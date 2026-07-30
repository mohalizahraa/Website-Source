"""Orchestration: ``translate_segment(seg, context) -> {en, engine, confidence}``.

Ties the pieces together in priority order:

1. **Sacred** (``kind == "sacred"``) → canonical detect-and-replace. Never MT.
2. **TM exact match** → reuse the approved English verbatim. Never MT.
3. **Routed MT** → local draft; escalate to cloud if low-confidence, doctrinal,
   or long. Each MT path runs a two-pass self-refine and a glossary-enforcement
   check.

The knowledge layer (glossary / TM / neighbours / style) is injected via the
prompt builder. Everything external sits behind an interface, so the default
pipeline is fully offline (mocks); production swaps in real adapters.
"""

from __future__ import annotations

import re
from typing import Optional

from . import arabic
from .interfaces import CanonicalDB, Translator
from .mocks import MockCanonicalDB, MockTranslator
from .prompt import PromptBuilder
from .router import Router
from .sacred import substitute_sacred
from .types import Context, Segment, TranslationResult

# Score at/above which a TM match counts as "exact" and is reused verbatim.
TM_EXACT_THRESHOLD = 0.995

# Some models (e.g. Qwen, DeepSeek) wrap output in a label or a translator's
# note despite "return only the translation". Strip those known wrappers so
# every engine is safe to use — conservative: only removes obvious meta lines.
_LABEL_RE = re.compile(
    r"^[\s*]*(?:improved translation|english translation|translation|"
    r"here is (?:the|my)(?: improved)? translation|the translation(?: is)?)[\s:*]*",
    re.IGNORECASE,
)
_TRAILING_NOTE_RE = re.compile(
    r"\n+\s*\(?(?:note|improved for|changes?:|i (?:have )?improved|this translation)\b.*$",
    re.IGNORECASE | re.DOTALL,
)


def _sanitize(text: str) -> str:
    """Strip a leading label line and a trailing translator's meta-note."""
    if not text:
        return text
    t = text.strip()
    t = _LABEL_RE.sub("", t, count=1).strip()
    t = _TRAILING_NOTE_RE.sub("", t).strip()
    if len(t) >= 2 and t[0] in "\"'`" and t[-1] == t[0]:
        t = t[1:-1].strip()
    return t


class Pipeline:
    """Configurable translation pipeline.

    Inject custom engines / DB / router for tests or production. The defaults
    are the offline mocks so ``Pipeline()`` works with no configuration.
    """

    def __init__(
        self,
        *,
        local: Optional[Translator] = None,
        cloud: Optional[Translator] = None,
        canonical_db: Optional[CanonicalDB] = None,
        router: Optional[Router] = None,
        prompt_builder: Optional[PromptBuilder] = None,
        refine: bool = True,
    ):
        self.local = local or MockTranslator("mock-local")
        self.cloud = cloud or MockTranslator("mock-cloud", force_confidence=0.9)
        self.canonical_db = canonical_db or MockCanonicalDB()
        self.router = router or Router()
        self.prompt_builder = prompt_builder or PromptBuilder()
        self.refine = refine

    # -- TM exact reuse ---------------------------------------------------
    def _tm_exact(self, seg: Segment, context: Context) -> Optional[dict]:
        ar = seg.get("ar", "")
        ar_norm = arabic.normalize(ar)
        for m in context.get("tm_matches") or []:
            score = m.get("score", 0.0)
            same = arabic.normalize(m.get("ar", "")) == ar_norm and ar_norm != ""
            if score >= TM_EXACT_THRESHOLD or same:
                return {
                    "en": m.get("en_approved", ""),
                    "engine": "tm-exact",
                    "confidence": 1.0,
                }
        return None

    # -- one MT pass + refine + glossary enforcement ----------------------
    def _mt(self, seg: Segment, context: Context, engine: Translator) -> TranslationResult:
        prompt = self.prompt_builder.build(seg, context)
        draft = engine.translate(prompt, ar=seg.get("ar", ""), context=context)
        result = draft
        if self.refine:
            refine_prompt = self.prompt_builder.build_refine(seg, context, draft.text)
            refined = engine.refine(
                draft.text, prompt=refine_prompt, ar=seg.get("ar", ""), context=context
            )
            # A refine pass that drops a big chunk of a long draft has almost
            # certainly TRUNCATED rather than improved — keep the fuller draft.
            d, r = len(draft.text.strip()), len(refined.text.strip())
            if r >= 0.75 * d or d < 400:
                result = refined
        result.text = _sanitize(result.text)
        result.text = self._enforce_glossary(seg, context, result.text)
        return result

    def _enforce_glossary(self, seg: Segment, context: Context, text: str) -> str:
        """Guarantee every applicable termbase rendering is present.

        A pipeline-level backstop independent of the engine: if a glossary term
        occurs in the source but its approved English is absent from the output,
        append it. Keeps terminology enforcement true for real engines too.
        """
        ar = seg.get("ar", "")
        for entry in context.get("glossary") or []:
            term_ar = entry.get("term_ar", "")
            term_en = entry.get("term_en", "")
            if term_en and arabic.contains(ar, term_ar) and term_en not in text:
                text = f"{text} [{term_en}]"
        return text

    # -- public entry -----------------------------------------------------
    def translate_segment(self, seg: Segment, context: Optional[Context] = None) -> dict:
        context = context or {}

        # 1) Sacred → canonical detect-and-replace. A miss is deliberately left
        # for human verification: an authoritative-looking machine rendering is
        # a quality regression here, even when produced by the frontier model.
        if seg.get("kind") == "sacred":
            replaced = substitute_sacred(seg, self.canonical_db)
            if replaced is not None:
                return replaced
            return {
                "en": "",
                "engine": "canonical-missing",
                "confidence": 0.0,
                "status": "needs_review",
                "needs_canonical": True,
            }

        # 2) TM exact match → reuse verbatim (never MT).
        tm = self._tm_exact(seg, context)
        if tm is not None:
            return tm

        # 3) Routed machine translation. Branch every tier explicitly so no
        # unexpected tier can silently fall through to local MT.
        decision = self.router.initial_tier(seg)

        if decision.tier == "cloud":
            result = self._mt(seg, context, self.cloud)
            return {"en": result.text, "engine": self.cloud.name, "confidence": result.confidence}

        if decision.tier == "local":
            # local draft, escalate to cloud when low-confidence OR blank output
            result = self._mt(seg, context, self.local)
            if self.router.should_escalate(result.confidence) or not result.text.strip():
                escalated = self._mt(seg, context, self.cloud)
                return {
                    "en": escalated.text,
                    "engine": self.cloud.name,
                    "confidence": escalated.confidence,
                }
            return {"en": result.text, "engine": self.local.name, "confidence": result.confidence}

        # Any other tier (e.g. "canonical" leaking here) must NOT be machine
        # translated — route to human review instead of silently MT'ing.
        return {
            "en": "",
            "engine": "canonical-missing" if decision.tier == "canonical" else decision.tier,
            "confidence": 0.0,
            "status": "needs_review",
            "needs_canonical": decision.tier == "canonical",
        }


# Module-level default pipeline (offline mocks) + convenience function so the
# contract `translate_segment(seg, context)` is importable directly.
_DEFAULT = Pipeline()


def translate_segment(seg: Segment, context: Optional[Context] = None) -> dict:
    """Translate one segment. See :meth:`Pipeline.translate_segment`.

    Uses a default, fully-offline pipeline (mock engines + canonical DB). For
    production, construct a :class:`Pipeline` with real adapters and call its
    method instead.
    """
    return _DEFAULT.translate_segment(seg, context)

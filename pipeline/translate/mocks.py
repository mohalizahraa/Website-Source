"""Deterministic offline mocks for the translation stage.

These satisfy the :mod:`interfaces` ABCs with no network access, so the whole
pipeline runs and is unit-testable offline (per ARCHITECTURE.md → "Environment
reality"). They are *fakes*, not stubs: the translator really applies the
glossary and produces stable output; the canonical DB really matches.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

from . import arabic
from .interfaces import CanonicalDB, Translator
from .types import CanonicalEntry, Context, Prompt, TranslationResult


class MockTranslator(Translator):
    """A deterministic, glossary-aware fake translator.

    Output is a stable, readable pseudo-translation:

    * Every glossary term whose Arabic appears in the source is rendered with
      its approved English (glossary enforcement is observable in the output).
    * A small built-in lexicon covers a few frequent words so results look
      translation-like.
    * Remaining tokens are passed through in ``⟨…⟩`` so nothing is silently
      dropped and output stays deterministic.

    Confidence is derived from lexical coverage, so richer glossary/context
    raises it. ``force_confidence`` pins it for routing tests, and ``label``
    lets a test stand up distinct "local" vs "cloud" engines.
    """

    # Tiny built-in AR→EN lexicon so the mock reads like a translation.
    LEXICON: Dict[str, str] = {
        "قال": "said",
        "الله": "God",
        "و": "and",
        "في": "in",
        "من": "from",
        "على": "upon",
        "الحمد": "praise",
        "رب": "Lord",
        "العالمين": "the worlds",
        "الكتاب": "the book",
        "العلم": "knowledge",
    }

    def __init__(
        self,
        label: str = "mock",
        *,
        force_confidence: Optional[float] = None,
    ):
        self.name = label
        self.force_confidence = force_confidence

    # -- helpers ----------------------------------------------------------
    def _lexicon_for(self, context: Context) -> Dict[str, str]:
        lex = dict(self.LEXICON)
        for entry in context.get("glossary") or []:
            key = arabic.normalize(entry.get("term_ar", ""))
            if key and not entry.get("transliterate"):
                lex[key] = entry.get("term_en", "")
            elif key and entry.get("transliterate"):
                # honour a transliteration rule: keep the given (Latin) form
                lex[key] = entry.get("term_en", "")
        return lex

    def _render(self, ar: str, context: Context) -> tuple[str, float]:
        lex = self._lexicon_for(context)
        toks = arabic.tokens(ar)
        if not toks:
            return "", 0.0
        out: List[str] = []
        hits = 0
        for tok in toks:
            if tok in lex:
                out.append(lex[tok])
                hits += 1
            else:
                out.append(f"⟨{tok}⟩")
        text = " ".join(out)
        # Multi-word glossary phrases: ensure phrase renderings appear verbatim.
        for entry in context.get("glossary") or []:
            if arabic.contains(ar, entry.get("term_ar", "")):
                en = entry.get("term_en", "")
                if en and en not in text:
                    text = f"{text} [{en}]"
                    hits += 1
        coverage = hits / max(len(toks), 1)
        confidence = 0.45 + 0.5 * min(coverage, 1.0)
        return text, min(confidence, 0.99)

    # -- interface --------------------------------------------------------
    def translate(self, prompt: Prompt, *, ar: str, context: Context) -> TranslationResult:
        text, conf = self._render(ar, context)
        if self.force_confidence is not None:
            conf = self.force_confidence
        return TranslationResult(text=text, confidence=conf, notes=f"mock:{self.name}").clamp()

    def refine(self, draft, *, prompt, ar, context) -> TranslationResult:
        # Second pass: re-assert any glossary rendering that went missing and
        # nudge confidence up slightly to reflect the extra scrutiny.
        text = draft
        for entry in context.get("glossary") or []:
            if arabic.contains(ar, entry.get("term_ar", "")):
                en = entry.get("term_en", "")
                if en and en not in text:
                    text = f"{text} [{en}]"
        conf = self.force_confidence
        if conf is None:
            _, base = self._render(ar, context)
            conf = min(base + 0.05, 0.99)
        return TranslationResult(text=text, confidence=conf, notes="mock refine").clamp()


class RecordingTranslator(Translator):
    """Wraps another translator and records whether it was invoked.

    Handy in tests to assert that sacred / TM-exact segments never reach an MT
    engine. If ``forbid`` is set, any call raises — a hard guarantee.
    """

    def __init__(self, inner: Translator, *, forbid: bool = False):
        self._inner = inner
        self.name = inner.name
        self.forbid = forbid
        self.calls: int = 0

    def _guard(self):
        self.calls += 1
        if self.forbid:
            raise AssertionError(
                f"translator {self.name!r} was called but must not be for this segment"
            )

    def translate(self, prompt, *, ar, context) -> TranslationResult:
        self._guard()
        return self._inner.translate(prompt, ar=ar, context=context)

    def refine(self, draft, *, prompt, ar, context) -> TranslationResult:
        self._guard()
        return self._inner.refine(draft, prompt=prompt, ar=ar, context=context)


class MockCanonicalDB(CanonicalDB):
    """In-memory canonical Qurʾān/Hadith store, seeded with real entries.

    Matching is on normalised Arabic (diacritics/OCR-noise tolerant): a segment
    matches an entry if the entry's canonical text is contained in it, or token
    similarity clears ``min_score``.
    """

    def __init__(self, entries: Optional[List[CanonicalEntry]] = None):
        self.entries: List[CanonicalEntry] = entries if entries is not None else _seed_entries()

    def add(self, entry: CanonicalEntry) -> None:
        self.entries.append(entry)

    #: containment only counts as a strong match when the two strings are of
    #: comparable length — a short fragment inside a long verse must NOT trigger
    #: a full-verse substitution.
    CONTAINMENT_LEN_RATIO = 0.8

    def match(self, ar: str, *, min_score: float = 0.6) -> Optional[CanonicalEntry]:
        if not ar:
            return None
        a = arabic.normalize(ar)
        if not a:
            return None
        best: Optional[CanonicalEntry] = None
        best_score = 0.0
        for entry in self.entries:
            b = arabic.normalize(entry.ar_canonical)
            if not b:
                continue
            if a == b:
                score = 1.0
            else:
                # Primary signal: token-overlap (Jaccard). A full verse with
                # only diacritic/OCR differences still scores ~1.0 here.
                score = arabic.similarity(ar, entry.ar_canonical)
                # Containment boost ONLY when lengths are comparable, so a tiny
                # fragment ("هو") cannot borrow a long verse's score.
                if a in b or b in a:
                    ratio = min(len(a), len(b)) / max(len(a), len(b))
                    if ratio >= self.CONTAINMENT_LEN_RATIO:
                        score = max(score, 0.97)
            if score > best_score:
                best_score, best = score, entry
        if best is not None and best_score >= min_score:
            return CanonicalEntry(
                ref=best.ref,
                kind=best.kind,
                ar_canonical=best.ar_canonical,
                en_approved=best.en_approved,
                score=best_score,
            )
        return None


def _seed_entries() -> List[CanonicalEntry]:
    """At least one Qurʾān verse and one Hadith, as required by the contract."""
    return [
        CanonicalEntry(
            ref="Qurʾān 57:3",
            kind="quran",
            ar_canonical=(
                "هُوَ الْأَوَّلُ وَالْآخِرُ وَالظَّاهِرُ وَالْبَاطِنُ ۖ "
                "وَهُوَ بِكُلِّ شَيْءٍ عَلِيمٌ"
            ),
            en_approved=(
                "He is the First and the Last, the Manifest and the Hidden, "
                "and He has full knowledge of all things."
            ),
        ),
        CanonicalEntry(
            ref="Ṣaḥīḥ al-Bukhārī 1",
            kind="hadith",
            ar_canonical="إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ",
            en_approved="Actions are but by intentions.",
        ),
    ]

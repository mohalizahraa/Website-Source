"""score_segment — the QA stage entry point.

Contract (ARCHITECTURE.md):
    score_segment(seg) -> { bt_sim, self_consistency, judge_score, judge_note,
                            footnote_ok, status }

Signals:
  1. bt_sim            back-translation adequacy, cosine(embed(ar),
                       embed(back_translate(en))) via a DIFFERENT translator.
  2. self_consistency  divergence between two independent samples of the
                       translation -> a stability score.
  3. judge_score       weighted MQM rubric from an LLM-as-judge (adequacy,
                       fluency, terminology, footnote_placement) + judge_note.
  4. footnote_ok       positional footnote check (footnotes.check_footnotes):
                       anchors survive AND stay attached to the right clause.
  5. status            gate: approved | needs_review.

Gate (per architecture): approve a normal segment only if bt_sim, judge_score
AND footnote placement all pass their thresholds (self_consistency is an extra
soft guard). A ``sacred`` segment is approved only if it exactly matches the
canonical Qurʾān/Hadith store (canonical-match = true).

All external models are injected; defaults are the offline deterministic mocks,
so ``score_segment(seg)`` runs with no arguments and no network.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .config import DEFAULT_THRESHOLDS, Thresholds
from .footnotes import check_footnotes
from .interfaces import CanonicalStore, Embedder, Judge, Translator
from .mocks import (
    MockBackTranslator,
    MockCanonicalStore,
    MockEmbedder,
    MockForwardTranslator,
    MockJudge,
    cosine,
)


@dataclass
class QADeps:
    """Injectable model dependencies. Defaults = offline mocks."""

    embedder: Embedder
    back_translator: Translator      # QA-side; MUST differ from producing engine
    sampler: Translator              # ar->en engine, sampled for self-consistency
    judge: Judge
    canonical_store: CanonicalStore

    @staticmethod
    def default() -> "QADeps":
        return QADeps(
            embedder=MockEmbedder(),
            back_translator=MockBackTranslator(),
            sampler=MockForwardTranslator(),
            judge=MockJudge(),
            canonical_store=MockCanonicalStore(),
        )


def _english(seg: dict) -> str:
    """The current English rendering, tolerating wire vs DB field names."""
    for key in ("en", "en_current", "en_draft"):
        val = seg.get(key)
        if val:
            return val
    return ""


def score_segment(
    seg: dict,
    deps: Optional[QADeps] = None,
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> dict:
    """Score one segment and gate it. See module docstring for the contract."""
    deps = deps or QADeps.default()
    ar = seg.get("ar", "") or ""
    en = _english(seg)
    kind = seg.get("kind", "body")

    # --- 4. Footnote positional check (authoritative) -------------------- #
    fn = check_footnotes(
        ar,
        en,
        clause_tol=thresholds.footnote_clause_tol,
        token_tol=thresholds.footnote_token_tol,
    )
    footnote_ok = fn.footnote_ok

    # --- 1. Back-translation adequacy ------------------------------------ #
    back_ar = deps.back_translator.translate(en, src="en", tgt="ar")
    bt_sim = round(cosine(deps.embedder.embed(ar), deps.embedder.embed(back_ar)), 3)

    # --- 2. Self-consistency --------------------------------------------- #
    s1 = deps.sampler.sample(ar, src="ar", tgt="en", seed=1)
    s2 = deps.sampler.sample(ar, src="ar", tgt="en", seed=2)
    self_consistency = round(
        cosine(deps.embedder.embed(s1), deps.embedder.embed(s2)), 3
    )

    # --- 3. LLM-as-judge (MQM rubric) ------------------------------------ #
    rubric = deps.judge.judge(ar, en, kind)
    judge_score = round(
        thresholds.w_adequacy * rubric["adequacy"]
        + thresholds.w_fluency * rubric["fluency"]
        + thresholds.w_terminology * rubric["terminology"]
        + thresholds.w_footnote * rubric["footnote_placement"],
        3,
    )
    judge_note = rubric.get("note", "")

    # --- 5. Gate --------------------------------------------------------- #
    status, gate_reason = _gate(
        seg,
        kind,
        ar,
        en,
        bt_sim,
        judge_score,
        rubric["adequacy"],
        self_consistency,
        fn,
        deps,
        thresholds,
    )

    # Surface the decisive footnote reason so reviewers see WHY, not just a flag.
    if fn.reason and fn.reason not in judge_note:
        judge_note = f"{judge_note} | footnotes: {fn.reason}"
    if gate_reason:
        judge_note = f"{judge_note} | gate: {gate_reason}"

    return {
        "bt_sim": bt_sim,
        "self_consistency": self_consistency,
        "judge_score": judge_score,
        "judge_note": judge_note,
        "footnote_ok": footnote_ok,
        "status": status,
    }


def _is_degenerate(text: str) -> bool:
    """True if text is empty/whitespace or contains ONLY footnote anchors."""
    from .footnotes import ANCHOR_RE

    return not ANCHOR_RE.sub(" ", text or "").strip()


def _gate(seg, kind, ar, en, bt_sim, judge_score, adequacy,
          self_consistency, fn, deps, thr):
    """Return (status, reason). status in {approved, needs_review}."""
    # Blank/degenerate guard (all kinds): empty or anchor-only source or
    # translation is never approvable, even though a mock embedder may report
    # a spuriously high bt_sim for two empty strings.
    if _is_degenerate(ar) or _is_degenerate(en):
        return "needs_review", "empty/anchor-only source or translation"

    if kind == "sacred":
        approved_en = deps.canonical_store.lookup(ar)
        if approved_en is not None and en.strip() == approved_en.strip():
            return "approved", ""
        if approved_en is None:
            return "needs_review", "sacred segment not found in canonical store"
        return "needs_review", "sacred segment does not match canonical English"

    fails = []
    if bt_sim < thr.bt_sim_min:
        fails.append(f"bt_sim {bt_sim} < {thr.bt_sim_min}")
    if judge_score < thr.judge_min:
        fails.append(f"judge_score {judge_score} < {thr.judge_min}")
    # Hard adequacy floor: a fragmentary translation can clear the *average*
    # judge_score on the strength of fluency/terminology/footnotes while barely
    # preserving meaning. Reject it regardless of the average.
    if adequacy < thr.adequacy_min:
        fails.append(f"adequacy {adequacy} < {thr.adequacy_min}")
    if not fn.footnote_ok:
        fails.append("footnote placement failed")
    if self_consistency < thr.self_consistency_min:
        fails.append(f"self_consistency {self_consistency} < {thr.self_consistency_min}")

    if fails:
        return "needs_review", "; ".join(fails)
    return "approved", ""

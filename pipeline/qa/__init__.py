"""Haydari QA stage: back-translation adequacy, self-consistency, LLM-judge,
positional footnote verification, and approve/needs_review gating.

Public API:
    score_segment(seg) -> { bt_sim, self_consistency, judge_score,
                            judge_note, footnote_ok, status }
"""
from .config import DEFAULT_THRESHOLDS, Thresholds
from .footnotes import FootnoteReport, check_footnotes, extract_anchors
from .scoring import QADeps, score_segment

__all__ = [
    "score_segment",
    "QADeps",
    "check_footnotes",
    "extract_anchors",
    "FootnoteReport",
    "Thresholds",
    "DEFAULT_THRESHOLDS",
]

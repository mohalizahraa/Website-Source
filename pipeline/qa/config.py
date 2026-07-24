"""Gating thresholds for the QA stage.

Kept in one place so reviewers can tune the approve/needs_review boundary as the
real models are swapped in for the mocks.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Thresholds:
    # Back-translation adequacy floor: cosine(embed(ar), embed(back_translate(en))).
    bt_sim_min: float = 0.50
    # LLM-judge overall score floor (weighted MQM rubric).
    judge_min: float = 0.70
    # Hard floor on the MQM *adequacy* dimension alone. Averaging can hide a
    # fragmentary translation (adequacy low, other dims high); this floor forces
    # needs_review whenever meaning preservation is poor, regardless of the mean.
    adequacy_min: float = 0.60
    # Self-consistency floor (stability of the engine across samples). Soft guard.
    self_consistency_min: float = 0.55

    # Weights for the judge's MQM dimensions -> overall judge_score.
    w_adequacy: float = 0.35
    w_fluency: float = 0.20
    w_terminology: float = 0.20
    w_footnote: float = 0.25

    # Max allowed difference in clause-position ratio for a footnote anchor
    # between source and translation before we call it a placement error.
    # Boundary is inclusive (drift == tol is rejected).
    footnote_clause_tol: float = 0.20
    # Max allowed difference in *token*-position ratio for an anchor. Catches an
    # anchor that moves WITHIN a single clause (where clause ratio is unchanged).
    # More lenient than clause_tol because word order legitimately shifts in
    # translation. Boundary inclusive.
    footnote_token_tol: float = 0.30


DEFAULT_THRESHOLDS = Thresholds()

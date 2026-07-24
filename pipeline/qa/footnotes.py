"""Positional footnote verification — the core improvement over the old pipeline.

The legacy QA (see books/process_book.py) approved a page when the *count* of
footnote markers in the source equalled the count in the draft:

    status = "draft_ready" if source_anchors == draft_anchors else "needs_review"

That lets garbled or reordered text pass as long as the number of markers is
right. This module instead treats each ``[[FN-n]]`` marker as an indexed,
positionally-verifiable anchor (per the architecture's anchor scheme) and checks
that every source anchor:

  1. *survives* translation (same multiset of anchor ids — no dropped/added),
  2. keeps its *relative order* among the other anchors, and
  3. stays attached to the *corresponding clause* (clause-position ratio within
     tolerance).

Checks 2 and 3 are complementary: order catches swaps within a single clause;
clause-ratio catches an anchor that migrated to a different sentence/clause.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

# Body-text footnote reference, e.g. [[FN-3]]. Never a bare glyph.
ANCHOR_RE = re.compile(r"\[\[FN-(\d+)\]\]")

# Sentence/clause boundaries across Arabic and English punctuation.
#   . ! ?   Latin terminators
#   ؟ ؛     Arabic question mark / semicolon
#   ، ,     comma (clause boundary)
#   ;       semicolon
_CLAUSE_SPLIT_RE = re.compile(r"[.!?؟؛;،,]")

# Word tokens in either script (letters only; excludes digits/punctuation).
# Language-agnostic so token *position ratios* are comparable across ar/en.
_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


@dataclass
class AnchorHit:
    id: str            # e.g. "FN-1"
    order: int         # 0-based occurrence index within the text
    clause_index: int  # which clause the anchor sits in
    total_clauses: int
    clause_ratio: float  # clause_index / total_clauses  (0..1)
    token_ratio: float   # words-before-anchor / total-words (0..1)


def _clause_spans(text: str) -> List[tuple]:
    """Return (start, end) char spans of non-empty clauses in reading order."""
    spans = []
    start = 0
    for m in _CLAUSE_SPLIT_RE.finditer(text):
        spans.append((start, m.start()))
        start = m.end()
    spans.append((start, len(text)))
    return [(s, e) for (s, e) in spans if text[s:e].strip()]


def _clause_of(spans: List[tuple], pos: int) -> int:
    """Index of the clause containing char position ``pos`` (nearest preceding)."""
    idx = 0
    for i, (s, e) in enumerate(spans):
        if s <= pos < e:
            return i
        if pos >= e:
            idx = i
    return idx


def _token_ratio(text: str, char_pos: int, total_words: int) -> float:
    """Fraction of word-tokens that precede the anchor at ``char_pos``."""
    if total_words == 0:
        return 0.0
    before = len(_WORD_RE.findall(ANCHOR_RE.sub(" ", text[:char_pos])))
    return before / total_words


def extract_anchors(text: str) -> List[AnchorHit]:
    """Extract ordered anchors with their clause- and token-position signatures."""
    spans = _clause_spans(text)
    total = max(len(spans), 1)
    total_words = len(_WORD_RE.findall(ANCHOR_RE.sub(" ", text)))
    hits: List[AnchorHit] = []
    for i, m in enumerate(ANCHOR_RE.finditer(text)):
        ci = _clause_of(spans, m.start())
        hits.append(
            AnchorHit(
                id=f"FN-{m.group(1)}",
                order=i,
                clause_index=ci,
                total_clauses=total,
                clause_ratio=ci / total,
                token_ratio=_token_ratio(text, m.start(), total_words),
            )
        )
    return hits


@dataclass
class FootnoteReport:
    footnote_ok: bool
    count_match: bool
    survived: bool           # same multiset of anchor ids
    order_ok: bool           # same sequence of anchor ids
    placement_ok: bool       # per-anchor clause ratio within tolerance
    source_ids: List[str] = field(default_factory=list)
    target_ids: List[str] = field(default_factory=list)
    reason: str = ""


def check_footnotes(
    ar: str,
    en: str,
    clause_tol: float = 0.20,
    token_tol: float = 0.30,
) -> FootnoteReport:
    """Positionally verify that source anchors survive AND stay in place.

    ``footnote_ok`` is True only when count, survival, order, clause-placement
    AND token-placement all hold. A translation with the right *count* but the
    wrong *placement* (the case the old pipeline missed) returns
    ``footnote_ok = False`` — including an anchor that drifts *within* a single
    clause, which the clause-level check alone cannot see.

    Both drift bounds are inclusive: drift *equal to* the tolerance is rejected.
    """
    src = extract_anchors(ar)
    tgt = extract_anchors(en)
    src_ids = [h.id for h in src]
    tgt_ids = [h.id for h in tgt]

    count_match = len(src_ids) == len(tgt_ids)
    survived = sorted(src_ids) == sorted(tgt_ids)
    order_ok = src_ids == tgt_ids

    # No anchors in the source -> nothing to place; trivially ok (but flag extras).
    if not src_ids:
        ok = len(tgt_ids) == 0
        return FootnoteReport(
            footnote_ok=ok,
            count_match=count_match,
            survived=survived,
            order_ok=order_ok,
            placement_ok=ok,
            source_ids=src_ids,
            target_ids=tgt_ids,
            reason="" if ok else "translation introduced footnote anchors absent from source",
        )

    # Placement: for each id (matched by occurrence order among identical ids)
    # compare BOTH its clause-position ratio and its token-position ratio between
    # source and translation. Clause ratio catches cross-clause moves; token
    # ratio catches within-clause moves. Only meaningful when ids survived.
    placement_ok = True
    worst_clause = 0.0
    worst_token = 0.0
    clause_fail = False
    token_fail = False
    if survived:
        src_by_id: dict = {}
        tgt_by_id: dict = {}
        for h in src:
            src_by_id.setdefault(h.id, []).append(h)
        for h in tgt:
            tgt_by_id.setdefault(h.id, []).append(h)
        for aid, shits in src_by_id.items():
            thits = tgt_by_id.get(aid, [])
            for i, sh in enumerate(shits):
                th = thits[i] if i < len(thits) else None
                if th is None:
                    placement_ok = False
                    continue
                cdiff = abs(sh.clause_ratio - th.clause_ratio)
                tdiff = abs(sh.token_ratio - th.token_ratio)
                worst_clause = max(worst_clause, cdiff)
                worst_token = max(worst_token, tdiff)
                if cdiff >= clause_tol:
                    clause_fail = True
                if tdiff >= token_tol:
                    token_fail = True
        if clause_fail or token_fail:
            placement_ok = False
    else:
        placement_ok = False

    footnote_ok = count_match and survived and order_ok and placement_ok

    # Build a human-readable reason for the judge_note / reviewer.
    missing = sorted(set(src_ids) - set(tgt_ids))
    extra = sorted(set(tgt_ids) - set(src_ids))
    if footnote_ok:
        reason = ""
    elif missing or extra:
        reason = (
            f"anchors changed: missing={missing} extra={extra} "
            f"(source count={len(src_ids)}, translation count={len(tgt_ids)})"
        )
    elif not order_ok:
        reason = (
            f"anchor order changed: source={src_ids} translation={tgt_ids} "
            "(same count, wrong placement)"
        )
    elif clause_fail:
        reason = (
            f"anchor attached to wrong clause (max clause-ratio drift "
            f"{worst_clause:.2f} >= tol {clause_tol:.2f}); same count, wrong placement"
        )
    else:
        reason = (
            f"anchor moved within its clause (max token-position drift "
            f"{worst_token:.2f} >= tol {token_tol:.2f}); same count, wrong placement"
        )

    return FootnoteReport(
        footnote_ok=footnote_ok,
        count_match=count_match,
        survived=survived,
        order_ok=order_ok,
        placement_ok=placement_ok,
        source_ids=src_ids,
        target_ids=tgt_ids,
        reason=reason,
    )

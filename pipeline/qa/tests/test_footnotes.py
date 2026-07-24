"""Positional footnote checker tests.

Headline: a translation with the CORRECT anchor count but the WRONG placement
must be rejected — proving we beat the legacy count-only check
(books/process_book.py: `status = draft_ready if source==draft else needs_review`).
"""
from pipeline.qa.footnotes import check_footnotes, extract_anchors


# Source: two clauses, one anchor attached to each.
AR = "ذهب المتكلمون إلى أن العقل مقدم [[FN-1]]، وقال الفلاسفة بخلاف ذلك [[FN-2]]."


def test_good_translation_preserves_placement():
    en = (
        "The theologians held that reason takes precedence [[FN-1]], "
        "and the philosophers said otherwise [[FN-2]]."
    )
    r = check_footnotes(AR, en)
    assert r.footnote_ok
    assert r.count_match and r.survived and r.order_ok and r.placement_ok


def test_adversarial_right_count_wrong_placement_is_caught():
    """THE key case: same 2 anchors present (count matches) but SWAPPED.

    The old pipeline would have called this draft_ready. We reject it.
    """
    en = (
        "The theologians held that reason takes precedence [[FN-2]], "
        "and the philosophers said otherwise [[FN-1]]."
    )
    r = check_footnotes(AR, en)
    assert r.count_match is True          # count is identical...
    assert r.survived is True             # ...same anchor ids present...
    assert r.footnote_ok is False         # ...but placement is wrong -> caught
    assert r.order_ok is False
    assert "wrong placement" in r.reason


def test_anchor_migrated_to_wrong_clause_is_caught():
    """Order of ids preserved, but FN-2 dragged into the first clause."""
    en = (
        "The theologians held that reason takes precedence [[FN-1]] [[FN-2]], "
        "and the philosophers said otherwise."
    )
    r = check_footnotes(AR, en)
    assert r.count_match is True
    assert r.survived is True
    assert r.order_ok is True             # ids still in the order FN-1, FN-2
    assert r.placement_ok is False        # but FN-2 jumped clauses
    assert r.footnote_ok is False


def test_dropped_anchor_is_caught():
    en = "The theologians held that reason takes precedence [[FN-1]]."
    r = check_footnotes(AR, en)
    assert r.count_match is False
    assert r.footnote_ok is False
    assert "FN-2" in r.reason


def test_extra_anchor_is_caught():
    en = (
        "The theologians held [[FN-1]], and the philosophers [[FN-2]] "
        "disagreed [[FN-3]]."
    )
    r = check_footnotes(AR, en)
    assert r.footnote_ok is False
    assert "FN-3" in r.reason


def test_no_source_anchors_but_translation_adds_one():
    r = check_footnotes("جملة بلا حواشي.", "A sentence with a stray [[FN-1]].")
    assert r.footnote_ok is False


def test_no_anchors_either_side_is_ok():
    r = check_footnotes("جملة بسيطة.", "A simple sentence.")
    assert r.footnote_ok is True


def test_extract_anchor_signature():
    hits = extract_anchors(AR)
    assert [h.id for h in hits] == ["FN-1", "FN-2"]
    assert hits[0].clause_index == 0
    assert hits[1].clause_index == 1


# --- Regression (gap 3): within-clause movement ------------------------------
# Single clause -> clause-level check gives NO protection; token position must.
AR_ONE_CLAUSE = "الطالب المجتهد [[FN-1]] النبيه"


def test_within_clause_move_is_caught():
    """FN-1 slides to the end of the same clause. Clause index is unchanged,
    so only the token-position check can catch it."""
    en = "the diligent clever student [[FN-1]]"
    r = check_footnotes(AR_ONE_CLAUSE, en)
    assert r.count_match is True and r.survived is True and r.order_ok is True
    assert r.footnote_ok is False           # token drift caught it
    assert "within its clause" in r.reason


def test_within_clause_small_shift_still_ok():
    """A faithful reordering keeps the anchor near its source token position."""
    en = "the diligent [[FN-1]] clever student"
    r = check_footnotes(AR_ONE_CLAUSE, en)
    assert r.footnote_ok is True


# --- Regression (gap 4): drift exactly equal to tolerance --------------------
def test_clause_drift_equal_to_tolerance_is_caught():
    """5 clauses; moving one clause = 0.20 drift == clause_tol. Inclusive bound
    means at-tolerance movement is rejected (was passing with '>')."""
    ar = "a [[FN-1]], b, c, d, e."
    en = "a, b [[FN-1]], c, d, e."   # FN-1 clause 0 -> clause 1 => drift 0.20
    r = check_footnotes(ar, en, clause_tol=0.20)
    assert abs((1 / 5) - 0.20) < 1e-9   # the drift is exactly the tolerance
    assert r.footnote_ok is False
    assert "wrong clause" in r.reason

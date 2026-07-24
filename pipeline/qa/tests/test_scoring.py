"""End-to-end score_segment / gating tests (fully offline via mocks)."""
from pipeline.qa import score_segment
from pipeline.qa.config import Thresholds
from pipeline.qa.mocks import MockCanonicalStore
from pipeline.qa.scoring import QADeps


AR = "ذهب المتكلمون إلى أن العقل مقدم على النقل [[FN-1]]، وقال الفلاسفة بخلاف ذلك [[FN-2]]."


def _seg(**kw):
    base = {
        "id": "B-01:042:03",
        "book_id": "B-01",
        "page": 42,
        "order": 3,
        "kind": "body",
        "anchor": None,
        "ar": AR,
        "engine": "mock-forward-v1",
    }
    base.update(kw)
    return base


def test_good_segment_is_approved():
    en = (
        "The mutakallimun held that reason precedes revelation [[FN-1]], "
        "and the philosophers said otherwise [[FN-2]]."
    )
    out = score_segment(_seg(en=en))
    assert set(out) == {
        "bt_sim", "self_consistency", "judge_score",
        "judge_note", "footnote_ok", "status",
    }
    assert out["footnote_ok"] is True
    assert out["bt_sim"] >= 0.50
    assert out["judge_score"] >= 0.70
    assert out["status"] == "approved"


def test_adversarial_footnote_swap_needs_review():
    """Right anchor count, wrong placement -> needs_review.

    Contrast with the legacy count-only check which would have passed it.
    """
    en = (
        "The mutakallimun held that reason precedes revelation [[FN-2]], "
        "and the philosophers said otherwise [[FN-1]]."
    )
    out = score_segment(_seg(en=en))
    assert out["footnote_ok"] is False
    assert out["status"] == "needs_review"
    assert "placement" in out["judge_note"]


def test_low_bt_sim_needs_review():
    """Off-topic translation: content diverges, back-translation won't match."""
    en = "The weather is nice today [[FN-1]] [[FN-2]]."
    out = score_segment(_seg(en=en))
    assert out["bt_sim"] < 0.50
    assert out["status"] == "needs_review"


def test_dropped_anchor_needs_review():
    en = "The mutakallimun held that reason precedes revelation [[FN-1]]."
    out = score_segment(_seg(en=en))
    assert out["footnote_ok"] is False
    assert out["status"] == "needs_review"


def test_sacred_segment_matching_canonical_is_approved():
    ar = "بسم الله الرحمن الرحيم"
    en = "In the name of God, the Most Gracious, the Most Merciful"
    out = score_segment(_seg(kind="sacred", ar=ar, en=en, anchor=None))
    assert out["status"] == "approved"


def test_sacred_segment_mismatch_needs_review():
    ar = "بسم الله الرحمن الرحيم"
    en = "In the name of Allah, the beneficent, the merciful"  # paraphrase, not canonical
    out = score_segment(_seg(kind="sacred", ar=ar, en=en))
    assert out["status"] == "needs_review"
    assert "canonical" in out["judge_note"]


def test_sacred_segment_not_in_store_needs_review():
    ar = "آية غير موجودة في قاعدة البيانات"
    out = score_segment(_seg(kind="sacred", ar=ar, en="some translation"))
    assert out["status"] == "needs_review"


def test_dependencies_are_injectable():
    """A custom canonical store can be injected without touching QA code."""
    deps = QADeps.default()
    deps.canonical_store = MockCanonicalStore({"قل هو الله أحد": "Say: He is God, the One"})
    out = score_segment(
        _seg(kind="sacred", ar="قل هو الله أحد", en="Say: He is God, the One"),
        deps=deps,
    )
    assert out["status"] == "approved"


def test_fragmentary_translation_blocked_by_adequacy_floor():
    """Regression (gap 1): averaging hid low adequacy.

    This segment passes every OTHER gate — bt_sim >= min, judge_score >= min,
    self_consistency >= min, footnote_ok — yet the MQM adequacy dimension is only
    0.50 (half the source content is dropped). Without the hard adequacy floor
    the weighted average approves it; with the floor it is needs_review.
    """
    seg = _seg(ar="قال الفلاسفة النقل الرسول", en="the philosophers said", anchor=None)
    out = score_segment(seg)

    # every other signal passes...
    assert out["bt_sim"] >= 0.50
    assert out["judge_score"] >= 0.70
    assert out["self_consistency"] >= 0.55
    assert out["footnote_ok"] is True
    # ...but low adequacy forces review
    assert out["status"] == "needs_review"
    assert "adequacy" in out["judge_note"]

    # Prove the floor is what catches it: disable it (old behavior) -> approved.
    relaxed = score_segment(seg, thresholds=Thresholds(adequacy_min=0.0))
    assert relaxed["status"] == "approved"


def test_empty_segment_never_approved():
    """Regression (gap 2): blank content scored bt_sim=1.0 and was approved."""
    out = score_segment(_seg(ar="", en="", anchor=None))
    assert out["status"] == "needs_review"
    assert "empty" in out["judge_note"]


def test_anchor_only_content_never_approved():
    """Regression (gap 2): anchor-only source/translation is degenerate."""
    out = score_segment(_seg(ar="[[FN-1]]", en="[[FN-1]]", anchor="FN-1"))
    assert out["status"] == "needs_review"


def test_empty_translation_of_real_source_needs_review():
    """Regression (gap 2): a real source with a blank translation is not ok."""
    out = score_segment(_seg(en="   "))
    assert out["status"] == "needs_review"


def test_wire_format_field_fallback():
    """en_current / en_draft are accepted when 'en' is absent (DB shape)."""
    en = (
        "The mutakallimun held that reason precedes revelation [[FN-1]], "
        "and the philosophers said otherwise [[FN-2]]."
    )
    seg = _seg()
    seg.pop("engine", None)
    seg["en_current"] = en
    out = score_segment(seg)
    assert out["status"] == "approved"

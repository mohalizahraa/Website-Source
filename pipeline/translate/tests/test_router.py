"""Balanced routing: escalate low-confidence / doctrinal / sacred / long."""

from translate import MockTranslator, Pipeline, RecordingTranslator, Router


def _pipe(local_conf, cloud_conf=0.95, **kw):
    return Pipeline(
        local=MockTranslator("mock-local", force_confidence=local_conf),
        cloud=MockTranslator("mock-cloud", force_confidence=cloud_conf),
        **kw,
    )


def test_low_confidence_local_escalates_to_cloud():
    pipe = _pipe(local_conf=0.5)
    seg = {"kind": "body", "ar": "جملة قصيرة للاختبار"}
    out = pipe.translate_segment(seg, {})
    assert out["engine"] == "mock-cloud"
    assert out["confidence"] == 0.95


def test_confident_local_stays_local():
    pipe = _pipe(local_conf=0.9)
    seg = {"kind": "body", "ar": "جملة قصيرة للاختبار"}
    out = pipe.translate_segment(seg, {})
    assert out["engine"] == "mock-local"


def test_doctrinal_goes_straight_to_cloud_even_if_local_would_be_confident():
    # Local engine forbidden → proves doctrinal content never drafts locally.
    forbid_local = RecordingTranslator(MockTranslator("mock-local"), forbid=True)
    pipe = Pipeline(
        local=forbid_local,
        cloud=MockTranslator("mock-cloud", force_confidence=0.95),
    )
    seg = {"kind": "body", "ar": "باب في التوحيد والصفات"}
    out = pipe.translate_segment(seg, {})
    assert out["engine"] == "mock-cloud"
    assert forbid_local.calls == 0


def test_long_segment_goes_to_cloud():
    pipe = _pipe(local_conf=0.99)
    seg = {"kind": "body", "ar": "كلمة " * 200}  # > 600 chars
    out = pipe.translate_segment(seg, {})
    assert out["engine"] == "mock-cloud"


def test_router_initial_tier_classifies_sacred_and_doctrinal():
    r = Router()
    assert r.initial_tier({"kind": "sacred", "ar": "..."}).tier == "canonical"
    assert r.initial_tier({"kind": "body", "ar": "التوحيد"}).tier == "cloud"
    assert r.initial_tier({"kind": "body", "ar": "نص عادي"}).tier == "local"
    assert r.initial_tier({"kind": "body", "ar": "x", "doctrinal": True}).tier == "cloud"


def test_should_escalate_threshold():
    r = Router(confidence_threshold=0.8)
    assert r.should_escalate(0.79) is True
    assert r.should_escalate(0.8) is False


def test_blank_local_output_escalates_even_at_threshold_confidence():
    # REGRESSION (bug 2): a blank/whitespace local draft returned at exactly the
    # threshold confidence (0.8) must still escalate — empty output is never OK.
    from translate import TranslationResult
    from translate.interfaces import Translator

    class BlankLocal(Translator):
        name = "blank-local"

        def translate(self, prompt, *, ar, context):
            return TranslationResult(text="   ", confidence=0.8)
        # inherits the default no-op refine() (also confidence 0.8)

    pipe = Pipeline(
        local=BlankLocal(),
        cloud=MockTranslator("mock-cloud", force_confidence=0.95),
    )
    out = pipe.translate_segment({"kind": "body", "ar": "نص عادي"}, {})
    assert out["engine"] == "mock-cloud"
    assert out["en"].strip() != ""

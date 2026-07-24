"""Translation-memory reuse: exact matches are used verbatim, fuzzy are hints."""

from translate import MockTranslator, Pipeline, RecordingTranslator


def test_exact_tm_match_reused_verbatim_not_mt():
    forbid = RecordingTranslator(MockTranslator("mt"), forbid=True)
    pipe = Pipeline(local=forbid, cloud=forbid)
    seg = {"kind": "body", "ar": "الحمد لله رب العالمين"}
    context = {
        "tm_matches": [
            {"ar": "الحمد لله رب العالمين", "en_approved": "Praise be to God, Lord of the worlds.", "score": 1.0}
        ]
    }
    out = pipe.translate_segment(seg, context)
    assert out["engine"] == "tm-exact"
    assert out["en"] == "Praise be to God, Lord of the worlds."
    assert out["confidence"] == 1.0
    assert forbid.calls == 0  # never machine-translated


def test_exact_match_by_normalized_equality_even_with_low_score():
    # Same text modulo diacritics; the stored score is low but it's an exact match.
    forbid = RecordingTranslator(MockTranslator("mt"), forbid=True)
    pipe = Pipeline(local=forbid, cloud=forbid)
    seg = {"kind": "body", "ar": "إِنَّمَا الْأَعْمَالُ"}
    context = {"tm_matches": [{"ar": "انما الاعمال", "en_approved": "Only deeds", "score": 0.4}]}
    out = pipe.translate_segment(seg, context)
    assert out["engine"] == "tm-exact"
    assert out["en"] == "Only deeds"
    assert forbid.calls == 0


def test_fuzzy_match_is_not_reused_verbatim():
    pipe = Pipeline(
        local=MockTranslator("mock-local", force_confidence=0.9),
        cloud=MockTranslator("mock-cloud", force_confidence=0.95),
    )
    seg = {"kind": "body", "ar": "الحمد لله رب العالمين والصلاة"}
    context = {
        "tm_matches": [
            {"ar": "الحمد لله رب العالمين", "en_approved": "Praise be to God.", "score": 0.7}
        ]
    }
    out = pipe.translate_segment(seg, context)
    assert out["engine"] != "tm-exact"
    assert out["en"] != "Praise be to God."


def test_fuzzy_match_injected_into_prompt():
    from translate import PromptBuilder

    seg = {"kind": "body", "ar": "نص جديد"}
    context = {
        "tm_matches": [
            {"ar": "نص قديم", "en_approved": "An old passage.", "score": 0.72}
        ]
    }
    prompt = PromptBuilder().build(seg, context)
    assert "An old passage." in prompt.render()
    assert "TRANSLATION MEMORY" in prompt.render()

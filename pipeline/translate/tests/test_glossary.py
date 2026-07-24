"""Glossary / termbase enforcement."""

from translate import MockTranslator, Pipeline, translate_segment


GLOSSARY = [
    {
        "term_ar": "المتكلمون",
        "term_en": "the dialectical theologians (mutakallimūn)",
        "note": "kalām practitioners",
    },
    {"term_ar": "العلم", "term_en": "knowledge"},
]


def test_glossary_term_appears_in_output_default_pipeline():
    seg = {"id": "B-1:001:01", "kind": "body", "ar": "فذهب المتكلمون إلى هذا القول"}
    context = {"glossary": GLOSSARY}
    out = translate_segment(seg, context)
    assert "the dialectical theologians (mutakallimūn)" in out["en"]
    assert out["engine"]
    assert 0.0 <= out["confidence"] <= 1.0


def test_glossary_enforced_even_if_engine_omits_it():
    # An engine that ignores the glossary entirely (returns fixed English).
    class BlindTranslator(MockTranslator):
        def translate(self, prompt, *, ar, context):
            from translate import TranslationResult

            return TranslationResult(text="Some plain rendering.", confidence=0.95)

        def refine(self, draft, *, prompt, ar, context):
            from translate import TranslationResult

            return TranslationResult(text=draft, confidence=0.95)

    pipe = Pipeline(local=BlindTranslator("blind"), cloud=BlindTranslator("blind"))
    seg = {"kind": "body", "ar": "العلم نور"}
    out = pipe.translate_segment(seg, {"glossary": GLOSSARY})
    # Pipeline-level backstop appends the approved rendering.
    assert "knowledge" in out["en"]


def test_transliteration_rule_is_honoured_in_prompt():
    from translate import PromptBuilder

    glossary = [{"term_ar": "تصوف", "term_en": "taṣawwuf", "transliterate": True}]
    seg = {"kind": "body", "ar": "علم تصوف"}
    prompt = PromptBuilder().build(seg, {"glossary": glossary})
    assert "transliterate this term" in prompt.render()
    assert "taṣawwuf" in prompt.render()

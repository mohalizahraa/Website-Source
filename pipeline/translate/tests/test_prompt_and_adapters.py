"""Prompt assembly (9-point spec + knowledge injection) and adapter guardrails."""

import pytest

from translate import (
    ClaudeTranslator,
    GeminiTranslator,
    NotConfiguredError,
    OllamaTranslator,
    PromptBuilder,
)


def test_prompt_contains_nine_point_rules_and_context():
    seg = {"kind": "body", "anchor": "FN-3", "ar": "متن مع حاشية [[FN-3]]"}
    context = {
        "glossary": [{"term_ar": "الفقه", "term_en": "jurisprudence"}],
        "tm_matches": [{"ar": "سابق", "en_approved": "Previous rendering.", "score": 0.8}],
        "prev_en": "The previous sentence.",
        "next_en": "The following sentence.",
        "style_rules": ["Use British spelling."],
    }
    text = PromptBuilder().build(seg, context).render()

    # 9-point spirit
    assert "Do NOT transliterate" in text
    assert "established" in text and "Islamic terminology" in text
    assert "[[FN-n]]" in text  # anchor-preservation rule
    # knowledge injection
    assert "jurisprudence" in text
    assert "Previous rendering." in text
    assert "The previous sentence." in text
    assert "The following sentence." in text
    assert "Use British spelling." in text


@pytest.mark.parametrize(
    "cls, envs",
    [
        (OllamaTranslator, ["OLLAMA_HOST"]),
        (ClaudeTranslator, ["ANTHROPIC_API_KEY"]),
        (GeminiTranslator, ["GEMINI_API_KEY", "GOOGLE_API_KEY"]),
    ],
)
def test_adapters_raise_clear_not_configured_error(cls, envs, monkeypatch):
    for e in envs:
        monkeypatch.delenv(e, raising=False)
    engine = cls()
    prompt = PromptBuilder().build({"kind": "body", "ar": "نص"}, {})
    with pytest.raises(NotConfiguredError) as exc:
        engine.translate(prompt, ar="نص", context={})
    # message names the env var to set
    assert any(e in str(exc.value) for e in envs)

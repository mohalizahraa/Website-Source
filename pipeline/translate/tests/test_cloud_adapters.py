"""Cloud-adapter wiring: selection, defaults, and fail-fast without keys.

All offline — no adapter is ever called, so no network. We only check that the
engines are constructed, defaulted, selected, and that they raise
NotConfiguredError before any request when their key is absent.
"""

import pytest

from pipeline.translate import (
    ClaudeTranslator,
    GeminiTranslator,
    MockTranslator,
    NotConfiguredError,
    OpenAITranslator,
    OpenRouterTranslator,
    Pipeline,
    RecordingTranslator,
    build_pipeline_from_env,
    cloud_translator_from_env,
)
from pipeline.translate.prompt import PromptBuilder

SEG = {"kind": "body", "ar": "اعلم أنّ الوجود أظهر الأشياء."}


def _clear_keys(monkeypatch):
    for var in ("OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
                "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_HOST",
                "CLOUD_TRANSLATOR",
                # also clear model/base overrides so defaults are deterministic
                # (the ambient shell may set ANTHROPIC_MODEL, etc.)
                "ANTHROPIC_MODEL", "GEMINI_MODEL", "OPENAI_MODEL", "OPENAI_BASE_URL",
                "OPENROUTER_MODEL", "OPENROUTER_BASE_URL",
                "TRANSLATION_MODEL_BULK", "TRANSLATION_MODEL_FRONTIER"):
        monkeypatch.delenv(var, raising=False)


def test_default_models_are_the_value_picks(monkeypatch):
    _clear_keys(monkeypatch)
    assert GeminiTranslator().model == "gemini-2.5-flash"
    assert OpenAITranslator().model == "gpt-4.1-mini"
    assert ClaudeTranslator().model == "claude-sonnet-5"  # frontier escalation


def test_env_overrides_model(monkeypatch):
    _clear_keys(monkeypatch)
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.4-mini")
    assert GeminiTranslator().model == "gemini-3.5-flash-lite"
    assert OpenAITranslator().model == "gpt-5.4-mini"


def test_openai_fails_fast_without_key(monkeypatch):
    _clear_keys(monkeypatch)
    prompt = PromptBuilder().build(SEG, {})
    with pytest.raises(NotConfiguredError):
        OpenAITranslator().translate(prompt, ar=SEG["ar"], context={})


def test_gemini_fails_fast_without_key(monkeypatch):
    _clear_keys(monkeypatch)
    prompt = PromptBuilder().build(SEG, {})
    with pytest.raises(NotConfiguredError):
        GeminiTranslator().translate(prompt, ar=SEG["ar"], context={})


def test_cloud_selection_by_env(monkeypatch):
    _clear_keys(monkeypatch)
    assert isinstance(cloud_translator_from_env(), GeminiTranslator)  # default
    monkeypatch.setenv("CLOUD_TRANSLATOR", "openai")
    assert isinstance(cloud_translator_from_env(), OpenAITranslator)
    monkeypatch.setenv("CLOUD_TRANSLATOR", "claude")
    assert isinstance(cloud_translator_from_env(), ClaudeTranslator)


def test_unknown_cloud_engine_errors(monkeypatch):
    _clear_keys(monkeypatch)
    monkeypatch.setenv("CLOUD_TRANSLATOR", "bard")
    with pytest.raises(ValueError):
        cloud_translator_from_env()


def test_openrouter_defaults_and_selection(monkeypatch):
    _clear_keys(monkeypatch)
    # default model is the value pick
    assert OpenRouterTranslator().model == "google/gemini-2.5-flash"
    # per-instance model override (used by the factory's two-tier split)
    assert OpenRouterTranslator(model="qwen/qwen3-max").model == "qwen/qwen3-max"
    assert OpenRouterTranslator().base_url == "https://openrouter.ai/api/v1"
    # with a key present, cloud selection auto-picks OpenRouter
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    assert isinstance(cloud_translator_from_env(), OpenRouterTranslator)


def test_openrouter_fails_fast_without_key(monkeypatch):
    _clear_keys(monkeypatch)
    prompt = PromptBuilder().build(SEG, {})
    with pytest.raises(NotConfiguredError):
        OpenRouterTranslator().translate(prompt, ar=SEG["ar"], context={})


def test_factory_builds_pipeline_without_network(monkeypatch):
    _clear_keys(monkeypatch)
    pipe = build_pipeline_from_env()
    assert isinstance(pipe, Pipeline)
    assert isinstance(pipe.cloud, GeminiTranslator)  # default cloud (no OpenRouter key)


def test_factory_two_tier_openrouter_when_keyed(monkeypatch):
    _clear_keys(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setenv("TRANSLATION_MODEL_BULK", "google/gemini-2.5-flash")
    monkeypatch.setenv("TRANSLATION_MODEL_FRONTIER", "google/gemini-3-pro")
    pipe = build_pipeline_from_env()
    assert isinstance(pipe.local, OpenRouterTranslator)
    assert isinstance(pipe.cloud, OpenRouterTranslator)
    assert pipe.local.model == "google/gemini-2.5-flash"   # bulk
    assert pipe.cloud.model == "google/gemini-3-pro"        # frontier


def test_sacred_never_calls_cloud_engine(monkeypatch):
    """Wiring a real cloud engine must not change the sacred guarantee."""
    _clear_keys(monkeypatch)
    forbid = RecordingTranslator(MockTranslator(), forbid=True)
    pipe = Pipeline(cloud=forbid, local=forbid)
    out = pipe.translate_segment({"kind": "sacred", "ar": "قل هو الله أحد"})
    assert forbid.calls == 0
    assert out["engine"] in ("canonical", "canonical-missing")

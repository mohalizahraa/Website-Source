"""Haydari translation stage.

Public contract (ARCHITECTURE.md § "Pipeline function contracts"):

    translate_segment(seg, context) -> { "en", "engine", "confidence" }
    context = { glossary, tm_matches, prev_en, next_en, style_rules }

Everything external (local Ollama/Qwen, cloud Claude/Gemini, canonical DB) sits
behind an interface with a working offline mock, so the whole stage runs and is
tested without a network or API keys.
"""

from .adapters import ClaudeTranslator, GeminiTranslator, OllamaTranslator
from .core import Pipeline, translate_segment
from .interfaces import CanonicalDB, NotConfiguredError, Translator
from .mocks import MockCanonicalDB, MockTranslator, RecordingTranslator
from .prompt import PromptBuilder
from .router import Router
from .sacred import substitute_sacred
from .types import CanonicalEntry, Prompt, RouteDecision, TranslationResult

__all__ = [
    "translate_segment",
    "Pipeline",
    "Translator",
    "CanonicalDB",
    "NotConfiguredError",
    "MockTranslator",
    "MockCanonicalDB",
    "RecordingTranslator",
    "OllamaTranslator",
    "ClaudeTranslator",
    "GeminiTranslator",
    "PromptBuilder",
    "Router",
    "substitute_sacred",
    "CanonicalEntry",
    "Prompt",
    "RouteDecision",
    "TranslationResult",
]

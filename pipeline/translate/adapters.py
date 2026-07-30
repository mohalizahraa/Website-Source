"""Real translation-engine adapters (behind the Translator interface).

Each reads its endpoint / credentials from environment variables and raises a
clear :class:`NotConfiguredError` when they are missing, *before* any network
call. They are never exercised by the offline test suite — the mocks stand in.
The HTTP bodies are implemented with the stdlib (``urllib``) so importing this
module pulls in no third-party dependency; when a key is present they will call
the real service.

Best value for Arabic→English (per the RESEARCH.md pricing/quality review): the
default cloud engines are **Gemini 2.5 Flash** and **GPT-4.1-mini** — top-tier
Arabic quality at the best price-per-page. Both providers apply automatic prompt
caching to a stable prefix, and the shared system preamble is sent first so the
9-point instruction block caches on repeat calls (see README → "Caching &
batch").

Env vars
--------
Which cloud engine to use:
    CLOUD_TRANSLATOR   "gemini" (default) | "openai" | "claude"
Ollama (local Qwen3-14B):
    OLLAMA_HOST   e.g. http://localhost:11434   (required to enable)
    OLLAMA_MODEL  default "qwen3:14b"
Gemini (cloud — best value):
    GEMINI_API_KEY | GOOGLE_API_KEY   (required to enable)
    GEMINI_MODEL        default "gemini-2.5-flash"
OpenAI (cloud — best all-rounder):
    OPENAI_API_KEY      (required to enable)
    OPENAI_MODEL        default "gpt-4.1-mini"
    OPENAI_BASE_URL     default "https://api.openai.com/v1"
Claude (cloud — frontier escalation for doctrinal passages):
    ANTHROPIC_API_KEY   (required to enable)
    ANTHROPIC_MODEL     default "claude-sonnet-5"
"""

from __future__ import annotations

import json
import os
import socket
import time
import urllib.error
import urllib.request
from typing import Optional

from . import usage
from .interfaces import NotConfiguredError, Translator
from .types import Context, Prompt, TranslationResult

_DEFAULT_TIMEOUT = 90
_MAX_RETRIES = 3
# HTTP statuses worth retrying (rate limit + transient server/gateway errors).
_RETRY_STATUS = {408, 409, 429, 500, 502, 503, 504}


def _post_json(url: str, payload: dict, headers: dict, timeout: int = _DEFAULT_TIMEOUT) -> dict:
    """POST JSON with retry + backoff on transient network/server errors.

    A single timed-out or rate-limited call must not fail a whole ingest run, so
    we retry a few times before giving up. Non-retryable HTTP errors (e.g. 400)
    are raised immediately.
    """
    data = json.dumps(payload).encode("utf-8")
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:  # pragma: no cover - network
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:  # pragma: no cover - network
            last_exc = exc
            if exc.code not in _RETRY_STATUS or attempt == _MAX_RETRIES - 1:
                raise
        except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError) as exc:  # pragma: no cover - network
            last_exc = exc
            if attempt == _MAX_RETRIES - 1:
                raise
        time.sleep(2 * (attempt + 1))  # backoff: 2s, 4s
    raise last_exc  # pragma: no cover - unreachable


class OllamaTranslator(Translator):
    """Local Qwen3-14B via an Ollama server (default engine when confident)."""

    name = "ollama-qwen3-14b"

    def __init__(self):
        self.host = os.environ.get("OLLAMA_HOST")
        self.model = os.environ.get("OLLAMA_MODEL", "qwen3:14b")

    def _require(self) -> str:
        if not self.host:
            raise NotConfiguredError(
                "OllamaTranslator is not configured: set OLLAMA_HOST "
                "(e.g. http://localhost:11434) and pull the model with "
                "`ollama pull qwen3:14b`."
            )
        return self.host

    def _generate(self, prompt: Prompt) -> str:  # pragma: no cover - network
        host = self._require()
        body = {
            "model": self.model,
            "system": prompt.system,
            "prompt": prompt.user,
            "stream": False,
        }
        out = _post_json(f"{host.rstrip('/')}/api/generate", body, {"Content-Type": "application/json"})
        return (out.get("response") or "").strip()

    def translate(self, prompt: Prompt, *, ar: str, context: Context) -> TranslationResult:
        self._require()
        return TranslationResult(text=self._generate(prompt), confidence=0.75).clamp()

    def refine(self, draft, *, prompt, ar, context) -> TranslationResult:
        self._require()
        return TranslationResult(text=self._generate(prompt), confidence=0.8).clamp()


class ClaudeTranslator(Translator):
    """Anthropic Claude (cloud) — used for hard/doctrinal escalations."""

    name = "claude-cloud"
    API_URL = "https://api.anthropic.com/v1/messages"

    def __init__(self):
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")
        self.model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")

    def _require(self) -> str:
        if not self.api_key:
            raise NotConfiguredError(
                "ClaudeTranslator is not configured: set ANTHROPIC_API_KEY "
                "(and optionally ANTHROPIC_MODEL)."
            )
        return self.api_key

    def _message(self, prompt: Prompt) -> str:  # pragma: no cover - network
        key = self._require()
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.model,
            "max_tokens": 4096,
            "system": prompt.system,
            "messages": [{"role": "user", "content": prompt.user}],
        }
        out = _post_json(self.API_URL, body, headers)
        parts = out.get("content") or []
        return "".join(p.get("text", "") for p in parts).strip()

    def translate(self, prompt: Prompt, *, ar: str, context: Context) -> TranslationResult:
        self._require()
        return TranslationResult(text=self._message(prompt), confidence=0.88).clamp()

    def refine(self, draft, *, prompt, ar, context) -> TranslationResult:
        self._require()
        return TranslationResult(text=self._message(prompt), confidence=0.9).clamp()


class GeminiTranslator(Translator):
    """Google Gemini (cloud) — best value for Arabic→English (default cloud engine).

    Defaults to ``gemini-2.5-flash``: top-tier Arabic quality at ~$0.15/$1.25 per
    1M tokens. Gemini applies implicit prompt caching to a repeated prefix, so
    the stable system preamble is cached across calls at ~10% of input cost.
    """

    name = "gemini-cloud"

    def __init__(self):
        self.api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        self.model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

    def _require(self) -> str:
        if not self.api_key:
            raise NotConfiguredError(
                "GeminiTranslator is not configured: set GEMINI_API_KEY "
                "(or GOOGLE_API_KEY, and optionally GEMINI_MODEL)."
            )
        return self.api_key

    def _generate(self, prompt: Prompt) -> str:  # pragma: no cover - network
        key = self._require()
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent?key={key}"
        )
        body = {
            "system_instruction": {"parts": [{"text": prompt.system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt.user}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 4096},
        }
        out = _post_json(url, body, {"Content-Type": "application/json"})
        cands = out.get("candidates") or []
        if not cands:
            return ""
        parts = cands[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts).strip()

    def translate(self, prompt: Prompt, *, ar: str, context: Context) -> TranslationResult:
        self._require()
        return TranslationResult(text=self._generate(prompt), confidence=0.85).clamp()

    def refine(self, draft, *, prompt, ar, context) -> TranslationResult:
        self._require()
        return TranslationResult(text=self._generate(prompt), confidence=0.88).clamp()


class OpenAITranslator(Translator):
    """OpenAI GPT-4.1-mini (cloud) — best all-round value for Arabic→English.

    Defaults to ``gpt-4.1-mini``: verified top-BLEU among small models on
    Arabic→English, a 1M-token context, and automatic prompt caching (cached
    input at ~$0.10/1M). The stable system preamble is sent first so it caches
    across calls. Uses the OpenAI Chat Completions API over the stdlib.
    """

    name = "openai-cloud"
    #: OpenRouter returns per-call cost when asked; direct OpenAI does not accept
    #: the field, so only the OpenRouter subclass opts in.
    _include_usage = False

    def __init__(self):
        self.api_key = os.environ.get("OPENAI_API_KEY")
        self.model = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")
        self.base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

    def _require(self) -> str:
        if not self.api_key:
            raise NotConfiguredError(
                "OpenAITranslator is not configured: set OPENAI_API_KEY "
                "(and optionally OPENAI_MODEL, default gpt-4.1-mini)."
            )
        return self.api_key

    def _chat(self, prompt: Prompt) -> str:  # pragma: no cover - network
        key = self._require()
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        body = {
            "model": self.model,
            "temperature": 0.2,
            "max_tokens": 4096,
            "messages": [
                # Stable system prefix first → automatic prompt caching.
                {"role": "system", "content": prompt.system},
                {"role": "user", "content": prompt.user},
            ],
        }
        if self._include_usage:
            body["usage"] = {"include": True}  # OpenRouter: return real per-call cost
        out = _post_json(f"{self.base_url}/chat/completions", body, headers)
        u = out.get("usage") or {}
        usage.record(
            stage="translate", model=self.model,
            prompt_tokens=u.get("prompt_tokens"),
            completion_tokens=u.get("completion_tokens"),
            cost=u.get("cost"),
        )
        choices = out.get("choices") or []
        if not choices:
            return ""
        return (choices[0].get("message", {}).get("content") or "").strip()

    def translate(self, prompt: Prompt, *, ar: str, context: Context) -> TranslationResult:
        self._require()
        return TranslationResult(text=self._chat(prompt), confidence=0.86).clamp()

    def refine(self, draft, *, prompt, ar, context) -> TranslationResult:
        self._require()
        return TranslationResult(text=self._chat(prompt), confidence=0.89).clamp()


class OpenRouterTranslator(OpenAITranslator):
    """Any model via OpenRouter (one key → Gemini / GPT / Claude / Qwen / …).

    OpenRouter is OpenAI-compatible, so this reuses the OpenAI chat path and just
    swaps the base URL, key, and model. ``model`` may be passed per instance (so
    a pipeline can run a cheap value model for the bulk and a frontier model for
    the hard/doctrinal minority — see ``factory.build_pipeline_from_env``).

    Env: OPENROUTER_API_KEY (required), OPENROUTER_MODEL (default
    ``google/gemini-2.5-flash``), OPENROUTER_BASE_URL.
    """

    name = "openrouter-cloud"
    _include_usage = True

    def __init__(self, model: Optional[str] = None):
        self.api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY")
        self.model = model or os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash")
        self.base_url = os.environ.get(
            "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
        ).rstrip("/")
        # Persist the concrete model on each segment instead of the ambiguous
        # shared label "openrouter-cloud" for both bulk and frontier calls.
        self.name = f"openrouter:{self.model}"

    def _require(self) -> str:
        if not self.api_key:
            raise NotConfiguredError(
                "OpenRouterTranslator is not configured: set OPENROUTER_API_KEY "
                "(get one at https://openrouter.ai/keys) and optionally "
                "OPENROUTER_MODEL (default google/gemini-2.5-flash)."
            )
        return self.api_key


# --- env-driven selection -------------------------------------------------

#: cloud-engine registry, keyed by the CLOUD_TRANSLATOR value
CLOUD_ENGINES = {
    "openrouter": OpenRouterTranslator,  # any model, one key (recommended)
    "gemini": GeminiTranslator,   # google direct
    "openai": OpenAITranslator,   # openai direct
    "claude": ClaudeTranslator,   # anthropic direct
}


def cloud_translator_from_env() -> Translator:
    """Return the cloud engine named by ``CLOUD_TRANSLATOR``.

    Default is ``openrouter`` when ``OPENROUTER_API_KEY`` is set, else ``gemini``.
    Constructs the adapter but does not call it — a missing API key only raises
    :class:`NotConfiguredError` when the engine is actually used.
    """
    choice = os.environ.get("CLOUD_TRANSLATOR")
    if not choice:
        choice = "openrouter" if os.environ.get("OPENROUTER_API_KEY") else "gemini"
    choice = choice.strip().lower()
    try:
        return CLOUD_ENGINES[choice]()
    except KeyError:
        raise ValueError(
            f"Unknown CLOUD_TRANSLATOR={choice!r}; choose one of "
            f"{sorted(CLOUD_ENGINES)}."
        )


def local_translator_from_env() -> Optional[Translator]:
    """Return the local Ollama engine if ``OLLAMA_HOST`` is set, else ``None``."""
    return OllamaTranslator() if os.environ.get("OLLAMA_HOST") else None

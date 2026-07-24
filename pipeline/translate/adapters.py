"""Real translation-engine adapters (behind the Translator interface).

Each reads its endpoint / credentials from environment variables and raises a
clear :class:`NotConfiguredError` when they are missing, *before* any network
call. They are never exercised by the offline test suite — the mocks stand in.
The HTTP bodies are implemented with the stdlib (``urllib``) so importing this
module pulls in no third-party dependency; when a key is present they will call
the real service.

Env vars
--------
Ollama (local Qwen3-14B):
    OLLAMA_HOST   e.g. http://localhost:11434   (required to enable)
    OLLAMA_MODEL  default "qwen3:14b"
Claude (cloud):
    ANTHROPIC_API_KEY   (required to enable)
    ANTHROPIC_MODEL     default "claude-opus-4-8"
Gemini (cloud):
    GEMINI_API_KEY | GOOGLE_API_KEY   (required to enable)
    GEMINI_MODEL        default "gemini-2.0-flash"
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Optional

from .interfaces import NotConfiguredError, Translator
from .types import Context, Prompt, TranslationResult

_DEFAULT_TIMEOUT = 60


def _post_json(url: str, payload: dict, headers: dict, timeout: int = _DEFAULT_TIMEOUT) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # pragma: no cover - network
        return json.loads(resp.read().decode("utf-8"))


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
        self.model = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")

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
    """Google Gemini (cloud) — alternate cloud engine."""

    name = "gemini-cloud"

    def __init__(self):
        self.api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        self.model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

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

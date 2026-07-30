"""Non-destructive LLM review of an editor's current translation.

The reviewer returns feedback and a suggested rendering; it never writes or
replaces segment text. The API layer owns authorization, quota enforcement, and
usage persistence.
"""

from __future__ import annotations

import json
import os

from pipeline.translate.adapters import _post_json


def _model() -> str:
    return (
        os.environ.get("HAYDARI_REVIEW_MODEL")
        or os.environ.get("TRANSLATION_MODEL_FRONTIER")
        or "google/gemini-2.5-pro"
    )


def _parse_json(text: str) -> dict:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (TypeError, ValueError):
        return {"assessment": raw, "suggestion": "", "issues": []}


def review_translation(
    *,
    ar: str,
    en: str,
    kind: str,
    instructions: str | None = None,
    glossary: list[dict] | None = None,
    style_rules: list[str] | None = None,
) -> dict:
    """Return feedback, suggestion, issues, model, and provider usage."""

    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    model = _model()
    base = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
    context = {
        "kind": kind,
        "book_instructions": instructions or "",
        "applicable_glossary": glossary or [],
        "style_rules": style_rules or [],
    }
    system = (
        "You are a senior Arabic-to-English reviewer of classical Islamic scholarship. "
        "Review conservatively: preserve the exact meaning, technical terminology, and every "
        "[[FN-n]] anchor. Never introduce a doctrinal claim absent from the Arabic. For sacred "
        "text, clearly flag that canonical verification is required. Return JSON only with "
        "assessment (short string), suggestion (complete English rendering), and issues "
        "(array of short strings). Do not change the source Arabic."
    )
    user = (
        f"CONTEXT:\n{json.dumps(context, ensure_ascii=False)}\n\n"
        f"ARABIC SOURCE:\n{ar}\n\nCURRENT ENGLISH:\n{en}"
    )
    body = {
        "model": model,
        "temperature": 0.1,
        "max_tokens": 1400,
        "response_format": {"type": "json_object"},
        "usage": {"include": True},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    out = _post_json(
        f"{base}/chat/completions",
        body,
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    choices = out.get("choices") or []
    content = (choices[0].get("message", {}).get("content") or "") if choices else ""
    parsed = _parse_json(content)
    issues = parsed.get("issues")
    if not isinstance(issues, list):
        issues = [str(issues)] if issues else []
    usage = out.get("usage") or {}
    return {
        "model": model,
        "assessment": str(parsed.get("assessment") or ""),
        "suggestion": str(parsed.get("suggestion") or ""),
        "issues": [str(item) for item in issues],
        "usage": {
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "cost_usd": float(usage["cost"]) if usage.get("cost") is not None else None,
        },
    }

"""OCR engine interface and adapters for the Haydari pipeline.

An engine's only job is *raw* recognition: turn a page image into a list of
text blocks (paragraph-level), a coarse region hint (``body`` / ``notes`` /
``divider``), and a confidence. All structural interpretation (footnote
anchors, sacred-text flagging, reading order, Markdown) happens later in
``classifier`` / ``emitter`` so that every engine is interchangeable.

Three engines are provided:

* :class:`MockOcrEngine` — deterministic, offline. Reads a JSON fixture and
  returns realistic Arabic + structure so the entire platform is testable
  without any model, GPU, or network.
* :class:`QariOcrEngine` — adapter stub for the local QARI-OCR VLM (default in
  production per ARCHITECTURE.md). Reads a model path from the environment and
  raises a clear "not configured" error until wired up.
* :class:`GeminiOcrEngine` — adapter stub for cloud escalation of poor / low
  confidence pages. Reads an API key from the environment.

``select_engine()`` chooses one from ``$HAYDARI_OCR_ENGINE`` (or availability),
falling back to the mock so nothing breaks offline.
"""

from __future__ import annotations

import base64
import json
import os
import re
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
DEFAULT_FIXTURE = FIXTURE_DIR / "mock_page.json"

# Region hints an engine may attach to a block. The classifier owns the real
# body/footnote split; these are just the raw layout signal an engine emits.
REGION_BODY = "body"
REGION_NOTES = "notes"
REGION_DIVIDER = "divider"


class OcrError(RuntimeError):
    """Raised when an engine cannot run (e.g. not configured)."""


@dataclass
class OcrBlock:
    """One recognised paragraph-level block of text."""

    text: str
    region: str = REGION_BODY
    confidence: float = 1.0


@dataclass
class OcrResult:
    """Raw recognition output for a single page."""

    blocks: list[OcrBlock] = field(default_factory=list)
    page_confidence: float = 1.0
    engine: str = "unknown"


class OcrEngine(Protocol):
    """The interface every engine implements."""

    name: str

    def recognize(self, image_path: str | Path) -> OcrResult:
        """Recognise one page image and return raw blocks + confidence."""
        ...


# --------------------------------------------------------------------------- #
# Mock engine — deterministic, offline                                        #
# --------------------------------------------------------------------------- #
class MockOcrEngine:
    """Deterministic engine that returns a fabricated fixture page.

    It ignores the actual pixels (there may be none) and returns the same
    structured Arabic page every time, so tests and offline demos are fully
    reproducible. A different fixture can be supplied per instance, or per
    image via ``fixture_map`` (image filename -> fixture path).
    """

    name = "mock"

    def __init__(
        self,
        fixture: str | Path = DEFAULT_FIXTURE,
        fixture_map: dict[str, str | Path] | None = None,
    ) -> None:
        self.fixture = Path(fixture)
        self.fixture_map = {k: Path(v) for k, v in (fixture_map or {}).items()}

    def recognize(self, image_path: str | Path) -> OcrResult:
        path = self.fixture_map.get(Path(image_path).name, self.fixture)
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        blocks = [
            OcrBlock(
                text=b["text"],
                region=b.get("region", REGION_BODY),
                confidence=float(b.get("confidence", 1.0)),
            )
            for b in data["blocks"]
        ]
        return OcrResult(
            blocks=blocks,
            page_confidence=float(data.get("page_confidence", 1.0)),
            engine=self.name,
        )


# --------------------------------------------------------------------------- #
# QARI-OCR adapter (local VLM) — STUB                                         #
# --------------------------------------------------------------------------- #
class QariOcrEngine:
    """Adapter for the local QARI-OCR vision-language model.

    NOT IMPLEMENTED YET. This is the production default per ARCHITECTURE.md
    ("Default engine QARI-OCR (local)"). It expects a model checkpoint whose
    path comes from ``$QARI_MODEL_PATH`` and would output Markdown (with a
    horizontal-rule footnote divider) that ``_blocks_from_markdown`` turns into
    :class:`OcrBlock` s. Until wired to a real model it raises :class:`OcrError`.
    """

    name = "qari"

    def __init__(self, model_path: str | None = None) -> None:
        self.model_path = model_path or os.environ.get("QARI_MODEL_PATH")

    def recognize(self, image_path: str | Path) -> OcrResult:
        if not self.model_path:
            raise OcrError(
                "QariOcrEngine is not configured: set $QARI_MODEL_PATH to a "
                "local QARI-OCR checkpoint, or use the mock engine offline."
            )
        # Real implementation (deferred): load the VLM once, prompt it to
        # transcribe Arabic to Markdown preserving diacritics + footnote rule,
        # then parse the Markdown into blocks.
        raise OcrError(
            "QariOcrEngine model inference is not implemented in this build. "
            "Model path is set but no runtime is wired up."
        )


# --------------------------------------------------------------------------- #
# Gemini adapter (cloud escalation) — STUB                                    #
# --------------------------------------------------------------------------- #
class GeminiOcrEngine:
    """Adapter for cloud OCR escalation (Gemini) of hard / low-confidence pages.

    NOT IMPLEMENTED YET. Reads ``$GEMINI_API_KEY`` (and optional
    ``$GEMINI_OCR_MODEL``). Raises :class:`OcrError` until a key is present and
    the client is wired up. Per ARCHITECTURE.md this is invoked only when a
    local page comes back poor / low-confidence.
    """

    name = "gemini"

    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.model = model or os.environ.get("GEMINI_OCR_MODEL", "gemini-2.5-pro")

    def recognize(self, image_path: str | Path) -> OcrResult:
        if not self.api_key:
            raise OcrError(
                "GeminiOcrEngine is not configured: set $GEMINI_API_KEY, or use "
                "the mock engine offline."
            )
        raise OcrError(
            "GeminiOcrEngine network inference is not implemented in this build. "
            "API key is set but no client is wired up."
        )


# --------------------------------------------------------------------------- #
# OpenRouter vision OCR (real) — one key, any vision model                     #
# --------------------------------------------------------------------------- #
_OCR_PROMPT = (
    "You are an OCR engine for classical Arabic scholarly books. Transcribe ALL "
    "Arabic text in this page image EXACTLY as printed, preserving diacritics "
    "(tashkīl) and punctuation. Output plain text as Markdown: one paragraph per "
    "block, blank line between blocks. If the page has a footnote section at the "
    "bottom, put a line with only '---' before it. Do NOT translate, summarise, "
    "explain, or add anything — output only the transcribed Arabic."
)


class OpenRouterOcrEngine:
    """Cloud vision OCR via OpenRouter (Gemini / GPT / Claude vision, one key).

    Uses the OpenAI-compatible chat endpoint with an image part, so any
    vision-capable model works. Env: OPENROUTER_API_KEY (required), OCR_MODEL
    (default ``google/gemini-2.5-flash``), OPENROUTER_BASE_URL. Stdlib only.
    """

    name = "openrouter"

    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
        self.model = model or os.environ.get("OCR_MODEL", "google/gemini-2.5-flash")
        self.base_url = os.environ.get(
            "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
        ).rstrip("/")

    def recognize(self, image_path: str | Path) -> OcrResult:  # pragma: no cover - network
        if not self.api_key:
            raise OcrError(
                "OpenRouterOcrEngine is not configured: set OPENROUTER_API_KEY "
                "(and optionally OCR_MODEL), or use the mock engine offline."
            )
        raw = Path(image_path).read_bytes()
        b64 = base64.b64encode(raw).decode("ascii")
        suffix = Path(image_path).suffix.lower().lstrip(".") or "png"
        media = "jpeg" if suffix in ("jpg", "jpeg") else suffix
        body = {
            "model": self.model,
            "temperature": 0,
            # Dense scholarly pages (Arabic + full tashkīl + footnotes) are long.
            # Without an explicit ceiling many providers default to a small output
            # cap and silently TRUNCATE mid-page. Give the transcription room.
            "max_tokens": int(os.environ.get("OCR_MAX_TOKENS", "8192")),
            "usage": {"include": True},  # OpenRouter: return real per-call cost
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _OCR_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/{media};base64,{b64}"},
                        },
                    ],
                }
            ],
        }
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=data,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        # Retry transient network/server errors so a single OCR hiccup doesn't
        # fail the page (which would otherwise be skipped by the ingest worker).
        out = None
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    out = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as exc:
                last_exc = exc
                if exc.code not in (408, 409, 429, 500, 502, 503, 504) or attempt == 2:
                    raise
            except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError) as exc:
                last_exc = exc
                if attempt == 2:
                    raise
            time.sleep(2 * (attempt + 1))
        if out is None:  # pragma: no cover
            raise last_exc or OcrError("OCR failed with no response")
        try:  # record real token/cost usage for measurement runs
            from pipeline.translate import usage as _usage
            u = out.get("usage") or {}
            _usage.record(stage="ocr", model=self.model,
                          prompt_tokens=u.get("prompt_tokens"),
                          completion_tokens=u.get("completion_tokens"),
                          cost=u.get("cost"))
        except Exception:  # noqa: BLE001 — never let accounting break OCR
            pass
        choices = out.get("choices") or []
        markdown = (choices[0].get("message", {}).get("content") or "") if choices else ""
        # If the model stopped because it hit the token ceiling, the page was
        # truncated — lower confidence so QA/human review flags it rather than
        # silently accepting a half-transcribed page.
        finish = (choices[0].get("finish_reason") if choices else None) or ""
        truncated = finish == "length"
        confidence = 0.4 if truncated else 0.9
        return OcrResult(
            blocks=blocks_from_markdown(markdown, confidence=confidence),
            page_confidence=confidence,
            engine=self.name,
        )


# --------------------------------------------------------------------------- #
# Shared helper for real VLM adapters                                         #
# --------------------------------------------------------------------------- #
def blocks_from_markdown(markdown: str, confidence: float = 1.0) -> list[OcrBlock]:
    """Parse VLM Markdown output into :class:`OcrBlock` s.

    Blank-line separated paragraphs become blocks. A horizontal rule
    (``---``, ``***``, or a run of underscores) becomes a divider; everything
    after it is tagged ``notes``. Used by the real QARI / Gemini adapters.
    """
    paras = [p.strip() for p in markdown.split("\n\n") if p.strip()]
    blocks: list[OcrBlock] = []
    region = REGION_BODY
    for para in paras:
        stripped = para.replace(" ", "")
        if stripped and set(stripped) <= {"-", "*", "_"} and len(stripped) >= 3:
            blocks.append(OcrBlock(text=para, region=REGION_DIVIDER, confidence=confidence))
            region = REGION_NOTES
            continue
        # A whole dense page often arrives as one paragraph. Split it into
        # sentence-sized units so review is granular AND each unit translates
        # completely (long inputs overflow the draft/refine passes and truncate).
        for piece in _split_long_paragraph(para):
            blocks.append(OcrBlock(text=piece, region=region, confidence=confidence))
    return blocks


# Sentence boundaries: Latin ., !, ? and Arabic ؟ / ۔, each followed by space.
_SENT_SPLIT = re.compile(r"(?<=[\.\!\?؟۔])\s+")


def _split_long_paragraph(text: str, target: int = 320, hard_min: int = 60) -> list[str]:
    """Split an over-long paragraph into ~``target``-char sentence groups.

    Short/normal paragraphs are returned unchanged. Only paragraphs well beyond
    ``target`` are split, on sentence boundaries, merging fragments so no chunk
    is smaller than ``hard_min``. Never splits inside a ``[[FN-n]]`` anchor.
    """
    text = text.strip()
    if len(text) <= int(target * 1.5):
        return [text]
    pieces = [p.strip() for p in _SENT_SPLIT.split(text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in pieces:
        if not buf:
            buf = p
        elif len(buf) < target:
            buf = f"{buf} {p}"
        else:
            chunks.append(buf)
            buf = p
    if buf:
        if chunks and len(buf) < hard_min:
            chunks[-1] = f"{chunks[-1]} {buf}"
        else:
            chunks.append(buf)
    return chunks or [text]


# --------------------------------------------------------------------------- #
# Engine selection                                                            #
# --------------------------------------------------------------------------- #
def select_engine(name: str | None = None) -> OcrEngine:
    """Return an engine by name (or ``$HAYDARI_OCR_ENGINE``), default mock.

    Real engines are only returned when their configuration is present;
    otherwise this falls back to the deterministic mock so the platform always
    runs offline.
    """
    name = (name or os.environ.get("HAYDARI_OCR_ENGINE") or "").strip().lower()

    if name == "openrouter":
        return OpenRouterOcrEngine()
    if name == "qari":
        return QariOcrEngine()
    if name == "gemini":
        return GeminiOcrEngine()
    if name == "mock":
        return MockOcrEngine()
    if not name:
        # Auto-detect: OpenRouter vision (one key) → local QARI → offline mock.
        if os.environ.get("OPENROUTER_API_KEY"):
            return OpenRouterOcrEngine()
        if os.environ.get("QARI_MODEL_PATH"):
            return QariOcrEngine()
        return MockOcrEngine()
    raise OcrError(f"Unknown OCR engine: {name!r}")

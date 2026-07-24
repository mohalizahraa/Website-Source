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

import json
import os
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
        blocks.append(OcrBlock(text=para, region=region, confidence=confidence))
    return blocks


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

    if name == "qari":
        return QariOcrEngine()
    if name == "gemini":
        return GeminiOcrEngine()
    if name == "mock" or not name:
        # Auto-detect: prefer a configured local engine, else mock.
        if os.environ.get("QARI_MODEL_PATH"):
            return QariOcrEngine()
        return MockOcrEngine()
    raise OcrError(f"Unknown OCR engine: {name!r}")

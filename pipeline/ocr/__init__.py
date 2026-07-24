"""Haydari OCR pipeline.

VLM/OCR -> layout & footnote structuring -> reading-ordered Markdown with
indexed ``[[FN-n]]`` anchors + typed segments (body / footnote / sacred).

Public API::

    from pipeline.ocr import process_page, process_pdf

Everything runs offline via a deterministic mock engine; real QARI (local) and
Gemini (cloud) adapters swap in through ``$HAYDARI_OCR_ENGINE`` when configured.
"""

from __future__ import annotations

from .classifier import (
    KIND_BODY,
    KIND_FOOTNOTE,
    KIND_SACRED,
    Segment,
    body_anchor_refs,
    check_anchors,
    classify,
    detect_sacred,
    normalize_markers,
)
from .emitter import emit_markdown
from .engines import (
    GeminiOcrEngine,
    MockOcrEngine,
    OcrBlock,
    OcrEngine,
    OcrError,
    OcrResult,
    QariOcrEngine,
    select_engine,
)
from .pipeline import process_page, process_pdf
from .render import RenderError, render_pdf

__all__ = [
    "process_page",
    "process_pdf",
    "classify",
    "check_anchors",
    "body_anchor_refs",
    "detect_sacred",
    "normalize_markers",
    "emit_markdown",
    "Segment",
    "OcrEngine",
    "OcrResult",
    "OcrBlock",
    "OcrError",
    "MockOcrEngine",
    "QariOcrEngine",
    "GeminiOcrEngine",
    "select_engine",
    "render_pdf",
    "RenderError",
    "KIND_BODY",
    "KIND_FOOTNOTE",
    "KIND_SACRED",
]

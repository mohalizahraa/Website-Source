"""Top-level OCR pipeline: the functions the rest of the platform calls.

Contract (ARCHITECTURE.md):

    process_page(image_path) -> {
        "markdown": str,
        "segments": [ {order, kind, ar, anchor} ]
    }

``kind`` in {body, footnote, sacred}; body footnote references use ``[[FN-n]]``
and the matching footnote segment carries ``anchor = "FN-n"``.

We also return a page-level ``confidence`` and per-segment ``confidence`` (an
additive superset of the required keys) so the translation router can decide
when to escalate a page from the local engine to a cloud one.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from .classifier import check_anchors, classify
from .emitter import emit_markdown
from .engines import OcrEngine, select_engine
from .render import render_pdf


def process_page(
    image_path: str | Path,
    engine: OcrEngine | None = None,
    *,
    rtl_mark: bool = True,
) -> dict:
    """OCR + classify + emit one page image.

    Returns ``{markdown, segments, confidence, engine}``. ``segments`` each hold
    ``{order, kind, ar, anchor, confidence}``. Defaults to the offline mock
    engine when nothing is configured.
    """
    engine = engine or select_engine()
    result = engine.recognize(image_path)
    segments = classify(result.blocks)
    markdown = emit_markdown(segments, rtl_mark=rtl_mark)
    anchors = check_anchors(segments)
    return {
        "markdown": markdown,
        "segments": [s.to_contract() for s in segments],
        "confidence": round(result.page_confidence, 4),
        "engine": result.engine,
        # Non-fatal: surfaced so QA / human review catches mismatched or
        # orphaned footnote numbering rather than trusting silent output.
        "anchor_mismatch": None if anchors["ok"] else anchors,
    }


def process_pdf(
    pdf_path: str | Path,
    engine: OcrEngine | None = None,
    *,
    dpi: int = 300,
    work_dir: str | Path | None = None,
    rtl_mark: bool = True,
) -> list[dict]:
    """Render a PDF to page images (Poppler) then run :func:`process_page`.

    Returns one page dict per page, each augmented with ``page_no`` (1-based)
    and ``image_path``.
    """
    engine = engine or select_engine()
    tmp: tempfile.TemporaryDirectory | None = None
    if work_dir is None:
        tmp = tempfile.TemporaryDirectory(prefix="haydari-ocr-")
        work_dir = tmp.name
    try:
        images = render_pdf(pdf_path, work_dir, dpi=dpi)
        pages = []
        for page_no, image in enumerate(images, start=1):
            page = process_page(image, engine, rtl_mark=rtl_mark)
            page["page_no"] = page_no
            page["image_path"] = str(image)
            pages.append(page)
        return pages
    finally:
        if tmp is not None:
            tmp.cleanup()

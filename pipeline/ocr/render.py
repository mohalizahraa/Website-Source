"""PDF -> page image rendering via Poppler's ``pdftoppm``.

``pdftoppm`` is installed on this machine (see ARCHITECTURE.md "Environment
reality"). This module is a thin, testable wrapper so ``process_pdf`` can turn
a source PDF into per-page PNGs before OCR.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


class RenderError(RuntimeError):
    """Raised when PDF rendering cannot proceed."""


def pdftoppm_available() -> bool:
    return shutil.which("pdftoppm") is not None


def render_pdf(pdf_path: str | Path, out_dir: str | Path, dpi: int = 300) -> list[Path]:
    """Render every page of ``pdf_path`` to PNGs in ``out_dir``.

    Returns the sorted list of generated image paths. Raises :class:`RenderError`
    if Poppler is missing or the PDF does not exist.
    """
    pdf_path = Path(pdf_path)
    out_dir = Path(out_dir)
    if not pdftoppm_available():
        raise RenderError("Poppler's `pdftoppm` is not on PATH; cannot render PDF.")
    if not pdf_path.is_file():
        raise RenderError(f"PDF not found: {pdf_path}")

    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = out_dir / "page"
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), str(pdf_path), str(prefix)],
        check=True,
    )
    return sorted(out_dir.glob("page-*.png"))


def pdf_page_count(pdf_path: str | Path) -> int:
    """Return the number of pages in ``pdf_path`` without rendering anything.

    Uses Poppler's ``pdfinfo`` (fast, metadata-only). Returns 0 if it cannot be
    determined so callers can degrade gracefully.
    """
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file() or shutil.which("pdfinfo") is None:
        return 0
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf_path)], capture_output=True, text=True, check=True
        ).stdout
    except subprocess.CalledProcessError:
        return 0
    for line in out.splitlines():
        if line.lower().startswith("pages:"):
            try:
                return int(line.split(":", 1)[1].strip())
            except ValueError:
                return 0
    return 0


def render_page(
    pdf_path: str | Path, out_dir: str | Path, page_no: int, dpi: int = 300
) -> Path:
    """Render a SINGLE 1-based page of ``pdf_path`` to a PNG in ``out_dir``.

    This is the incremental primitive the ingestion worker uses so a large book
    is processed page-by-page (bounded memory, resumable) instead of rendering
    every page up front. Returns the generated image path.
    """
    pdf_path = Path(pdf_path)
    out_dir = Path(out_dir)
    if not pdftoppm_available():
        raise RenderError("Poppler's `pdftoppm` is not on PATH; cannot render PDF.")
    if not pdf_path.is_file():
        raise RenderError(f"PDF not found: {pdf_path}")

    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = out_dir / f"p{page_no:05d}"
    subprocess.run(
        [
            "pdftoppm", "-png", "-r", str(dpi),
            "-f", str(page_no), "-l", str(page_no),
            "-singlefile", str(pdf_path), str(prefix),
        ],
        check=True,
    )
    img = out_dir / f"p{page_no:05d}.png"
    if not img.is_file():
        # -singlefile omits the page-number suffix; fall back to a glob if the
        # Poppler build ignored it for some reason.
        matches = sorted(out_dir.glob(f"p{page_no:05d}*.png"))
        if not matches:
            raise RenderError(f"page {page_no} did not render from {pdf_path}")
        img = matches[0]
    return img

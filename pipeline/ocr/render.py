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

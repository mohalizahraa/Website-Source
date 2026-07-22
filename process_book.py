#!/usr/bin/env python3
"""Process one PDF: temporary images -> Arabic OCR -> English draft -> QA report.

Requires Poppler (pdftoppm), Pillow, Apple's native Vision OCR on macOS, and a
running local Ollama server. Tesseract remains an optional fallback. The script
processes one book at a time so OCR and translation do not compete for RAM.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


ARABIC_MARKER = re.compile(r"[\[(\{][\s٠-٩0-9]{1,3}[\])\}]")


def require(command: str) -> None:
    if not shutil.which(command):
        raise RuntimeError(f"Required command is missing: {command}")


def render_pdf(pdf: Path, pages: Path, dpi: int) -> list[Path]:
    require("pdftoppm")
    prefix = pages / "page"
    subprocess.run(["pdftoppm", "-png", "-r", str(dpi), str(pdf), str(prefix)], check=True)
    return sorted(pages.glob("page-*.png"))


def split_page(image: Path, body_out: Path, notes_out: Path) -> tuple[bool, str]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Install Pillow: pip install pillow") from exc
    with Image.open(image) as im:
        width, height = im.size
        header = int(height * 0.115)
        # Prefer a real horizontal footnote divider, exactly as the old tests
        # did. If a page has no divider, use a cautious default.
        note_top, method = int(height * 0.84), "84% fallback"
        try:
            import cv2
            import numpy as np
            gray = cv2.cvtColor(np.array(im.convert("RGB")), cv2.COLOR_RGB2GRAY)
            lower_start, lower_end = int(height * 0.65), int(height * 0.92)
            lower = gray[lower_start:lower_end, :]
            threshold = cv2.threshold(lower, 200, 255, cv2.THRESH_BINARY_INV)[1]
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(40, int(width * 0.15)), 1))
            detected = cv2.morphologyEx(threshold, cv2.MORPH_OPEN, kernel)
            rows = np.where(detected > 0)[0]
            if len(rows):
                note_top, method = lower_start + int(rows.min()), "detected divider"
        except ImportError:
            pass
        im.crop((0, header, width, note_top)).save(body_out)
        im.crop((0, note_top, width, height)).save(notes_out)
    return True, method


def vision_ocr(image: Path) -> str:
    """Use Apple's local Vision framework for Arabic OCR."""
    if sys.platform != "darwin":
        raise RuntimeError("Apple Vision OCR only runs on macOS. Use --ocr-engine tesseract on another computer.")
    try:
        from Cocoa import NSURL
        from Vision import (
            VNImageRequestHandler,
            VNRecognizeTextRequest,
            VNRequestTextRecognitionLevelAccurate,
        )
    except ImportError as exc:
        raise RuntimeError("Apple Vision Python bindings are unavailable on this Mac.") from exc

    lines: list[str] = []

    def completed(request, error):
        if error:
            raise RuntimeError(f"Apple Vision OCR failed: {error}")
        for observation in request.results() or []:
            candidates = observation.topCandidates_(1)
            if candidates:
                lines.append(str(candidates[0].string()).strip())

    handler = VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(str(image)), None)
    request = VNRecognizeTextRequest.alloc().initWithCompletionHandler_(completed)
    request.setRecognitionLevel_(VNRequestTextRecognitionLevelAccurate)
    request.setRecognitionLanguages_(["ar"])
    handler.performRequests_error_([request], None)
    return "\n".join(line for line in lines if line)


def ocr(image: Path, engine: str, command_template: str | None) -> str:
    if engine == "vision":
        return vision_ocr(image)
    if engine == "command":
        if not command_template:
            raise RuntimeError("--ocr-engine command requires --ocr-command.")
        command = command_template.format(image=str(image), lang="ara")
        return subprocess.run(command, shell=True, check=True, text=True, capture_output=True).stdout.strip()
    if engine != "tesseract":
        raise RuntimeError(f"Unknown OCR engine: {engine}")
    require("tesseract")
    return subprocess.run(["tesseract", str(image), "stdout", "-l", "ara"], check=True,
                          text=True, capture_output=True).stdout.strip()


def translate(text: str, model: str) -> str:
    if not text.strip():
        return ""
    prompt = (
        "Translate the following Arabic book text into precise English. Translate all text; "
        "do not summarize, add commentary, or omit notes. Preserve quotations and paragraph breaks. "
        "Return English only.\n\nArabic:\n" + text
    )
    payload = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
    request = urllib.request.Request("http://127.0.0.1:11434/api/generate", payload,
                                     {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read().decode("utf-8"))["response"].strip()


def chunks(text: str, maximum: int = 5000) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    result, current = [], ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > maximum:
            result.append(current)
            current = ""
        current = (current + "\n\n" + paragraph).strip()
    if current:
        result.append(current)
    return result or [text]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--work-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--database", type=Path)
    parser.add_argument("--model", default="aya-expanse:8b")
    parser.add_argument("--ocr-engine", choices=("vision", "tesseract", "command"), default="vision")
    parser.add_argument("--ocr-command", help="Example: 'my_ocr {image} --lang {lang}'")
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--keep-work", action="store_true")
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise SystemExit(f"PDF not found: {args.pdf}")
    work = args.work_root / args.book_id
    pages, crops = work / "pages", work / "crops"
    final = args.output_root / args.book_id
    pages.mkdir(parents=True, exist_ok=True)
    crops.mkdir(parents=True, exist_ok=True)
    final.mkdir(parents=True, exist_ok=True)

    page_rows = []
    try:
        for number, page in enumerate(render_pdf(args.pdf, pages, args.dpi), start=1):
            body_image, notes_image = crops / f"{number:04d}-body.png", crops / f"{number:04d}-notes.png"
            _, split_note = split_page(page, body_image, notes_image)
            body_ar = ocr(body_image, args.ocr_engine, args.ocr_command)
            notes_ar = ocr(notes_image, args.ocr_engine, args.ocr_command)
            anchors = len(ARABIC_MARKER.findall(body_ar))
            body_with_anchors = ARABIC_MARKER.sub("⚓", body_ar)
            body_en = "\n\n".join(translate(part, args.model) for part in chunks(body_with_anchors))
            notes_en = "\n\n".join(translate(part, args.model) for part in chunks(notes_ar))
            page_rows.append({"page": number, "body_en": body_en, "notes_en": notes_en,
                              "source_anchor_count": anchors, "note_boundary": split_note})
            print(f"Completed page {number}")
    except Exception as exc:
        (final / "error.txt").write_text(str(exc), encoding="utf-8")
        raise

    source_anchors = sum(row["source_anchor_count"] for row in page_rows)
    draft_anchors = sum(row["body_en"].count("⚓") for row in page_rows)
    report = {"book_id": args.book_id, "pages": len(page_rows), "source_anchor_count": source_anchors,
              "draft_anchor_count": draft_anchors, "status": "draft_ready" if source_anchors == draft_anchors else "needs_review"}
    (final / "english_draft.json").write_text(json.dumps({"book_id": args.book_id, "pages": page_rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    (final / "qa_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.database:
        with sqlite3.connect(args.database) as conn:
            conn.execute("UPDATE books SET status=?, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                         (report["status"], args.book_id))
    if not args.keep_work and report["status"] == "draft_ready":
        shutil.rmtree(work)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

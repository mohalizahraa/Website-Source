#!/usr/bin/env python3
"""Run ready books one at a time. Designed for an unattended local run."""

from __future__ import annotations

import argparse
import sqlite3
import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--work-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=0, help="0 means all ready books")
    parser.add_argument("--model", default="aya-expanse:8b")
    parser.add_argument("--ocr-command")
    parser.add_argument("--publish", action="store_true", help="Publish after every successful draft")
    parser.add_argument("--google-folder-id")
    args = parser.parse_args()

    with sqlite3.connect(args.database) as conn:
        rows = conn.execute("SELECT id,local_pdf FROM books WHERE status='ready' AND local_pdf IS NOT NULL ORDER BY id").fetchall()
    if args.limit:
        rows = rows[:args.limit]
    for book_id, pdf in rows:
        command = [sys.executable, str(HERE / "process_book.py"), "--book-id", book_id, "--pdf", pdf,
                   "--work-root", str(args.work_root), "--output-root", str(args.output_root),
                   "--database", str(args.database), "--model", args.model]
        if args.ocr_command:
            command += ["--ocr-command", args.ocr_command]
        try:
            subprocess.run(command, check=True)
            if args.publish:
                draft = args.output_root / book_id / "english_draft.json"
                publish = [sys.executable, str(HERE / "publish_book_to_google.py"), "--book-id", book_id,
                           "--draft", str(draft), "--database", str(args.database)]
                if args.google_folder_id:
                    publish += ["--folder-id", args.google_folder_id]
                subprocess.run(publish, check=True)
        except subprocess.CalledProcessError as exc:
            with sqlite3.connect(args.database) as conn:
                conn.execute("UPDATE books SET status='needs_review', last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                             (str(exc), book_id))
            print(f"FAILED {book_id}; continuing.")
    print("Batch complete.")


if __name__ == "__main__":
    main()

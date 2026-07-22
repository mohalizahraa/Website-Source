#!/usr/bin/env python3
"""Copy book status and Google Doc links from SQLite into the website JSON data."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--archive-json", required=True, type=Path)
    parser.add_argument("--out", type=Path, help="Defaults to replacing --archive-json")
    args = parser.parse_args()

    archive = json.loads(args.archive_json.read_text(encoding="utf-8"))
    if not isinstance(archive, list):
        raise SystemExit("Website archive JSON must be an array of books.")
    with sqlite3.connect(args.database) as conn:
        rows = conn.execute("SELECT id,title_ar,status,google_doc_url,last_error FROM books").fetchall()
    by_title = {title: {"id": ident, "translation_status": status, "google_doc_url": url, "translation_error": error}
                for ident, title, status, url, error in rows}
    updated = 0
    for book in archive:
        values = by_title.get(book.get("ar"))
        if values:
            book["translation"] = values
            updated += 1
    destination = args.out or args.archive_json
    destination.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {updated} website records: {destination}")


if __name__ == "__main__":
    main()

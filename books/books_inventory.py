#!/usr/bin/env python3
"""Create the master local book database from the 176-book catalogue and PDFs."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def book_id(record: dict) -> str:
    seed = "|".join(str(record.get(key, "")) for key in ("ar", "author", "pdf_link"))
    return "B-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:10].upper()


def pdf_index(root: Path) -> list[Path]:
    return [path for path in root.rglob("*.pdf") if path.is_file()]


def choose_local_pdf(title: str, files: list[Path]) -> Path | None:
    normalized = "".join(title.lower().split())
    matches = [path for path in files if normalized in "".join(path.stem.lower().split())]
    return matches[0] if len(matches) == 1 else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--pdf-root", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    if not isinstance(catalog, list):
        raise SystemExit("Catalog must be a JSON array.")
    files = pdf_index(args.pdf_root)

    args.database.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.database)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY, title_ar TEXT NOT NULL, title_en TEXT,
          author TEXT, category TEXT, source_pdf_url TEXT, local_pdf TEXT,
          status TEXT NOT NULL, google_doc_url TEXT, last_error TEXT,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    report = {"ready": [], "missing": [], "unclear": []}
    for record in catalog:
        title = str(record.get("ar", "")).strip()
        if not title:
            continue
        local = choose_local_pdf(title, files)
        status = "ready" if local else "missing"
        row = {
            "id": book_id(record), "title_ar": title, "title_en": record.get("en", ""),
            "author": record.get("author", ""), "category": record.get("category", ""),
            "source_pdf_url": record.get("pdf_link", ""), "local_pdf": str(local) if local else None,
            "status": status,
        }
        conn.execute("""
          INSERT INTO books(id,title_ar,title_en,author,category,source_pdf_url,local_pdf,status)
          VALUES(:id,:title_ar,:title_en,:author,:category,:source_pdf_url,:local_pdf,:status)
          ON CONFLICT(id) DO UPDATE SET title_ar=excluded.title_ar,title_en=excluded.title_en,
          author=excluded.author,category=excluded.category,source_pdf_url=excluded.source_pdf_url,
          local_pdf=excluded.local_pdf,status=excluded.status,updated_at=CURRENT_TIMESTAMP
        """, row)
        report[status].append(row)
    conn.commit()
    conn.close()

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Ready: {len(report['ready'])}; missing: {len(report['missing'])}; database: {args.database}")


if __name__ == "__main__":
    main()

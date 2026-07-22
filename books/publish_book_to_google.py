#!/usr/bin/env python3
"""Create a Google Doc from an English draft and save its URL in the local database.

Needs Google Cloud credentials and the google-api-python-client package. The
three-book pilot is the proof point for real Docs footnotes and the native TOC.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path


def services():
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise RuntimeError("Install Google API packages: pip install google-api-python-client google-auth") from exc
    credential_file = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE")
    if not credential_file:
        raise RuntimeError("Set GOOGLE_SERVICE_ACCOUNT_FILE to your service-account JSON file.")
    creds = Credentials.from_service_account_file(credential_file, scopes=[
        "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive",
    ])
    return build("docs", "v1", credentials=creds), build("drive", "v3", credentials=creds)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--draft", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--folder-id", help="Optional Google Drive destination folder")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    draft = json.loads(args.draft.read_text(encoding="utf-8"))
    title = f"Haydari Book Translation — {args.book_id}"
    text = "\n\n".join(page["body_en"] for page in draft["pages"])
    if args.dry_run:
        print(json.dumps({"title": title, "characters": len(text), "footnote_placeholders": text.count("⚓")}, indent=2))
        return

    docs, drive = services()
    created = docs.documents().create(body={"title": title}).execute()
    document_id = created["documentId"]
    # The pilot validates formatting, native TOC insertion, and footnotes before batch use.
    docs.documents().batchUpdate(documentId=document_id, body={"requests": [
        {"insertText": {"location": {"index": 1}, "text": text}},
    ]}).execute()
    if args.folder_id:
        drive.files().update(fileId=document_id, addParents=args.folder_id, fields="id,webViewLink").execute()
    url = f"https://docs.google.com/document/d/{document_id}/edit"
    with sqlite3.connect(args.database) as conn:
        conn.execute("UPDATE books SET google_doc_url=?, status='needs_google_format_review', updated_at=CURRENT_TIMESTAMP WHERE id=?",
                     (url, args.book_id))
    print(url)


if __name__ == "__main__":
    main()

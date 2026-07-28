"""FastAPI application — HTTP API exactly as specified in ARCHITECTURE.md.

All endpoints are mounted under the `/api` prefix. Every mutation writes an
append-only event and commits atomically.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sqlite3
from typing import Optional

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from . import chat as chat_mod
from . import config, db, ingest, storage
from .diffing import compute_diff
from .events import write_event
from .schemas import (
    CatalogBook,
    LearningSummary,
    ReviewRequest,
    ReviewResponse,
    StyleRuleRequest,
    TermbaseRequest,
)
from .wire import segment_to_wire

app = FastAPI(title="Haydari Translation Platform API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# DB dependency (one connection per request; ensures schema exists)
# ---------------------------------------------------------------------------
def get_conn() -> sqlite3.Connection:
    conn = db.connect()
    db.init_db(conn)  # idempotent CREATE TABLE IF NOT EXISTS
    try:
        yield conn
    finally:
        conn.close()


@app.on_event("startup")
def _on_startup() -> None:
    """A fresh process has no running worker, so any book still marked
    'processing' is stale — un-wedge it so ingestion can be resumed."""
    conn = db.connect()
    try:
        db.init_db(conn)
        reset = db.reset_stale_processing(conn)
        if reset:
            for bid in reset:
                write_event(conn, actor="system", type="ingest.reset",
                            payload={"book_id": bid, "reason": "stale processing on startup"})
            conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Learning summary (shared shape)
# ---------------------------------------------------------------------------
def _learning_summary(conn: sqlite3.Connection) -> dict:
    return {
        "tm_size": db.tm_size(conn),
        "terms": db.count(conn, "termbase"),
        "rules": db.count(conn, "style_rules"),
        "auto_approval_rate": db.auto_approval_rate(conn),
        "corrections": db.count(conn, "corrections"),
    }


_ANCHOR_RE = re.compile(r"\[\[FN-\d+\]\]")


def _missing_anchors(source_ar: str, en_text: str) -> list[str]:
    """Footnote anchors present in the source but absent from the English."""
    required = _ANCHOR_RE.findall(source_ar or "")
    present = set(_ANCHOR_RE.findall(en_text or ""))
    missing: list[str] = []
    for a in required:
        if a not in present and a not in missing:
            missing.append(a)
    return missing


def _suggest_terms(diff: dict) -> list[dict]:
    """Naive term suggestions: short 'replace' ops are candidate glossary entries."""
    out: list[dict] = []
    for op in diff.get("ops", []):
        if op["op"] != "replace":
            continue
        after = (op.get("after") or "").strip()
        before = (op.get("before") or "").strip()
        if after and 0 < len(after.split()) <= 3:
            out.append({"before": before, "after": after})
    return out


# ---------------------------------------------------------------------------
# Books
# ---------------------------------------------------------------------------
@app.get("/api/books")
def list_books(conn: sqlite3.Connection = Depends(get_conn)):
    return db.list_books(conn)


@app.get("/api/books/{book_id}")
def get_book(book_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    book = db.get_book(conn, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="book not found")
    return book


@app.delete("/api/books/{book_id}")
def delete_book(book_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    """Delete a book and everything under it (pages, segments, corrections, TM,
    book-scoped terms — via ON DELETE CASCADE) plus its uploaded PDF."""
    book = db.get_book(conn, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="book not found")
    # Remove the source PDF from storage (best-effort). Handles both the new
    # storage keys and legacy absolute paths under the uploads dir.
    src = book.get("source_pdf") or ""
    try:
        if src.startswith("books/"):
            storage.get_storage().delete(src)
        else:
            up = os.path.realpath(config.upload_dir())
            if src and os.path.realpath(src).startswith(up) and os.path.exists(src):
                os.remove(src)
    except Exception:  # noqa: BLE001 — file cleanup is best-effort
        pass
    conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
    write_event(conn, actor="reviewer", type="book.delete", payload={"book_id": book_id})
    conn.commit()
    return {"ok": True, "id": book_id}


@app.post("/api/books/upload")
async def upload_books(
    files: list[UploadFile] = File(...),
    title_ar: Optional[str] = Form(None),
    title_en: Optional[str] = Form(None),
    author: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Accept one or many PDFs; store each and create a book (status=uploaded)."""
    if not files:
        raise HTTPException(status_code=400, detail="no files provided")
    created: list[dict] = []
    for f in files:
        book_id = db.next_book_id(conn)
        safe_name = os.path.basename(f.filename or f"{book_id}.pdf")
        # Store under a backend-neutral key (local disk or S3/R2). The KEY is
        # persisted in source_pdf; the ingest worker materializes it to a local
        # file for pdftoppm.
        key = f"books/{book_id}/{safe_name}"
        storage.get_storage().save_bytes(key, await f.read(), "application/pdf")
        # Default title from filename when none supplied.
        stem = os.path.splitext(safe_name)[0]
        db.insert_book(
            conn,
            book_id=book_id,
            title_ar=title_ar or stem,
            title_en=title_en,
            author=author,
            status="uploaded",
            source_pdf=key,
        )
        if notes and notes.strip():
            db.set_book_notes(conn, book_id, notes.strip())
        write_event(
            conn, actor="uploader", type="book.upload",
            payload={"id": book_id, "file": safe_name},
        )
        conn.commit()  # commit so next_book_id sees this row
        created.append({"id": book_id})
    return created


@app.post("/api/books/import")
async def import_books(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    """Bulk-register books from a catalog.

    Accepts the contract's raw JSON array ``[ {title_ar, ...}, ... ]`` and also
    the wrapped form ``{"books": [ ... ]}`` for convenience.
    """
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    if isinstance(payload, dict) and "books" in payload:
        raw_entries = payload["books"]
    elif isinstance(payload, list):
        raw_entries = payload
    else:
        raise HTTPException(
            status_code=400,
            detail="expected a JSON array of books or {\"books\": [...]}",
        )
    try:
        entries = [CatalogBook(**e) for e in raw_entries]
    except (TypeError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid catalog entry: {exc}")

    created: list[dict] = []
    for entry in entries:
        book_id = db.next_book_id(conn)
        db.insert_book(
            conn,
            book_id=book_id,
            title_ar=entry.title_ar,
            title_en=entry.title_en,
            author=entry.author,
            status="uploaded",
            source_pdf=entry.source_pdf,
        )
        write_event(
            conn, actor="importer", type="book.import",
            payload={"id": book_id, "title_ar": entry.title_ar},
        )
        conn.commit()
        created.append({"id": book_id})
    return created


@app.post("/api/books/{book_id}/ingest")
async def ingest_book(
    book_id: str, request: Request, conn: sqlite3.Connection = Depends(get_conn)
):
    """Enqueue the OCR->translate->QA pipeline (one-at-a-time worker).

    Optional JSON body bounds the run:
        {"from_page": 1, "to_page": 50, "max_pages": 20}
    Omit all three to process the next window (resume) with the default cap.
    """
    book = db.get_book(conn, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="book not found")

    options: dict = {}
    try:
        body = await request.json()
        if isinstance(body, dict):
            for k in ("from_page", "to_page", "max_pages"):
                v = body.get(k)
                if v is not None:
                    options[k] = int(v)
            if body.get("force"):
                options["force"] = True
    except Exception:  # noqa: BLE001 — empty/invalid body => default run
        options = {}

    write_event(
        conn, actor="reviewer", type="ingest.enqueue",
        payload={"book_id": book_id, "options": options},
    )
    conn.commit()
    state = ingest.enqueue(book_id, options)
    return {"book_id": book_id, "job": state, "options": options}


def _status_payload(conn: sqlite3.Connection, book: dict) -> dict:
    """Shared status shape: live page progress the Library bar reads."""
    book_id = book["id"]
    total = int(book.get("pages_total") or 0)
    done = db.pages_done(conn, book_id)
    job = ingest.job_state(book_id)
    active = job in ("queued", "processing") or book["status"] == "processing"
    phase = "translate" if active else ("done" if done and total and done >= total else "idle")
    # Progress reflects INGEST completion (pages done / total) so the bar moves
    # live during processing — distinct from the review/approval fraction.
    progress = (done / total) if total else (1.0 if book["status"] == "in_review" else 0.0)
    return {
        "book_id": book_id,
        "id": book_id,
        "status": book["status"],
        "job": job,
        "phase": phase,
        "pages_done": done,
        "pages_total": total,
        "pages": done,  # back-compat alias
        "has_more": bool(total) and done < total,
        "progress": progress,
        "review": book["progress"],  # approval fraction, for the review view
        "detail": ingest.job_detail(book_id),  # live phase/page/segment + message
    }


@app.get("/api/books/{book_id}/status")
def book_status(book_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    """Ingestion/translation progress for the Library view."""
    book = db.get_book(conn, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="book not found")
    return _status_payload(conn, book)


@app.post("/api/chat")
async def chat_endpoint(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    """In-app assistant. Body: {messages:[{role,content}], book_id?}."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    messages = body.get("messages") or []
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="messages[] required")
    book_id = body.get("book_id")
    try:
        result = chat_mod.chat(conn, messages, book_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"assistant error: {exc}")
    return result


@app.patch("/api/books/{book_id}")
async def update_book(
    book_id: str, request: Request, conn: sqlite3.Connection = Depends(get_conn)
):
    """Update editable book fields. Currently: translation_notes."""
    book = db.get_book(conn, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="book not found")
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    if "translation_notes" in body:
        db.set_book_notes(conn, book_id, (body.get("translation_notes") or "").strip() or None)
        write_event(conn, actor="reviewer", type="book.notes",
                    payload={"book_id": book_id})
    conn.commit()
    return db.get_book(conn, book_id)


@app.get("/api/books/{book_id}/activity")
def book_activity(book_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    """Recent ingest activity for a book — a live feed the UI can show so the
    reviewer always sees what happened (page done, page failed, start, finish)."""
    if db.get_book(conn, book_id) is None:
        raise HTTPException(status_code=404, detail="book not found")
    rows = conn.execute(
        "SELECT ts, type, payload_json FROM events "
        "WHERE type LIKE 'ingest%' AND payload_json LIKE ? "
        "ORDER BY id DESC LIMIT 40",
        (f'%"{book_id}"%',),
    ).fetchall()
    items = []
    for r in rows:
        try:
            payload = json.loads(r["payload_json"] or "{}")
        except Exception:  # noqa: BLE001
            payload = {}
        items.append({"ts": r["ts"], "type": r["type"],
                      "page_no": payload.get("page_no"),
                      "error": payload.get("error"),
                      "pages_done": payload.get("pages_done")})
    return {"items": items}


@app.get("/api/books/{book_id}/pages")
def list_pages(book_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    """The page numbers that are ready to review (completed OCR+translate).

    Ingestion can cover a non-contiguous range (e.g. pages 1–2 then 100), so the
    review UI must navigate the pages that actually exist rather than 1..N.
    """
    if db.get_book(conn, book_id) is None:
        raise HTTPException(status_code=404, detail="book not found")
    return {"pages": sorted(db.completed_page_numbers(conn, book_id))}


@app.get("/api/books/{book_id}/pages/{n}")
def get_page(book_id: str, n: int, conn: sqlite3.Connection = Depends(get_conn)):
    page = db.get_page(conn, book_id, n)
    if page is None:
        raise HTTPException(status_code=404, detail="page not found")
    segments = [segment_to_wire(s) for s in db.get_page_segments(conn, book_id, n)]
    return {
        "page": page["page_no"],
        "image_url": page.get("image_path"),
        "segments": segments,
    }


# ---------------------------------------------------------------------------
# Segments
# ---------------------------------------------------------------------------
@app.get("/api/segments/{seg_id}")
def get_segment(seg_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    seg = db.get_segment(conn, seg_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="segment not found")
    return segment_to_wire(seg)


@app.post("/api/segments/{seg_id}/review", response_model=ReviewResponse)
def review_segment(
    seg_id: str,
    body: ReviewRequest,
    conn: sqlite3.Connection = Depends(get_conn),
):
    seg = db.get_segment(conn, seg_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="segment not found")

    en_after = body.en_edited

    # Validate an approval BEFORE any write: never approve empty/whitespace text
    # or text that drops a [[FN-n]] anchor present in the source (would corrupt
    # TM and break footnote provenance).
    if body.action == "approve":
        if not (en_after or "").strip():
            raise HTTPException(
                status_code=400, detail="cannot approve empty translation"
            )
        missing = _missing_anchors(seg["ar"], en_after)
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"approved text drops footnote anchor(s): {', '.join(missing)}",
            )

    # The durable training pair is anchored to the ORIGINAL model draft, so it
    # stays (en_draft -> en_edited) even across reject->approve cycles. en_draft
    # is immutable (only en_current is ever rewritten).
    en_draft = seg.get("en_draft") or ""
    diff = compute_diff(en_draft, en_after)

    # Record the correction and COMMIT IT IMMEDIATELY. The training signal must
    # be durable regardless of anything that happens next (e.g. a TM-upsert
    # contention must never roll it back).
    db.insert_correction(
        conn,
        segment_id=seg_id,
        en_before=en_draft,
        en_after=en_after,
        diff=diff,
        mqm_tags=body.mqm,
        dims=body.scores.model_dump(exclude_none=True),
        reviewer=body.reviewer,
    )
    conn.commit()

    tm_added = 0
    applied_to: list[str] = []
    new_status = seg["status"]

    # Apply the action in a separate transaction from the correction.
    if body.action == "approve":
        db.update_segment(conn, seg_id, en_current=en_after, status="approved")
        new_status = "approved"
        try:
            _tm_id, created = db.upsert_tm(
                conn,
                book_id=seg["book_id"],
                ar=seg["ar"],
                en_approved=en_after,
            )
            tm_added = 1 if created else 0
            applied_to = db.segments_matching_ar(conn, seg["ar"], exclude_id=seg_id)
        except Exception as exc:  # noqa: BLE001 — TM is secondary to the approval
            write_event(
                conn, actor=body.reviewer or "reviewer", type="tm.error",
                payload={"segment_id": seg_id, "error": str(exc)},
            )
        conn.commit()
    elif body.action == "reject":
        # Keep the reviewer's text but send it back for another pass.
        db.update_segment(conn, seg_id, en_current=en_after, status="needs_review")
        new_status = "needs_review"
        conn.commit()
    # else skip — leave status untouched, nothing to persist.

    terms_suggested = _suggest_terms(diff)

    # Audit event.
    write_event(
        conn,
        actor=body.reviewer or "reviewer",
        type="segment.review",
        payload={
            "segment_id": seg_id,
            "action": body.action,
            "changed": diff["changed"],
            "tm_added": tm_added,
            "status": new_status,
        },
    )
    conn.commit()

    return {
        "status": new_status,
        "learning": {
            "tm_added": tm_added,
            "terms_suggested": terms_suggested,
            "applied_to": applied_to,
        },
    }


# ---------------------------------------------------------------------------
# Termbase / style rules
# ---------------------------------------------------------------------------
@app.post("/api/termbase")
def add_term(body: TermbaseRequest, conn: sqlite3.Connection = Depends(get_conn)):
    if body.scope == "book" and not body.book_id:
        raise HTTPException(status_code=400, detail="book_id required for scope=book")
    term_id = db.insert_term(
        conn,
        term_ar=body.term_ar,
        term_en=body.term_en,
        note=body.note,
        scope=body.scope,
        book_id=body.book_id,
        created_by=body.created_by,
    )
    write_event(
        conn,
        actor=body.created_by or "reviewer",
        type="termbase.add",
        payload={"id": term_id, "term_ar": body.term_ar, "term_en": body.term_en},
    )
    conn.commit()
    return {"id": term_id, "learning": _learning_summary(conn)}


@app.post("/api/termbase/import")
async def import_termbase(
    file: UploadFile = File(...),
    scope: str = Form("global"),
    book_id: Optional[str] = Form(None),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Bulk-load glossary term pairs from a CSV.

    Expected header columns (case-insensitive): term_ar, term_en, and optional
    note, scope, book_id. Per-row scope/book_id override the form defaults.
    """
    try:
        raw = (await file.read()).decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400, detail="CSV must be UTF-8 encoded text"
        )
    reader = csv.DictReader(io.StringIO(raw))
    try:
        fieldnames = reader.fieldnames
    except csv.Error:
        raise HTTPException(status_code=400, detail="malformed CSV")
    if not fieldnames:
        raise HTTPException(status_code=400, detail="empty CSV")
    norm = {name: (name or "").strip().lower() for name in fieldnames}
    added = 0
    try:
        rows = list(reader)
    except csv.Error:
        raise HTTPException(status_code=400, detail="malformed CSV")
    for row in rows:
        r = {norm[k]: (v or "").strip() for k, v in row.items() if k is not None}
        term_ar = r.get("term_ar", "")
        term_en = r.get("term_en", "")
        if not term_ar or not term_en:
            continue
        row_scope = r.get("scope") or scope
        row_book = r.get("book_id") or (book_id if row_scope == "book" else None)
        db.insert_term(
            conn,
            term_ar=term_ar,
            term_en=term_en,
            note=r.get("note") or None,
            scope=row_scope if row_scope in ("global", "book") else "global",
            book_id=row_book or None,
            created_by="csv-import",
        )
        added += 1
    write_event(
        conn, actor="csv-import", type="termbase.import", payload={"added": added}
    )
    conn.commit()
    return {"added": added, "learning": _learning_summary(conn)}


@app.post("/api/style-rules")
def add_style_rule(
    body: StyleRuleRequest, conn: sqlite3.Connection = Depends(get_conn)
):
    if body.scope == "book" and not body.book_id:
        raise HTTPException(status_code=400, detail="book_id required for scope=book")
    rule_id = db.insert_style_rule(
        conn, rule=body.rule, scope=body.scope, book_id=body.book_id
    )
    write_event(
        conn,
        actor="reviewer",
        type="style_rule.add",
        payload={"id": rule_id, "rule": body.rule},
    )
    conn.commit()
    return {"id": rule_id, "learning": _learning_summary(conn)}


# ---------------------------------------------------------------------------
# Learning summary
# ---------------------------------------------------------------------------
@app.get("/api/learning/summary", response_model=LearningSummary)
def learning_summary(conn: sqlite3.Connection = Depends(get_conn)):
    return _learning_summary(conn)


@app.get("/api/health")
def health():
    return {"status": "ok"}

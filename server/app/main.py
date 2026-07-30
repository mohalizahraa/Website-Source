"""FastAPI application — HTTP API exactly as specified in ARCHITECTURE.md.

All endpoints are mounted under the `/api` prefix. Every mutation writes an
append-only event and commits atomically.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import math
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
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from . import auth
from . import chat as chat_mod
from . import llm_review as llm_review_mod
from . import config, db, ingest, storage
from .diffing import compute_diff
from .events import write_event
from .schemas import (
    CatalogBook,
    DraftRequest,
    LearningSummary,
    LLMReviewRequest,
    LLMReviewResponse,
    ReviewRequest,
    ReviewResponse,
    StyleRuleRequest,
    TermbaseRequest,
)
from .wire import segment_to_wire

logger = logging.getLogger("uvicorn.error")

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
    # Schema is created once at startup (see _on_startup), NOT per request — on
    # Postgres, running CREATE TABLE/INDEX IF NOT EXISTS on every request adds
    # real catalog overhead and can exhaust connection limits under polling.
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Auth dependencies + helpers
# ---------------------------------------------------------------------------
def current_user(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    """The logged-in user, or None for anonymous (public) requests."""
    token = request.cookies.get(auth.COOKIE_NAME)
    if not token:
        return None
    uid = auth.read_session(token)
    if not uid:
        return None
    return db.get_user(conn, uid)


def require_user(user=Depends(current_user)):
    if user is None:
        raise HTTPException(status_code=401, detail="authentication required")
    return user


def require_admin(user=Depends(require_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return user


def require_creator(user=Depends(require_user)):
    """A user who may WRITE. Readers are read-only, so they're rejected here.

    Book-scoped writes re-check ownership via _require_book_access(write=True);
    this guards the GLOBAL-scope writes (termbase/style-rule/import) that have no
    single book to authorize against, so the role check would otherwise be
    skipped and a reader could write global training signal."""
    if user.get("role") == "reader":
        raise HTTPException(status_code=403, detail="read-only account")
    return user


def _user_wire(u: dict | None) -> dict | None:
    if not u:
        return None
    return {"id": u["id"], "email": u["email"],
            "display_name": u.get("display_name"), "role": u.get("role")}


def _cookie_secure() -> bool:
    return os.environ.get("HAYDARI_COOKIE_SECURE", "").strip().lower() in ("1", "true", "yes")


def _object_fingerprint(info: dict | None) -> tuple[str, int] | None:
    if not info:
        return None
    size = int(info.get("ContentLength") or 0)
    etag = str(info.get("ETag") or "").strip().strip('"').lower()
    if size <= 0 or not etag:
        return None
    return f"single-put:{etag}:{size}", size


def _backfill_source_fingerprints(conn) -> None:
    """Best-effort identity migration for books uploaded before deduplication.

    Metadata-only HEAD requests are enough for R2. Existing duplicate rows are
    deliberately left intact rather than deleting historical data automatically;
    future uploads will still match the first fingerprinted copy.
    """
    blob_store = storage.get_storage()
    for book in db.books_missing_source_fingerprint(conn):
        key = book.get("source_pdf") or ""
        if not key.startswith("books/"):
            continue
        try:
            identity = _object_fingerprint(blob_store.object_info(key))
            if not identity:
                continue
            fingerprint, size = identity
            db.set_book_source_identity(conn, book["id"], fingerprint, size)
            conn.commit()
        except Exception as exc:  # noqa: BLE001 — migration must not block startup
            conn.rollback()
            logger.warning("Could not fingerprint existing book %s: %s", book["id"], exc)


def _require_book_access(conn, book: dict | None, user, *, write: bool) -> dict:
    """Central access rule for a single book.

    - Anonymous may READ a published book only.
    - A logged-in user may read/write their own books (and legacy NULL-owner
      books, so pre-auth data stays manageable during migration). Admins: all.
    Raises 404 (not found), 401 (auth needed), or 403 (not yours).
    """
    if book is None:
        raise HTTPException(status_code=404, detail="book not found")
    published = book.get("status") == "published"
    if not write and published:
        return book  # public read of a published book
    if user is None:
        raise HTTPException(status_code=401, detail="authentication required")
    if write and user.get("role") == "reader":
        raise HTTPException(status_code=403, detail="read-only account")
    if user.get("role") == "admin":
        return book
    owner = book.get("owner_id")
    if owner is None or owner == user["id"]:
        return book
    raise HTTPException(status_code=403, detail="you do not have access to this book")


def _enforce_spend_quota(conn, user) -> None:
    """Block a paid action (ingest / chat) with 402 when a monthly cap is already
    reached. Enforced on spend ALREADY accrued (not a pre-estimate); the worker
    re-checks at run time so a burst of queued ingests can't overshoot."""
    reason = db.over_spend_quota(conn, user_id=user["id"], role=user.get("role"),
                                 user_limit=user.get("monthly_usd_limit"))
    if reason:
        raise HTTPException(status_code=402, detail=reason)


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
async def login(request: Request, response: Response,
                conn: sqlite3.Connection = Depends(get_conn)):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    u = db.get_user_by_email(conn, email)
    if not u or not auth.verify_password(password, u["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid email or password")
    token = auth.make_session(u["id"])
    response.set_cookie(auth.COOKIE_NAME, token, httponly=True, samesite="lax",
                        secure=_cookie_secure(), max_age=60 * 60 * 24 * 30, path="/")
    return _user_wire(u)


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.post("/api/auth/change-password")
async def change_password(
    request: Request,
    user=Depends(require_user),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Change the signed-in user's password after verifying the current one."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    current = body.get("current_password") or ""
    new = body.get("new_password") or ""
    if not auth.verify_password(current, user["password_hash"]):
        raise HTTPException(status_code=400, detail="current password is incorrect")
    if len(new) < 8:
        raise HTTPException(status_code=400, detail="new password must be at least 8 characters")
    if current == new:
        raise HTTPException(status_code=400, detail="new password must be different")
    db.set_user_password(conn, user["id"], auth.hash_password(new))
    write_event(conn, actor=user["id"], type="user.password.change", payload={"id": user["id"]})
    conn.commit()
    return {"ok": True}


@app.get("/api/auth/me")
def whoami(user=Depends(current_user)):
    return _user_wire(user)


@app.post("/api/auth/users")
async def create_user_endpoint(request: Request, _admin=Depends(require_admin),
                               conn: sqlite3.Connection = Depends(get_conn)):
    """Admin-only: provision a team account."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if "@" not in email or len(password) < 8:
        raise HTTPException(status_code=400, detail="valid email and 8+ char password required")
    if db.get_user_by_email(conn, email):
        raise HTTPException(status_code=409, detail="email already registered")
    role = body.get("role") if body.get("role") in ("admin", "creator", "reader") else "creator"
    # Optional per-user monthly spend cap (USD); null/absent = the env default.
    limit = body.get("monthly_usd_limit")
    try:
        limit = float(limit) if limit is not None else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="monthly_usd_limit must be a number")
    if limit is not None and (not math.isfinite(limit) or limit < 0):
        raise HTTPException(status_code=400, detail="monthly_usd_limit must be finite and non-negative")
    uid = db.next_user_id(conn)
    db.create_user(conn, user_id=uid, email=email,
                   password_hash=auth.hash_password(password),
                   display_name=body.get("display_name"), role=role,
                   monthly_usd_limit=limit)
    write_event(conn, actor=_admin["id"], type="user.create", payload={"id": uid, "role": role})
    conn.commit()
    return _user_wire(db.get_user(conn, uid))


@app.on_event("startup")
def _on_startup() -> None:
    """A fresh process has no running worker, so any book still marked
    'processing' is stale — un-wedge it so ingestion can be resumed."""
    # In production, REFUSE to start with insecure defaults (forgeable cookies
    # / default admin). Set HAYDARI_ENV=production once real secrets are configured.
    if os.environ.get("HAYDARI_ENV", "").strip().lower() == "production":
        missing = []
        if not auth.secret_is_configured():
            missing.append("HAYDARI_SECRET_KEY")
        if not os.environ.get("HAYDARI_ADMIN_EMAIL"):
            missing.append("HAYDARI_ADMIN_EMAIL")
        if not os.environ.get("HAYDARI_ADMIN_PASSWORD"):
            missing.append("HAYDARI_ADMIN_PASSWORD")
        if not _cookie_secure():
            missing.append("HAYDARI_COOKIE_SECURE=true")
        if missing:
            raise RuntimeError(
                "Refusing to start in production with insecure config; set: "
                + ", ".join(missing)
            )
    conn = db.connect()
    try:
        db.init_db(conn)
        _backfill_source_fingerprints(conn)
        reset = db.reset_stale_processing(conn)
        if reset:
            for bid in reset:
                write_event(conn, actor="system", type="ingest.reset",
                            payload={"book_id": bid, "reason": "stale processing on startup"})
            conn.commit()
        # Bootstrap the first admin account so the team can log in. Credentials
        # come from env; a dev default is used only when nothing is configured.
        if db.count_users(conn) == 0:
            email = (os.environ.get("HAYDARI_ADMIN_EMAIL") or "admin@haydari.local").strip().lower()
            password = os.environ.get("HAYDARI_ADMIN_PASSWORD") or "changeme-admin"
            uid = db.next_user_id(conn)
            db.create_user(conn, user_id=uid, email=email,
                           password_hash=auth.hash_password(password),
                           display_name="Admin", role="admin")
            write_event(conn, actor="system", type="user.bootstrap", payload={"id": uid})
            conn.commit()
    finally:
        conn.close()
    if not auth.secret_is_configured():
        import logging
        logging.getLogger("uvicorn.error").warning(
            "HAYDARI_SECRET_KEY is not set — using an INSECURE dev fallback. "
            "Session cookies are forgeable. Set a strong secret before production."
        )


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
def list_books(user=Depends(current_user), conn: sqlite3.Connection = Depends(get_conn)):
    # Anonymous → only published books (the public library). Logged in → your
    # own books plus any legacy unowned ones.
    if user is None:
        return db.list_published_books(conn)
    return db.list_books_for(conn, user["id"])


@app.get("/api/books/{book_id}")
def get_book(book_id: str, user=Depends(current_user),
             conn: sqlite3.Connection = Depends(get_conn)):
    book = db.get_book(conn, book_id)
    return _require_book_access(conn, book, user, write=False)


@app.delete("/api/books/{book_id}")
def delete_book(book_id: str, user=Depends(require_user),
                conn: sqlite3.Connection = Depends(get_conn)):
    """Delete a book and everything under it (pages, segments, corrections, TM,
    book-scoped terms — via ON DELETE CASCADE) plus its uploaded PDF."""
    book = _require_book_access(conn, db.get_book(conn, book_id), user, write=True)

    # Delete the DB rows FIRST (commit), THEN the storage blob — so a DB failure
    # never orphans the file (the reverse could leave a row pointing at nothing).
    # Pre-delete this book's translation-memory rows so the FK's ON DELETE SET
    # NULL never fires: setting book_id→NULL could collide with a global TM row
    # sharing the same ar_hash on the COALESCE(book_id,'') unique index.
    conn.execute("DELETE FROM translation_memory WHERE book_id = ?", (book_id,))
    conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
    write_event(conn, actor="reviewer", type="book.delete", payload={"book_id": book_id})
    conn.commit()

    # Best-effort blob cleanup (new storage keys and legacy absolute paths).
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
    return {"ok": True, "id": book_id}


@app.post("/api/books/upload")
async def upload_books(
    files: list[UploadFile] = File(...),
    title_ar: Optional[str] = Form(None),
    title_en: Optional[str] = Form(None),
    author: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    user=Depends(require_creator),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Accept one or many PDFs; store each and create a book (status=uploaded)
    owned by the caller."""
    if not files:
        raise HTTPException(status_code=400, detail="no files provided")
    created: list[dict] = []
    for f in files:
        base = os.path.basename(f.filename or "upload.pdf")
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._") or "upload.pdf"
        data = await f.read()
        stem = os.path.splitext(safe_name)[0]
        # The production direct-upload path uses R2's single-PUT ETag (MD5).
        # Computing the same identity here keeps local/legacy uploads compatible.
        digest = hashlib.md5(data, usedforsecurity=False).hexdigest()  # noqa: S324
        fingerprint = f"single-put:{digest}:{len(data)}"
        existing = db.find_book_by_source_fingerprint(conn, user["id"], fingerprint)
        if existing:
            created.append({"id": existing["id"], "duplicate": True})
            continue

        # Reserve the id by inserting the DB row FIRST (id allocation is atomic —
        # db.next_book_id serializes concurrent callers, so no PK race), then
        # commit BEFORE writing the blob so a failure never orphans a file.
        book_id = db.next_book_id(conn)
        db.insert_book(
            conn, book_id=book_id, title_ar=title_ar or stem,
            title_en=title_en, author=author, status="uploaded",
            source_pdf=f"books/{book_id}/{safe_name}", owner_id=user["id"],
            source_fingerprint=fingerprint, source_size=len(data),
        )
        conn.commit()

        key = f"books/{book_id}/{safe_name}"
        try:
            storage.get_storage().save_bytes(key, data, "application/pdf")
        except Exception as exc:  # noqa: BLE001 — don't leave a row with no blob
            logger.exception("Storage write failed for book %s at key %s", book_id, key)
            conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
            conn.commit()
            # Use a non-5xx dependency status so reverse proxies preserve the
            # actionable R2 error response for the browser instead of replacing
            # it with a generic gateway/network error.
            raise HTTPException(status_code=424, detail=f"storage write failed: {exc}")
        if notes and notes.strip():
            db.set_book_notes(conn, book_id, notes.strip())
        write_event(conn, actor=user["id"], type="book.upload",
                    payload={"id": book_id, "file": safe_name})
        conn.commit()
        created.append({"id": book_id, "duplicate": False})
    return created


@app.post("/api/books/upload/initiate")
async def initiate_direct_book_upload(
    request: Request,
    user=Depends(require_creator),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Create a short-lived direct-to-S3/R2 upload for one PDF.

    Only the small JSON control request crosses the API proxy. The browser sends
    the PDF directly to object storage, avoiding Cloudflare request-size limits
    and keeping Railway from buffering an entire book in memory.
    """
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")

    base = os.path.basename(str(body.get("filename") or "upload.pdf"))
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._") or "upload.pdf"
    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only PDF files are supported")
    try:
        size = int(body.get("size"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="a valid file size is required")
    max_size = int(os.environ.get("HAYDARI_MAX_UPLOAD_BYTES", str(5 * 1024**3)))
    if size <= 0:
        raise HTTPException(status_code=400, detail="the PDF is empty")
    if size > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"PDF exceeds the configured {max_size}-byte upload limit",
        )

    blob_store = storage.get_storage()
    book_id = db.next_book_id(conn)
    key = f"books/{book_id}/{safe_name}"
    try:
        upload_url = blob_store.presigned_upload_url(
            key, "application/pdf", expires=3600
        )
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        logger.exception("Could not create direct upload URL for %s", key)
        raise HTTPException(status_code=424, detail=f"could not prepare R2 upload: {exc}")
    if not upload_url:
        conn.rollback()
        # The frontend uses the existing multipart API in local development.
        raise HTTPException(status_code=409, detail="direct upload is not configured")

    stem = os.path.splitext(safe_name)[0]
    title_ar = body.get("title_ar")
    title_en = body.get("title_en")
    author = body.get("author")
    notes = body.get("notes")
    db.insert_book(
        conn,
        book_id=book_id,
        title_ar=str(title_ar or stem),
        title_en=str(title_en) if title_en else None,
        author=str(author) if author else None,
        status="uploading",
        source_pdf=key,
        owner_id=user["id"],
    )
    if notes and str(notes).strip():
        db.set_book_notes(conn, book_id, str(notes).strip())
    write_event(
        conn,
        actor=user["id"],
        type="book.upload.initiated",
        payload={"id": book_id, "file": safe_name, "size": size},
    )
    conn.commit()
    return {
        "id": book_id,
        "upload_url": upload_url,
        "content_type": "application/pdf",
        "expires_in": 3600,
    }


@app.post("/api/books/{book_id}/upload-complete")
async def complete_direct_book_upload(
    book_id: str,
    request: Request,
    user=Depends(require_creator),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Verify a direct upload exists in R2 before enabling ingestion."""
    book = _require_book_access(conn, db.get_book(conn, book_id), user, write=True)
    if book["status"] == "uploaded":
        return {"id": book_id, "duplicate": False}
    if book["status"] != "uploading":
        raise HTTPException(status_code=409, detail="book is not awaiting an upload")
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}

    key = book.get("source_pdf") or ""
    try:
        info = storage.get_storage().object_info(key)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Could not verify direct upload for book %s", book_id)
        raise HTTPException(status_code=424, detail=f"could not verify R2 upload: {exc}")
    if not info:
        raise HTTPException(status_code=424, detail="the uploaded PDF was not found in R2")

    actual_size = int(info.get("ContentLength") or 0)
    try:
        expected_size = int(body.get("size"))
    except (TypeError, ValueError):
        expected_size = 0
    if actual_size <= 0:
        raise HTTPException(status_code=409, detail="R2 contains an empty PDF")
    if expected_size > 0 and actual_size != expected_size:
        raise HTTPException(
            status_code=409,
            detail=f"R2 stored {actual_size} bytes; expected {expected_size}",
        )

    identity = _object_fingerprint(info)
    if not identity:
        raise HTTPException(status_code=424, detail="R2 did not return an object ETag")
    fingerprint, _ = identity
    existing = db.find_book_by_source_fingerprint(conn, user["id"], fingerprint)
    if existing and existing["id"] != book_id:
        # The new key is unique to this attempted upload, so removing it cannot
        # affect the existing book. Delete storage first; only then remove the
        # temporary DB row so a transient R2 failure remains recoverable.
        try:
            storage.get_storage().delete(key)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Could not remove duplicate upload for book %s", book_id)
            raise HTTPException(status_code=424, detail=f"could not clean up duplicate R2 object: {exc}")
        conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
        write_event(
            conn,
            actor=user["id"],
            type="book.upload.duplicate",
            payload={"discarded_id": book_id, "existing_id": existing["id"], "size": actual_size},
        )
        conn.commit()
        return {"id": existing["id"], "duplicate": True}

    db.set_book_source_identity(conn, book_id, fingerprint, actual_size)
    db.set_book_status(conn, book_id, "uploaded")
    write_event(
        conn,
        actor=user["id"],
        type="book.upload",
        payload={"id": book_id, "file": os.path.basename(key), "size": actual_size},
    )
    conn.commit()
    return {"id": book_id, "duplicate": False}


@app.post("/api/books/import")
async def import_books(request: Request, user=Depends(require_creator), conn: sqlite3.Connection = Depends(get_conn)):
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
            owner_id=user["id"],
        )
        write_event(
            conn, actor=user["id"], type="book.import",
            payload={"id": book_id, "title_ar": entry.title_ar},
        )
        conn.commit()
        created.append({"id": book_id})
    return created


@app.post("/api/books/{book_id}/ingest")
async def ingest_book(
    book_id: str, request: Request, user=Depends(require_user),
    conn: sqlite3.Connection = Depends(get_conn)
):
    """Enqueue the OCR->translate->QA pipeline (one-at-a-time worker).

    Optional JSON body bounds the run:
        {"from_page": 1, "to_page": 50, "max_pages": 20}
    Omit all three to process the next window (resume) with the default cap.
    """
    _require_book_access(conn, db.get_book(conn, book_id), user, write=True)
    _enforce_spend_quota(conn, user)  # ingestion spends model tokens

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
        conn, actor=user["id"], type="ingest.enqueue",
        payload={"book_id": book_id, "options": options},
    )
    conn.commit()
    state = ingest.enqueue(book_id, options, actor_id=user["id"])
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
def book_status(book_id: str, user=Depends(current_user),
                conn: sqlite3.Connection = Depends(get_conn)):
    """Ingestion/translation progress for the Library view."""
    book = _require_book_access(conn, db.get_book(conn, book_id), user, write=False)
    return _status_payload(conn, book)


@app.post("/api/chat")
async def chat_endpoint(request: Request, user=Depends(require_creator),
                        conn: sqlite3.Connection = Depends(get_conn)):
    """In-app assistant (writes notes/glossary) — creators/admins only. A global
    glossary tool call has no book_id to authorize against, so a reader must be
    blocked at the door rather than at the per-book authorize() callback."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    messages = body.get("messages") or []
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="messages[] required")
    book_id = body.get("book_id")
    # The assistant can edit a book (set notes, add glossary), so require write
    # access to any book it is scoped to.
    if book_id:
        _require_book_access(conn, db.get_book(conn, book_id), user, write=True)
    _enforce_spend_quota(conn, user)  # the assistant calls the model (spends)

    # Authorize EVERY book the assistant's tools try to touch (a tool call can
    # carry an arbitrary book_id), not just the top-level one.
    def authorize(bid: str, write: bool = True) -> bool:
        try:
            _require_book_access(conn, db.get_book(conn, bid), user, write=write)
            return True
        except HTTPException:
            return False

    try:
        result = chat_mod.chat(conn, messages, book_id, authorize=authorize)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"assistant error: {exc}")

    # Ledger the assistant's real spend against the caller so chat counts toward
    # personal + global caps. Kept off the client wire contract ({reply, actions}).
    usage = result.pop("usage", None)
    if usage and (usage.get("cost_usd") is not None
                  or usage.get("prompt_tokens") or usage.get("completion_tokens")):
        db.record_usage(conn, user_id=user["id"], book_id=book_id, stage="chat",
                        prompt_tokens=usage.get("prompt_tokens", 0),
                        completion_tokens=usage.get("completion_tokens", 0),
                        cost_usd=usage.get("cost_usd"))
        # Chat is a deliberate exception to per-call attribution: chat.py
        # accumulates every tool-loop call into one usage dict, so this is one row
        # per chat turn (aggregated across tool rounds), not per provider call.
        # Accepted because model attribution is still exact (every round uses
        # CHAT_MODEL) and per-turn spend is the useful unit here. True per-call
        # rows would require threading record_usage_event into chat.py's loop.
        db.record_usage_event(conn, user_id=user["id"], book_id=book_id, stage="chat",
                              model=chat_mod.CHAT_MODEL, operation="chat",
                              prompt_tokens=usage.get("prompt_tokens", 0),
                              completion_tokens=usage.get("completion_tokens", 0),
                              cost_usd=usage.get("cost_usd"))
        conn.commit()
    return result


@app.patch("/api/books/{book_id}")
async def update_book(
    book_id: str, request: Request, user=Depends(require_user),
    conn: sqlite3.Connection = Depends(get_conn)
):
    """Update editable book fields: translation_notes and publish/unpublish."""
    _require_book_access(conn, db.get_book(conn, book_id), user, write=True)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    if "translation_notes" in body:
        db.set_book_notes(conn, book_id, (body.get("translation_notes") or "").strip() or None)
        write_event(conn, actor=user["id"], type="book.notes", payload={"book_id": book_id})
    # Publish / unpublish makes a book publicly readable (future reader library).
    if "status" in body and body["status"] in ("published", "in_review"):
        db.set_book_status(conn, book_id, body["status"])
        write_event(conn, actor=user["id"], type="book.publish",
                    payload={"book_id": book_id, "status": body["status"]})
    conn.commit()
    return db.get_book(conn, book_id)


@app.get("/api/books/{book_id}/activity")
def book_activity(book_id: str, user=Depends(current_user),
                  conn: sqlite3.Connection = Depends(get_conn)):
    """Recent ingest activity for a book — a live feed the UI can show so the
    reviewer always sees what happened (page done, page failed, start, finish)."""
    _require_book_access(conn, db.get_book(conn, book_id), user, write=False)
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
def list_pages(book_id: str, user=Depends(current_user),
               conn: sqlite3.Connection = Depends(get_conn)):
    """The page numbers that are ready to review (completed OCR+translate).

    Ingestion can cover a non-contiguous range (e.g. pages 1–2 then 100), so the
    review UI must navigate the pages that actually exist rather than 1..N.
    """
    _require_book_access(conn, db.get_book(conn, book_id), user, write=False)
    return {"pages": sorted(db.completed_page_numbers(conn, book_id))}


@app.get("/api/books/{book_id}/pages/{n}")
def get_page(book_id: str, n: int, user=Depends(current_user),
             conn: sqlite3.Connection = Depends(get_conn)):
    _require_book_access(conn, db.get_book(conn, book_id), user, write=False)
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
def get_segment(seg_id: str, user=Depends(current_user),
                conn: sqlite3.Connection = Depends(get_conn)):
    seg = db.get_segment(conn, seg_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="segment not found")
    # Scope to the segment's BOOK (ids like B-02:001:00 are guessable, so
    # require_user alone would let any creator read another's segment — IDOR).
    _require_book_access(conn, db.get_book(conn, seg["book_id"]), user, write=False)
    return segment_to_wire(seg)


@app.patch("/api/segments/{seg_id}")
def save_segment_draft(
    seg_id: str,
    body: DraftRequest,
    user=Depends(require_user),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Durably save the editor's current text without teaching from a partial draft.

    Editing an approved segment moves it back to ``draft`` so published/approved
    state can never silently disagree with the newly edited text.
    """
    seg = db.get_segment(conn, seg_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="segment not found")
    _require_book_access(conn, db.get_book(conn, seg["book_id"]), user, write=True)
    db.update_segment(conn, seg_id, en_current=body.en_edited, status="draft")
    write_event(
        conn,
        actor=user["id"],
        type="segment.draft_saved",
        payload={"segment_id": seg_id, "changed": body.en_edited != (seg.get("en_current") or "")},
    )
    conn.commit()
    return segment_to_wire(db.get_segment(conn, seg_id))


@app.post("/api/segments/{seg_id}/review", response_model=ReviewResponse)
def review_segment(
    seg_id: str,
    body: ReviewRequest,
    user=Depends(require_user),
    conn: sqlite3.Connection = Depends(get_conn),
):
    seg = db.get_segment(conn, seg_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="segment not found")
    # Only the owner (or admin) of the segment's book may review/approve it.
    _require_book_access(conn, db.get_book(conn, seg["book_id"]), user, write=True)

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
        # Commit the approval FIRST so it is durable independent of the TM step.
        # (On Postgres a failed statement aborts the whole transaction, so the
        # TM-upsert must be isolated — otherwise its failure would also roll back
        # the approval and break every subsequent write in this request.)
        db.update_segment(conn, seg_id, en_current=en_after, status="approved")
        new_status = "approved"
        conn.commit()
        try:
            _tm_id, created = db.upsert_tm(
                conn,
                book_id=seg["book_id"],
                ar=seg["ar"],
                en_approved=en_after,
            )
            tm_added = 1 if created else 0
            applied_to = db.segments_matching_ar(conn, seg["ar"], exclude_id=seg_id)
            conn.commit()
        except Exception as exc:  # noqa: BLE001 — TM is secondary to the approval
            # Clear any aborted-transaction state (Postgres) BEFORE logging.
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
            try:
                write_event(
                    conn, actor=body.reviewer or "reviewer", type="tm.error",
                    payload={"segment_id": seg_id, "error": str(exc)},
                )
                conn.commit()
            except Exception:  # noqa: BLE001
                pass
    elif body.action == "reject":
        # Keep the reviewer's text but send it back for another pass.
        db.update_segment(conn, seg_id, en_current=en_after, status="needs_review")
        new_status = "needs_review"
        conn.commit()
    else:
        # Skip means "not deciding yet", not "discard my typing". Preserve the
        # current edit and status, then let the UI move to the next segment.
        db.update_segment(conn, seg_id, en_current=en_after)
        conn.commit()

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


@app.post("/api/segments/{seg_id}/llm-review", response_model=LLMReviewResponse)
def llm_review_segment(
    seg_id: str,
    body: LLMReviewRequest,
    user=Depends(require_creator),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Get frontier-model feedback without overwriting the editor's text."""
    seg = db.get_segment(conn, seg_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="segment not found")
    # Authorize BEFORE branching on segment content, so an unauthorized caller
    # can't distinguish sacred (422) from non-sacred (403) segments in another
    # book by probing predictable IDs.
    book = _require_book_access(conn, db.get_book(conn, seg["book_id"]), user, write=True)
    # Sacred text is never machine-reviewed: an LLM suggestion for Qurʾān/Hadith
    # is exactly the fabrication the canonical store exists to prevent. This is
    # the real enforcement boundary — the UI also hides the control, but a client
    # must not be able to obtain a machine rendering of sacred wording here.
    if seg["kind"] == "sacred":
        raise HTTPException(
            status_code=422,
            detail="LLM review is unavailable for sacred passages — enter verified canonical wording.",
        )
    _enforce_spend_quota(conn, user)
    # Only send glossary entries that actually occur in this source. This keeps
    # review focused and prevents termbase growth from bloating every prompt.
    from pipeline.translate import arabic as tr_arabic

    rows = conn.execute(
        "SELECT term_ar, term_en, note FROM termbase WHERE scope='global' OR book_id=?",
        (seg["book_id"],),
    ).fetchall()
    glossary = [
        {"term_ar": r["term_ar"], "term_en": r["term_en"], "note": r["note"]}
        for r in rows
        if tr_arabic.contains(seg["ar"], r["term_ar"])
    ]
    try:
        result = llm_review_mod.review_translation(
            ar=seg["ar"],
            en=body.en_edited,
            kind=seg["kind"],
            instructions=book.get("translation_notes"),
            glossary=glossary,
            style_rules=db.style_rules_for(conn, seg["book_id"]),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"LLM review failed: {exc}")
    usage = result.pop("usage", {})
    suggestion = result.get("suggestion") or ""
    missing = _missing_anchors(seg["ar"], suggestion) if suggestion else []
    if missing:
        # Never offer a structurally unsafe suggestion for one-click apply.
        # Approval also validates anchors, but blocking it here prevents a
        # reviewer from accidentally saving a broken intermediate draft.
        result["suggestion"] = ""
        issues = list(result.get("issues") or [])
        issues.append(
            "Suggestion withheld because it dropped footnote anchor(s): "
            + ", ".join(missing)
        )
        result["issues"] = issues
    db.record_usage(
        conn,
        user_id=user["id"],
        book_id=seg["book_id"],
        stage="llm_review",
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        cost_usd=usage.get("cost_usd"),
    )
    db.record_usage_event(
        conn,
        user_id=user["id"],
        book_id=seg["book_id"],
        stage="llm_review",
        model=result["model"],
        operation="review",
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        cost_usd=usage.get("cost_usd"),
    )
    write_event(
        conn,
        actor=user["id"],
        type="segment.llm_review",
        payload={"segment_id": seg_id, "model": result["model"]},
    )
    conn.commit()
    return result


# ---------------------------------------------------------------------------
# Termbase / style rules
# ---------------------------------------------------------------------------
@app.post("/api/termbase")
def add_term(body: TermbaseRequest, user=Depends(require_creator), conn: sqlite3.Connection = Depends(get_conn)):
    if body.scope == "book" and not body.book_id:
        raise HTTPException(status_code=400, detail="book_id required for scope=book")
    if body.book_id:  # a book-scoped term must be authorized against that book
        _require_book_access(conn, db.get_book(conn, body.book_id), user, write=True)
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
    user=Depends(require_creator),
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
        if row_book:  # authorize any book-scoped row against that book
            _require_book_access(conn, db.get_book(conn, row_book), user, write=True)
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
    body: StyleRuleRequest, user=Depends(require_creator),
    conn: sqlite3.Connection = Depends(get_conn)
):
    if body.scope == "book" and not body.book_id:
        raise HTTPException(status_code=400, detail="book_id required for scope=book")
    if body.book_id:  # a book-scoped rule must be authorized against that book
        _require_book_access(conn, db.get_book(conn, body.book_id), user, write=True)
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
def learning_summary(_user=Depends(require_user), conn: sqlite3.Connection = Depends(get_conn)):
    return _learning_summary(conn)


# ---------------------------------------------------------------------------
# Usage / spend quotas (Phase 3)
# ---------------------------------------------------------------------------
@app.get("/api/usage/me")
def usage_me(user=Depends(require_user), conn: sqlite3.Connection = Depends(get_conn)):
    """This month's spend for the signed-in user, against their effective cap."""
    is_admin = user.get("role") == "admin"
    cap = user.get("monthly_usd_limit")
    if cap is None:
        cap = db.resolved_user_default_cap(conn)
    spent = db.user_spend_this_month(conn, user["id"])
    # Admins aren't personally capped (only the global cap applies), so report
    # that honestly rather than showing a limit that isn't enforced.
    return {
        "month": db.current_month_label(),
        "spent_usd": round(spent, 4),
        "limit_usd": None if is_admin else cap,
        "remaining_usd": None if (is_admin or cap is None) else round(max(0.0, cap - spent), 4),
        "enforced": not is_admin,
    }


@app.get("/api/usage")
def usage_overview(_admin=Depends(require_admin), conn: sqlite3.Connection = Depends(get_conn)):
    """Admin: this month's global spend vs the cap, plus a per-user breakdown."""
    gcap = db.resolved_global_cap(conn)
    gspent = db.global_spend_this_month(conn)
    return {
        "month": db.current_month_label(),
        "global_spent_usd": round(gspent, 4),
        "global_limit_usd": gcap,
        "global_remaining_usd": None if gcap is None else round(max(0.0, gcap - gspent), 4),
        "user_limit_default_usd": db.resolved_user_default_cap(conn),
        "by_user": db.spend_by_user_this_month(conn),
        # Per-call attribution: which model / pass actually spent this month.
        **db.usage_events_breakdown(conn),
    }


# ---------------------------------------------------------------------------
# Admin-editable settings (spend caps + per-run page limit)
# ---------------------------------------------------------------------------
def _settings_payload(conn) -> dict:
    """Effective config now, plus the env defaults for reference in the UI."""
    return {
        "global_monthly_usd": db.resolved_global_cap(conn),
        "user_monthly_usd_default": db.resolved_user_default_cap(conn),
        "max_pages_per_run": db.resolved_max_pages_per_run(conn, ingest.DEFAULT_MAX_PAGES_PER_RUN),
        "defaults": {
            "global_monthly_usd": config.global_monthly_usd(),
            "user_monthly_usd_default": config.user_monthly_usd_default(),
            "max_pages_per_run": ingest.DEFAULT_MAX_PAGES_PER_RUN,
        },
    }


def _parse_cap(value) -> tuple[bool, str | None]:
    """Normalize an incoming USD-cap value → (clear_override, stored_value).

    null → clear the override (fall back to env). "", "off", "none",
    "unlimited" → disabled (no cap). A number → that cap. Raises on garbage."""
    if value is None:
        return True, None
    if isinstance(value, str) and value.strip().lower() in ("", "off", "none", "unlimited"):
        return False, ""  # stored empty = no cap
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="cap must be a number, null, or 'off'")
    if not math.isfinite(n) or n < 0:
        raise HTTPException(status_code=400, detail="cap must be a finite, non-negative number")
    return False, str(n)


@app.get("/api/settings")
def get_settings(_admin=Depends(require_admin), conn: sqlite3.Connection = Depends(get_conn)):
    return _settings_payload(conn)


@app.put("/api/settings")
async def update_settings(request: Request, admin=Depends(require_admin),
                          conn: sqlite3.Connection = Depends(get_conn)):
    """Admin: change spend caps / per-run page limit at runtime. Any subset of
    {global_monthly_usd, user_monthly_usd_default, max_pages_per_run}."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="expected a JSON object")

    for key in ("global_monthly_usd", "user_monthly_usd_default"):
        if key in body:
            clear, stored = _parse_cap(body[key])
            db.set_setting(conn, key, None if clear else stored)
    if "max_pages_per_run" in body:
        v = body["max_pages_per_run"]
        if v is None:
            db.set_setting(conn, "max_pages_per_run", None)
        else:
            # Reject booleans and non-integral floats (1.9, NaN) — only a real
            # integer (or an integer-valued string) is a valid page count.
            if isinstance(v, bool):
                raise HTTPException(status_code=400, detail="max_pages_per_run must be an integer")
            if isinstance(v, float) and (not math.isfinite(v) or not v.is_integer()):
                raise HTTPException(status_code=400, detail="max_pages_per_run must be an integer")
            try:
                n = int(v)
            except (TypeError, ValueError, OverflowError):
                raise HTTPException(status_code=400, detail="max_pages_per_run must be an integer")
            if n < 1:
                raise HTTPException(status_code=400, detail="max_pages_per_run must be >= 1")
            db.set_setting(conn, "max_pages_per_run", str(n))

    write_event(conn, actor=admin["id"], type="settings.update", payload={"keys": list(body.keys())})
    conn.commit()
    return _settings_payload(conn)


# ---------------------------------------------------------------------------
# Admin user management (list + edit role / spend limit)
# ---------------------------------------------------------------------------
@app.get("/api/auth/users")
def list_users(_admin=Depends(require_admin), conn: sqlite3.Connection = Depends(get_conn)):
    spend = {r["user_id"]: r["cost_usd"] for r in db.spend_by_user_this_month(conn)}
    out = []
    for u in db.list_users(conn):
        w = _user_wire(u)
        w["monthly_usd_limit"] = u.get("monthly_usd_limit")
        w["spent_usd"] = round(float(spend.get(u["id"], 0.0)), 4)
        out.append(w)
    return out


@app.patch("/api/auth/users/{user_id}")
async def update_user_account(user_id: str, request: Request, admin=Depends(require_admin),
                              conn: sqlite3.Connection = Depends(get_conn)):
    """Admin: set a user's per-user monthly cap and/or role."""
    target = db.get_user(conn, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="user not found")
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")

    if "monthly_usd_limit" in body:
        v = body["monthly_usd_limit"]
        if v is None:
            db.set_user_monthly_limit(conn, user_id, None)  # null = use the default
        else:
            try:
                n = float(v)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="monthly_usd_limit must be a number or null")
            if not math.isfinite(n) or n < 0:
                raise HTTPException(status_code=400, detail="monthly_usd_limit must be finite and non-negative")
            db.set_user_monthly_limit(conn, user_id, n)
    if "role" in body:
        if body["role"] not in ("admin", "creator", "reader"):
            raise HTTPException(status_code=400, detail="role must be admin, creator, or reader")
        if target.get("role") == "admin" and body["role"] != "admin":
            admins = [u for u in db.list_users(conn) if u.get("role") == "admin"]
            if len(admins) <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="create another admin before changing the only admin's role",
                )
        db.set_user_role(conn, user_id, body["role"])

    write_event(conn, actor=admin["id"], type="user.update",
                payload={"id": user_id, "keys": list(body.keys())})
    conn.commit()
    u = db.get_user(conn, user_id)
    w = _user_wire(u)
    w["monthly_usd_limit"] = u.get("monthly_usd_limit")
    return w


@app.get("/api/health")
def health():
    return {"status": "ok"}

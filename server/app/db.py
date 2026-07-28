"""Thin data-access layer over sqlite3 (no ORM).

Provides connection management, schema init, and small query helpers used by the
API and seed script. Every mutation goes through here and is paired with an
append-only event via :mod:`app.events`.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
from typing import Any, Iterable

from . import config
from .embedder import get_embedder, pack_vector

# --- Arabic diacritics (tashkeel / tatweel) for normalization ---------------
_TASHKEEL_RE = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_WS_RE = re.compile(r"\s+")


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------
def connect(path: str | None = None) -> sqlite3.Connection:
    """Open a connection with sane defaults (Row factory, FK enforcement)."""
    # check_same_thread=False: FastAPI may run a sync dependency and an async
    # endpoint body on different threads within the SAME request. Each request
    # still gets its own connection and uses it sequentially (never shared
    # concurrently), so this is safe.
    conn = sqlite3.connect(path or config.db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    # WAL lets many readers run concurrently with one writer. busy_timeout makes
    # a would-be second writer WAIT (up to 5s) for the lock instead of failing
    # with "database is locked" — this is what lets a reviewer approve/edit a
    # done page while the ingest worker is committing a later page.
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db(conn: sqlite3.Connection, schema_file: str | None = None) -> None:
    """Create all tables from the authoritative schema.sql (idempotent)."""
    with open(schema_file or config.schema_path(), "r", encoding="utf-8") as fh:
        conn.executescript(fh.read())
    _migrate(conn)
    conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    """Additive, idempotent column migrations for pre-existing databases.

    ``CREATE TABLE IF NOT EXISTS`` never alters an existing table, so new
    columns added to schema.sql must also be back-filled here for DBs created
    before the column existed. Safe to run on every startup.
    """
    have = {r["name"] for r in conn.execute("PRAGMA table_info(books)").fetchall()}
    if "pages_total" not in have:
        conn.execute("ALTER TABLE books ADD COLUMN pages_total INTEGER NOT NULL DEFAULT 0")
    if "translation_notes" not in have:
        conn.execute("ALTER TABLE books ADD COLUMN translation_notes TEXT")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def normalize_ar(text: str) -> str:
    """Normalize Arabic for hashing: NFC, strip diacritics/tatweel, collapse ws."""
    text = unicodedata.normalize("NFC", text or "")
    text = _TASHKEEL_RE.sub("", text)
    text = _WS_RE.sub(" ", text).strip()
    return text


def ar_hash(text: str) -> str:
    return hashlib.sha256(normalize_ar(text).encode("utf-8")).hexdigest()


def _row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


# ---------------------------------------------------------------------------
# Books / pages
# ---------------------------------------------------------------------------
def list_books(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM books ORDER BY id").fetchall()
    books = []
    for r in rows:
        b = dict(r)
        b["progress"] = book_progress(conn, b["id"])
        books.append(b)
    return books


def next_book_id(conn: sqlite3.Connection) -> str:
    """Allocate the next sequential book id, e.g. B-01, B-02, ..."""
    rows = conn.execute("SELECT id FROM books").fetchall()
    max_n = 0
    for r in rows:
        m = re.fullmatch(r"B-(\d+)", r["id"])
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"B-{max_n + 1:02d}"


def insert_book(
    conn: sqlite3.Connection,
    *,
    book_id: str,
    title_ar: str,
    title_en: str | None,
    author: str | None,
    status: str,
    source_pdf: str | None,
    google_doc_url: str | None = None,
) -> str:
    conn.execute(
        """
        INSERT INTO books (id, title_ar, title_en, author, status, source_pdf,
                           google_doc_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            book_id,
            title_ar,
            title_en,
            author,
            status,
            source_pdf,
            google_doc_url,
            _now(),
        ),
    )
    return book_id


def set_book_status(conn: sqlite3.Connection, book_id: str, status: str) -> None:
    conn.execute(
        "UPDATE books SET status = ?, updated_at = ? WHERE id = ?",
        (status, _now(), book_id),
    )


def claim_book_for_ingest(conn: sqlite3.Connection, book_id: str) -> bool:
    """Atomically claim a book for ingestion.

    Sets status='processing' only if it is not already processing, using a
    single conditional UPDATE. Returns True if this caller won the claim; False
    if the book is already being processed (guards against duplicate /ingest
    calls and two processors running the same book concurrently).
    """
    cur = conn.execute(
        "UPDATE books SET status = 'processing', updated_at = ? "
        "WHERE id = ? AND status != 'processing'",
        (_now(), book_id),
    )
    return cur.rowcount == 1


def page_count(conn: sqlite3.Connection, book_id: str) -> int:
    return int(
        conn.execute(
            "SELECT COUNT(*) AS c FROM pages WHERE book_id = ?", (book_id,)
        ).fetchone()["c"]
    )


def completed_page_numbers(conn: sqlite3.Connection, book_id: str) -> set[int]:
    """Page numbers already fully processed (OCR'd + translated => 'in_review').

    Used to resume ingestion: these pages are skipped on a subsequent run.
    """
    rows = conn.execute(
        "SELECT page_no FROM pages WHERE book_id = ? AND status = 'in_review'",
        (book_id,),
    ).fetchall()
    return {int(r["page_no"]) for r in rows}


def pages_done(conn: sqlite3.Connection, book_id: str) -> int:
    return len(completed_page_numbers(conn, book_id))


def reset_stale_processing(conn: sqlite3.Connection) -> list[str]:
    """Un-wedge books left in 'processing' by a killed/restarted worker.

    A book is only ever 'processing' while a worker holds it. On a fresh process
    (server restart, crash, or --reload) no worker is running, so any surviving
    'processing' row is stale and would block ``claim_book_for_ingest`` forever.
    Reset each to a resumable state: 'in_review' if it has completed pages, else
    'uploaded'. Returns the affected book ids.
    """
    rows = conn.execute("SELECT id FROM books WHERE status = 'processing'").fetchall()
    ids = [r["id"] for r in rows]
    for bid in ids:
        conn.execute(
            "UPDATE books SET status = ?, updated_at = ? WHERE id = ?",
            ("in_review" if pages_done(conn, bid) > 0 else "uploaded", _now(), bid),
        )
    if ids:
        conn.commit()
    return ids


def set_book_pages_total(conn: sqlite3.Connection, book_id: str, total: int) -> None:
    conn.execute(
        "UPDATE books SET pages_total = ?, updated_at = ? WHERE id = ?",
        (int(total), _now(), book_id),
    )


def set_book_notes(conn: sqlite3.Connection, book_id: str, notes: str | None) -> None:
    conn.execute(
        "UPDATE books SET translation_notes = ?, updated_at = ? WHERE id = ?",
        (notes, _now(), book_id),
    )


def get_book(conn: sqlite3.Connection, book_id: str) -> dict | None:
    b = _row_to_dict(
        conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    )
    if b is not None:
        b["progress"] = book_progress(conn, book_id)
    return b


def book_progress(conn: sqlite3.Connection, book_id: str) -> dict:
    row = conn.execute(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft
        FROM segments WHERE book_id = ?
        """,
        (book_id,),
    ).fetchone()
    total = row["total"] or 0
    approved = row["approved"] or 0
    return {
        "total_segments": total,
        "approved": approved,
        "needs_review": row["needs_review"] or 0,
        "draft": row["draft"] or 0,
        "fraction": (approved / total) if total else 0.0,
    }


def get_page(conn: sqlite3.Connection, book_id: str, page_no: int) -> dict | None:
    return _row_to_dict(
        conn.execute(
            "SELECT * FROM pages WHERE book_id = ? AND page_no = ?",
            (book_id, page_no),
        ).fetchone()
    )


# ---------------------------------------------------------------------------
# Segments
# ---------------------------------------------------------------------------
def get_segment(conn: sqlite3.Connection, seg_id: str) -> dict | None:
    return _row_to_dict(
        conn.execute("SELECT * FROM segments WHERE id = ?", (seg_id,)).fetchone()
    )


def get_page_segments(
    conn: sqlite3.Connection, book_id: str, page_no: int
) -> list[dict]:
    rows = conn.execute(
        """
        SELECT * FROM segments
        WHERE book_id = ? AND page_no = ?
        ORDER BY seg_order
        """,
        (book_id, page_no),
    ).fetchall()
    return [dict(r) for r in rows]


def update_segment(
    conn: sqlite3.Connection, seg_id: str, **fields: Any
) -> None:
    if not fields:
        return
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(
        f"UPDATE segments SET {cols} WHERE id = ?",
        (*fields.values(), seg_id),
    )


# ---------------------------------------------------------------------------
# Corrections (training signal)
# ---------------------------------------------------------------------------
def insert_correction(
    conn: sqlite3.Connection,
    *,
    segment_id: str,
    en_before: str | None,
    en_after: str | None,
    diff: dict,
    mqm_tags: list | None,
    dims: dict | None,
    reviewer: str | None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO corrections
            (segment_id, en_before, en_after, diff_json, mqm_tags_json,
             dims_json, reviewer)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            segment_id,
            en_before,
            en_after,
            json.dumps(diff, ensure_ascii=False),
            json.dumps(mqm_tags or [], ensure_ascii=False),
            json.dumps(dims or {}, ensure_ascii=False),
            reviewer,
        ),
    )
    return int(cur.lastrowid)


# ---------------------------------------------------------------------------
# Translation memory
# ---------------------------------------------------------------------------
def upsert_tm(
    conn: sqlite3.Connection,
    *,
    book_id: str | None,
    ar: str,
    en_approved: str,
) -> tuple[int, bool]:
    """Insert or update the (book, ar)->en approved pair. Returns (id, created).

    Conflict-tolerant: if a concurrent approve of the same Arabic wins the race
    and the unique index rejects our INSERT, we fall back to an UPDATE instead
    of raising. This guarantees a TM contention can never bubble up and roll
    back the already-committed correction (the training signal).
    """
    h = ar_hash(ar)
    embedding = pack_vector(get_embedder().embed(ar))

    def _find():
        return conn.execute(
            "SELECT id FROM translation_memory WHERE book_id IS ? AND ar_hash = ?",
            (book_id, h),
        ).fetchone()

    existing = _find()
    if existing is not None:
        conn.execute(
            """
            UPDATE translation_memory
            SET ar = ?, en_approved = ?, embedding = ?
            WHERE id = ?
            """,
            (ar, en_approved, embedding, existing["id"]),
        )
        return int(existing["id"]), False
    try:
        cur = conn.execute(
            """
            INSERT INTO translation_memory (book_id, ar_hash, ar, en_approved, embedding)
            VALUES (?, ?, ?, ?, ?)
            """,
            (book_id, h, ar, en_approved, embedding),
        )
        return int(cur.lastrowid), True
    except sqlite3.IntegrityError:
        # Lost the race: a row now exists — update it rather than fail.
        row = _find()
        if row is None:
            raise
        conn.execute(
            "UPDATE translation_memory SET ar = ?, en_approved = ?, embedding = ? WHERE id = ?",
            (ar, en_approved, embedding, row["id"]),
        )
        return int(row["id"]), False


def tm_size(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) AS c FROM translation_memory").fetchone()["c"])


def tm_lookup(conn: sqlite3.Connection, ar: str, book_id: str | None = None,
              top_k: int = 3) -> list[dict]:
    """Approved translation-memory matches for a piece of Arabic.

    Returns exact matches (same normalized Arabic) as ``{ar, en_approved, score}``
    with score 1.0, book-scoped entries preferred over global. This is what lets
    an approved translation be REUSED for identical Arabic on future runs — the
    core of the human-in-the-loop learning feeding back into new translations.
    """
    if not (ar or "").strip():
        return []
    h = ar_hash(ar)
    rows = conn.execute(
        "SELECT ar, en_approved FROM translation_memory WHERE ar_hash = ? "
        "ORDER BY (book_id IS NOT NULL AND book_id = ?) DESC LIMIT ?",
        (h, book_id, top_k),
    ).fetchall()
    return [{"ar": r["ar"], "en_approved": r["en_approved"], "score": 1.0} for r in rows]


def style_rules_for(conn: sqlite3.Connection, book_id: str | None = None) -> list[str]:
    """Active style rules for a book: global rules plus this book's own."""
    rows = conn.execute(
        "SELECT rule FROM style_rules WHERE scope = 'global' OR book_id = ? ORDER BY id",
        (book_id,),
    ).fetchall()
    return [r["rule"] for r in rows]


def segments_matching_ar(
    conn: sqlite3.Connection, ar: str, exclude_id: str | None = None
) -> list[str]:
    """Segment ids sharing the same normalized Arabic (where TM could apply)."""
    rows = conn.execute("SELECT id, ar FROM segments").fetchall()
    h = ar_hash(ar)
    out = []
    for r in rows:
        if r["id"] == exclude_id:
            continue
        if ar_hash(r["ar"]) == h:
            out.append(r["id"])
    return out


# ---------------------------------------------------------------------------
# Termbase / style rules
# ---------------------------------------------------------------------------
def insert_term(
    conn: sqlite3.Connection,
    *,
    term_ar: str,
    term_en: str,
    note: str | None,
    scope: str,
    book_id: str | None,
    created_by: str | None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO termbase (term_ar, term_en, note, scope, book_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (term_ar, term_en, note, scope, book_id, created_by),
    )
    return int(cur.lastrowid)


def insert_style_rule(
    conn: sqlite3.Connection,
    *,
    rule: str,
    scope: str,
    book_id: str | None,
) -> int:
    cur = conn.execute(
        "INSERT INTO style_rules (rule, scope, book_id) VALUES (?, ?, ?)",
        (rule, scope, book_id),
    )
    return int(cur.lastrowid)


def count(conn: sqlite3.Connection, table: str) -> int:
    # `table` is never user-supplied; callers pass literals.
    return int(conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"])


def auto_approval_rate(conn: sqlite3.Connection) -> float:
    """Fraction of approved segments that were never touched by a human review.

    Precise definition: a segment is *auto-approved* only if it reached status
    'approved' with NO correction row at all. Any review action records a
    correction, so a human approval — even of unchanged text — counts as a human
    review, not an auto-approval.
    """
    total_approved = int(
        conn.execute(
            "SELECT COUNT(*) AS c FROM segments WHERE status = 'approved'"
        ).fetchone()["c"]
    )
    if total_approved == 0:
        return 0.0
    human_reviewed = int(
        conn.execute(
            """
            SELECT COUNT(DISTINCT c.segment_id) AS c
            FROM corrections c
            JOIN segments s ON s.id = c.segment_id
            WHERE s.status = 'approved'
            """
        ).fetchone()["c"]
    )
    return (total_approved - human_reviewed) / total_approved


# ---------------------------------------------------------------------------
# misc
# ---------------------------------------------------------------------------
def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

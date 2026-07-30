"""Thin data-access layer over sqlite3 (no ORM).

Provides connection management, schema init, and small query helpers used by the
API and seed script. Every mutation goes through here and is paired with an
append-only event via :mod:`app.events`.
"""
from __future__ import annotations

import hashlib
import json
import os
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
# Connection — dual backend: SQLite (local dev + tests) and PostgreSQL (prod).
#
# The whole data layer is raw SQL with ``?`` placeholders and dict-style row
# access (``row["col"]``). Both backends are wrapped by ``Conn`` so the ~30
# query functions below work UNCHANGED against either. Postgres is selected by
# setting DATABASE_URL (postgres://…); otherwise SQLite is used.
# ---------------------------------------------------------------------------
def _database_url() -> str | None:
    url = os.environ.get("DATABASE_URL", "").strip()
    return url or None


class Conn:
    """Backend-agnostic connection wrapper.

    ``execute`` accepts SQLite-style ``?`` placeholders and rewrites them for
    Postgres (``%s``), doubling literal ``%`` so LIKE patterns survive. Rows are
    dict-accessible on both backends (``sqlite3.Row`` / psycopg ``dict_row``).
    """

    def __init__(self, raw, backend: str):
        self._raw = raw
        self.backend = backend  # "sqlite" | "postgres"

    def execute(self, sql: str, params: Iterable = ()):  # type: ignore[type-arg]
        if self.backend == "postgres":
            sql = sql.replace("%", "%%").replace("?", "%s")
        return self._raw.execute(sql, tuple(params) if params else ())

    def executescript(self, script: str) -> None:
        if self.backend == "sqlite":
            self._raw.executescript(script)
            return
        # psycopg: run each ';'-terminated statement (schema_pg.sql has no
        # inline semicolons, so a simple split is safe).
        cur = self._raw.cursor()
        for stmt in _split_sql(script):
            cur.execute(stmt)

    def commit(self) -> None:
        self._raw.commit()

    def rollback(self) -> None:
        self._raw.rollback()

    def close(self) -> None:
        self._raw.close()


def _split_sql(script: str) -> list[str]:
    """Split a SQL script into individual statements (comments stripped)."""
    lines = [ln for ln in script.splitlines() if not ln.strip().startswith("--")]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


def connect(path: str | None = None) -> Conn:
    """Open a connection. Postgres when DATABASE_URL is set, else SQLite."""
    url = _database_url()
    if url:
        import psycopg
        from psycopg.rows import dict_row

        raw = psycopg.connect(url, row_factory=dict_row, autocommit=False)
        return Conn(raw, "postgres")

    # check_same_thread=False: FastAPI may run a sync dependency and an async
    # endpoint body on different threads within the SAME request. Each request
    # still gets its own connection and uses it sequentially, so this is safe.
    raw = sqlite3.connect(path or config.db_path(), check_same_thread=False)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON")
    raw.execute("PRAGMA journal_mode = WAL")
    # busy_timeout makes a second writer WAIT for the lock (up to 5s) instead of
    # failing with "database is locked" — lets review + ingest write concurrently.
    raw.execute("PRAGMA busy_timeout = 5000")
    return Conn(raw, "sqlite")


def init_db(conn: Conn, schema_file: str | None = None) -> None:
    """Create all tables from the backend's schema (idempotent)."""
    if schema_file is None:
        schema_file = config.schema_path_pg() if conn.backend == "postgres" \
            else config.schema_path()
    with open(schema_file, "r", encoding="utf-8") as fh:
        conn.executescript(fh.read())
    _migrate(conn)
    conn.commit()


def _table_columns(conn: Conn, table: str) -> set[str]:
    if conn.backend == "postgres":
        rows = conn.execute(
            "SELECT column_name AS name FROM information_schema.columns "
            "WHERE table_name = ?", (table,)
        ).fetchall()
    else:
        # PRAGMA can't be parameterized; table names here are internal literals.
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()  # noqa: S608
    return {r["name"] for r in rows}


def _book_columns(conn: Conn) -> set[str]:
    return _table_columns(conn, "books")


def _insert_id(conn: Conn, sql: str, params: Iterable) -> int:
    """Run an INSERT and return the new integer id, on either backend."""
    if conn.backend == "postgres":
        row = conn.execute(sql + " RETURNING id", params).fetchone()
        return int(row["id"])
    return int(conn.execute(sql, params).lastrowid)


def _is_unique_violation(exc: Exception) -> bool:
    """True for a UNIQUE-constraint failure on either backend (SQLite
    IntegrityError / Postgres SQLSTATE 23505). Used so upsert_tm only recovers
    from a lost race and lets every other error propagate."""
    if isinstance(exc, sqlite3.IntegrityError):
        return "unique" in str(exc).lower()
    sqlstate = getattr(exc, "sqlstate", None)
    if sqlstate is None:
        diag = getattr(exc, "diag", None)
        sqlstate = getattr(diag, "sqlstate", None)
    return sqlstate == "23505"


def _migrate(conn: Conn) -> None:
    """Additive, idempotent column migrations for pre-existing databases.

    ``CREATE TABLE IF NOT EXISTS`` never alters an existing table, so columns
    added later must be back-filled here. Safe to run on every startup.
    """
    have = _book_columns(conn)
    if "pages_total" not in have:
        conn.execute("ALTER TABLE books ADD COLUMN pages_total INTEGER NOT NULL DEFAULT 0")
    if "translation_notes" not in have:
        conn.execute("ALTER TABLE books ADD COLUMN translation_notes TEXT")
    if "owner_id" not in have:
        # No inline REFERENCES on ALTER (both backends dislike it); the column is
        # enough — new rows use the schema's FK, legacy rows stay NULL (public/system).
        conn.execute("ALTER TABLE books ADD COLUMN owner_id TEXT")
    if "source_fingerprint" not in have:
        conn.execute("ALTER TABLE books ADD COLUMN source_fingerprint TEXT")
    if "source_size" not in have:
        size_type = "BIGINT" if conn.backend == "postgres" else "INTEGER"
        conn.execute(f"ALTER TABLE books ADD COLUMN source_size {size_type}")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_books_owner_source_fingerprint "
        "ON books (COALESCE(owner_id, ''), source_fingerprint) "
        "WHERE source_fingerprint IS NOT NULL"
    )

    # Atomic id-allocation counters. Created here as well as in the schema files
    # so pre-existing DBs get the table, then seeded to the current MAX id so
    # allocation continues past existing rows (see _seed_id_counter).
    conn.execute(
        "CREATE TABLE IF NOT EXISTS id_counters "
        "(name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)"
    )
    _seed_id_counter(conn, "book")
    _seed_id_counter(conn, "user")

    # Phase 3: per-user monthly spend cap column (NULL = use the env default).
    if "monthly_usd_limit" not in _table_columns(conn, "users"):
        col = "DOUBLE PRECISION" if conn.backend == "postgres" else "REAL"
        conn.execute(f"ALTER TABLE users ADD COLUMN monthly_usd_limit {col}")

    # Admin-editable runtime settings (spend caps, per-run page limit).
    conn.execute("CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT)")


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


# --- atomic id allocation (B-01, U-01, …) ----------------------------------
_ID_SPECS = {"book": ("books", "B"), "user": ("users", "U")}


def _seed_id_counter(conn: Conn, name: str) -> None:
    """Raise id_counters[name] to at least the highest existing numeric id.

    Self-healing and idempotent: run on every startup so a counter created before
    its rows existed (or lagging after a manual insert) is corrected upward and
    allocation never regenerates a live id. Never lowers the counter."""
    table, prefix = _ID_SPECS[name]
    max_n = 0
    for r in conn.execute(f"SELECT id FROM {table}").fetchall():  # noqa: S608 — internal literals
        m = re.fullmatch(rf"{re.escape(prefix)}-(\d+)", str(r["id"]))
        if m:
            max_n = max(max_n, int(m.group(1)))
    # ON CONFLICT … DO UPDATE with a CASE (not MAX/GREATEST, which differ by
    # backend) keeps the higher of the stored and computed values.
    conn.execute(
        "INSERT INTO id_counters (name, value) VALUES (?, ?) "
        "ON CONFLICT (name) DO UPDATE SET value = "
        "CASE WHEN excluded.value > id_counters.value "
        "THEN excluded.value ELSE id_counters.value END",
        (name, max_n),
    )


def _next_seq(conn: Conn, name: str) -> int:
    """Atomically allocate the next value for a named counter.

    The UPDATE takes a write lock held until the caller's transaction commits, so
    two concurrent allocations serialize instead of both reading the same
    MAX(id) — the race the old approach had. If the caller's surrounding INSERT
    rolls back, this increment rolls back with it too, so the number becomes
    reusable rather than skipped — and is never handed out twice. Callers MUST
    allocate and insert in the same transaction."""
    if conn.execute("SELECT 1 FROM id_counters WHERE name = ?", (name,)).fetchone() is None:
        _seed_id_counter(conn, name)
    conn.execute("UPDATE id_counters SET value = value + 1 WHERE name = ?", (name,))
    return int(conn.execute("SELECT value FROM id_counters WHERE name = ?", (name,)).fetchone()["value"])


def next_book_id(conn: sqlite3.Connection) -> str:
    """Atomically allocate the next sequential book id, e.g. B-01, B-02, ..."""
    return f"B-{_next_seq(conn, 'book'):02d}"


def insert_book(
    conn: sqlite3.Connection,
    *,
    book_id: str,
    title_ar: str,
    title_en: str | None,
    author: str | None,
    status: str,
    source_pdf: str | None,
    source_fingerprint: str | None = None,
    source_size: int | None = None,
    google_doc_url: str | None = None,
    owner_id: str | None = None,
) -> str:
    conn.execute(
        """
        INSERT INTO books (id, title_ar, title_en, author, status, source_pdf,
                           source_fingerprint, source_size, google_doc_url,
                           owner_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            book_id,
            title_ar,
            title_en,
            author,
            status,
            source_pdf,
            source_fingerprint,
            source_size,
            google_doc_url,
            owner_id,
            _now(),
        ),
    )
    return book_id


def find_book_by_source_fingerprint(
    conn: sqlite3.Connection, owner_id: str | None, fingerprint: str
) -> dict | None:
    row = conn.execute(
        "SELECT * FROM books WHERE source_fingerprint = ? "
        "AND ((owner_id = ?) OR (owner_id IS NULL AND ? IS NULL)) LIMIT 1",
        (fingerprint, owner_id, owner_id),
    ).fetchone()
    return _row_to_dict(row)


def books_missing_source_fingerprint(conn: sqlite3.Connection) -> list[dict]:
    return [
        dict(row)
        for row in conn.execute(
            "SELECT * FROM books WHERE source_fingerprint IS NULL "
            "AND source_pdf IS NOT NULL ORDER BY id"
        ).fetchall()
    ]


def set_book_source_identity(
    conn: sqlite3.Connection, book_id: str, fingerprint: str, size: int
) -> None:
    conn.execute(
        "UPDATE books SET source_fingerprint = ?, source_size = ?, updated_at = ? "
        "WHERE id = ?",
        (fingerprint, int(size), _now(), book_id),
    )


# ---------------------------------------------------------------------------
# Users (creators/reviewers). Readers browse published books anonymously.
# ---------------------------------------------------------------------------
def next_user_id(conn: sqlite3.Connection) -> str:
    """Atomically allocate the next sequential user id, e.g. U-01, U-02, ..."""
    return f"U-{_next_seq(conn, 'user'):02d}"


def create_user(conn: sqlite3.Connection, *, user_id: str, email: str,
                password_hash: str, display_name: str | None,
                role: str = "creator", bio: str | None = None,
                monthly_usd_limit: float | None = None) -> str:
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role, bio, monthly_usd_limit) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, email.lower().strip(), password_hash, display_name, role, bio,
         monthly_usd_limit),
    )
    return user_id


def get_user(conn: sqlite3.Connection, user_id: str) -> dict | None:
    return _row_to_dict(
        conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    )


def get_user_by_email(conn: sqlite3.Connection, email: str) -> dict | None:
    return _row_to_dict(
        conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower().strip(),)
        ).fetchone()
    )


def count_users(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"])


def list_users(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
    return [_row_to_dict(r) for r in rows]


def set_user_monthly_limit(conn: sqlite3.Connection, user_id: str, limit: float | None) -> None:
    conn.execute("UPDATE users SET monthly_usd_limit = ? WHERE id = ?", (limit, user_id))


def set_user_role(conn: sqlite3.Connection, user_id: str, role: str) -> None:
    conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))


def set_user_password(conn: sqlite3.Connection, user_id: str, password_hash: str) -> None:
    conn.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (password_hash, user_id),
    )


# ---------------------------------------------------------------------------
# Usage ledger / spend quotas (Phase 3)
# ---------------------------------------------------------------------------
def _month_start() -> str:
    """First instant of the current UTC calendar month, in the same ISO format
    as created_at, so a lexicographic ``created_at >= _month_start()`` compare
    selects this month's rows without any date parsing."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}-01T00:00:00.000000Z"


def current_month_label() -> str:
    """The active quota window as ``YYYY-MM`` (UTC)."""
    return _month_start()[:7]


def record_usage(conn: sqlite3.Connection, *, user_id: str | None, book_id: str | None,
                 stage: str, prompt_tokens: int = 0, completion_tokens: int = 0,
                 cost_usd: float | None = None) -> None:
    """Append one spend record. cost_usd is the real per-call USD OpenRouter
    reports (None if it didn't)."""
    conn.execute(
        "INSERT INTO usage_ledger "
        "(user_id, book_id, stage, prompt_tokens, completion_tokens, cost_usd, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, book_id, stage, int(prompt_tokens or 0), int(completion_tokens or 0),
         float(cost_usd) if cost_usd is not None else None, _now()),
    )


def user_spend_this_month(conn: sqlite3.Connection, user_id: str) -> float:
    row = conn.execute(
        "SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_ledger "
        "WHERE user_id = ? AND created_at >= ?",
        (user_id, _month_start()),
    ).fetchone()
    return float(row["s"] or 0.0)


def global_spend_this_month(conn: sqlite3.Connection) -> float:
    row = conn.execute(
        "SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_ledger WHERE created_at >= ?",
        (_month_start(),),
    ).fetchone()
    return float(row["s"] or 0.0)


# --- admin-editable settings (override the env defaults at runtime) ----------
def get_setting(conn: sqlite3.Connection, name: str) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE name = ?", (name,)).fetchone()
    return row["value"] if row else None


def set_setting(conn: sqlite3.Connection, name: str, value: str | None) -> None:
    """Upsert a setting. value=None clears the override (falls back to env)."""
    if value is None:
        conn.execute("DELETE FROM settings WHERE name = ?", (name,))
        return
    conn.execute(
        "INSERT INTO settings (name, value) VALUES (?, ?) "
        "ON CONFLICT (name) DO UPDATE SET value = excluded.value",
        (name, str(value)),
    )


def _resolved_cap(conn: sqlite3.Connection, name: str, env_fallback: float | None) -> float | None:
    """A USD cap: admin setting if present ('' = disabled/None), else env."""
    raw = get_setting(conn, name)
    if raw is None:
        return env_fallback
    raw = raw.strip()
    if raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return env_fallback


def resolved_global_cap(conn: sqlite3.Connection) -> float | None:
    return _resolved_cap(conn, "global_monthly_usd", config.global_monthly_usd())


def resolved_user_default_cap(conn: sqlite3.Connection) -> float | None:
    return _resolved_cap(conn, "user_monthly_usd_default", config.user_monthly_usd_default())


def resolved_max_pages_per_run(conn: sqlite3.Connection, env_default: int) -> int:
    """Per-run page cap (token-budget safety): admin setting if a positive int,
    else the env default."""
    raw = get_setting(conn, "max_pages_per_run")
    if raw is not None:
        try:
            n = int(float(raw.strip()))
            if n >= 1:
                return n
        except (ValueError, AttributeError):
            pass
    return env_default


def over_spend_quota(conn: sqlite3.Connection, *, user_id: str | None, role: str | None,
                     user_limit: float | None) -> str | None:
    """Return a human-readable reason if a paid action should be blocked for this
    payer, else None. The global cap applies to everyone (a backstop on the
    owner's total bill); the per-user cap applies to non-admins. Enforced on
    spend already accrued this month. Shared by the request path (gates before
    enqueue) and the worker (re-checks at run time, so a burst of queued runs
    can't collectively blow past the cap)."""
    gcap = resolved_global_cap(conn)
    if gcap is not None and global_spend_this_month(conn) >= gcap:
        return "global monthly spend cap reached; contact the administrator"
    if role == "admin":
        return None
    cap = user_limit if user_limit is not None else resolved_user_default_cap(conn)
    if cap is not None and user_id is not None and user_spend_this_month(conn, user_id) >= cap:
        return f"monthly usage limit of ${cap:.2f} reached; it resets next month"
    return None


def spend_by_user_this_month(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT user_id, COALESCE(SUM(cost_usd), 0) AS cost_usd, "
        "SUM(prompt_tokens + completion_tokens) AS tokens, COUNT(*) AS calls "
        "FROM usage_ledger WHERE created_at >= ? GROUP BY user_id ORDER BY cost_usd DESC",
        (_month_start(),),
    ).fetchall()
    return [
        {"user_id": r["user_id"], "cost_usd": round(float(r["cost_usd"] or 0.0), 6),
         "tokens": int(r["tokens"] or 0), "calls": int(r["calls"] or 0)}
        for r in rows
    ]


def list_published_books(conn: sqlite3.Connection) -> list[dict]:
    """Books anyone (even anonymous) may read."""
    rows = conn.execute(
        "SELECT * FROM books WHERE status = 'published' ORDER BY id"
    ).fetchall()
    out = []
    for r in rows:
        b = dict(r)
        b["progress"] = book_progress(conn, b["id"])
        out.append(b)
    return out


def list_books_for(conn: sqlite3.Connection, owner_id: str | None,
                   include_unowned: bool = True) -> list[dict]:
    """Books a creator can manage: their own, plus legacy/unowned (NULL owner)
    so pre-auth books remain visible to the team during migration."""
    if include_unowned:
        rows = conn.execute(
            "SELECT * FROM books WHERE owner_id = ? OR owner_id IS NULL ORDER BY id",
            (owner_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM books WHERE owner_id = ? ORDER BY id", (owner_id,)
        ).fetchall()
    out = []
    for r in rows:
        b = dict(r)
        b["progress"] = book_progress(conn, b["id"])
        out.append(b)
    return out


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
    return _insert_id(
        conn,
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

    # NULL-safe lookup (book_id can be NULL for global entries) — written so it
    # works identically on SQLite and Postgres (avoid the SQLite-only `IS ?`).
    if book_id is None:
        existing = conn.execute(
            "SELECT id FROM translation_memory WHERE book_id IS NULL AND ar_hash = ?",
            (h,),
        ).fetchone()
    else:
        existing = conn.execute(
            "SELECT id FROM translation_memory WHERE book_id = ? AND ar_hash = ?",
            (book_id, h),
        ).fetchone()

    if existing is not None:
        conn.execute(
            "UPDATE translation_memory SET ar = ?, en_approved = ?, embedding = ? WHERE id = ?",
            (ar, en_approved, embedding, existing["id"]),
        )
        return int(existing["id"]), False
    try:
        new_id = _insert_id(
            conn,
            "INSERT INTO translation_memory (book_id, ar_hash, ar, en_approved, embedding) "
            "VALUES (?, ?, ?, ?, ?)",
            (book_id, h, ar, en_approved, embedding),
        )
        return new_id, True
    except Exception as exc:  # noqa: BLE001
        # Only recover from a lost race on the unique index; let every other
        # error propagate (so a real failure never gets silently swallowed).
        if not _is_unique_violation(exc):
            raise
        # Clear the aborted-transaction state (Postgres) then update the row the
        # winner inserted. Callers isolate upsert_tm in its own transaction, so a
        # rollback here never discards other committed work.
        conn.rollback()
        if book_id is None:
            row = conn.execute(
                "SELECT id FROM translation_memory WHERE book_id IS NULL AND ar_hash = ?",
                (h,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM translation_memory WHERE book_id = ? AND ar_hash = ?",
                (book_id, h),
            ).fetchone()
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
    return _insert_id(
        conn,
        """
        INSERT INTO termbase (term_ar, term_en, note, scope, book_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (term_ar, term_en, note, scope, book_id, created_by),
    )


def insert_style_rule(
    conn: sqlite3.Connection,
    *,
    rule: str,
    scope: str,
    book_id: str | None,
) -> int:
    return _insert_id(
        conn,
        "INSERT INTO style_rules (rule, scope, book_id) VALUES (?, ?, ?)",
        (rule, scope, book_id),
    )


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

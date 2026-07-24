"""One-at-a-time ingestion worker for the OCR -> translate -> QA pipeline.

The real pipeline (pipeline/ocr, pipeline/translate, pipeline/qa) is owned by
other agents and not present offline. So the heavy work sits behind a single
hook, ``PIPELINE_HOOK``, with a deterministic mock that flips book status
``uploaded -> processing -> in_review`` and lays down a stub page/segment so the
Library and review views have something to render. Real pipeline code is wired
in later by replacing the hook.

A single background daemon thread drains an in-process queue so books ingest one
at a time. When ``config.sync_ingest()`` is true (tests) the job runs inline and
status is final by the time the request returns.
"""
from __future__ import annotations

import queue
import threading
from typing import Callable

from . import config, db
from .events import write_event

# In-memory job state, keyed by book id: queued | processing | done | error.
JOB_STATE: dict[str, str] = {}

_Q: "queue.Queue[str]" = queue.Queue()
_WORKER: threading.Thread | None = None
_LOCK = threading.Lock()


def mock_pipeline(conn, book_id: str) -> None:
    """Deterministic stand-in for OCR->translate->QA.

    Creates one stub page + one mock segment (draft) so ingestion produces
    visible data offline. Replace ``PIPELINE_HOOK`` with the real orchestrator.
    """
    existing = db.page_count(conn, book_id)
    if existing == 0:
        conn.execute(
            """
            INSERT INTO pages (book_id, page_no, image_path, ocr_markdown, status)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                book_id,
                1,
                f"/static/{book_id}/pages/001.png",
                "# Page 1\n\n(mock OCR output)",
                "in_review",
            ),
        )
        conn.execute(
            """
            INSERT INTO segments
                (id, book_id, page_no, seg_order, kind, anchor, ar,
                 en_draft, en_current, engine, confidence, status)
            VALUES (?, ?, ?, ?, 'body', NULL, ?, ?, ?, 'mock', 0.5, 'needs_review')
            """,
            (
                f"{book_id}:001:01",
                book_id,
                1,
                1,
                "نصّ عربيّ تجريبيّ للمعالجة.",
                "Mock translated sentence pending review.",
                "Mock translated sentence pending review.",
            ),
        )


# Swappable hook: (sqlite3.Connection, book_id) -> None
PIPELINE_HOOK: Callable[[object, str], None] = mock_pipeline


def _process(book_id: str) -> None:
    conn = db.connect()
    try:
        db.init_db(conn)

        # Atomic DB-backed claim: only one processor may hold a book at a time
        # (guards against a duplicate /ingest or a second worker double-running).
        claimed = db.claim_book_for_ingest(conn, book_id)
        conn.commit()
        if not claimed:
            JOB_STATE[book_id] = "processing"  # someone else owns it; don't double-run
            return

        JOB_STATE[book_id] = "processing"
        write_event(conn, actor="worker", type="ingest.start", payload={"book_id": book_id})
        conn.commit()

        PIPELINE_HOOK(conn, book_id)

        db.set_book_status(conn, book_id, "in_review")
        write_event(conn, actor="worker", type="ingest.done", payload={"book_id": book_id})
        conn.commit()
        JOB_STATE[book_id] = "done"
    except Exception as exc:  # noqa: BLE001 — record and surface via status
        JOB_STATE[book_id] = "error"
        # Discard any partial pages/segments written by the failed pipeline run;
        # only the error status + event are persisted (never leave 'processing').
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        try:
            db.set_book_status(conn, book_id, "error")
            write_event(
                conn, actor="worker", type="ingest.error",
                payload={"book_id": book_id, "error": str(exc)},
            )
            conn.commit()
        except Exception:  # noqa: BLE001
            pass
    finally:
        conn.close()


def _worker_loop() -> None:
    while True:
        book_id = _Q.get()
        try:
            _process(book_id)
        finally:
            _Q.task_done()


def _ensure_worker() -> None:
    global _WORKER
    with _LOCK:
        if _WORKER is None or not _WORKER.is_alive():
            _WORKER = threading.Thread(target=_worker_loop, daemon=True)
            _WORKER.start()


def enqueue(book_id: str) -> str:
    """Queue a book for ingestion. Returns the job state after enqueue.

    In sync mode the pipeline runs inline (state == 'done'). Otherwise the book
    is queued for the background worker (state == 'queued').
    """
    if config.sync_ingest():
        JOB_STATE[book_id] = "queued"
        _process(book_id)
        return JOB_STATE.get(book_id, "done")
    JOB_STATE[book_id] = "queued"
    _ensure_worker()
    _Q.put(book_id)
    return "queued"


def job_state(book_id: str) -> str | None:
    return JOB_STATE.get(book_id)

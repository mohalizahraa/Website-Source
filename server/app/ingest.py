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

import os
import queue
import sys
import threading
from pathlib import Path
from typing import Callable

from . import config, db
from .events import write_event

# Make the repo-root `pipeline` package importable (server/app/ingest.py → root).
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# In-memory job state, keyed by book id: queued | processing | done | error.
JOB_STATE: dict[str, str] = {}

_Q: "queue.Queue[str]" = queue.Queue()
_WORKER: threading.Thread | None = None
_LOCK = threading.Lock()


# Per-run safety cap: a single ingest click never processes more than this many
# pages (protects your token budget on very large books). Override with
# HAYDARI_MAX_PAGES_PER_RUN. Callers may request a smaller cap; never a larger.
DEFAULT_MAX_PAGES_PER_RUN = int(os.environ.get("HAYDARI_MAX_PAGES_PER_RUN", "20"))

# Options passed with each queued job, keyed by book id (from_page/to_page/max_pages).
JOB_OPTS: dict[str, dict] = {}

# The user who triggered each queued job, keyed by book id. Used to bill spend
# for a legacy owner-less book to the actor, and to re-check their quota at run
# time (the request-time check can't see spend from other still-queued runs).
JOB_ACTOR: dict[str, str] = {}

# Live, human-readable progress detail per book, surfaced to the UI so the
# reviewer always sees exactly what's happening (never a silent "ingesting…").
JOB_DETAIL: dict[str, dict] = {}


def _set_detail(book_id: str, **kw) -> None:
    JOB_DETAIL.setdefault(book_id, {}).update(kw)


def _detail_message(d: dict) -> str:
    """Compose the one-line status shown in the UI from the detail dict."""
    phase = d.get("phase")
    page = d.get("page")
    idx, tc = d.get("index"), d.get("target_count")
    prefix = f"page {page}" if page else ""
    where = f" ({idx}/{tc} this run)" if idx and tc else ""
    if phase == "rendering":
        return f"Rendering {prefix}{where}…"
    if phase == "ocr":
        return f"Reading (OCR) {prefix}{where}…"
    if phase == "translate":
        s, st = d.get("seg"), d.get("seg_total")
        seg = f" · segment {s}/{st}" if s and st else ""
        return f"Translating {prefix}{seg}{where}…"
    if phase == "done":
        dr = d.get("done_this_run", 0)
        fl = d.get("failed") or []
        msg = f"Finished — {dr} page(s) processed this run"
        if fl:
            shown = ", ".join(str(p) for p in fl[:6]) + ("…" if len(fl) > 6 else "")
            msg += f"; {len(fl)} failed (pages {shown}) — press Reprocess to retry"
        return msg
    if phase == "error":
        return d.get("last_error") or "Ingestion error."
    return "Working…"


def mock_pipeline(conn, book_id: str, options: dict | None = None) -> None:
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


# --------------------------------------------------------------------------- #
# Real pipeline: OCR (if needed) -> translate -> QA, writing into the DB.      #
# Runs only when OPENROUTER_API_KEY is set and we're not inside pytest; falls  #
# back to the mock so the platform still works offline and tests never call    #
# the network.                                                                 #
# --------------------------------------------------------------------------- #
def _pipeline_mode() -> str:
    mode = os.environ.get("HAYDARI_PIPELINE", "auto").strip().lower()
    if mode != "auto":
        return mode
    if os.environ.get("OPENROUTER_API_KEY") and "PYTEST_CURRENT_TEST" not in os.environ:
        return "real"
    return "mock"


def _resolve_pdf(source_pdf: str | None) -> tuple[str | None, bool]:
    """Return ``(local_path, is_temp)`` for the book's PDF.

    Handles legacy absolute/relative paths (still on disk) AND the new storage
    keys (``books/<id>/<file>``). ``is_temp`` is True only when the path is a
    throwaway copy the caller must clean up (S3/R2 materialization) — ownership
    is explicit, never inferred from the filename.
    """
    if not source_pdf:
        return None, False
    candidates = [source_pdf, str(_REPO_ROOT / source_pdf),
                  os.path.join(config.upload_dir(), os.path.basename(source_pdf))]
    for c in candidates:
        if os.path.exists(c):
            return c, False  # a real on-disk file — never delete it
    from . import storage  # lazy to avoid an import cycle at module load
    st = storage.get_storage()
    if st.exists(source_pdf):
        return st.materialize(source_pdf), st.materialize_is_temp
    return None, False


def _load_glossary(conn, book_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT term_ar, term_en, note FROM termbase WHERE scope='global' OR book_id=?",
        (book_id,),
    ).fetchall()
    return [{"term_ar": r["term_ar"], "term_en": r["term_en"], "note": r["note"]} for r in rows]


def _target_pages(conn, book_id: str, total: int, options: dict) -> list[int]:
    """Compute the ordered list of page numbers to process on THIS run.

    Honours an optional [from_page, to_page] window, skips pages already
    completed (resume), and caps the count at the per-run safety limit.
    """
    from_page = max(1, int(options.get("from_page") or 1))
    to_page = int(options.get("to_page") or total or from_page)
    if total:
        to_page = min(to_page, total)
    to_page = max(to_page, from_page)

    # Admin-configurable per-run page limit (token-budget safety); the caller may
    # request a SMALLER cap for this run, never a larger one. An explicit 0/None
    # means "use the run cap" (not zero pages).
    run_cap = db.resolved_max_pages_per_run(conn, DEFAULT_MAX_PAGES_PER_RUN)
    requested = options.get("max_pages")
    cap = run_cap if not requested else max(1, int(requested))
    cap = min(cap, run_cap)

    # force=True re-does already-finished pages in the range (to pick up pipeline
    # improvements); otherwise completed pages are skipped (normal resume).
    done: set[int] = set() if options.get("force") else db.completed_page_numbers(conn, book_id)
    pending = [p for p in range(from_page, to_page + 1) if p not in done]
    return pending[:cap]


def _process_one_page(conn, book_id, pdf, page_no, work_dir, engine, pipe,
                      glossary, notes, style_rules=None):
    """Render → OCR → translate + QA a single page, writing it into the DB.

    The caller commits after this returns so each page is durable on its own
    (live progress + resumable). Any prior partial rows for this page (from a
    failed earlier attempt) are cleared first so retries are clean.
    """
    from pipeline.ocr.pipeline import process_page
    from pipeline.ocr.render import render_page
    from pipeline.qa import score_segment

    # Clear any partial rows for this page from a previous failed attempt.
    conn.execute("DELETE FROM segments WHERE book_id=? AND page_no=?", (book_id, page_no))
    conn.execute("DELETE FROM pages WHERE book_id=? AND page_no=?", (book_id, page_no))

    _set_detail(book_id, phase="rendering", page=page_no)
    image = render_page(pdf, work_dir, page_no)
    _set_detail(book_id, phase="ocr", page=page_no)
    page = process_page(image, engine)  # OCR (OpenRouter vision) + classify

    conn.execute(
        "INSERT INTO pages (book_id, page_no, image_path, ocr_markdown, status) "
        "VALUES (?, ?, ?, ?, 'processing')",
        (book_id, page_no, page.get("image_path"), page.get("markdown", "")),
    )
    seg_rows = []
    for seg in page["segments"]:
        order = seg["order"]
        sid = f"{book_id}:{page_no:03d}:{order:02d}"
        conn.execute(
            "INSERT INTO segments (id, book_id, page_no, seg_order, kind, anchor, "
            "ar, confidence, engine, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')",
            (sid, book_id, page_no, order, seg.get("kind", "body"), seg.get("anchor"),
             seg.get("ar", ""), seg.get("confidence"), page.get("engine")),
        )
        seg_rows.append((sid, seg))

    total = len(seg_rows)
    for i, (sid, seg) in enumerate(seg_rows, 1):
        _set_detail(book_id, phase="translate", page=page_no, seg=i, seg_total=total)
        s = {"id": sid, "kind": seg.get("kind", "body"),
             "anchor": seg.get("anchor"), "ar": seg.get("ar", "")}
        # Feed the learning loop back into translation: enforced glossary terms,
        # active style rules, per-book instructions, and — crucially — reuse of
        # previously-approved translations for identical Arabic (translation memory).
        ctx = {"glossary": glossary, "style_rules": style_rules or []}
        if notes:
            ctx["instructions"] = notes
        tm = db.tm_lookup(conn, s["ar"], book_id)
        if tm:
            ctx["tm_matches"] = tm
        # Per-segment resilience: a single segment that fails (even after the
        # network-layer retries) must not lose the rest of the page. Flag it for
        # review with the Arabic preserved, and move on.
        try:
            res = pipe.translate_segment(s, ctx)
        except Exception as exc:  # noqa: BLE001
            res = {"en": s["ar"], "engine": "error",
                   "confidence": 0.0, "status": "needs_review",
                   "judge_note": f"translation failed: {str(exc)[:120]}"}
        en = res.get("en", "") or ""
        qa = score_segment({**s, "en": en})
        status = res.get("status") or qa["status"]
        db.update_segment(
            conn, sid,
            en_draft=en,            # first draft, immutable baseline for training
            en_current=en,
            engine=res.get("engine"),
            confidence=res.get("confidence"),
            bt_sim=qa["bt_sim"],
            self_consistency=qa["self_consistency"],
            judge_score=qa["judge_score"],
            judge_note=res.get("judge_note") or qa["judge_note"],
            footnote_ok=1 if qa["footnote_ok"] else 0,
            status=status,
        )
    conn.execute(
        "UPDATE pages SET status='in_review' WHERE book_id=? AND page_no=?",
        (book_id, page_no),
    )


def real_pipeline(conn, book_id: str, options: dict | None = None) -> None:
    """Incremental OCR→translate→QA: process a bounded window of pages, one at a
    time, committing after each so progress is live and the run is resumable."""
    import tempfile

    from pipeline.ocr.engines import select_engine
    from pipeline.ocr.render import pdf_page_count
    from pipeline.translate.factory import build_pipeline_from_env

    options = options or {}
    book = db.get_book(conn, book_id) or {}
    pdf, pdf_is_temp = _resolve_pdf(book.get("source_pdf"))
    if not pdf:
        raise RuntimeError(f"source PDF not found for {book_id}: {book.get('source_pdf')!r}")

    try:
        # Record the true page total once (metadata only; no rendering).
        total = int(book.get("pages_total") or 0)
        if not total:
            total = pdf_page_count(pdf)
            db.set_book_pages_total(conn, book_id, total)
            conn.commit()

        targets = _target_pages(conn, book_id, total, options)
        if not targets:
            return

        engine = select_engine()
        pipe = build_pipeline_from_env()
        glossary = _load_glossary(conn, book_id)
        style_rules = db.style_rules_for(conn, book_id)
        notes = (book.get("translation_notes") or "").strip() or None

        _set_detail(book_id, target_count=len(targets), done_this_run=0,
                    failed=[], last_error=None)

        with tempfile.TemporaryDirectory(prefix="haydari-ocr-") as work_dir:
            for i, page_no in enumerate(targets, 1):
                _set_detail(book_id, index=i, page=page_no)
                # Per-PAGE resilience: one page failing (a timeout, a bad render)
                # must not abort the whole run. Roll back just that page, record
                # it, and continue — the reviewer can retry the failed page.
                try:
                    _process_one_page(conn, book_id, pdf, page_no, work_dir,
                                      engine, pipe, glossary, notes, style_rules)
                except Exception as exc:  # noqa: BLE001
                    conn.rollback()
                    JOB_DETAIL[book_id]["failed"].append(page_no)
                    JOB_DETAIL[book_id]["last_error"] = f"page {page_no}: {str(exc)[:160]}"
                    write_event(conn, actor="worker", type="ingest.page_error",
                                payload={"book_id": book_id, "page_no": page_no,
                                         "error": str(exc)[:200]})
                    conn.commit()
                    continue
                JOB_DETAIL[book_id]["done_this_run"] = i - len(JOB_DETAIL[book_id]["failed"])
                db.set_book_status(conn, book_id, "processing")
                write_event(conn, actor="worker", type="ingest.page_done",
                            payload={"book_id": book_id, "page_no": page_no})
                conn.commit()  # durable per page → live progress + resume point
        _set_detail(book_id, phase="done", page=None)
    finally:
        # Release the materialized source PDF ONLY when it was a temp copy
        # (S3/R2) — never a real on-disk file (explicit ownership, not filename).
        if pdf_is_temp:
            from . import storage
            storage.get_storage().cleanup_local(pdf)


def default_pipeline(conn, book_id: str, options: dict | None = None) -> None:
    """Dispatch to the real pipeline when configured, else the offline mock."""
    if _pipeline_mode() == "real":
        real_pipeline(conn, book_id, options)
    else:
        mock_pipeline(conn, book_id, options)


# Swappable hook: (sqlite3.Connection, book_id, options) -> None
PIPELINE_HOOK: Callable[..., None] = default_pipeline


def _final_status(conn, book_id: str) -> str:
    """A book with any completed page is reviewable; otherwise it stays uploaded."""
    return "in_review" if db.pages_done(conn, book_id) > 0 else "uploaded"


def _usage_module():
    """The pipeline's in-process token/cost recorder (absent if the pipeline
    package can't be imported, e.g. a trimmed offline checkout)."""
    try:
        from pipeline.translate import usage
        return usage
    except Exception:  # noqa: BLE001
        return None


def _persist_run_usage(book_id: str, owner_id: str | None) -> None:
    """Record this run's real model spend to the usage ledger, attributed to the
    book's owner (the payer). Uses its OWN connection so committing the ledger
    row can never commit partially-written pipeline state on the worker's
    connection (whose failed page must stay rollback-able)."""
    u = _usage_module()
    if u is None:
        return
    try:
        s = u.summary()
    except Exception:  # noqa: BLE001
        return
    if not s or not s.get("calls"):
        return  # nothing spent (e.g. the mock pipeline) — no ledger noise
    c = db.connect()
    try:
        db.record_usage(
            c, user_id=owner_id, book_id=book_id, stage="ingest",
            prompt_tokens=s.get("prompt_tokens", 0),
            completion_tokens=s.get("completion_tokens", 0),
            cost_usd=s.get("cost_usd"),
        )
        c.commit()
    except Exception:  # noqa: BLE001 — accounting must never break ingestion
        try:
            c.rollback()
        except Exception:  # noqa: BLE001
            pass
    finally:
        c.close()


def _process(book_id: str, options: dict | None = None) -> None:
    conn = db.connect()
    options = options or JOB_OPTS.get(book_id) or {}
    try:
        db.init_db(conn)

        # Atomic DB-backed claim: only one processor may hold a book at a time
        # (guards against a duplicate /ingest or a second worker double-running).
        claimed = db.claim_book_for_ingest(conn, book_id)
        conn.commit()
        if not claimed:
            JOB_STATE[book_id] = "processing"  # someone else owns it; don't double-run
            return

        # Who pays for this run: the book's owner, or the triggering user for a
        # legacy owner-less book.
        owner_id = (db.get_book(conn, book_id) or {}).get("owner_id")
        payer_id = owner_id or JOB_ACTOR.get(book_id)
        payer = db.get_user(conn, payer_id) if payer_id else None

        # Re-check the quota AT RUN TIME. The request-time gate can't see spend
        # from other runs still queued behind this one; by now those have each
        # recorded their spend, so a burst of queued ingests can overshoot by at
        # most this single run. Over cap → release the claim and skip, unspent.
        reason = db.over_spend_quota(
            conn, user_id=payer_id, role=(payer or {}).get("role"),
            user_limit=(payer or {}).get("monthly_usd_limit"),
        )
        if reason:
            db.set_book_status(conn, book_id, _final_status(conn, book_id))
            _set_detail(book_id, phase="idle", last_error=f"skipped: {reason}")
            write_event(conn, actor="worker", type="ingest.quota_blocked",
                        payload={"book_id": book_id, "reason": reason, "payer": payer_id})
            conn.commit()
            JOB_STATE[book_id] = "blocked"
            return

        JOB_STATE[book_id] = "processing"
        write_event(conn, actor="worker", type="ingest.start", payload={"book_id": book_id})
        conn.commit()

        # Meter real model spend for this run and bill the payer. reset() before,
        # persist in finally so partial spend on a mid-run failure is still
        # recorded (the worker is single-threaded, so this global recorder is
        # safe to scope per run).
        u = _usage_module()
        if u is not None:
            u.reset()
        try:
            # The pipeline commits page-by-page; each completed page is durable.
            PIPELINE_HOOK(conn, book_id, options)
        finally:
            _persist_run_usage(book_id, payer_id)

        db.set_book_status(conn, book_id, _final_status(conn, book_id))
        write_event(conn, actor="worker", type="ingest.done",
                    payload={"book_id": book_id, "pages_done": db.pages_done(conn, book_id)})
        conn.commit()
        JOB_STATE[book_id] = "done"
    except Exception as exc:  # noqa: BLE001 — record and surface via status
        JOB_STATE[book_id] = "error"
        _set_detail(book_id, phase="error", last_error=str(exc)[:200])
        # Pages already committed by the pipeline are KEPT (resumable). Only the
        # current in-flight page is rolled back; the book returns to a reviewable
        # state if anything succeeded, else 'error'.
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        try:
            done = db.pages_done(conn, book_id)
            db.set_book_status(conn, book_id, "in_review" if done > 0 else "error")
            write_event(
                conn, actor="worker", type="ingest.error",
                payload={"book_id": book_id, "error": str(exc), "pages_done": done},
            )
            conn.commit()
        except Exception:  # noqa: BLE001
            pass
    finally:
        JOB_OPTS.pop(book_id, None)
        JOB_ACTOR.pop(book_id, None)
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


def enqueue(book_id: str, options: dict | None = None, actor_id: str | None = None) -> str:
    """Queue a book for ingestion. Returns the job state after enqueue.

    ``options`` may carry ``from_page`` / ``to_page`` / ``max_pages`` to bound
    the run (page range + per-run cap). ``actor_id`` is the user who triggered
    the run (billed when the book has no owner). In sync mode the pipeline runs
    inline (state == 'done'); otherwise it is queued for the background worker.
    """
    JOB_OPTS[book_id] = options or {}
    if actor_id is not None:
        JOB_ACTOR[book_id] = actor_id
    if config.sync_ingest():
        JOB_STATE[book_id] = "queued"
        _process(book_id, options)
        return JOB_STATE.get(book_id, "done")
    JOB_STATE[book_id] = "queued"
    _ensure_worker()
    _Q.put(book_id)
    return "queued"


def job_state(book_id: str) -> str | None:
    return JOB_STATE.get(book_id)


def job_detail(book_id: str) -> dict:
    """Live, human-readable detail for the UI: phase, current page, segment
    progress, failed pages, and a composed one-line message."""
    d = dict(JOB_DETAIL.get(book_id) or {})
    if d:
        d["message"] = _detail_message(d)
    return d

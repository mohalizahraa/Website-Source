"""Regression tests for the codex peer-review findings.

HIGH 1  correction anchors to the ORIGINAL model draft (en_draft -> en_edited),
        stable across reject->approve cycles.
HIGH 2  the correction is durably committed regardless of TM-upsert outcome.
HIGH 3  a failing ingest sets book status='error' (never left 'processing').
HIGH 4  a failing ingest rolls back partial page/segment writes.

Plus lighter checks for MEDIUM/LOW findings (5, 6, 7, 9, 10, 8).
"""
from __future__ import annotations

import io
import os
import sqlite3

import pytest

from app import config


@pytest.fixture(autouse=True)
def _sync_ingest():
    prev = os.environ.get("HAYDARI_SYNC_INGEST")
    os.environ["HAYDARI_SYNC_INGEST"] = "1"
    yield
    if prev is None:
        os.environ.pop("HAYDARI_SYNC_INGEST", None)
    else:
        os.environ["HAYDARI_SYNC_INGEST"] = prev


def _open():
    conn = sqlite3.connect(config.db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _upload(client, name="reg.pdf"):
    up = client.post(
        "/api/books/upload",
        files={"files": (name, io.BytesIO(b"%PDF reg"), "application/pdf")},
    )
    return up.json()[0]["id"]


# --- HIGH 1 -----------------------------------------------------------------
def test_high1_correction_anchors_to_original_draft(client):
    seg_id = "B-01:042:03"
    conn = _open()
    draft = conn.execute(
        "SELECT en_draft FROM segments WHERE id = ?", (seg_id,)
    ).fetchone()["en_draft"]
    conn.close()

    # A reject moves en_current to an interim v2 ...
    client.post(
        f"/api/segments/{seg_id}/review",
        json={"en_edited": "Interim v2 rendering held for another pass.", "action": "reject"},
    )
    # ... then an approve records the final v3.
    client.post(
        f"/api/segments/{seg_id}/review",
        json={"en_edited": "Final v3 approved rendering.", "action": "approve"},
    )

    conn = _open()
    corr = conn.execute(
        "SELECT * FROM corrections WHERE segment_id = ? ORDER BY id DESC LIMIT 1",
        (seg_id,),
    ).fetchone()
    conn.close()
    # The durable training pair must be (original draft -> v3), not (v2 -> v3).
    assert corr["en_before"] == draft
    assert corr["en_after"] == "Final v3 approved rendering."


# --- HIGH 2 -----------------------------------------------------------------
def test_high2_correction_persists_when_tm_upsert_fails(client, monkeypatch):
    from app import main as main_mod

    def boom(*args, **kwargs):
        raise RuntimeError("TM backend unavailable")

    monkeypatch.setattr(main_mod.db, "upsert_tm", boom)

    seg_id = "B-01:042:06"
    try:
        client.post(
            f"/api/segments/{seg_id}/review",
            json={"en_edited": "An approved rendering worth remembering.", "action": "approve"},
        )
    except Exception:
        pass  # even if the endpoint were to error, the correction must survive

    conn = _open()
    n = conn.execute(
        "SELECT COUNT(*) c FROM corrections WHERE segment_id = ?", (seg_id,)
    ).fetchone()["c"]
    conn.close()
    assert n == 1  # training signal durable despite TM failure


# --- HIGH 3 + HIGH 4 --------------------------------------------------------
def test_high3_4_ingest_failure_errors_and_rolls_back(client, monkeypatch):
    from app import ingest

    def boom(conn, book_id):
        # Partial write that must NOT survive a failed ingest.
        conn.execute(
            "INSERT INTO pages (book_id, page_no, image_path, status) VALUES (?, ?, ?, ?)",
            (book_id, 1, "/partial.png", "in_review"),
        )
        raise RuntimeError("pipeline exploded mid-run")

    monkeypatch.setattr(ingest, "PIPELINE_HOOK", boom)

    book_id = _upload(client, "fails.pdf")
    client.post(f"/api/books/{book_id}/ingest")

    st = client.get(f"/api/books/{book_id}/status").json()
    assert st["status"] == "error"  # HIGH 3: never stuck at 'processing'
    assert st["job"] == "error"
    assert st["pages"] == 0  # HIGH 4: partial page rolled back


# --- MEDIUM 5 ---------------------------------------------------------------
def test_medium5_claim_guard_blocks_concurrent_processing(client):
    from app import db

    book_id = _upload(client, "claim.pdf")
    conn = db.connect()
    try:
        db.init_db(conn)
        first = db.claim_book_for_ingest(conn, book_id)
        conn.commit()
        second = db.claim_book_for_ingest(conn, book_id)
        conn.commit()
    finally:
        conn.close()
    assert first is True   # first processor claims it
    assert second is False  # a second cannot claim while 'processing'


# --- MEDIUM 6 ---------------------------------------------------------------
def test_medium6_reject_empty_approval(client):
    r = client.post(
        "/api/segments/B-01:042:08/review",
        json={"en_edited": "   ", "action": "approve"},
    )
    assert r.status_code == 400


def test_medium6_reject_dropped_footnote_anchor(client):
    # B-01:042:05 source carries a [[FN-1]] anchor; approving text without it fails.
    r = client.post(
        "/api/segments/B-01:042:05/review",
        json={"en_edited": "Approved text that lost its footnote marker.", "action": "approve"},
    )
    assert r.status_code == 400


# --- MEDIUM 7 ---------------------------------------------------------------
def test_medium7_global_tm_dedup(client):
    from app import db

    conn = db.connect()
    try:
        db.init_db(conn)
        before = db.tm_size(conn)
        db.upsert_tm(conn, book_id=None, ar="جملة عالمية", en_approved="A global sentence.")
        db.upsert_tm(conn, book_id=None, ar="جملة عالمية", en_approved="A global sentence, revised.")
        conn.commit()
        after = db.tm_size(conn)
    finally:
        conn.close()
    assert after == before + 1  # global (NULL book_id) rows dedupe by ar_hash


# --- MEDIUM 9 ---------------------------------------------------------------
def test_medium9_import_accepts_raw_json_array(client):
    r = client.post(
        "/api/books/import",
        json=[{"title_ar": "كتاب مصفوفة", "author": "A"}],
    )
    assert r.status_code == 200
    assert len(r.json()) == 1


# --- LOW 10 -----------------------------------------------------------------
def test_low10_malformed_csv_returns_400(client):
    # Invalid UTF-8 bytes must yield a clean 400, not a 500.
    resp = client.post(
        "/api/termbase/import",
        files={"file": ("bad.csv", io.BytesIO(b"\xff\xfe\x00bad"), "text/csv")},
        data={"scope": "global"},
    )
    assert resp.status_code == 400


# --- LOW 8 ------------------------------------------------------------------
def test_low8_unchanged_human_approval_not_auto(client):
    # Seed has 2 approved segments with no corrections -> auto-approval rate 1.0.
    assert client.get("/api/learning/summary").json()["auto_approval_rate"] == 1.0
    # A human approval (even of unchanged text) is a review, not an auto-approval.
    conn = _open()
    same = conn.execute(
        "SELECT en_draft FROM segments WHERE id = ?", ("B-01:042:08",)
    ).fetchone()["en_draft"]
    conn.close()
    client.post(
        "/api/segments/B-01:042:08/review",
        json={"en_edited": same, "action": "approve"},
    )
    rate = client.get("/api/learning/summary").json()["auto_approval_rate"]
    # Now 3 approved, 1 human-reviewed -> 2/3.
    assert rate == pytest.approx(2 / 3)

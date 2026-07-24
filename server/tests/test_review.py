"""Tests for POST /segments/{id}/review — diff, correction, TM upsert, status."""
from __future__ import annotations

import sqlite3

from app import config


def _open():
    conn = sqlite3.connect(config.db_path())
    conn.row_factory = sqlite3.Row
    return conn


def test_approve_records_correction_and_upserts_tm(client):
    seg_id = "B-01:042:03"

    before = _open()
    tm_before = before.execute(
        "SELECT COUNT(*) c FROM translation_memory"
    ).fetchone()["c"]
    corr_before = before.execute(
        "SELECT COUNT(*) c FROM corrections"
    ).fetchone()["c"]
    before.close()

    edited = "So the dialectical theologians (mutakallimūn) held that His attributes are superadded to His essence, while the philosophers opposed them."
    resp = client.post(
        f"/api/segments/{seg_id}/review",
        json={
            "en_edited": edited,
            "action": "approve",
            "scores": {"Adequacy": 4, "Fluency": 5, "Terminology": 4, "Footnotes": 5},
            "mqm": [{"category": "terminology", "severity": "minor"}],
            "reviewer": "hussein",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Response shape from the contract.
    assert data["status"] == "approved"
    assert set(data["learning"]) == {"tm_added", "terms_suggested", "applied_to"}
    assert data["learning"]["tm_added"] == 1

    conn = _open()
    # Segment flipped to approved and en_current updated.
    seg = conn.execute("SELECT * FROM segments WHERE id = ?", (seg_id,)).fetchone()
    assert seg["status"] == "approved"
    assert seg["en_current"] == edited

    # A correction row was written with a non-empty diff.
    corr = conn.execute(
        "SELECT * FROM corrections WHERE segment_id = ? ORDER BY id DESC LIMIT 1",
        (seg_id,),
    ).fetchone()
    assert corr is not None
    assert corr["reviewer"] == "hussein"
    assert '"changed": true' in corr["diff_json"] or '"changed":true' in corr["diff_json"]

    corr_after = conn.execute("SELECT COUNT(*) c FROM corrections").fetchone()["c"]
    tm_after = conn.execute(
        "SELECT COUNT(*) c FROM translation_memory"
    ).fetchone()["c"]
    assert corr_after == corr_before + 1
    assert tm_after == tm_before + 1

    # An audit event was recorded.
    ev = conn.execute(
        "SELECT COUNT(*) c FROM events WHERE type = 'segment.review'"
    ).fetchone()["c"]
    assert ev >= 1
    conn.close()


def test_approve_is_idempotent_on_tm(client):
    seg_id = "B-01:042:06"
    body = {"en_edited": "This is the true position of the verifiers.", "action": "approve"}
    r1 = client.post(f"/api/segments/{seg_id}/review", json=body)
    r2 = client.post(f"/api/segments/{seg_id}/review", json=body)
    assert r1.json()["learning"]["tm_added"] == 1
    # Second approve of same ar updates, doesn't add a new TM row.
    assert r2.json()["learning"]["tm_added"] == 0


def test_skip_does_not_change_status_but_records_correction(client):
    seg_id = "B-01:042:08"
    conn = _open()
    status_before = conn.execute(
        "SELECT status FROM segments WHERE id = ?", (seg_id,)
    ).fetchone()["status"]
    conn.close()

    resp = client.post(
        f"/api/segments/{seg_id}/review",
        json={"en_edited": "A slightly different closing.", "action": "skip"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == status_before  # unchanged
    assert resp.json()["learning"]["tm_added"] == 0

    conn = _open()
    n = conn.execute(
        "SELECT COUNT(*) c FROM corrections WHERE segment_id = ?", (seg_id,)
    ).fetchone()["c"]
    conn.close()
    assert n == 1  # correction still captured


def test_reject_sends_back_for_review(client):
    seg_id = "B-01:042:05"
    resp = client.post(
        f"/api/segments/{seg_id}/review",
        json={"en_edited": "Reworked text [[FN-1]]", "action": "reject"},
    )
    assert resp.json()["status"] == "needs_review"
    assert resp.json()["learning"]["tm_added"] == 0


def test_review_404_for_unknown_segment(client):
    resp = client.post(
        "/api/segments/NOPE/review",
        json={"en_edited": "x", "action": "approve"},
    )
    assert resp.status_code == 404

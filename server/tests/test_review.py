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


def test_save_draft_persists_after_reload_without_training_signal(client):
    seg_id = "B-01:042:06"
    conn = _open()
    before = conn.execute(
        "SELECT COUNT(*) c FROM corrections WHERE segment_id = ?", (seg_id,)
    ).fetchone()["c"]
    conn.close()

    text = "A durable in-progress rendering that survives navigation."
    saved = client.patch(f"/api/segments/{seg_id}", json={"en_edited": text})
    assert saved.status_code == 200, saved.text
    assert saved.json()["en"] == text
    assert saved.json()["status"] == "draft"

    reloaded = client.get(f"/api/segments/{seg_id}")
    assert reloaded.status_code == 200
    assert reloaded.json()["en"] == text
    assert reloaded.json()["en_draft"]

    conn = _open()
    after = conn.execute(
        "SELECT COUNT(*) c FROM corrections WHERE segment_id = ?", (seg_id,)
    ).fetchone()["c"]
    conn.close()
    assert after == before  # partial drafts do not pollute model training data


def test_skip_persists_edit_but_does_not_approve(client):
    seg_id = "B-01:042:06"
    before = client.get(f"/api/segments/{seg_id}").json()["status"]
    text = "Saved while skipped for a later decision."
    response = client.post(
        f"/api/segments/{seg_id}/review",
        json={"en_edited": text, "action": "skip"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == before
    reloaded = client.get(f"/api/segments/{seg_id}").json()
    assert reloaded["en"] == text
    assert reloaded["status"] == before


def test_draft_save_requires_write_access(client):
    from app import auth, db

    conn = db.connect()
    try:
        db.create_user(
            conn,
            user_id="U-99",
            email="reader-draft@example.com",
            password_hash=auth.hash_password("reader password"),
            display_name="Reader Draft",
            role="reader",
        )
        conn.commit()
    finally:
        conn.close()
    client.post("/api/auth/logout")
    client.post(
        "/api/auth/login",
        json={"email": "reader-draft@example.com", "password": "reader password"},
    )
    response = client.patch(
        "/api/segments/B-01:042:06", json={"en_edited": "not allowed"}
    )
    assert response.status_code == 403


def test_llm_review_is_non_destructive_and_metered(client, monkeypatch):
    from app import llm_review

    seg_id = "B-01:042:06"
    original = client.get(f"/api/segments/{seg_id}").json()["en"]

    def fake_review(**kwargs):
        assert kwargs["en"] == original
        return {
            "model": "test/reviewer",
            "assessment": "Faithful; one term can be more precise.",
            "suggestion": "A suggested rendering that is not auto-applied.",
            "issues": ["Terminology"],
            "usage": {"prompt_tokens": 100, "completion_tokens": 20, "cost_usd": 0.001},
        }

    monkeypatch.setattr(llm_review, "review_translation", fake_review)
    response = client.post(
        f"/api/segments/{seg_id}/llm-review", json={"en_edited": original}
    )
    assert response.status_code == 200, response.text
    assert response.json()["suggestion"].startswith("A suggested")
    assert client.get(f"/api/segments/{seg_id}").json()["en"] == original

    conn = _open()
    usage = conn.execute(
        "SELECT * FROM usage_ledger WHERE stage='llm_review' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()
    assert usage["prompt_tokens"] == 100
    assert usage["completion_tokens"] == 20


def test_llm_review_withholds_suggestion_that_drops_footnote_anchor(client, monkeypatch):
    from app import llm_review

    seg_id = "B-01:042:05"
    original = client.get(f"/api/segments/{seg_id}").json()["en"]
    assert "[[FN-1]]" in original

    monkeypatch.setattr(
        llm_review,
        "review_translation",
        lambda **_kwargs: {
            "model": "test/reviewer",
            "assessment": "Suggested a smoother sentence.",
            "suggestion": "A smoother sentence with its footnote accidentally omitted.",
            "issues": [],
            "usage": {"prompt_tokens": 10, "completion_tokens": 10, "cost_usd": 0},
        },
    )
    response = client.post(
        f"/api/segments/{seg_id}/llm-review", json={"en_edited": original}
    )
    assert response.status_code == 200, response.text
    assert response.json()["suggestion"] == ""
    assert "dropped footnote anchor" in response.json()["issues"][0]
    assert client.get(f"/api/segments/{seg_id}").json()["en"] == original

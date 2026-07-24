"""Tests for termbase (single + CSV import), style-rules, and learning summary."""
from __future__ import annotations

import io


def test_learning_summary_shape(client):
    resp = client.get("/api/learning/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data) == {
        "tm_size",
        "terms",
        "rules",
        "auto_approval_rate",
        "corrections",
    }
    # Seed loaded 2 terms and 1 rule.
    assert data["terms"] == 2
    assert data["rules"] == 1
    assert isinstance(data["auto_approval_rate"], float)


def test_add_term_increments_summary(client):
    before = client.get("/api/learning/summary").json()["terms"]
    resp = client.post(
        "/api/termbase",
        json={
            "term_ar": "الظاهر",
            "term_en": "the Outward (al-Ẓāhir)",
            "note": "Divine name",
            "scope": "global",
        },
    )
    assert resp.status_code == 200
    assert "id" in resp.json()
    after = client.get("/api/learning/summary").json()["terms"]
    assert after == before + 1


def test_add_book_scoped_term_requires_book_id(client):
    resp = client.post(
        "/api/termbase",
        json={"term_ar": "x", "term_en": "y", "scope": "book"},
    )
    assert resp.status_code == 400


def test_style_rule_increments_summary(client):
    before = client.get("/api/learning/summary").json()["rules"]
    resp = client.post(
        "/api/style-rules",
        json={"rule": "Prefer 'God' over 'Allah' in running English prose.", "scope": "global"},
    )
    assert resp.status_code == 200
    after = client.get("/api/learning/summary").json()["rules"]
    assert after == before + 1


def test_termbase_csv_import(client):
    before = client.get("/api/learning/summary").json()["terms"]
    csv_text = (
        "term_ar,term_en,note\n"
        "الباطن,the Inward (al-Bāṭin),Divine name\n"
        "الأوّل,the First (al-Awwal),Divine name\n"
        ",skipme,missing arabic\n"  # skipped: no term_ar
    )
    resp = client.post(
        "/api/termbase/import",
        files={"file": ("terms.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")},
        data={"scope": "global"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["added"] == 2
    after = client.get("/api/learning/summary").json()["terms"]
    assert after == before + 2


def test_approve_raises_auto_approval_denominator(client):
    # Approving without editing keeps auto-approval clean; corrections counted.
    seg_id = "B-01:042:08"
    client.post(
        f"/api/segments/{seg_id}/review",
        json={
            "en_edited": "A detailed discussion of this will come in the following chapter, God the Exalted willing.",
            "action": "approve",
        },
    )
    summary = client.get("/api/learning/summary").json()
    assert summary["corrections"] >= 1
    assert 0.0 <= summary["auto_approval_rate"] <= 1.0

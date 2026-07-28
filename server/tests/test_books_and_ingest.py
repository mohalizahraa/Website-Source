"""Tests for library endpoints: books listing, upload, import, ingest, status."""
from __future__ import annotations

import io
import os

import pytest


@pytest.fixture(autouse=True)
def _sync_ingest():
    """Run ingestion inline so status is final when the request returns."""
    prev = os.environ.get("HAYDARI_SYNC_INGEST")
    os.environ["HAYDARI_SYNC_INGEST"] = "1"
    yield
    if prev is None:
        os.environ.pop("HAYDARI_SYNC_INGEST", None)
    else:
        os.environ["HAYDARI_SYNC_INGEST"] = prev


def test_list_books_includes_seed(client):
    resp = client.get("/api/books")
    assert resp.status_code == 200
    books = resp.json()
    ids = {b["id"] for b in books}
    assert "B-01" in ids
    b1 = next(b for b in books if b["id"] == "B-01")
    assert "progress" in b1 and "fraction" in b1["progress"]


def test_get_page_returns_wire_segments(client):
    resp = client.get("/api/books/B-01/pages/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["page"] == 1
    assert len(data["segments"]) == 8
    sacred = [s for s in data["segments"] if s["kind"] == "sacred"]
    assert len(sacred) == 1
    body_with_fn = [s for s in data["segments"] if s["ar"].find("[[FN-1]]") != -1]
    assert body_with_fn and body_with_fn[0]["kind"] == "body"
    footnote = [s for s in data["segments"] if s["anchor"] == "FN-1"]
    assert footnote and footnote[0]["kind"] == "footnote"
    # Wire shape sanity.
    s = data["segments"][0]
    assert set(s) >= {"id", "book_id", "page", "order", "kind", "anchor", "ar",
                      "en", "engine", "confidence", "qa", "alternatives", "status"}
    assert set(s["qa"]) == {"bt_sim", "self_consistency", "judge_score",
                            "judge_note", "footnote_ok"}


def test_upload_creates_uploaded_book(client):
    pdf_bytes = b"%PDF-1.4 fake pdf content"
    resp = client.post(
        "/api/books/upload",
        files={"files": ("kitab.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        data={"title_ar": "كتاب تجريبي", "author": "al-Ḥaydarī"},
    )
    assert resp.status_code == 200, resp.text
    created = resp.json()
    assert len(created) == 1
    new_id = created[0]["id"]

    detail = client.get(f"/api/books/{new_id}").json()
    assert detail["status"] == "uploaded"
    assert detail["title_ar"] == "كتاب تجريبي"
    # source_pdf is now a backend-neutral storage key; verify the blob exists.
    from app import storage
    assert detail["source_pdf"] and storage.get_storage().exists(detail["source_pdf"])


def test_upload_multiple_files(client):
    resp = client.post(
        "/api/books/upload",
        files=[
            ("files", ("a.pdf", io.BytesIO(b"%PDF a"), "application/pdf")),
            ("files", ("b.pdf", io.BytesIO(b"%PDF b"), "application/pdf")),
        ],
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2
    # Unique ids allocated.
    ids = [c["id"] for c in resp.json()]
    assert len(set(ids)) == 2


def test_import_catalog(client):
    resp = client.post(
        "/api/books/import",
        json={
            "books": [
                {"title_ar": "الكتاب الأول", "title_en": "Book One", "author": "X"},
                {"title_ar": "الكتاب الثاني", "author": "Y"},
            ]
        },
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_ingest_advances_status(client):
    # Upload a fresh book -> status uploaded.
    up = client.post(
        "/api/books/upload",
        files={"files": ("ingest_me.pdf", io.BytesIO(b"%PDF x"), "application/pdf")},
    )
    book_id = up.json()[0]["id"]
    assert client.get(f"/api/books/{book_id}/status").json()["status"] == "uploaded"

    # Ingest (runs inline via sync mode).
    ing = client.post(f"/api/books/{book_id}/ingest")
    assert ing.status_code == 200
    assert ing.json()["job"] == "done"

    status = client.get(f"/api/books/{book_id}/status").json()
    assert status["status"] == "in_review"
    assert status["pages"] >= 1  # mock pipeline laid down a stub page


def test_ingest_unknown_book_404(client):
    assert client.post("/api/books/NOPE/ingest").status_code == 404

"""Phase 2: auth + per-user scoping + anonymous public read of published books.

The `client` fixture is logged in as the bootstrapped admin. Tests clear the
session cookie to exercise anonymous (public) behaviour.
"""
from __future__ import annotations

import io


def _upload(client, name="b.pdf"):
    r = client.post(
        "/api/books/upload",
        files={"files": (name, io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


def test_me_returns_bootstrapped_admin(client):
    me = client.get("/api/auth/me").json()
    assert me and me["role"] == "admin"


def test_bad_login_rejected(client):
    r = client.post("/api/auth/login", json={"email": "admin@haydari.local", "password": "wrong"})
    assert r.status_code == 401


def test_anonymous_cannot_mutate(client):
    client.cookies.clear()
    up = client.post(
        "/api/books/upload",
        files={"files": ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert up.status_code == 401
    assert client.get("/api/auth/me").json() is None


def test_public_sees_only_published(client):
    pub = _upload(client, "pub.pdf")
    priv = _upload(client, "priv.pdf")
    # Publish one of them (creator action).
    assert client.patch(f"/api/books/{pub}", json={"status": "published"}).status_code == 200

    # Go anonymous.
    client.cookies.clear()
    ids = [b["id"] for b in client.get("/api/books").json()]
    assert pub in ids           # published book is in the public library
    assert priv not in ids      # unpublished book is hidden from the public

    # Public can READ a published book + its status; not an unpublished one.
    assert client.get(f"/api/books/{pub}").status_code == 200
    assert client.get(f"/api/books/{pub}/status").status_code == 200
    assert client.get(f"/api/books/{priv}").status_code == 401
    # And cannot start work on it.
    assert client.post(f"/api/books/{priv}/ingest").status_code == 401


def test_creator_cannot_touch_another_users_book(client):
    # admin creates a second creator account and a book owned by admin
    mk = client.post("/api/auth/users", json={
        "email": "creator@haydari.local", "password": "password123",
        "display_name": "Creator", "role": "creator"})
    assert mk.status_code == 200, mk.text
    admin_book = _upload(client, "admins.pdf")

    # log in as the creator (new client-less flow: re-login on same client)
    assert client.post("/api/auth/login", json={
        "email": "creator@haydari.local", "password": "password123"}).status_code == 200

    # the creator may not read/delete the admin's unpublished book
    assert client.get(f"/api/books/{admin_book}").status_code == 403
    assert client.delete(f"/api/books/{admin_book}").status_code == 403


def test_segment_routes_are_scoped_to_book_owner(client):
    """IDOR guard: segment ids (B-02:001:00) are guessable, so segment routes
    must check the segment's BOOK ownership — not merely that you're logged in."""
    from app import config, db

    admin_book = _upload(client, "adminseg.pdf")  # owned by admin
    conn = db.connect(config.db_path())
    conn.execute("INSERT INTO pages (book_id, page_no, status) VALUES (?, ?, 'in_review')",
                 (admin_book, 1))
    seg_id = f"{admin_book}:001:00"
    conn.execute(
        "INSERT INTO segments (id, book_id, page_no, seg_order, kind, ar, status) "
        "VALUES (?, ?, 1, 0, 'body', 'نص', 'needs_review')", (seg_id, admin_book))
    conn.commit()
    conn.close()

    # admin (owner) can read it
    assert client.get(f"/api/segments/{seg_id}").status_code == 200

    # a different creator cannot read or review it
    client.post("/api/auth/users", json={
        "email": "creator2@haydari.local", "password": "password123", "role": "creator"})
    assert client.post("/api/auth/login", json={
        "email": "creator2@haydari.local", "password": "password123"}).status_code == 200
    assert client.get(f"/api/segments/{seg_id}").status_code == 403
    assert client.post(f"/api/segments/{seg_id}/review",
                       json={"en_edited": "x", "action": "approve",
                             "scores": {}, "mqm": []}).status_code == 403


def test_chat_tools_reject_unauthorized_book():
    """The assistant's tools must refuse any book the caller can't access,
    even if the model supplies an arbitrary book_id in a tool call."""
    from app import chat

    deny = lambda bid, write=True: False  # noqa: E731 — user has no access
    for name, args in [
        ("set_translation_notes", {"book_id": "B-99", "notes": "x"}),
        ("get_book_status", {"book_id": "B-99"}),
        ("add_glossary_term", {"book_id": "B-99", "term_ar": "x", "term_en": "y", "scope": "book"}),
    ]:
        res = chat._execute_tool(None, name, args, authorize=deny)
        assert "not authorized" in str(res.get("error", "")), (name, res)

"""Atomic id allocation (B-NN / U-NN).

The old SELECT MAX(id) approach let two concurrent allocations read the same max
and collide. Allocation now goes through an id_counters row updated under a write
lock, so ids are distinct, continue past pre-existing rows, and roll back cleanly
with a failed insert.
"""
from __future__ import annotations

import io


def _upload(client, name):
    r = client.post(
        "/api/books/upload",
        files={"files": (name, io.BytesIO(b"%PDF-1.4 " + name.encode()), "application/pdf")},
    )
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


def test_uploads_get_distinct_sequential_ids(client):
    # seed holds B-01, so uploads continue at B-02, B-03 (never regenerate B-01).
    assert _upload(client, "a.pdf") == "B-02"
    assert _upload(client, "b.pdf") == "B-03"


def test_multi_file_upload_ids_are_distinct(client):
    r = client.post(
        "/api/books/upload",
        files=[
            ("files", ("x.pdf", io.BytesIO(b"%PDF x"), "application/pdf")),
            ("files", ("y.pdf", io.BytesIO(b"%PDF y"), "application/pdf")),
        ],
    )
    assert r.status_code == 200, r.text
    ids = [b["id"] for b in r.json()]
    assert len(set(ids)) == len(ids) == 2


def test_counter_seeds_past_existing_rows(client):
    """The startup migrate seeds the counter to MAX(existing id), so the next
    allocation clears the seeded B-01 without anything having incremented yet."""
    from app import config, db

    conn = db.connect(config.db_path())
    try:
        assert db.next_book_id(conn) == "B-02"
        conn.rollback()
    finally:
        conn.close()


def test_allocation_is_mutating_and_rolls_back(client):
    from app import config, db

    conn = db.connect(config.db_path())
    try:
        first = db.next_book_id(conn)
        second = db.next_book_id(conn)
        # Distinct on each call (the counter mutates) — unlike the old MAX scan,
        # which returned the same id until a row was actually inserted.
        assert first != second
        assert int(second[2:]) == int(first[2:]) + 1
        # A rollback releases the allocations: nothing was permanently consumed.
        conn.rollback()
        assert db.next_book_id(conn) == first
        conn.rollback()
    finally:
        conn.close()

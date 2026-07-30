"""Per-call usage attribution (usage_events) — the granular observability
ledger that sits alongside the aggregate usage_ledger without touching billing.
"""
from __future__ import annotations


def _record_events(book_id="B-01", user_id="U-1"):
    from app import config, db

    conn = db.connect(config.db_path())
    try:
        # A representative run: bulk draft+refine, one frontier refine, one OCR page.
        db.record_usage_event(conn, user_id=user_id, book_id=book_id, stage="translate",
                              model="google/gemini-2.5-flash", operation="draft",
                              prompt_tokens=400, completion_tokens=40, cost_usd=0.001)
        db.record_usage_event(conn, user_id=user_id, book_id=book_id, stage="translate",
                              model="google/gemini-2.5-flash", operation="refine",
                              prompt_tokens=420, completion_tokens=42, cost_usd=0.0011)
        db.record_usage_event(conn, user_id=user_id, book_id=book_id, stage="translate",
                              model="google/gemini-2.5-pro", operation="refine",
                              prompt_tokens=500, completion_tokens=48, cost_usd=0.006)
        db.record_usage_event(conn, user_id=user_id, book_id=book_id, stage="ocr",
                              model="google/gemini-2.5-flash", operation=None,
                              prompt_tokens=120, completion_tokens=0, cost_usd=None)
        conn.commit()
    finally:
        conn.close()


def test_breakdown_groups_by_model_and_operation(client):
    from app import config, db

    _record_events()
    conn = db.connect(config.db_path())
    try:
        bd = db.usage_events_breakdown(conn)
    finally:
        conn.close()

    by_model = {r["model"]: r for r in bd["by_model"]}
    assert by_model["google/gemini-2.5-flash"]["calls"] == 3
    assert by_model["google/gemini-2.5-pro"]["calls"] == 1
    # Frontier Pro is the most expensive line despite the fewest calls.
    assert bd["by_model"][0]["model"] == "google/gemini-2.5-pro"

    ops = {(r["stage"], r["operation"]): r for r in bd["by_operation"]}
    assert ops[("translate", "draft")]["calls"] == 1
    assert ops[("translate", "refine")]["calls"] == 2
    # OCR has no pass label; a NULL cost must not crash aggregation.
    assert ops[("ocr", None)]["cost_usd"] == 0.0


def test_admin_usage_endpoint_exposes_attribution(client):
    _record_events()
    body = client.get("/api/usage").json()
    assert "by_model" in body and "by_operation" in body
    assert any(r["model"] == "google/gemini-2.5-pro" for r in body["by_model"])


def test_record_usage_event_never_raises_on_bad_input(client):
    """Telemetry is best-effort: a malformed call must not break the caller."""
    from app import config, db

    conn = db.connect(config.db_path())
    try:
        # A genuinely unserializable meta (json.dumps raises TypeError) plus None
        # numerics must be swallowed inside the savepoint, never raised.
        db.record_usage_event(conn, user_id=None, book_id=None, stage="translate",
                              model=None, operation=None,
                              prompt_tokens=None, completion_tokens=None,
                              cost_usd=None, meta={"bad": object()})
        # The connection must still be usable afterwards.
        db.record_usage_event(conn, user_id="U", book_id="B-01", stage="translate",
                              model="ok", operation="draft",
                              prompt_tokens=1, completion_tokens=1, cost_usd=0.01)
        conn.commit()
    finally:
        conn.close()

    # Prove recovery: the bad event was swallowed, but the valid one persisted.
    conn = db.connect(config.db_path())
    try:
        models = {r["model"] for r in db.usage_events_breakdown(conn)["by_model"]}
        assert "ok" in models
    finally:
        conn.close()


def test_failed_event_rolls_back_to_savepoint_and_leaves_connection_usable(client):
    """A telemetry INSERT that fails must not poison the caller's connection.

    Forces a NOT NULL violation (stage=None) so the INSERT fails inside the
    savepoint; the ROLLBACK TO SAVEPOINT must leave the connection usable so a
    subsequent aggregate/event write still commits. (On Postgres this is what
    prevents a bad event from aborting the billing transaction; SQLite doesn't
    abort on statement error, but this still exercises the recovery path.)
    """
    from app import config, db

    conn = db.connect(config.db_path())
    try:
        # Mirror production ordering: the aggregate billing row is written FIRST,
        # then per-call events are looped. A later event failure must not lose it.
        db.record_usage(conn, user_id="U-x", book_id="B-01", stage="ingest",
                        prompt_tokens=1, completion_tokens=1, cost_usd=0.5)
        db.record_usage_event(conn, user_id="U-x", book_id="B-01", stage=None,
                              model="broken", prompt_tokens=1, completion_tokens=1,
                              cost_usd=0.5)
        # Connection survived the failed insert: a valid write still commits.
        db.record_usage_event(conn, user_id="U-x", book_id="B-01", stage="translate",
                              model="good", operation="draft",
                              prompt_tokens=1, completion_tokens=1, cost_usd=0.5)
        conn.commit()
    finally:
        conn.close()

    conn = db.connect(config.db_path())
    try:
        bd = db.usage_events_breakdown(conn)
        models = {r["model"] for r in bd["by_model"]}
        assert "good" in models        # the valid event persisted
        assert "broken" not in models  # the failed event did not
        assert round(db.user_spend_this_month(conn, "U-x"), 2) == 0.50  # billing row intact
    finally:
        conn.close()

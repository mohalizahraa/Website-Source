"""Phase 3: per-user quotas + global spend cap.

The mock pipeline records no real cost, so spend is injected straight into the
usage ledger to exercise the enforcement/reporting paths deterministically.
"""
from __future__ import annotations

import io

import pytest


@pytest.fixture(autouse=True)
def _sync_and_caps(monkeypatch):
    # Run ingestion inline so no background worker touches the temp DB post-teardown.
    monkeypatch.setenv("HAYDARI_SYNC_INGEST", "1")
    yield


def _spend(user_id, amount, book_id="B-01"):
    from app import config, db

    conn = db.connect(config.db_path())
    try:
        db.record_usage(conn, user_id=user_id, book_id=book_id, stage="ingest",
                        prompt_tokens=1000, completion_tokens=500, cost_usd=amount)
        conn.commit()
    finally:
        conn.close()


def _make_creator(client, email="creator@h.local"):
    client.post("/api/auth/users", json={"email": email, "password": "password123", "role": "creator"})
    assert client.post("/api/auth/login", json={"email": email, "password": "password123"}).status_code == 200
    return client.get("/api/auth/me").json()


def test_usage_me_reports_default_cap_for_creator(client):
    from app import config

    _make_creator(client)
    j = client.get("/api/usage/me").json()
    assert j["spent_usd"] == 0
    assert j["enforced"] is True
    assert j["limit_usd"] == config.user_monthly_usd_default()
    assert j["remaining_usd"] == config.user_monthly_usd_default()


def test_usage_me_admin_is_not_personally_capped(client):
    j = client.get("/api/usage/me").json()  # conftest logs in as admin
    assert j["enforced"] is False
    assert j["limit_usd"] is None


def test_creator_ingest_blocked_over_personal_cap(client, monkeypatch):
    monkeypatch.setenv("HAYDARI_USER_MONTHLY_USD", "1.00")
    monkeypatch.setenv("HAYDARI_GLOBAL_MONTHLY_USD", "1000")
    me = _make_creator(client)
    up = client.post("/api/books/upload",
                     files={"files": ("b.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    bid = up.json()[0]["id"]
    # Under the cap → allowed.
    assert client.post(f"/api/books/{bid}/ingest").status_code == 200
    # Push this creator over their $1 cap → blocked with 402.
    _spend(me["id"], 1.50, bid)
    assert client.get("/api/usage/me").json()["remaining_usd"] == 0
    assert client.post(f"/api/books/{bid}/ingest").status_code == 402


def test_admin_exempt_from_personal_cap_but_not_global(client, monkeypatch):
    monkeypatch.setenv("HAYDARI_USER_MONTHLY_USD", "0.01")
    monkeypatch.setenv("HAYDARI_GLOBAL_MONTHLY_USD", "1000")
    admin = client.get("/api/auth/me").json()
    _spend(admin["id"], 5.00)  # far over the $0.01 personal cap
    # Admin/owner is not personally capped — still allowed.
    assert client.post("/api/books/B-01/ingest").status_code == 200
    # But the global cap is a backstop for everyone, admin included.
    monkeypatch.setenv("HAYDARI_GLOBAL_MONTHLY_USD", "1.00")
    assert client.post("/api/books/B-01/ingest").status_code == 402


def test_chat_blocked_when_global_cap_reached(client, monkeypatch):
    monkeypatch.setenv("HAYDARI_GLOBAL_MONTHLY_USD", "1.00")
    _spend("someone", 2.00)
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 402


def test_usage_overview_is_admin_only(client):
    j = client.get("/api/usage").json()
    assert "global_spent_usd" in j and "by_user" in j
    _make_creator(client, "c2@h.local")
    assert client.get("/api/usage").status_code == 403


def test_create_user_with_explicit_limit(client):
    from app import config, db

    r = client.post("/api/auth/users", json={
        "email": "lim@h.local", "password": "password123",
        "role": "creator", "monthly_usd_limit": 2.5})
    assert r.status_code == 200, r.text
    conn = db.connect(config.db_path())
    try:
        u = db.get_user_by_email(conn, "lim@h.local")
        assert float(u["monthly_usd_limit"]) == 2.5
    finally:
        conn.close()


def test_admin_can_edit_caps_at_runtime(client):
    # Change the global + default caps via the API; they take effect immediately.
    r = client.put("/api/settings", json={
        "global_monthly_usd": 123.0, "user_monthly_usd_default": 7.5, "max_pages_per_run": 33})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["global_monthly_usd"] == 123.0
    assert s["user_monthly_usd_default"] == 7.5
    assert s["max_pages_per_run"] == 33
    # A separate request opens a fresh DB connection; values must persist, not
    # merely live in process memory or the response that saved them.
    persisted = client.get("/api/settings").json()
    assert persisted["global_monthly_usd"] == 123.0
    assert persisted["user_monthly_usd_default"] == 7.5
    assert persisted["max_pages_per_run"] == 33
    # A newly-created creator with no explicit limit now sees the new default.
    _make_creator(client, "def@h.local")
    assert client.get("/api/usage/me").json()["limit_usd"] == 7.5


def test_settings_reject_non_finite(client):
    # JSON permits NaN/Infinity; a non-finite cap must be rejected, not stored
    # (a NaN cap would silently disable enforcement).
    for tok in ("NaN", "Infinity"):
        r = client.put("/api/settings", content=f'{{"global_monthly_usd": {tok}}}',
                       headers={"content-type": "application/json"})
        assert r.status_code == 400, (tok, r.text)


def test_off_disables_a_cap(client, monkeypatch):
    monkeypatch.setenv("HAYDARI_GLOBAL_MONTHLY_USD", "1.00")
    # 'off' stores no-cap; resolution returns null and spend never blocks globally.
    assert client.put("/api/settings", json={"global_monthly_usd": "off"}).status_code == 200
    assert client.get("/api/settings").json()["global_monthly_usd"] is None
    _spend("whoever", 99.0)
    # a creator can still ingest despite huge spend, because the global cap is off
    me = _make_creator(client, "off@h.local")
    up = client.post("/api/books/upload",
                     files={"files": ("b.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    assert client.post(f"/api/books/{up.json()[0]['id']}/ingest").status_code == 200


def test_settings_edit_is_admin_only(client):
    _make_creator(client, "notadmin@h.local")
    assert client.get("/api/settings").status_code == 403
    assert client.put("/api/settings", json={"global_monthly_usd": 1}).status_code == 403


def test_runtime_cap_override_blocks_ingest(client):
    # A creator under the default cap...
    me = _make_creator(client, "rt@h.local")
    up = client.post("/api/books/upload",
                     files={"files": ("b.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    bid = up.json()[0]["id"]
    _spend(me["id"], 3.0, bid)
    assert client.post(f"/api/books/{bid}/ingest").status_code == 200  # under $5 default
    # ...admin tightens the default cap to $1 at runtime -> now blocked.
    client.post("/api/auth/login", json={"email": "admin@haydari.local", "password": "changeme-admin"})
    assert client.put("/api/settings", json={"user_monthly_usd_default": 1.0}).status_code == 200
    client.post("/api/auth/login", json={"email": "rt@h.local", "password": "password123"})
    assert client.post(f"/api/books/{bid}/ingest").status_code == 402


def test_admin_lists_and_edits_user_limit(client):
    creator = _make_creator(client, "edit@h.local")
    client.post("/api/auth/login", json={"email": "admin@haydari.local", "password": "changeme-admin"})
    # list includes the creator with a null (default) limit
    users = client.get("/api/auth/users").json()
    row = next(u for u in users if u["id"] == creator["id"])
    assert row["monthly_usd_limit"] is None and "spent_usd" in row
    # set an explicit per-user limit
    r = client.patch(f"/api/auth/users/{creator['id']}", json={"monthly_usd_limit": 2.0})
    assert r.status_code == 200 and r.json()["monthly_usd_limit"] == 2.0
    # clearing it (null) falls back to the default
    r = client.patch(f"/api/auth/users/{creator['id']}", json={"monthly_usd_limit": None})
    assert r.json()["monthly_usd_limit"] is None


def test_created_account_can_sign_in_and_admin_can_change_its_role(client):
    created = client.post("/api/auth/users", json={
        "email": "managed@h.local",
        "password": "password123",
        "display_name": "Managed User",
        "role": "creator",
        "monthly_usd_limit": 2.5,
    })
    assert created.status_code == 200, created.text
    user_id = created.json()["id"]

    login = client.post("/api/auth/login", json={
        "email": "managed@h.local", "password": "password123"})
    assert login.status_code == 200 and login.json()["role"] == "creator"
    assert client.get("/api/usage/me").json()["limit_usd"] == 2.5
    assert client.get("/api/settings").status_code == 403

    client.post("/api/auth/login", json={
        "email": "admin@haydari.local", "password": "changeme-admin"})
    changed = client.patch(f"/api/auth/users/{user_id}", json={
        "role": "admin", "monthly_usd_limit": None})
    assert changed.status_code == 200, changed.text
    assert changed.json()["role"] == "admin"

    client.post("/api/auth/login", json={
        "email": "managed@h.local", "password": "password123"})
    assert client.get("/api/settings").status_code == 200


def test_only_admin_cannot_remove_their_own_admin_access(client):
    me = client.get("/api/auth/me").json()
    refused = client.patch(f"/api/auth/users/{me['id']}", json={"role": "creator"})
    assert refused.status_code == 409
    assert client.get("/api/auth/me").json()["role"] == "admin"


def test_worker_rechecks_quota_at_run_time(client, monkeypatch):
    # The request-time gate can't see spend from other still-queued runs; the
    # worker must re-check before spending. Drive it directly to prove it skips.
    monkeypatch.setenv("HAYDARI_USER_MONTHLY_USD", "1.00")
    monkeypatch.setenv("HAYDARI_GLOBAL_MONTHLY_USD", "1000")
    me = _make_creator(client, "wk@h.local")
    up = client.post("/api/books/upload",
                     files={"files": ("b.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    bid = up.json()[0]["id"]
    _spend(me["id"], 2.00, bid)  # now over the $1 cap

    from app import ingest
    ingest.enqueue(bid, {}, actor_id=me["id"])  # sync mode → runs inline, re-checks
    assert ingest.job_state(bid) == "blocked"
    # The book was released back to a non-processing state; nothing was ingested.
    assert client.get(f"/api/books/{bid}/status").json()["status"] in ("uploaded", "in_review")


def test_spend_breakdown_and_totals(client):
    from app import config, db

    admin = client.get("/api/auth/me").json()
    _spend(admin["id"], 0.75)
    _spend(admin["id"], 0.25)
    conn = db.connect(config.db_path())
    try:
        assert round(db.user_spend_this_month(conn, admin["id"]), 2) == 1.00
        assert round(db.global_spend_this_month(conn), 2) == 1.00
        by_user = db.spend_by_user_this_month(conn)
        assert any(r["user_id"] == admin["id"] and round(r["cost_usd"], 2) == 1.00 for r in by_user)
    finally:
        conn.close()

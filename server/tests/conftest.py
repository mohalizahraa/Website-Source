"""Pytest fixtures — every test runs offline against a throwaway SQLite DB."""
from __future__ import annotations

import os
import sys
import tempfile

import pytest

# Make the `app` and `seed` modules importable (server/ on path).
_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _SERVER_DIR)


@pytest.fixture()
def client():
    """A TestClient bound to a fresh, seeded temp database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.environ["HAYDARI_DB"] = path
    # Tests are strictly offline: never let a real key (loaded from server/.env)
    # push ingestion onto the network. Force the deterministic mock pipeline.
    os.environ.pop("OPENROUTER_API_KEY", None)
    os.environ["HAYDARI_PIPELINE"] = "mock"

    # Import lazily so config picks up HAYDARI_DB, and re-seed per test.
    from app import config, db  # noqa: WPS433
    import seed as seed_module  # noqa: WPS433

    assert config.db_path() == path
    conn = db.connect(path)
    seed_module.seed(conn)
    conn.close()

    from app.main import app  # noqa: WPS433
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        # Startup bootstraps an admin (admin@haydari.local / changeme-admin);
        # log in so the authenticated routes work. The client persists the
        # session cookie across requests. Tests that need anonymous behaviour
        # can clear c.cookies themselves.
        r = c.post("/api/auth/login",
                   json={"email": "admin@haydari.local", "password": "changeme-admin"})
        assert r.status_code == 200, r.text
        yield c

    os.remove(path)

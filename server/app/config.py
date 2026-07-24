"""Runtime configuration, read from environment variables.

Everything here has a working default so the whole system runs offline with no
setup. Real deployments override via env vars.
"""
from __future__ import annotations

import os
from pathlib import Path

# Repository-relative default DB location: server/haydari.db
_SERVER_DIR = Path(__file__).resolve().parent.parent


def db_path() -> str:
    """Absolute path to the SQLite database file."""
    return os.environ.get("HAYDARI_DB", str(_SERVER_DIR / "haydari.db"))


def schema_path() -> str:
    """Absolute path to the authoritative schema.sql."""
    return os.environ.get("HAYDARI_SCHEMA", str(_SERVER_DIR / "db" / "schema.sql"))


def cors_origins() -> list[str]:
    """Allowed CORS origins for the Next.js frontend (comma-separated env)."""
    raw = os.environ.get(
        "HAYDARI_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    return [o.strip() for o in raw.split(",") if o.strip()]


# Embedding vector dimensionality for the mock/real embedders.
EMBED_DIM = int(os.environ.get("HAYDARI_EMBED_DIM", "64"))


def upload_dir() -> str:
    """Directory where uploaded source PDFs are stored."""
    path = os.environ.get(
        "HAYDARI_UPLOAD_DIR", str(_SERVER_DIR / "data" / "uploads")
    )
    os.makedirs(path, exist_ok=True)
    return path


def sync_ingest() -> bool:
    """When true, the ingest pipeline runs inline (used by tests) instead of
    on the background worker thread."""
    return os.environ.get("HAYDARI_SYNC_INGEST", "0") in ("1", "true", "True")

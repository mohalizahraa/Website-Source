"""Runtime configuration, read from environment variables.

Everything here has a working default so the whole system runs offline with no
setup. Real deployments override via env vars.
"""
from __future__ import annotations

import os
from pathlib import Path

# Repository-relative default DB location: server/haydari.db
_SERVER_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Load ``server/.env`` into the process environment (no dependency).

    Reads simple ``KEY=VALUE`` lines (``#`` comments and blanks ignored). An
    already-set environment variable always wins, so real env overrides the
    file. This is how API keys (OPENROUTER_API_KEY, …) reach both the server
    and the translation/OCR pipeline, which run in the same process.
    """
    env_file = _SERVER_DIR / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()


def db_path() -> str:
    """Absolute path to the SQLite database file."""
    return os.environ.get("HAYDARI_DB", str(_SERVER_DIR / "haydari.db"))


def schema_path() -> str:
    """Absolute path to the authoritative SQLite schema.sql."""
    return os.environ.get("HAYDARI_SCHEMA", str(_SERVER_DIR / "db" / "schema.sql"))


def schema_path_pg() -> str:
    """Absolute path to the PostgreSQL schema (used when DATABASE_URL is set)."""
    return os.environ.get("HAYDARI_SCHEMA_PG", str(_SERVER_DIR / "db" / "schema_pg.sql"))


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


def _usd_env(name: str, default: str) -> float | None:
    """Read a USD cap from the environment. An empty value DISABLES the cap
    (returns None); an unset value uses ``default``."""
    raw = os.environ.get(name, default).strip()
    if raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return float(default)


def user_monthly_usd_default() -> float | None:
    """Default per-user monthly spend cap (USD). Overridable per user via
    users.monthly_usd_limit. Set HAYDARI_USER_MONTHLY_USD='' to disable."""
    return _usd_env("HAYDARI_USER_MONTHLY_USD", "5.00")


def global_monthly_usd() -> float | None:
    """System-wide monthly spend cap (USD) across all users — the backstop so a
    misconfigured account can't run up the owner's whole bill. Set
    HAYDARI_GLOBAL_MONTHLY_USD='' to disable."""
    return _usd_env("HAYDARI_GLOBAL_MONTHLY_USD", "50.00")

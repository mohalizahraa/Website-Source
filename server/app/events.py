"""Append-only event log writer.

Called on every mutation to record audit / provenance. Never updated or deleted.
"""
from __future__ import annotations

import json
from typing import Any

from . import db


def write_event(
    conn,
    *,
    actor: str | None,
    type: str,
    payload: dict[str, Any] | None = None,
) -> int:
    # Uses the cross-backend insert helper so it works on both SQLite and
    # Postgres (psycopg cursors have no ``lastrowid``; they use RETURNING).
    return db._insert_id(
        conn,
        "INSERT INTO events (actor, type, payload_json) VALUES (?, ?, ?)",
        (actor, type, json.dumps(payload or {}, ensure_ascii=False)),
    )

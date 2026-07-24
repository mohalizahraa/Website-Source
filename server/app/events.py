"""Append-only event log writer.

Called on every mutation to record audit / provenance. Never updated or deleted.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any


def write_event(
    conn: sqlite3.Connection,
    *,
    actor: str | None,
    type: str,
    payload: dict[str, Any] | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO events (actor, type, payload_json) VALUES (?, ?, ?)",
        (actor, type, json.dumps(payload or {}, ensure_ascii=False)),
    )
    return int(cur.lastrowid)

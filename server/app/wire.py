"""Serialize DB rows into the exact Segment JSON wire format (ARCHITECTURE.md).

    {
      "id": "B-XX:042:03", "book_id": "B-XX", "page": 42, "order": 3,
      "kind": "body", "anchor": null,
      "ar": "...", "en": "...",
      "engine": "claude-cloud", "confidence": 0.61,
      "qa": { "bt_sim": 0.82, "self_consistency": 0.71, "judge_score": 0.68,
              "judge_note": "...", "footnote_ok": true },
      "alternatives": ["...", "..."],
      "status": "needs_review"
    }
"""
from __future__ import annotations

import json


def _as_bool(v) -> bool | None:
    if v is None:
        return None
    return bool(v)


def _alternatives(raw) -> list:
    if not raw:
        return []
    try:
        val = json.loads(raw)
        return val if isinstance(val, list) else []
    except (ValueError, TypeError):
        return []


def segment_to_wire(seg: dict) -> dict:
    """Map a segments-table row (as dict) to the API wire format."""
    en = seg.get("en_current") or seg.get("en_draft")
    return {
        "id": seg["id"],
        "book_id": seg["book_id"],
        "page": seg["page_no"],
        "order": seg["seg_order"],
        "kind": seg["kind"],
        "anchor": seg.get("anchor"),
        "ar": seg["ar"],
        "en": en,
        # Original model output stays available after a saved edit so the UI
        # can render tracked changes and approvals can create draft→final
        # training pairs after a leave/reload cycle.
        "en_draft": seg.get("en_draft"),
        "engine": seg.get("engine"),
        "confidence": seg.get("confidence"),
        "qa": {
            "bt_sim": seg.get("bt_sim"),
            "self_consistency": seg.get("self_consistency"),
            "judge_score": seg.get("judge_score"),
            "judge_note": seg.get("judge_note"),
            "footnote_ok": _as_bool(seg.get("footnote_ok")),
        },
        "alternatives": _alternatives(seg.get("alternatives")),
        "status": seg["status"],
    }

"""In-process token / cost recorder for measuring a pipeline run.

Adapters call :func:`record` after every model response. OpenRouter returns the
exact ``cost`` (USD) per call when we ask for it, so this reports *real* spend,
not an estimate. Use it around a run:

    from pipeline.translate import usage
    usage.reset()
    ...run the pipeline...
    print(usage.summary())

Simple module-level state — intended for measurement / single-run scripts, not
concurrent production accounting.
"""

from __future__ import annotations

import threading

_LOCK = threading.Lock()
_RECORDS: list[dict] = []


def reset() -> None:
    with _LOCK:
        _RECORDS.clear()


def record(*, stage: str, model: str, prompt_tokens=0, completion_tokens=0, cost=None,
           operation: str | None = None) -> None:
    with _LOCK:
        _RECORDS.append({
            "stage": stage,
            "model": model,
            "operation": operation,
            "prompt_tokens": int(prompt_tokens or 0),
            "completion_tokens": int(completion_tokens or 0),
            "cost": float(cost) if cost is not None else None,
        })


def records() -> list[dict]:
    with _LOCK:
        return list(_RECORDS)


def summary() -> dict:
    recs = records()
    pt = sum(r["prompt_tokens"] for r in recs)
    ct = sum(r["completion_tokens"] for r in recs)
    known = [r["cost"] for r in recs if r["cost"] is not None]

    by_stage: dict[str, dict] = {}
    by_model: dict[str, dict] = {}
    for r in recs:
        for key, bucket in (("stage", by_stage), ("model", by_model)):
            b = bucket.setdefault(r[key], {"calls": 0, "prompt": 0, "completion": 0,
                                           "cost": 0.0, "cost_known": True})
            b["calls"] += 1
            b["prompt"] += r["prompt_tokens"]
            b["completion"] += r["completion_tokens"]
            if r["cost"] is None:
                b["cost_known"] = False
            else:
                b["cost"] += r["cost"]

    return {
        "calls": len(recs),
        "prompt_tokens": pt,
        "completion_tokens": ct,
        "total_tokens": pt + ct,
        "cost_usd": round(sum(known), 6) if known else None,
        "cost_complete": len(known) == len(recs) and recs != [],
        "by_stage": by_stage,
        "by_model": by_model,
    }

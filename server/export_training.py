"""Export the human-review signal as fine-tuning datasets.

Every approval writes a `corrections` row: en_before = the model's ORIGINAL
draft, en_after = your approved text. That's the training signal. This turns it
into two datasets ready for fine-tuning a local model on *your* voice:

* **SFT** (supervised) — chat examples whose target is your approved English,
  using the same system prompt inference uses. Teaches the model to produce
  translations like the ones you approved.
* **DPO / preference** — (prompt, chosen=your edit, rejected=model draft) pairs,
  only where you actually changed the draft. Teaches the model to prefer your
  edits over its own first attempt.

Plus the termbase as a glossary. Everything is derived from approved work, so it
grows as you review more books.

    python server/export_training.py                 # -> ./training/*.jsonl
    python server/export_training.py --out /path/dir
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SERVER_DIR.parent
sys.path.insert(0, str(_SERVER_DIR))
sys.path.insert(0, str(_REPO_ROOT))

from app import config, db  # noqa: E402

try:
    from pipeline.translate.prompt import SYSTEM_PREAMBLE  # noqa: E402
except Exception:  # pragma: no cover - keep export usable even if pipeline moves
    SYSTEM_PREAMBLE = "Translate the Arabic into faithful, scholarly English."


def _rows(conn):
    """Approved corrections joined to their segment's Arabic."""
    return conn.execute(
        """
        SELECT c.en_before, c.en_after, s.ar, s.kind
        FROM corrections c
        JOIN segments s ON s.id = c.segment_id
        WHERE c.en_after IS NOT NULL AND TRIM(c.en_after) != ''
              AND s.ar IS NOT NULL AND TRIM(s.ar) != ''
        ORDER BY c.id
        """
    ).fetchall()


def export(out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    conn = db.connect()
    db.init_db(conn)
    try:
        rows = _rows(conn)
        sft_path = out_dir / "sft.jsonl"
        dpo_path = out_dir / "dpo.jsonl"
        glossary_path = out_dir / "glossary.json"

        n_sft = n_dpo = 0
        with open(sft_path, "w", encoding="utf-8") as sft, open(dpo_path, "w", encoding="utf-8") as dpo:
            for r in rows:
                ar, approved, draft = r["ar"], r["en_after"], r["en_before"]
                user = f"Translate the following Arabic into English:\n\n{ar}"
                sft.write(json.dumps({
                    "messages": [
                        {"role": "system", "content": SYSTEM_PREAMBLE},
                        {"role": "user", "content": user},
                        {"role": "assistant", "content": approved},
                    ]
                }, ensure_ascii=False) + "\n")
                n_sft += 1
                # Preference pair only where the human changed the draft.
                if draft and draft.strip() and draft.strip() != approved.strip():
                    dpo.write(json.dumps({
                        "prompt": user,
                        "chosen": approved,
                        "rejected": draft,
                    }, ensure_ascii=False) + "\n")
                    n_dpo += 1

        terms = conn.execute(
            "SELECT term_ar, term_en, note, scope FROM termbase ORDER BY id"
        ).fetchall()
        glossary = [dict(t) for t in terms]
        glossary_path.write_text(json.dumps(glossary, ensure_ascii=False, indent=2), encoding="utf-8")

        return {
            "sft_examples": n_sft, "sft_file": str(sft_path),
            "dpo_pairs": n_dpo, "dpo_file": str(dpo_path),
            "glossary_terms": len(glossary), "glossary_file": str(glossary_path),
        }
    finally:
        conn.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Export review corrections as fine-tuning datasets.")
    ap.add_argument("--out", default=str(_REPO_ROOT / "training"), help="output directory")
    args = ap.parse_args(argv)
    result = export(Path(args.out))
    print(json.dumps(result, indent=2))
    if result["sft_examples"] == 0:
        print("\nNo approved corrections yet — approve some segments in the "
              "review workbench first, then re-run.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

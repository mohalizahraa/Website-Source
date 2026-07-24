"""Token-level diff between the pre-edit and post-edit English.

The diff is the concrete, structured form of a reviewer's tracked change and is
stored on every correction row (the training signal).
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

_TOKEN_RE = re.compile(r"\s+|\S+")


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall(text or "")


def compute_diff(before: str, after: str) -> dict:
    """Return a structured token-level diff.

    Shape::

        {
          "ops": [ {"op": "equal|insert|delete|replace",
                    "before": "...", "after": "..."}, ... ],
          "changed": bool,
          "added_tokens": int,
          "removed_tokens": int
        }
    """
    a = _tokens(before)
    b = _tokens(after)
    sm = SequenceMatcher(a=a, b=b, autojunk=False)
    ops: list[dict] = []
    added = 0
    removed = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        before_txt = "".join(a[i1:i2])
        after_txt = "".join(b[j1:j2])
        if tag == "equal":
            ops.append({"op": "equal", "before": before_txt, "after": after_txt})
        elif tag == "insert":
            added += j2 - j1
            ops.append({"op": "insert", "before": "", "after": after_txt})
        elif tag == "delete":
            removed += i2 - i1
            ops.append({"op": "delete", "before": before_txt, "after": ""})
        else:  # replace
            added += j2 - j1
            removed += i2 - i1
            ops.append({"op": "replace", "before": before_txt, "after": after_txt})
    changed = any(o["op"] != "equal" for o in ops)
    return {
        "ops": ops,
        "changed": changed,
        "added_tokens": added,
        "removed_tokens": removed,
    }

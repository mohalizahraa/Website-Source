"""Sacred-text detect-and-replace.

For ``kind == "sacred"`` segments the pipeline must NOT machine-translate.
Instead it retrieves the verified canonical Arabic + approved English from the
:class:`CanonicalDB` and substitutes them, always emitting both the Arabic and
the English (ARCHITECTURE.md § translate; RESEARCH.md finding #3). This is the
single most important religious-accuracy step.
"""

from __future__ import annotations

from typing import Optional

from .interfaces import CanonicalDB
from .types import CanonicalEntry, Segment


def format_bilingual(entry: CanonicalEntry) -> str:
    """Render a canonical passage as Arabic + English + reference."""
    return f"{entry.ar_canonical}\n{entry.en_approved} ({entry.ref})"


def substitute_sacred(
    seg: Segment,
    db: CanonicalDB,
    *,
    min_score: float = 0.6,
    mutate: bool = True,
) -> Optional[dict]:
    """Attempt canonical substitution for a sacred segment.

    On a hit, returns a result dict ``{en, engine, confidence}`` where ``en``
    contains both the canonical Arabic and the approved English, ``engine`` is
    ``"canonical"`` and ``confidence`` is the match score. When ``mutate`` is
    true, the segment's ``ar`` is replaced with the verified canonical Arabic
    (so downstream storage/publishing carry the corrected source) and the
    matched entry is recorded on the segment for provenance.

    Returns ``None`` when no entry clears ``min_score`` — the caller then falls
    back to normal (audited) machine translation.
    """
    entry = db.match(seg.get("ar", ""), min_score=min_score)
    if entry is None:
        return None

    if mutate:
        seg["ar"] = entry.ar_canonical
        seg["canonical_ref"] = entry.ref

    return {
        "en": format_bilingual(entry),
        "engine": "canonical",
        "confidence": entry.score,
    }

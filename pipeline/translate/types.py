"""Core data types for the translation stage.

These are intentionally lightweight dataclasses. On the wire, segments and
context travel as plain dicts (see ``ARCHITECTURE.md`` → "Segment JSON"); the
helpers here just give the internal code readable, typed handles.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Segment / context wire shapes (documented, not enforced — we accept dicts)
# ---------------------------------------------------------------------------

# A *segment* dict looks like (subset of the DB row / API wire format):
#   {
#     "id": "B-XX:042:03", "book_id": "B-XX", "page": 42, "order": 3,
#     "kind": "body" | "footnote" | "sacred",
#     "anchor": None | "FN-3",
#     "ar": "…arabic…",
#     "doctrinal": False,          # optional hint used by the router
#   }
#
# A *context* dict (the second argument to translate_segment):
#   {
#     "glossary":   [ {term_ar, term_en, note?, transliterate?}, … ],
#     "tm_matches": [ {ar, en_approved, score}, … ],   # sorted, best first
#     "prev_en":    str | None,
#     "next_en":    str | None,
#     "style_rules":[ "rule text", … ],
#   }

Segment = Dict[str, Any]
Context = Dict[str, Any]


@dataclass
class TranslationResult:
    """What a Translator returns from a draft or refine pass."""

    text: str
    confidence: float
    notes: str = ""

    def clamp(self) -> "TranslationResult":
        self.confidence = max(0.0, min(1.0, float(self.confidence)))
        return self


@dataclass
class CanonicalEntry:
    """A verified Qurʾān/Hadith record from the canonical DB."""

    ref: str  # e.g. "Qurʾān 57:3" or "Ṣaḥīḥ al-Bukhārī 1"
    kind: str  # "quran" | "hadith"
    ar_canonical: str  # fully-vocalised, verified Arabic
    en_approved: str  # approved English rendering
    score: float = 1.0  # match confidence (filled in by the DB)


@dataclass
class RouteDecision:
    """The router's choice for a segment, with a human-readable reason."""

    engine: str  # concrete engine name that will run / ran
    tier: str  # "canonical" | "tm-exact" | "local" | "cloud"
    reason: str
    escalated: bool = False


@dataclass
class Prompt:
    """A rendered prompt with separate system / user parts."""

    system: str
    user: str

    def render(self) -> str:
        return f"{self.system}\n\n{self.user}"

    # Convenience so tests / callers can do `term in prompt`.
    def __contains__(self, needle: str) -> bool:  # pragma: no cover - trivial
        return needle in self.render()

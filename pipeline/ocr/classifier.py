"""Structure / classification step.

Turns raw :class:`~pipeline.ocr.engines.OcrBlock` s into ordered, typed
segments that satisfy the ARCHITECTURE.md contract:

    { order, kind, ar, anchor }   with kind in {body, footnote, sacred}

Responsibilities:

1. Split body vs footnote using the footnote divider region.
2. Rewrite in-body footnote reference markers ``(١)`` / ``[1]`` into the
   indexed, positionally-verifiable anchor scheme ``[[FN-n]]``.
3. Match each footnote block to its number so its segment carries
   ``anchor = "FN-n"`` (the same ``n`` as the body reference).
4. Flag sacred segments (Qurʾan / Hadith) with a transparent heuristic.

Everything here is pure and unit-testable; no I/O, no models.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .engines import REGION_DIVIDER, REGION_NOTES, OcrBlock

# Arabic-Indic digits U+0660..U+0669 -> ASCII.
_AR_DIGITS = {ord(c): str(i) for i, c in enumerate("٠١٢٣٤٥٦٧٨٩")}

# A footnote reference / label marker: a 1-3 digit number in () or [] brackets,
# e.g. (١)  [12]  (3). Kept deliberately close to the legacy books/ regex.
_MARKER = re.compile(r"[\[(]\s*([٠-٩0-9]{1,3})\s*[\])]")
# A leading marker at the start of a footnote line.
_LEADING_MARKER = re.compile(r"^\s*[\[(]?\s*([٠-٩0-9]{1,3})\s*[\])]?\s*")
# An already-formed indexed anchor, possibly with Arabic-Indic digits, e.g.
# [[FN-٣]] — emitted by some VLMs. Normalised to ASCII so all anchors line up.
_ANCHOR = re.compile(r"\[\[FN-([٠-٩0-9]{1,3})\]\]")

# --- Sacred-text heuristics ------------------------------------------------ #
# Qurʾan cues: quotation verbs, ornate verse brackets ﴿ ﴾, and sura citations.
_QURAN_MARKERS = (
    "قال الله تعالى",
    "قال تعالى",
    "قوله تعالى",
    "قال عز وجل",
    "قال سبحانه",
    "﴿",
    "﴾",
)
# A sura citation like [الحديد: ٣] or (البقرة: ٢٥٥).
_SURA_CITATION = re.compile(r"[\[(][^\]\)]{2,30}[:：][\s٠-٩0-9]{1,3}[\])]")
# Hadith cues. Deliberately strong/specific (an explicit Prophetic attribution
# or the ﷺ eulogy) so meta-discussion like "أهل الحديث" / "هذا الحديث" is NOT
# mistaken for sacred text.
_HADITH_MARKERS = (
    "قال النبي",
    "قال رسول الله",
    "صلى الله عليه وسلم",
    "صلّى الله عليه وسلّم",
    "عن النبي",
    "عن رسول الله",
)
# Tiny canonical index (a real deployment resolves against the Qurʾan/Hadith DB
# via embedding similarity per ARCHITECTURE.md). A substring hit is enough here.
_KNOWN_VERSES = {
    "57:3": "هو الأول والآخر والظاهر والباطن",
}

KIND_BODY = "body"
KIND_FOOTNOTE = "footnote"
KIND_SACRED = "sacred"


@dataclass
class Segment:
    """A classified, ordered segment (superset of the wire contract)."""

    order: int
    kind: str  # body | footnote | sacred
    ar: str
    anchor: str | None = None
    confidence: float = 1.0
    sacred_kind: str | None = None  # quran | hadith | None (diagnostic only)

    def to_contract(self) -> dict:
        """The exact {order, kind, ar, anchor} shape the pipeline promises,
        plus confidence for the router."""
        return {
            "order": self.order,
            "kind": self.kind,
            "ar": self.ar,
            "anchor": self.anchor,
            "confidence": round(self.confidence, 4),
        }


def _to_ascii_digits(text: str) -> str:
    return text.translate(_AR_DIGITS)


def normalize_markers(text: str) -> str:
    """Rewrite in-body footnote references to ASCII ``[[FN-n]]``.

    Handles both bare markers ``(١)`` / ``[3]`` and already-formed anchors that
    carry Arabic-Indic digits ``[[FN-٣]]`` (normalised to ASCII), so every
    emitted anchor matches downstream QA's ASCII ``[[FN-n]]`` pattern and body
    numbering lines up with footnote numbering.
    """

    def anchor_repl(m: re.Match) -> str:
        return f"[[FN-{int(_to_ascii_digits(m.group(1)))}]]"

    def marker_repl(m: re.Match) -> str:
        return f"[[FN-{int(_to_ascii_digits(m.group(1)))}]]"

    # Normalise pre-formed anchors first so the marker pass never touches them.
    text = _ANCHOR.sub(anchor_repl, text)
    return _MARKER.sub(marker_repl, text)


def body_anchor_refs(ar: str) -> list[int]:
    """Return the numeric ids of every ``[[FN-n]]`` reference in body text."""
    return [int(_to_ascii_digits(m.group(1))) for m in _ANCHOR.finditer(ar)]


def detect_sacred(text: str) -> str | None:
    """Return 'quran', 'hadith', or None using transparent heuristics."""
    # Known canonical verse text wins first.
    stripped = _strip_tashkeel(text)
    for ref, needle in _KNOWN_VERSES.items():
        if _strip_tashkeel(needle) in stripped:
            return "quran"
    if any(marker in text for marker in _QURAN_MARKERS):
        return "quran"
    if _SURA_CITATION.search(text) and ("﴿" in text or "الآية" in text):
        return "quran"
    if any(marker in text for marker in _HADITH_MARKERS):
        return "hadith"
    return None


# Combining marks used for Arabic tashkeel (harakat) — stripped when comparing
# against the canonical index so diacritic noise never blocks a match.
_TASHKEEL = re.compile(r"[ؗ-ًؚ-ْٰۖ-ۭ]")


def _strip_tashkeel(text: str) -> str:
    return _TASHKEEL.sub("", text)


def classify(blocks: list[OcrBlock]) -> list[Segment]:
    """Split, anchor, and flag blocks into ordered segments.

    Reading order: body/sacred segments first (top of page), then footnote
    segments (bottom of page), matching how the page is read.
    """
    body_blocks: list[OcrBlock] = []
    note_blocks: list[OcrBlock] = []
    in_notes = False

    for block in blocks:
        if block.region == REGION_DIVIDER:
            in_notes = True
            continue
        if block.region == REGION_NOTES or in_notes:
            note_blocks.append(block)
        else:
            body_blocks.append(block)

    segments: list[Segment] = []
    order = 0

    for block in body_blocks:
        sacred_kind = detect_sacred(block.text)
        ar = normalize_markers(block.text)
        kind = KIND_SACRED if sacred_kind else KIND_BODY
        segments.append(
            Segment(
                order=order,
                kind=kind,
                ar=ar,
                anchor=None,
                confidence=block.confidence,
                sacred_kind=sacred_kind,
            )
        )
        order += 1

    for block in note_blocks:
        anchor, text = _split_footnote_marker(block.text)
        segments.append(
            Segment(
                order=order,
                kind=KIND_FOOTNOTE,
                ar=text,
                anchor=anchor,
                confidence=block.confidence,
            )
        )
        order += 1

    return segments


def _split_footnote_marker(text: str) -> tuple[str | None, str]:
    """Extract the leading footnote number, returning ('FN-n', clean_text)."""
    m = _LEADING_MARKER.match(text)
    if not m:
        return None, text.strip()
    n = int(_to_ascii_digits(m.group(1)))
    return f"FN-{n}", text[m.end():].strip()


def check_anchors(segments: list[Segment]) -> dict:
    """Cross-check body ``[[FN-n]]`` references against footnote anchors.

    Numbering is authored by hand on the source page, so OCR can pick up a page
    where a body reference has no matching footnote (or vice versa) — a silent
    off-by-one that would corrupt translation/publishing. We surface it instead
    of emitting mismatched numbering unnoticed.

    Returns a diagnostic dict::

        {
          "ok": bool,
          "body_refs": [ids...],          # numeric ids referenced in body
          "footnote_anchors": [ids...],   # numeric ids of footnote segments
          "body_orphans": [ids...],       # refs with no footnote
          "footnote_orphans": [ids...],   # footnotes with no body ref
          "duplicate_footnotes": [ids...],# same anchor on 2+ footnote segments
        }
    """
    body_refs: list[int] = []
    footnote_ids: list[int] = []
    for seg in segments:
        if seg.kind == KIND_FOOTNOTE:
            if seg.anchor and seg.anchor.startswith("FN-"):
                footnote_ids.append(int(seg.anchor[3:]))
        else:
            body_refs.extend(body_anchor_refs(seg.ar))

    body_set = set(body_refs)
    footnote_set = set(footnote_ids)
    duplicates = sorted({n for n in footnote_ids if footnote_ids.count(n) > 1})
    body_orphans = sorted(body_set - footnote_set)
    footnote_orphans = sorted(footnote_set - body_set)
    return {
        "ok": not (body_orphans or footnote_orphans or duplicates),
        "body_refs": sorted(body_set),
        "footnote_anchors": sorted(footnote_set),
        "body_orphans": body_orphans,
        "footnote_orphans": footnote_orphans,
        "duplicate_footnotes": duplicates,
    }

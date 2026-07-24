"""Markdown emitter.

Renders classified segments to Markdown while:

* preserving reading order (body/sacred first, footnotes at the bottom);
* keeping the indexed ``[[FN-n]]`` anchors intact in body text;
* emitting each footnote line prefixed with its own ``[[FN-n]]`` anchor so the
  reference and its target are positionally linkable (QA can verify each anchor
  survives translation and stays attached to the right sentence);
* leaving RTL Arabic text byte-for-byte intact (no reshaping/reordering — the
  characters are already logical-order Unicode; downstream renderers apply the
  bidi algorithm).

Sacred segments are rendered as Markdown block quotes so Qurʾan/Hadith stand
out visually and are trivial to detect downstream.
"""

from __future__ import annotations

from .classifier import KIND_FOOTNOTE, KIND_SACRED, Segment

# U+200F RIGHT-TO-LEFT MARK — prefixes each line so mixed Arabic/anchor text
# renders in the correct base direction without altering the Arabic itself.
RLM = "‏"


def emit_markdown(segments: list[Segment], *, rtl_mark: bool = True) -> str:
    """Render segments to reading-ordered Markdown with ``[[FN-n]]`` anchors."""
    prefix = RLM if rtl_mark else ""
    body_lines: list[str] = []
    footnote_lines: list[str] = []

    for seg in segments:
        if seg.kind == KIND_FOOTNOTE:
            anchor = seg.anchor or "FN-?"
            footnote_lines.append(f"{prefix}[[{anchor}]] {seg.ar}")
        elif seg.kind == KIND_SACRED:
            body_lines.append(f"{prefix}> {seg.ar}")
        else:  # body
            body_lines.append(f"{prefix}{seg.ar}")

    parts = ["\n\n".join(body_lines)]
    if footnote_lines:
        parts.append("---")
        parts.append("\n\n".join(footnote_lines))
    return "\n\n".join(p for p in parts if p).strip() + "\n"

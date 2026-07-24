"""Prompt construction.

Builds the instruction + context prompt handed to a Translator. Follows the
9-point Al-Shamela deployment spec (Khair & Sawalha, COLING-Rel 2025) and
injects the knowledge layer: termbase, top TM fuzzy matches, previous/next
English for cross-segment coherence, and style rules.
"""

from __future__ import annotations

from typing import List

from .types import Context, Prompt, Segment

# The 9-point prompt spirit, rendered as an explicit rule list.
NINE_POINT_RULES: List[str] = [
    "1. You are a proficient Arabic-to-English translator of classical Islamic "
    "scholarly texts. Translate faithfully and idiomatically.",
    "2. Do NOT transliterate. Render meaning in English. Transliterate a term "
    "ONLY when an explicit term rule below says so.",
    "3. Use established, standard Islamic terminology (e.g. tawḥīd → 'the "
    "oneness of God'); prefer the termbase renderings given below.",
    "4. Keep the English readable and natural while preserving the precise, "
    "truthful sense of the source — no additions, no omissions.",
    "5. For Qurʾān and Hadith, output BOTH the Arabic source and the English "
    "translation (these are normally handled by canonical substitution).",
    "6. Preserve document formatting: paragraphs, lists, and line structure.",
    "7. Render headings as headings (bold); keep chapter and page breaks.",
    "8. Preserve every footnote anchor of the form [[FN-n]] EXACTLY and keep it "
    "attached to the same sentence it marks in the Arabic.",
    "9. Output only the English translation (plus Arabic for sacred passages). "
    "Do not add commentary, notes, or explanations of your own.",
]

SYSTEM_PREAMBLE = (
    "You translate classical Arabic Islamic scholarship into English for a "
    "scholarly review workbench. Follow every rule exactly.\n\n"
    + "\n".join(NINE_POINT_RULES)
)


def _glossary_block(context: Context) -> str:
    glossary = context.get("glossary") or []
    if not glossary:
        return ""
    lines = ["TERMBASE — you MUST use these renderings when the term appears:"]
    for entry in glossary:
        term_ar = entry.get("term_ar", "")
        term_en = entry.get("term_en", "")
        note = entry.get("note")
        if entry.get("transliterate"):
            lines.append(
                f"  - {term_ar} → {term_en}  (transliterate this term; rule override)"
            )
        else:
            suffix = f"  — {note}" if note else ""
            lines.append(f"  - {term_ar} → {term_en}{suffix}")
    return "\n".join(lines)


def _tm_block(context: Context, top_k: int = 3) -> str:
    matches = context.get("tm_matches") or []
    if not matches:
        return ""
    # Highest-scoring first; caller usually pre-sorts but we don't rely on it.
    ranked = sorted(matches, key=lambda m: m.get("score", 0.0), reverse=True)[:top_k]
    lines = [
        "TRANSLATION MEMORY — approved renderings of similar past segments "
        "(use for consistency of terminology and voice; adapt as needed):"
    ]
    for m in ranked:
        score = m.get("score", 0.0)
        lines.append(f"  - AR: {m.get('ar', '')}")
        lines.append(f"    EN (approved, {score:.0%} match): {m.get('en_approved', '')}")
    return "\n".join(lines)


def _coherence_block(context: Context) -> str:
    prev_en = context.get("prev_en")
    next_en = context.get("next_en")
    if not prev_en and not next_en:
        return ""
    lines = ["SURROUNDING CONTEXT — for coherent flow across segments (do NOT retranslate these):"]
    if prev_en:
        lines.append(f"  Previous segment (English): {prev_en}")
    if next_en:
        lines.append(f"  Next segment (English): {next_en}")
    return "\n".join(lines)


def _style_block(context: Context) -> str:
    rules = context.get("style_rules") or []
    if not rules:
        return ""
    lines = ["STYLE RULES — apply throughout:"]
    lines.extend(f"  - {r}" for r in rules)
    return "\n".join(lines)


class PromptBuilder:
    """Assembles a :class:`Prompt` from a segment + retrieval context."""

    def __init__(self, tm_top_k: int = 3):
        self.tm_top_k = tm_top_k

    def build(self, seg: Segment, context: Context) -> Prompt:
        blocks = [
            _glossary_block(context),
            _tm_block(context, self.tm_top_k),
            _coherence_block(context),
            _style_block(context),
        ]
        context_section = "\n\n".join(b for b in blocks if b)

        kind = seg.get("kind", "body")
        anchor = seg.get("anchor")
        seg_notes = [f"Segment kind: {kind}."]
        if anchor:
            seg_notes.append(
                f"This is footnote {anchor}; keep its content self-contained."
            )

        user_parts = []
        if context_section:
            user_parts.append(context_section)
        user_parts.append(" ".join(seg_notes))
        user_parts.append("Translate the following Arabic into English:")
        user_parts.append(seg.get("ar", ""))

        return Prompt(system=SYSTEM_PREAMBLE, user="\n\n".join(user_parts))

    def build_refine(self, seg: Segment, context: Context, draft: str) -> Prompt:
        """Prompt for the second (critique/refine) pass."""
        base = self.build(seg, context)
        critique = (
            "SECOND PASS — critique then improve the draft translation below. "
            "Check: terminology matches the termbase, no transliteration unless "
            "a rule allows it, footnote anchors preserved, faithful sense, "
            "natural English, coherence with surrounding context. "
            "Return only the improved translation.\n\n"
            f"DRAFT:\n{draft}"
        )
        return Prompt(system=base.system, user=base.user + "\n\n" + critique)

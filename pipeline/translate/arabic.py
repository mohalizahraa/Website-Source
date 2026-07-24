"""Arabic text normalisation helpers.

Used for (a) exact Translation-Memory matching and (b) canonical Qurʾān/Hadith
detection, where OCR output rarely carries the same diacritics as a verified
source. Normalisation is deliberately *lossy* and only for comparison — the
original / canonical strings are always what we store and emit.
"""

from __future__ import annotations

import re
import unicodedata

# Arabic diacritics (harakāt, tanwīn, shadda, sukūn, superscript alef, etc.)
_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")
_TATWEEL = re.compile(r"ـ")
# Anything that is not an Arabic letter or ASCII word char or whitespace.
_PUNCT = re.compile(r"[^\wء-يٱ-ۓ\s]", re.UNICODE)
_SPACES = re.compile(r"\s+")

# Letter folding: unify orthographic variants that differ across editions.
_FOLD = {
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",  # alef variants
    "ى": "ي",  # alef maqsura → ya
    "ئ": "ي",
    "ؤ": "و",
    "ة": "ه",  # ta marbuta → ha
    "ﷲ": "الله",
}


def normalize(text: str) -> str:
    """Return a comparison-friendly form of ``text``.

    Strips diacritics/tatweel/punctuation, folds letter variants, and
    collapses whitespace. Idempotent.
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = _DIACRITICS.sub("", text)
    text = _TATWEEL.sub("", text)
    for src, dst in _FOLD.items():
        text = text.replace(src, dst)
    text = _PUNCT.sub(" ", text)
    text = _SPACES.sub(" ", text)
    return text.strip()


def tokens(text: str) -> list[str]:
    """Whitespace tokens of the normalised text."""
    norm = normalize(text)
    return norm.split() if norm else []


def similarity(a: str, b: str) -> float:
    """Token Jaccard similarity of two normalised strings in [0, 1]."""
    ta, tb = set(tokens(a)), set(tokens(b))
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def contains(haystack: str, needle: str) -> bool:
    """True if the normalised ``needle`` appears within normalised ``haystack``."""
    hn, nn = normalize(haystack), normalize(needle)
    if not nn:
        return False
    return nn in hn

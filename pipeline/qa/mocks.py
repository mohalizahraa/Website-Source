"""Deterministic, offline mocks for every QA external dependency.

None of these touch the network. They are *meaningful* fakes: the embedder's
cosine reflects real surface overlap, the back-translator reconstructs Arabic
from a small bilingual lexicon so a faithful English draft scores high and an
off-topic one scores low, and the judge derives its rubric from those same
signals. This lets the whole gate be exercised — including the adversarial
footnote case — with zero API keys.
"""
from __future__ import annotations

import hashlib
import math
import re
from typing import Dict, List, Optional

from .footnotes import ANCHOR_RE

# --------------------------------------------------------------------------- #
# Bilingual lexicon (Islamic-theology pilot vocabulary).                      #
# ar -> list of acceptable en renderings (first is canonical).                #
# --------------------------------------------------------------------------- #
AR_EN: Dict[str, List[str]] = {
    "المتكلمون": ["mutakallimun", "theologians"],
    "الفلاسفة": ["philosophers", "falasifa"],
    "قال": ["held", "said"],
    "ذهب": ["held", "maintained"],
    "العقل": ["reason", "intellect"],
    "النقل": ["revelation", "transmission"],
    "مقدم": ["precedes", "takes precedence"],
    "الله": ["god", "allah"],
    "الرسول": ["messenger", "prophet"],
    "الطقس": ["weather"],
    "جميل": ["nice", "pleasant"],
    "اليوم": ["today"],
    "الايمان": ["faith", "belief"],
    "العمل": ["works", "deeds"],
}

# en (lowercased) -> ar, derived from AR_EN (first ar wins for a given en).
EN_AR: Dict[str, str] = {}
for _ar, _ens in AR_EN.items():
    for _en in _ens:
        EN_AR.setdefault(_en, _ar)

# Function words we drop before matching (both languages).
_STOP = {
    "the", "a", "an", "that", "to", "of", "on", "over", "and", "so", "is",
    "then", "in", "held", "it", "its",
    "ان", "أن", "إلى", "الى", "على", "و", "في", "ف", "ال",
}

_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def _tokenize(text: str) -> List[str]:
    """Words only, lowercased, anchors stripped, stopwords removed."""
    text = ANCHOR_RE.sub(" ", text)
    return [w for w in (t.lower() for t in _WORD_RE.findall(text)) if w not in _STOP]


# --------------------------------------------------------------------------- #
# Embedder: char-n-gram feature hashing. Cosine ~ surface/semantic overlap.   #
# --------------------------------------------------------------------------- #
class MockEmbedder:
    def __init__(self, dim: int = 512):
        self.dim = dim

    def _ngrams(self, text: str) -> List[str]:
        # Normalize on content tokens so word overlap dominates over layout.
        norm = " ".join(_tokenize(text))
        grams: List[str] = []
        for n in (2, 3):
            grams += [norm[i : i + n] for i in range(len(norm) - n + 1)]
        return grams or [norm]

    def embed(self, text: str) -> List[float]:
        vec = [0.0] * self.dim
        for g in self._ngrams(text):
            h = int(hashlib.md5(g.encode("utf-8")).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 12) & 1 else -1.0
            vec[idx] += sign
        return vec


def cosine(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# --------------------------------------------------------------------------- #
# Translators. Two distinct engines so QA back-translation uses a DIFFERENT   #
# model than the one that produced the segment (per the architecture).        #
# --------------------------------------------------------------------------- #
def _pseudo_ar(word: str) -> str:
    """Deterministic non-lexicon Arabic-ish token for unknown english words.

    Unknown content maps to stable garbage that will NOT overlap the real
    source Arabic — so off-topic drafts score low bt_sim.
    """
    h = hashlib.md5(word.encode("utf-8")).hexdigest()[:6]
    return "ﻍ" + h


class MockBackTranslator:
    """QA-side translator (en -> ar). Reconstructs Arabic via the lexicon.

    This is intentionally a *different* engine from whatever produced the
    segment's English, satisfying the 'back-translate with a different model'
    requirement. Anchors are preserved in place so footnote placement can be
    verified on the back-translation too if desired.
    """

    name = "mock-backtranslator-v1"

    def translate(self, text: str, src: str = "en", tgt: str = "ar") -> str:
        out: List[str] = []
        # Walk tokens but keep anchors where they occur.
        parts = re.split(r"(\[\[FN-\d+\]\])", text)
        for part in parts:
            if ANCHOR_RE.fullmatch(part):
                out.append(part)
                continue
            for w in _tokenize(part):
                out.append(EN_AR.get(w, _pseudo_ar(w)))
        return " ".join(out)

    def sample(self, text: str, src: str = "en", tgt: str = "ar", seed: int = 0) -> str:
        return self.translate(text, src, tgt)


class MockForwardTranslator:
    """Production-style engine (ar -> en) used only to measure self-consistency.

    ``sample`` perturbs the choice among synonyms by seed, so an input whose
    words are unambiguous yields identical samples (high self-consistency) while
    an input rich in polysemous terms diverges (lower self-consistency).
    """

    name = "mock-forward-v1"

    def _render(self, text: str, seed: int) -> str:
        # A stable engine returns the canonical rendering for most words; only a
        # small, deterministic subset of genuinely ambiguous words wobbles with
        # the seed. So a normal segment has high self-consistency and only
        # highly-ambiguous inputs diverge.
        out: List[str] = []
        parts = re.split(r"(\[\[FN-\d+\]\])", text)
        for part in parts:
            if ANCHOR_RE.fullmatch(part):
                out.append(part)
                continue
            for w in _WORD_RE.findall(part):
                options = AR_EN.get(w)
                if not options:
                    out.append(w)
                    continue
                if len(options) > 1 and self._wobbles(w):
                    idx = seed % len(options)
                else:
                    idx = 0
                out.append(options[idx])
        return " ".join(out)

    @staticmethod
    def _wobbles(word: str) -> bool:
        h = int(hashlib.md5(word.encode("utf-8")).hexdigest(), 16)
        return h % 8 == 0

    def translate(self, text: str, src: str = "ar", tgt: str = "en") -> str:
        return self._render(text, 0)

    def sample(self, text: str, src: str = "ar", tgt: str = "en", seed: int = 0) -> str:
        return self._render(text, seed)


# --------------------------------------------------------------------------- #
# LLM-as-judge (MQM rubric). Derives dimensions from real signals.            #
# --------------------------------------------------------------------------- #
class MockJudge:
    """Deterministic MQM-style judge.

    - adequacy: lexical coverage of source content words in the translation
      (proxy for meaning preservation).
    - fluency: penalizes empty / degenerate (highly repetitive) output.
    - terminology: rewards use of canonical term renderings from the lexicon.
    - footnote_placement: NOTE — this mock judge, like the *old* pipeline and a
      naive LLM, only checks that anchor COUNT is preserved. It is deliberately
      fooled by the adversarial reorder case; the authoritative positional catch
      lives in footnotes.check_footnotes(). This layering is the whole point:
      we do not rely on the judge alone for placement.
    """

    name = "mock-judge-v1"

    def _adequacy(self, ar: str, en: str) -> float:
        # Map source Arabic content words to their acceptable english renderings,
        # then measure how many are actually present in the english draft.
        ar_words = [w for w in _WORD_RE.findall(ANCHOR_RE.sub(" ", ar)) if w not in _STOP]
        total = sum(1 for w in ar_words if w in AR_EN)
        if total == 0:
            return 0.75  # nothing to verify against; neutral-high
        en_tokens = set(t.lower() for t in _WORD_RE.findall(en))
        # accept any acceptable rendering, not just the canonical one
        hit = 0
        for w in ar_words:
            opts = AR_EN.get(w)
            if opts and any(o in en_tokens for o in opts):
                hit += 1
        return hit / total

    def _fluency(self, en: str) -> float:
        toks = [t.lower() for t in _WORD_RE.findall(en)]
        if not toks:
            return 0.1
        uniq = len(set(toks)) / len(toks)
        # degenerate/repetitive output -> low fluency
        return max(0.2, min(1.0, 0.4 + 0.6 * uniq))

    def _terminology(self, ar: str, en: str) -> float:
        ar_words = [w for w in _WORD_RE.findall(ANCHOR_RE.sub(" ", ar)) if w in AR_EN]
        if not ar_words:
            return 0.85
        en_tokens = set(t.lower() for t in _WORD_RE.findall(en))
        canonical_hits = sum(1 for w in ar_words if AR_EN[w][0] in en_tokens)
        # partial credit for any acceptable rendering
        any_hits = sum(
            1 for w in ar_words if any(o in en_tokens for o in AR_EN[w])
        )
        return min(1.0, 0.5 * (any_hits / len(ar_words)) + 0.5 * (canonical_hits / len(ar_words)) + 0.25)

    def judge(self, ar: str, en: str, kind: str = "body") -> dict:
        adequacy = round(self._adequacy(ar, en), 3)
        fluency = round(self._fluency(en), 3)
        terminology = round(self._terminology(ar, en), 3)
        # Naive count-only footnote opinion (intentionally weak — see docstring).
        src_n = len(ANCHOR_RE.findall(ar))
        tgt_n = len(ANCHOR_RE.findall(en))
        footnote_placement = 1.0 if src_n == tgt_n else 0.2

        dims = {
            "adequacy": adequacy,
            "fluency": fluency,
            "terminology": terminology,
            "footnote_placement": footnote_placement,
        }
        worst = min(dims, key=dims.get)
        note = f"MQM: lowest dimension = {worst} ({dims[worst]:.2f}); " + ", ".join(
            f"{k}={v:.2f}" for k, v in dims.items()
        )
        dims["note"] = note
        return dims


# --------------------------------------------------------------------------- #
# Canonical Qurʾān/Hadith store.                                              #
# --------------------------------------------------------------------------- #
class MockCanonicalStore:
    """Tiny canonical DB. Sacred segments must match the approved English."""

    def __init__(self, entries: Optional[Dict[str, str]] = None):
        # key: normalized Arabic -> approved English
        self._entries = entries or {
            "بسم الله الرحمن الرحيم": "In the name of God, the Most Gracious, the Most Merciful",
        }

    @staticmethod
    def _norm(ar: str) -> str:
        return re.sub(r"\s+", " ", ar.strip())

    def lookup(self, ar: str) -> Optional[str]:
        return self._entries.get(self._norm(ar))

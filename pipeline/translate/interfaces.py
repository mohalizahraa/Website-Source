"""Abstract interfaces every external model sits behind.

The rest of the pipeline depends only on these ABCs, never on a concrete
engine or a network call. Offline the mocks (``mocks.py``) satisfy them; in
production the adapters (``adapters.py``) are swapped in.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .types import CanonicalEntry, Context, Prompt, TranslationResult


class NotConfiguredError(RuntimeError):
    """Raised by a real adapter when its endpoint / API key is missing.

    Carries a clear, actionable message naming the environment variables that
    must be set. Adapters raise this *before* attempting any network call, so
    an un-configured engine fails fast and never silently degrades.
    """


class Translator(ABC):
    """A machine-translation engine.

    Two passes are exposed so a caller can implement two-pass self-refine:
    ``translate`` produces a first draft, ``refine`` critiques + improves it.
    ``name`` is the engine label written into the segment's ``engine`` field.
    """

    #: concrete engine label, e.g. "ollama-qwen3-14b" / "claude-cloud"
    name: str = "translator"

    @abstractmethod
    def translate(self, prompt: Prompt, *, ar: str, context: Context) -> TranslationResult:
        """Produce a first-draft English translation of ``ar``."""

    def refine(
        self,
        draft: str,
        *,
        prompt: Prompt,
        ar: str,
        context: Context,
    ) -> TranslationResult:
        """Critique-and-refine pass over ``draft``.

        Default implementation is a no-op that returns the draft unchanged with
        a modest confidence bump; engines may override with a real critique.
        """
        return TranslationResult(text=draft, confidence=0.8, notes="no-op refine").clamp()


class CanonicalDB(ABC):
    """A trusted store of verified Qurʾān / Hadith text.

    For ``kind == "sacred"`` segments the pipeline *detects and replaces* rather
    than machine-translating: it asks the DB for a match and substitutes the
    canonical Arabic + approved English. This is the single most important
    religious-accuracy technique in the design.
    """

    @abstractmethod
    def match(self, ar: str, *, min_score: float = 0.6) -> Optional[CanonicalEntry]:
        """Return the best canonical match for ``ar`` or ``None``.

        Implementations should match on *normalised* Arabic so OCR diacritic
        noise does not prevent a hit.
        """

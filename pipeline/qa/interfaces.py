"""Abstract interfaces for every external model the QA stage depends on.

Per ARCHITECTURE.md: each external dependency (embeddings, translation,
LLM-judge, canonical Qurʾān/Hadith DB) must sit behind a clean interface with a
working deterministic mock so the whole system runs offline. Real adapters
(cloud embeddings, Claude/Gemini, a real canonical store) implement the same
protocols and are swapped in later by reading keys from env vars.
"""
from __future__ import annotations

from typing import List, Optional, Protocol, runtime_checkable


@runtime_checkable
class Embedder(Protocol):
    """Maps text to a dense vector. Cosine of two vectors ~ semantic overlap."""

    def embed(self, text: str) -> List[float]:
        ...


@runtime_checkable
class Translator(Protocol):
    """A machine translator between two languages.

    ``translate`` is the deterministic best-effort output. ``sample`` returns a
    stochastic variant keyed by ``seed`` and is used to measure self-consistency
    (the stability of the engine on a given input).
    """

    def translate(self, text: str, src: str, tgt: str) -> str:
        ...

    def sample(self, text: str, src: str, tgt: str, seed: int) -> str:
        ...


@runtime_checkable
class Judge(Protocol):
    """LLM-as-judge returning an MQM-style rubric plus a short note.

    Returns a dict with keys: adequacy, fluency, terminology,
    footnote_placement (each 0..1) and note (str).
    """

    def judge(self, ar: str, en: str, kind: str) -> dict:
        ...


@runtime_checkable
class CanonicalStore(Protocol):
    """Canonical Qurʾān/Hadith database.

    ``lookup`` returns the approved English rendering for a canonical Arabic
    passage, or ``None`` if the passage is not a recognized canonical text.
    Sacred segments are gated on an exact match against this store.
    """

    def lookup(self, ar: str) -> Optional[str]:
        ...

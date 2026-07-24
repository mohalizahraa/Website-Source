"""Embedder interface + a deterministic, offline mock.

Translation-memory retrieval needs vector embeddings, but this machine has no
Ollama and no cloud API keys. So embeddings sit behind a clean interface with a
deterministic hash-based fake that requires no network and produces stable,
comparable vectors. Real adapters (Ollama / OpenAI / Gemini) read keys from env
vars and are swapped in later by overriding ``get_embedder``.
"""
from __future__ import annotations

import hashlib
import math
import struct
from typing import Protocol

from . import config


class Embedder(Protocol):
    """Anything that turns text into a fixed-length float vector."""

    dim: int

    def embed(self, text: str) -> list[float]:
        ...


class MockEmbedder:
    """Deterministic hash-based embedder — same text always yields same vector.

    Not semantically meaningful, but stable and offline: good enough for storing
    embeddings and computing cosine similarity in tests and local dev.
    """

    def __init__(self, dim: int | None = None) -> None:
        self.dim = dim or config.EMBED_DIM

    def embed(self, text: str) -> list[float]:
        text = (text or "").strip()
        vec: list[float] = []
        counter = 0
        # Expand a SHA-256 stream until we have `dim` floats in [-1, 1].
        while len(vec) < self.dim:
            h = hashlib.sha256(f"{counter}:{text}".encode("utf-8")).digest()
            for i in range(0, len(h), 4):
                if len(vec) >= self.dim:
                    break
                (u,) = struct.unpack("<I", h[i : i + 4])
                vec.append((u / 0xFFFFFFFF) * 2.0 - 1.0)
            counter += 1
        # L2-normalize so cosine == dot product.
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]


def pack_vector(vec: list[float]) -> bytes:
    """Serialize a float vector to a compact float32 BLOB."""
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack_vector(blob: bytes | None) -> list[float]:
    """Inverse of :func:`pack_vector`."""
    if not blob:
        return []
    n = len(blob) // 4
    return list(struct.unpack(f"<{n}f", blob))


def cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two equal-length vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(x * x for x in b)) or 1.0
    return dot / (na * nb)


_DEFAULT_EMBEDDER: Embedder = MockEmbedder()


def get_embedder() -> Embedder:
    """Return the active embedder. Swap the module global to inject a real one."""
    return _DEFAULT_EMBEDDER

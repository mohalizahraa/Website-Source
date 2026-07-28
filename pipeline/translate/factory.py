"""Build a production :class:`Pipeline` from environment configuration.

This is the seam the server's ingest worker uses to get a real translator
without knowing anything about specific engines:

    from pipeline.translate.factory import build_pipeline_from_env
    pipe = build_pipeline_from_env()
    result = pipe.translate_segment(seg, context)

**OpenRouter (recommended): one key, any model.** When ``OPENROUTER_API_KEY`` is
set, the pipeline runs two models through OpenRouter and lets the router split
traffic by difficulty — the best quality-per-dollar strategy:

* **bulk / confident** segments → ``TRANSLATION_MODEL_BULK``
  (default ``google/gemini-2.5-flash`` — top-tier Arabic at the best price).
* **doctrinal / long / low-confidence** segments → ``TRANSLATION_MODEL_FRONTIER``
  (default ``anthropic/claude-sonnet-5`` — frontier accuracy where it matters).

Without OpenRouter it falls back to: local = Ollama/Qwen if ``OLLAMA_HOST`` is
set (else the offline mock); cloud = ``CLOUD_TRANSLATOR`` (gemini/openai/claude).

Nothing here makes a network call; adapters only reach out when actually used,
and raise NotConfiguredError if their API key is missing.
"""

from __future__ import annotations

import os

from .adapters import (
    OpenRouterTranslator,
    cloud_translator_from_env,
    local_translator_from_env,
)
from .core import Pipeline
from .mocks import MockCanonicalDB, MockTranslator

# Best quality-per-dollar defaults (any OpenRouter model id works here).
DEFAULT_BULK_MODEL = "google/gemini-2.5-flash"
DEFAULT_FRONTIER_MODEL = "anthropic/claude-sonnet-5"


def build_pipeline_from_env(*, refine: bool = True) -> Pipeline:
    """Assemble a Pipeline from environment variables (see module docstring)."""
    if os.environ.get("OPENROUTER_API_KEY"):
        bulk = os.environ.get("TRANSLATION_MODEL_BULK", DEFAULT_BULK_MODEL)
        frontier = os.environ.get("TRANSLATION_MODEL_FRONTIER", DEFAULT_FRONTIER_MODEL)
        # Router sends confident/short work to `local` and escalates the hard
        # minority to `cloud` — so map value→local, frontier→cloud.
        local = OpenRouterTranslator(model=bulk)
        cloud = OpenRouterTranslator(model=frontier)
    else:
        local = local_translator_from_env() or MockTranslator("mock-local")
        cloud = cloud_translator_from_env()

    return Pipeline(
        local=local,
        cloud=cloud,
        canonical_db=MockCanonicalDB(),  # TODO: real Tanzil/Hadith canonical store
        refine=refine,
    )

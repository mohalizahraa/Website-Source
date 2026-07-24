# Haydari — Translation stage (`pipeline/translate/`)

Implements the pipeline contract from `ARCHITECTURE.md`:

```python
translate_segment(seg, context) -> { "en", "engine", "confidence" }
context = { glossary, tm_matches, prev_en, next_en, style_rules }
```

Balanced per-segment routing, glossary/TM injection, two-pass self-refine, and
Qurʾān/Hadith **detect-and-replace**. Every external model (local Ollama/Qwen,
cloud Claude/Gemini, canonical DB) sits behind an interface with a **working
offline mock**, so the whole stage runs and is tested with no network or keys.

## Quick start

```python
from translate import translate_segment

seg = {"id": "B-1:042:03", "kind": "body", "ar": "فذهب المتكلمون إلى هذا القول"}
ctx = {"glossary": [{"term_ar": "المتكلمون",
                     "term_en": "the dialectical theologians (mutakallimūn)"}]}

translate_segment(seg, ctx)
# -> {"en": "...the dialectical theologians (mutakallimūn)...",
#     "engine": "mock-cloud", "confidence": 0.9}
```

The module-level `translate_segment` uses a default, fully-offline `Pipeline`
(mock engines + mock canonical DB). Construct a `Pipeline(...)` to inject real
adapters or custom components.

## How a segment flows

Priority order inside `translate_segment` (`core.py`):

1. **Sacred → canonical substitution** (`kind == "sacred"`). The segment's
   Arabic is matched against the `CanonicalDB`; on a hit the verified canonical
   Arabic + approved English are substituted (both emitted), engine =
   `canonical`. Sacred text is **never machine-translated**. The segment's `ar`
   is corrected to the canonical text and `canonical_ref` is recorded. No hit →
   audited MT fallback.
2. **TM exact match → verbatim reuse.** If a `tm_matches` entry has `score ≥
   0.995` *or* is identical to the segment after Arabic normalisation, its
   `en_approved` is returned verbatim, engine = `tm-exact`, confidence `1.0`.
   Never machine-translated.
3. **Routed MT.** The `Router` picks a tier:
   - `sacred` → canonical (handled above)
   - doctrinal (creed/theology markers, or `seg["doctrinal"]`) → **cloud**
   - long (> 600 chars) → **cloud**
   - otherwise → **local** draft; if the draft's confidence `< 0.8`, **escalate
     to cloud**.
   Each MT path runs a **two-pass self-refine** (draft → critique/refine) and a
   pipeline-level **glossary-enforcement** backstop that guarantees every
   applicable termbase rendering appears in the output — even if the underlying
   engine ignored it.

## Components

| File | Role |
|------|------|
| `core.py` | `translate_segment` + `Pipeline` orchestration |
| `router.py` | `Router` — balanced local/cloud/canonical decision |
| `prompt.py` | `PromptBuilder` — 9-point Al-Shamela spec + knowledge injection |
| `sacred.py` | `substitute_sacred` — detect-and-replace for Qurʾān/Hadith |
| `interfaces.py` | `Translator`, `CanonicalDB` ABCs, `NotConfiguredError` |
| `mocks.py` | `MockTranslator`, `MockCanonicalDB`, `RecordingTranslator` |
| `adapters.py` | `OllamaTranslator`, `ClaudeTranslator`, `GeminiTranslator` |
| `arabic.py` | Arabic normalisation (diacritic-tolerant matching) |
| `types.py` | dataclasses: `TranslationResult`, `CanonicalEntry`, `Prompt`, … |

## Prompt (9-point Al-Shamela spirit)

`PromptBuilder` renders: proficient AR→EN role; **no transliteration** (unless a
term rule sets `transliterate: true`); established Islamic terminology; readable
+ faithful sense; Qurʾān/Hadith output both Arabic and English; preserve
paragraph/list/heading formatting; bold headings and keep chapter/page breaks;
preserve `[[FN-n]]` anchors attached to the same sentence. It injects the
termbase, top-k TM fuzzy matches, `prev_en`/`next_en` for cross-segment
coherence, and style rules.

## Canonical DB

`MockCanonicalDB` is seeded with real, verified entries (extend via `.add()`):

- **Qurʾān 57:3** — *He is the First and the Last, the Manifest and the Hidden…*
- **Ṣaḥīḥ al-Bukhārī 1** — *Actions are but by intentions.*

Matching is on normalised Arabic so OCR diacritic noise does not prevent a hit.

## Real engines (later)

Adapters read config from env and raise a clear `NotConfiguredError` before any
network call (never exercised offline):

| Engine | Env vars |
|--------|----------|
| `OllamaTranslator` (Qwen3-14B, local) | `OLLAMA_HOST` (required), `OLLAMA_MODEL` (default `qwen3:14b`) |
| `ClaudeTranslator` (cloud) | `ANTHROPIC_API_KEY` (required), `ANTHROPIC_MODEL` (default `claude-opus-4-8`) |
| `GeminiTranslator` (cloud) | `GEMINI_API_KEY` / `GOOGLE_API_KEY` (required), `GEMINI_MODEL` (default `gemini-2.0-flash`) |

Wire them into production like:

```python
from translate import Pipeline, OllamaTranslator, ClaudeTranslator
pipe = Pipeline(local=OllamaTranslator(), cloud=ClaudeTranslator())
```

## Tests

Fully offline. From this directory:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q
```

Coverage: glossary enforcement, sacred replacement (never MT'd), router
escalation (low-confidence / doctrinal / long / sacred), TM exact-vs-fuzzy
reuse, prompt assembly, and adapter "not configured" guardrails.

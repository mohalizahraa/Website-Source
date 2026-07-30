# Haydari LLM usage and token audit

Generated 2026-07-30 by an offline harness. No API calls, database writes, deployments, or paid model calls were made.

## Current local model selectors

| Role | Model |
|---|---|
| OCR | `google/gemini-2.5-flash` |
| Bulk translation | `google/gemini-2.5-flash` |
| Frontier translation | `google/gemini-2.5-pro` |
| Assistant chat | `google/gemini-2.5-flash` |

## Exact usage inventory

| Runtime | Stage | Model | When and why | Current accounting |
|---|---|---|---|---|
| deployed web pipeline | OCR | `google/gemini-2.5-flash` | once per rendered page when OpenRouter OCR is selected/auto-detected; vision transcription of Arabic page images | successful response recorded by model/stage in memory; persisted only as aggregate ingest |
| deployed web pipeline | bulk translation | `google/gemini-2.5-flash` | short non-doctrinal, non-sacred, non-TM segments; draft and refine; default inexpensive translation tier | per-call model known in memory; DB segment stores only openrouter-cloud and ledger aggregates ingest |
| deployed web pipeline | frontier translation | `google/gemini-2.5-pro` | doctrinal, >600-char, low-OCR-confidence, blank bulk, or bulk confidence <0.8; draft and refine; higher-quality handling of risky passages | per-call model known in memory; reason and pass are not persisted |
| deployed web pipeline | assistant chat | `google/gemini-2.5-flash` | every creator chat request, repeated for each tool loop up to five calls; answer app questions and choose safe database tools | whole chat turn persisted as one aggregate row without model/tool-turn detail |
| deployed web pipeline | QA and embeddings | `offline deterministic mocks` | every translated segment / translation-memory insert; placeholder scoring and deterministic vectors | zero provider tokens; despite names, no live back-translator, embedder, sampler, or LLM judge is wired |
| manual legacy script only | lecture translation | `qwen2.5:3b via local Ollama` | only when that standalone script is manually run; legacy local lecture translation | not part of web ingest and not metered |
| unreachable stubs | QARI/direct Gemini OCR and direct-provider translators | `configuration dependent` | not used by the current OpenRouter web configuration; adapter seams for future/local/provider-direct operation | not applicable unless explicitly configured |

## Offline routing benchmark

The harness executes the real router and prompt builder with recording adapters. Prompt character counts and call counts are exact for these fixtures; tokens and cost are estimates.

| Scenario | Initial route | Calls | Models | Est. input | Est. output | Est. cost | Why |
|---|---:|---:|---|---:|---:|---:|---|
| short_standard | local | 2 | google/gemini-2.5-flash ×2 | 1459 | 42 | $0.000543 | short, non-doctrinal segment starts in the bulk tier |
| doctrinal | cloud | 2 | google/gemini-2.5-pro ×2 | 1458 | 48 | $0.002302 | Arabic doctrinal marker routes directly to frontier |
| long_segment | cloud | 2 | google/gemini-2.5-pro ×2 | 1932 | 48 | $0.002895 | source exceeds the 600-character frontier threshold |
| low_model_confidence_theoretical | local | 4 | google/gemini-2.5-flash ×2, google/gemini-2.5-pro ×2 | 2921 | 90 | $0.002850 | probe forces confidence below 0.8, causing bulk then frontier |
| tm_exact | local | 0 | none | 0 | 0 | $0.000000 | approved exact Arabic match bypasses every model |
| sacred_canonical_hit | canonical | 0 | none | 0 | 0 | $0.000000 | seeded canonical match bypasses every model |
| sacred_canonical_miss | canonical | 0 | none | 0 | 0 | $0.000000 | missing canonical entry is held for human review without MT |

## Controlled token-optimization comparisons

All translation rows use the same short Arabic segment and exact production prompt builder. No model was called.

| Configuration | Terms sent | Calls | Est. input | Est. output | Est. list cost | Input change vs current |
|---|---:|---:|---:|---:|---:|---:|
| current: 12-term glossary + draft/refine | 12 | 2 | 1459 | 42 | $0.000543 | +0.0% |
| filter glossary + draft/refine | 1 | 2 | 1275 | 42 | $0.000487 | -12.6% |
| 12-term glossary + draft only | 12 | 1 | 670 | 21 | $0.000253 | -54.1% |
| filter glossary + draft only | 1 | 1 | 578 | 21 | $0.000226 | -60.4% |
| future 100-term glossary + draft/refine | 100 | 2 | 3338 | 42 | $0.001106 | +128.8% |
| chat one call on current Flash | — | 1 | 1244 | 25 | $0.000436 | — |
| chat one call on Flash-Lite (same tokens) | — | 1 | 1244 | 25 | $0.000134 | — |

## Highest-value optimizations

### 1. Refine is unconditional for every model-translated segment.

Evidence: Offline scenarios produced 5 refine calls and 5 draft calls; refine prompts include the entire draft prompt again.

Change to test: A/B single-pass bulk translation; retain refine only for frontier/risk/QA failures.

Expected effect: Removes about 4187 estimated prompt tokens and 5 calls in this fixture suite.

Required gate: Paid blinded comparison on representative pages is required before changing behavior.

### 2. All glossary terms are injected into every segment and duplicated in refine.

Evidence: The representative prompt includes 12 terms although only 1 appears in the short source.

Change to test: Filter glossary to source-matching terms plus a very small global must-include set.

Expected effect: Savings grow linearly with termbase size and are doubled by current refinement.

Required gate: Unit-test Arabic normalization and multi-word matching; no paid call needed.

### 3. OCR confidence now reaches routing, but translation confidence is still hard-coded.

Evidence: Low-confidence OCR is routed directly to frontier; OpenRouter translation adapters still return fixed 0.86/0.89 values.

Change to test: Keep the OCR safeguard and later replace adapter constants with calibrated QA signals.

Expected effect: Targets frontier spend at visibly uncertain source text without reducing translation quality.

Required gate: Build a labeled OCR/translation error set and calibrate thresholds.

### 4. Frontier Gemini Pro costs roughly 4x Flash at current list rates.

Evidence: $1.25/$10 versus $0.30/$2.50 per million input/output tokens.

Change to test: Keep Pro only where a blinded Arabic quality test proves material improvement; test Flash on long segments and Pro only on doctrinal/canonical misses.

Expected effect: Each moved frontier token costs about one quarter as much on Flash at list price.

Required gate: Human review by an Arabic/Islamic-text expert is mandatory.

### 5. Chat resends a large static knowledge block and all tool schemas on every tool round.

Evidence: The chat loop allows five calls and accumulates the conversation while repeating the same system/tools prefix.

Change to test: Test Flash-Lite for chat and cap/compact history; preserve Flash fallback for tool failures.

Expected effect: Flash-Lite list rates are 67% lower for input and 84% lower for output than Flash, before quality/tool-reliability effects.

Required gate: Replay tool-choice and authorization test cases before switching.

### 6. The production database cannot answer which model/pass/reason spent each token.

Evidence: usage_ledger persists only stage=ingest/chat totals; segment.engine is the shared label openrouter-cloud.

Change to test: Add a per-call audit table/JSON event with model, operation, route reason, page/segment, provider tokens, cost, latency, and retry count.

Expected effect: Observability improvement; no direct token saving, but enables evidence-based routing.

Required gate: Schema migration and privacy review before any production deployment.

## Important interpretation limits

- This is a routing and token-overhead benchmark, not a translation-quality benchmark.
- Token estimates use `ceil(Unicode characters / 3)`. Only provider-returned usage is exact.
- OCR image token cost cannot be estimated reliably without an actual provider response.
- Retries that time out after the provider processed a request may be billed but are not currently recorded unless a response returns.
- The low-confidence scenario is theoretical: current OpenRouter adapters assign fixed confidence values rather than measuring output confidence.

## Price references

- [google/gemini-2.5-flash](https://openrouter.ai/google/gemini-2.5-flash): $0.3/M input, $2.5/M output (checked 2026-07-30).
- [google/gemini-2.5-pro](https://openrouter.ai/google/gemini-2.5-pro): $1.25/M input, $10/M output (checked 2026-07-30).
- [google/gemini-2.5-flash-lite](https://openrouter.ai/google/gemini-2.5-flash-lite): $0.1/M input, $0.4/M output (checked 2026-07-30).

## Reproduce

```bash
python -m benchmarks.llm_usage_audit
```

See `model_calls.json` for every individual offline call, including operation and route reason.

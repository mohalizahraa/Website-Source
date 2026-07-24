# Haydari Translation Platform — Architecture & Build Contract

This is the **shared source of truth** for the rebuild. Every component (built by a
specialized agent, in parallel) must conform to the data model, anchor scheme, and API
contract below so the pieces integrate cleanly. Decisions already locked with the owner:

- **Deployment:** hybrid — local-first on Apple Silicon, cloud APIs for hard/doctrinal work.
- **Learning:** prompt/RAG memory now (TM, termbase, exemplars, style rules); LoRA/DPO fine-tuning later.
- **Reviewers:** small trusted team; edits made **doc-style** (tracked changes) are the primary training signal.
- **Engine strategy:** balanced per-segment routing (cheap/local when confident, cloud when risky).
- **Frontend:** Next.js (React) web app; clean, simple, accessible. Design reference = the review-workbench mockup.
  **Theme: green accent (#1E6B4E) + warm off-white ground (#F4F1E8) + gold reserved for sacred text (#8F6F1C).**
  Confidence stays semantic and distinct from the brand: high=green, medium=amber, low=red; sacred = gold ring.

**Language decision — Python + TypeScript (not Go or Rust).** The core of this system is an
AI/ML pipeline: VLM OCR, LLM translation, embeddings/RAG, and later LoRA/DPO fine-tuning. That
entire ecosystem — QARI-OCR, Qwen/transformers, vLLM/MLX, sentence-transformers, PyMuPDF/Poppler,
docling/surya, and the Anthropic/OpenAI/Google SDKs — is **Python-first or Python-only**. The
workload is I/O- and GPU-bound (model latency dominates), one book at a time, for a few reviewers,
so a language's raw speed is never the bottleneck — ecosystem and developer velocity are. Go and
Rust are excellent languages but here they'd force FFI-to-Python or reimplementation for **zero
real gain**. Decision: **Python (FastAPI) for backend + pipeline; TypeScript (Next.js) for the
frontend.** Revisit only if a genuine high-throughput hot path ever emerges — then isolate *that
one piece* as a small Go/Rust service behind the API, rather than adopting it wholesale.

## The core idea — a review-driven learning flywheel

Human review is not a final gate; it is the training signal. Every edit, score, and approval
is captured as structured data and fed back so the next page/book is better, faster, cheaper.

```
OCR → layout/footnotes → TRANSLATE → AUTO-QA → HUMAN REVIEW → PUBLISH
                              │          │          │
                              └──────────┴──────────┘  edits/scores captured
                                          ▼
                    KNOWLEDGE LAYER  (Translation Memory · Termbase ·
                    Exemplars · Style rules · Qurʾān/Hadith canonical DB)
                                          │ retrieved + injected into
                                          ▼  the next translation prompt
```

## Repository layout (each top dir owned by one build agent)

```
haydari/
  books/          # LEGACY scripts (existing) — keep, migrate later. Do not edit.
  server/         # FastAPI backend + SQLite data model + event log     [Backend agent]
  pipeline/
    ocr/          # VLM OCR → structured Markdown + segments            [OCR agent]
    translate/    # routing, glossary/TM injection, refine, sacred-text [Translation agent]
    qa/           # back-translation, LLM-judge, footnote check, gating [QA agent]
    publish/      # Markdown+[^n] → Pandoc → docx/Docs (footnotes+TOC)  [Publishing — later]
  web/            # Next.js review workbench                            [Frontend agent]
  ARCHITECTURE.md # this file
```

## Anchor scheme (footnotes)

Indexed, positionally-verifiable markers — **never a bare glyph**. In body text a footnote
reference is `[[FN-3]]`; the matching footnote segment has `anchor = "FN-3"`. QA verifies each
anchor survives translation **and stays attached to the correct sentence**, not just a count.

## Data model (SQLite; `server/db/schema.sql` is authoritative)

- **books**(id PK, title_ar, title_en, author, status, source_pdf, google_doc_url, updated_at)
- **pages**(book_id, page_no, image_path, ocr_markdown, status, PRIMARY KEY(book_id,page_no))
- **segments**(id PK, book_id, page_no, seg_order, kind ∈ {body,footnote,sacred}, anchor,
  ar, en_draft, en_current, engine, confidence REAL, bt_sim REAL, self_consistency REAL,
  judge_score REAL, judge_note, footnote_ok INT, status ∈ {draft,needs_review,approved}, updated_at)
- **translation_memory**(id PK, book_id, ar_hash, ar, en_approved, embedding BLOB, created_at)
- **termbase**(id PK, term_ar, term_en, note, scope ∈ {global,book}, book_id NULL, created_by, created_at)
- **style_rules**(id PK, rule, scope, book_id NULL, created_at)
- **corrections**(id PK, segment_id, en_before, en_after, diff_json, mqm_tags_json, dims_json,
  reviewer, created_at)   ← the training signal (draft→edited pairs)
- **events**(id PK, ts, actor, type, payload_json)   ← audit / provenance

## Segment JSON (API wire format)

```json
{
  "id": "B-XX:042:03", "book_id": "B-XX", "page": 42, "order": 3,
  "kind": "body", "anchor": null,
  "ar": "فذهب المتكلمون ...", "en": "So the mutakallimūn held ...",
  "engine": "claude-cloud", "confidence": 0.61,
  "qa": { "bt_sim": 0.82, "self_consistency": 0.71, "judge_score": 0.68,
          "judge_note": "Terminology: ...", "footnote_ok": true },
  "alternatives": ["the dialectical theologians (mutakallimūn)", "the scholastics"],
  "status": "needs_review"
}
```

## HTTP API (FastAPI, prefix `/api`) — the frontend depends on exactly this

- `GET  /books` → book list with status + progress (the Library)
- `GET  /books/{id}` → book detail
- `POST /books/upload` (multipart) → accept one or many PDFs (+ optional title_ar, title_en, author);
  store each file under the project data dir, create a `books` row with status='uploaded', return `[{id}]`
- `POST /books/import` → bulk-register from a catalog JSON array (title_ar/title_en/author/source_pdf)
- `POST /books/{id}/ingest` → enqueue the OCR→translate→QA pipeline (one-at-a-time worker); returns job status
- `GET  /books/{id}/status` → ingestion/translation progress for the Library view
- `POST /termbase/import` (multipart CSV) → bulk-load glossary term pairs
- `GET  /books/{id}/pages/{n}` → `{ page, image_url, segments: [Segment] }`
- `GET  /segments/{id}` → Segment
- `POST /segments/{id}/review` → body
  `{ en_edited, action ∈ {approve,reject,skip}, scores:{Adequacy,Fluency,Terminology,Footnotes}, mqm:[..] }`
  → records a **correction anchored to the original model draft** (`en_draft → en_edited` — the durable
  training pair, stable across reject→approve cycles), updates TM + segment status, returns
  `{ status, learning: { tm_added, terms_suggested, applied_to } }`
- `POST /termbase` `{ term_ar, term_en, note, scope }`
- `POST /style-rules` `{ rule, scope }`
- `GET  /learning/summary` → `{ tm_size, terms, rules, auto_approval_rate, corrections }`

## Pipeline function contracts (Python)

- **ocr**: `process_page(image_path) -> { "markdown": str, "segments": [ {order,kind,ar,anchor} ] }`
  Default engine QARI-OCR (local); escalate poor/low-confidence pages to Gemini. Emit Markdown
  with `[[FN-n]]` anchors; classify body vs footnote vs sacred (Qurʾān/Hadith).
- **translate**: `translate_segment(seg, context) -> { "en", "engine", "confidence" }`
  `context = { glossary, tm_matches, prev_en, next_en, style_rules }`. Balanced routing; two-pass
  self-refine; for `kind=="sacred"` do **detect-and-replace** against the canonical Qurʾān/Hadith DB
  (substitute canonical Arabic + approved English; never MT sacred text).
- **qa**: `score_segment(seg) -> { bt_sim, self_consistency, judge_score, judge_note, footnote_ok, status }`
  bt_sim = cosine(embed(ar), embed(back_translate(en))) using a *different* model; judge = MQM rubric
  (adequacy/fluency/terminology/footnote-placement); gate `approved` only if thresholds met.
- **publish**: `build_document(book_id) -> path` — assemble approved segments to Markdown with `[^n]`
  footnotes, run Pandoc → `.docx`/PDF with a native TOC.

## Environment reality (build accordingly)

This machine has Poppler, Tesseract, Pillow — but **no Ollama, no cloud API keys, no Node yet**.
So: every external dependency (QARI/Ollama, Gemini/Claude/OpenAI, Google Docs, embeddings) must sit
behind a **clean interface with a working mock/stub** (deterministic fake) so the whole system runs
and is testable offline. Real adapters read keys from env vars and are swapped in later. Ship unit
tests against the mocks, a `requirements.txt`/`package.json`, and a short README per component.

## Definition of done (Phase 1 pilot)

End-to-end on 3 books using mocks: PDF → OCR(markdown+anchors) → segments in DB → routed
translation with glossary/TM + sacred detect-and-replace → QA scores + gating → review workbench
shows confidence triage and tracked-changes editing → approving captures a correction into TM/termbase
→ publish approved book to `.docx` with real footnotes + TOC.

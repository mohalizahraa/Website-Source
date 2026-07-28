# Haydari Archive & Translation Platform

Tools for building the **Haydari Archive** — a master record of Sayyid al-Ḥaydarī's Arabic books — and
translating them into English with a human-in-the-loop, learning pipeline.

This repository holds three things:

1. **The archive website** (`index.html`) — the deployed static Haydari Archive site.
2. **The legacy book scripts** (`books/`) — the original five-script CLI workflow (see below).
3. **The translation platform** (`server/`, `pipeline/`, `web/`) — the new system: a FastAPI backend,
   a modular OCR → translate → QA pipeline, and a Next.js review workbench.

> **Design note:** the platform prefers local/open-source models on a single Apple-Silicon Mac and uses
> cloud APIs only where they clearly win. Human review is treated as the *training signal*: every edit,
> score, and approval feeds a knowledge layer (translation memory, termbase, exemplars, style rules) that
> makes the next book better, faster, and cheaper. Full design in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Repository layout

```
.
├── index.html            # Deployed Haydari Archive website (static)
├── web/                  # Next.js review workbench (TypeScript/React) — the UI
├── server/               # FastAPI backend + SQLite data model + event log
├── pipeline/
│   ├── ocr/              # VLM OCR → structured Markdown + [[FN-n]] anchors
│   ├── translate/        # balanced local/cloud routing, glossary/TM, Qurʾān/Hadith detect-and-replace
│   └── qa/               # back-translation, LLM-judge, footnote-placement gating
├── books/                # LEGACY: original five-script CLI workflow
├── ARCHITECTURE.md       # The build contract: data model, HTTP API, learning loop (source of truth)
├── RESEARCH.md           # Tooling/model research (Arabic OCR, MT, footnotes) with citations
└── KNOWN_ISSUES.md       # Findings from reviewing the legacy scripts
```

Each component also has its own README with detailed run instructions
(`server/README.md`, `pipeline/*/README.md`, `web/README.md`).

## Run the platform locally

Everything runs **offline** using deterministic mocks in place of models/keys, so you can drive the whole
UI without Ollama, cloud keys, or GPU weights.

**Backend** (Python 3.12 — pydantic wheels don't build on 3.14 yet):

```bash
cd server
python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python seed.py                              # init + seed the demo book
./.venv/bin/uvicorn app.main:app --port 8000            # http://localhost:8000
./.venv/bin/python -m pytest -q                         # 28 tests
```

**Frontend** (Next.js):

```bash
cd web
npm install
# point it at the live API (or omit for built-in mock data):
echo 'NEXT_PUBLIC_DATA_SOURCE=api'                    >  .env.local
echo 'NEXT_PUBLIC_API_BASE=http://localhost:8000/api' >> .env.local
npm run dev                                             # http://localhost:3000
```

Open **http://localhost:3000** → the Library. Upload a PDF (auto-ingests), then open a book to review its
translation in the green workbench: confidence-triaged segments, a doc-style tracked-changes editor, quality
scoring, and "teach the model" actions — all persisting to the backend.

## Status

| Component | State |
|---|---|
| OCR / Translate / QA pipeline | Built, codex-reviewed, fixed — **74 tests** passing (mocks for real models) |
| Backend (API + data model + learning loop) | Built, codex-reviewed, fixed — **28 tests** passing |
| Frontend (Library + upload + workbench) | Built — typecheck + production build clean |
| End-to-end (offline, mocked) | Verified: upload → ingest → review → approve → learning capture |

**Not yet wired (needs real dependencies):** live Arabic OCR (QARI-OCR / Gemini), real translation
(Ollama + Qwen3 / cloud), and Qurʾān/Hadith canonical data. These sit behind clean interfaces with working
mocks; swap in real adapters via environment variables. See `ARCHITECTURE.md` → "Environment reality".

## Run it for real (OpenRouter — one key, any model)

1. **Paste your key** into `server/.env` → `OPENROUTER_API_KEY=…` (git-ignored; auto-loaded).
   Pick models with `TRANSLATION_MODEL_BULK` (value, e.g. `google/gemini-2.5-flash`),
   `TRANSLATION_MODEL_FRONTIER` (doctrinal, e.g. `google/gemini-2.5-pro`), and `OCR_MODEL`.
2. **Compare models on your own text** before committing:
   ```bash
   python -m pipeline.translate.ab_compare --file page.txt   # Western + Chinese shortlist
   ```
3. **Start the app** (`server/README.md` + `web/README.md`), **upload a PDF** in the Library, hit
   **Ingest** → the worker runs **real OCR → translate → QA** and fills in the review workbench.
   Sacred Qurʾān/Hadith is substituted from the canonical store (never machine-translated); doctrinal
   segments route to the frontier model; footnote anchors are preserved.
4. **Review & approve** in the workbench. Every edit is captured as a `(draft → your edit)` pair.
5. **Export training data** to fine-tune a model on your voice:
   ```bash
   python server/export_training.py    # → training/sft.jsonl, dpo.jsonl, glossary.json
   ```

Everything degrades gracefully: with no key set, the pipeline runs on deterministic mocks and the full
test suite stays offline.

## Legacy: the five book scripts (`books/`)

The original CLI workflow, kept for reference. See `KNOWN_ISSUES.md` for the review of these scripts.

1. `books/books_inventory.py` — build the local book database from the catalogue + PDFs.
2. `books/process_book.py` — page images → OCR → body/footnote split → English draft → footnote QA.
3. `books/publish_book_to_google.py` — create the Google Doc and save its link.
4. `books/sync_archive_data.py` — copy status + Google Doc links into the website data.
5. `books/run_batch.py` — process the next ready book, one at a time.

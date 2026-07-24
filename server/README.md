# Haydari Translation Platform — Backend

FastAPI + SQLite backend implementing the data model, Segment wire format, and
HTTP API defined in [`../ARCHITECTURE.md`](../ARCHITECTURE.md). It is the
review-driven learning flywheel's system of record: segments, corrections (the
training signal), translation memory, termbase, style rules, and an append-only
event log.

Everything runs **offline** — external dependencies (embeddings, OCR/translate/QA
pipeline) sit behind clean interfaces with deterministic mocks. Real adapters read
env vars and are swapped in later.

## Layout

```
server/
  db/schema.sql        # authoritative SQLite schema (all tables)
  app/
    config.py          # env-driven config (DB path, CORS, upload dir, embed dim)
    db.py              # thin sqlite3 data-access layer (no ORM)
    events.py          # append-only event-log writer
    embedder.py        # Embedder interface + deterministic MockEmbedder
    diffing.py         # token-level tracked-change diff
    wire.py            # DB row -> Segment JSON wire format
    ingest.py          # one-at-a-time OCR->translate->QA worker (mock hook)
    schemas.py         # pydantic request models
    main.py            # FastAPI app + all /api endpoints + CORS
  seed.py              # create DB + sample book "معارج التوحيد" page 42 (8 segments)
  tests/               # pytest (offline, mocks only)
  requirements.txt     # pinned
```

## Requirements

- Python **3.11–3.13** (pinned wheels; the machine default 3.14 has no prebuilt
  `pydantic-core` wheel yet, so use e.g. `python3.12`).

## Setup

```bash
cd server
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

## Initialize + seed the database

Creates `server/haydari.db` and loads the sample book (B-01), page 42, and the
eight review-workbench segments (including the sacred Qurʾān 57:3 segment and a
body segment with a `[[FN-1]]` anchor plus its matching `FN-1` footnote):

```bash
./.venv/bin/python seed.py
```

`schema.sql` is applied automatically on every connection (idempotent
`CREATE TABLE IF NOT EXISTS`), so the DB self-initializes even without seeding.

## Run the API

```bash
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

- Base URL: `http://localhost:8000`, all routes under `/api`.
- Interactive docs: `http://localhost:8000/docs`.
- CORS is open to `http://localhost:3000` / `127.0.0.1:3000` by default (the
  Next.js app). Override with `HAYDARI_CORS_ORIGINS="https://a,https://b"`.

## Run the tests

```bash
./.venv/bin/python -m pytest -q
```

Each test runs against a fresh, seeded temp DB and forces synchronous ingestion
(`HAYDARI_SYNC_INGEST=1`) so results are deterministic. No network required.

## Endpoints (exactly per contract, prefix `/api`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/books` | Library list with status + progress |
| GET  | `/books/{id}` | Book detail |
| POST | `/books/upload` | Multipart: one/many PDFs (+ optional title_ar/en/author) → `[{id}]`, status `uploaded` |
| POST | `/books/import` | Bulk register from a catalog JSON array |
| POST | `/books/{id}/ingest` | Enqueue OCR→translate→QA (one-at-a-time worker) → job status |
| GET  | `/books/{id}/status` | Ingestion/translation progress for the Library |
| POST | `/termbase/import` | Multipart CSV bulk-load of term pairs |
| GET  | `/books/{id}/pages/{n}` | `{ page, image_url, segments: [Segment] }` |
| GET  | `/segments/{id}` | Segment (wire format) |
| POST | `/segments/{id}/review` | Record correction, update TM + status, return learning |
| POST | `/termbase` | Add one glossary term |
| POST | `/style-rules` | Add one style rule |
| GET  | `/learning/summary` | `{ tm_size, terms, rules, auto_approval_rate, corrections }` |
| GET  | `/health` | Liveness probe |

### The review endpoint (the learning signal)

`POST /api/segments/{id}/review` with
`{ en_edited, action ∈ {approve,reject,skip}, scores:{...}, mqm:[...], reviewer? }`:

1. Computes a token-level diff between the current English (`en_before`) and
   `en_edited`.
2. Inserts a `corrections` row (before/after/diff/MQM/dims/reviewer) — **always**,
   the training signal.
3. `approve` → sets segment `status=approved`, updates `en_current`, and upserts
   the `(ar → en)` pair into `translation_memory` (idempotent by book + normalized
   Arabic hash).
   `reject` → `status=needs_review` (keeps the edited text).
   `skip` → status unchanged.
4. Writes an audit event and returns
   `{ status, learning: { tm_added, terms_suggested, applied_to } }`.

## Book status lifecycle

`uploaded → processing → in_review → published`

Ingestion (`/books/{id}/ingest`) flips `uploaded → processing → in_review` via a
single background worker thread (a serial in-process queue). The heavy pipeline
sits behind `app.ingest.PIPELINE_HOOK`; the default `mock_pipeline` lays down a
stub page + segment so the flow is visible offline. Replace the hook to wire in
the real `pipeline/` code.

## Configuration (env vars)

| Var | Default | Meaning |
| --- | --- | --- |
| `HAYDARI_DB` | `server/haydari.db` | SQLite file path |
| `HAYDARI_SCHEMA` | `server/db/schema.sql` | Schema file |
| `HAYDARI_CORS_ORIGINS` | localhost:3000 origins | Comma-separated allowed origins |
| `HAYDARI_UPLOAD_DIR` | `server/data/uploads` | Where uploaded PDFs are stored |
| `HAYDARI_EMBED_DIM` | `64` | Mock embedding dimensionality |
| `HAYDARI_SYNC_INGEST` | `0` | `1` runs ingestion inline (tests) |

## Swapping in real adapters later

- **Embeddings:** implement the `Embedder` protocol in `app/embedder.py` and
  point `get_embedder()` at it (reads keys from env).
- **Pipeline:** set `app.ingest.PIPELINE_HOOK` to the real
  OCR→translate→QA orchestrator; it receives `(sqlite3.Connection, book_id)`.

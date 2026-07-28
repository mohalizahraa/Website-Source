# Haydari — Session Handoff

_Last updated: 2026-07-28. Written so a fresh Claude session (any account) can pick up cold._

---

## 0. TL;DR — where we are right now

- **What this is:** "Miʿrāj / Haydari" — an Arabic→English translation platform for classical/contemporary
  **Shia** Islamic texts (falsafa, ʿirfān, uṣūl, hadith), by al-Ḥaydarī. Pipeline: PDF → OCR → AI translate →
  human review workbench → learning loop. Vision: an **open-source movement** — creators publish translations;
  the public reads free; future social layer (reviews, follows, filter-per-scholar).
- **Stack:** FastAPI + SQLite/Postgres (`server/`), Next.js (`web/`), Python pipeline (`pipeline/` = ocr, translate, qa).
  Models via **OpenRouter** (one key). 
- **Current branch:** `phase-2-auth` (built on `phase-1-postgres-r2`, built on `main`). All pushed to
  GitHub remote `origin` (github.com/mohalizahraa/Website-Source).
- **Done:** Phase 1 (Postgres + S3/R2 data layer) and Phase 2 (auth + per-user scoping + anonymous public read),
  both peer-reviewed by Codex and fixed. **35 server tests pass.**
- **THE IMMEDIATE NEXT TASK:** build the **frontend auth UI** (login page + session wiring). The backend now
  requires a session, so the web app (`web/`) will get 401s until this is done. See §7.
- **In flight when we paused:** a Codex re-review of the Phase 2 security fixes was running in the background.
  That session does NOT transfer across accounts — just re-run the Codex review (see §8) or trust the 35 passing
  tests; all 5 of Codex's Phase-2 blockers were already fixed + regression-tested.

---

## 1. Who the user is / how to work

- User is building this as a serious product → "production-grade," wants to deploy for a **private team** first.
- **Cost-conscious.** Prefers lean, inline work; get explicit opt-in before spawning multi-agent fleets / big token spends.
- **Git:** only commit/push when asked (the user has been asking). End commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Work on the phase branches, not `main`.
- **Peer review:** the user wants **Codex** (OpenAI CLI) to review substantial work in parallel, and for us to
  "communicate" (reconcile findings, push back where warranted). See §8.
- Decisions already made for production: **private team** (login + allowlist), **managed PaaS** hosting
  (recommend Render), **owner pays OpenRouter with strict per-user quotas**.

## 2. SECRETS / safety (read before touching git)

- `server/.env` holds the real **OPENROUTER_API_KEY** — git-ignored via `.env*`. **NEVER echo or commit it.**
- `.gitignore` also excludes `*.db`, `server/data/`, `**/uploads/`, `.venv/`, `node_modules/`, `web/.next/`.
- `server/haydari.db` is the local dev DB (git-ignored). Contains test books (B-01 seed + junk from testing).

## 3. Repo state (branches, all on `origin`)

```
main                     baseline (session 1 work: resumable ingest, chat, learning loop)
 └─ phase-1-postgres-r2  Postgres + S3/R2 data layer (dual-backend), Codex-reviewed + fixed
     └─ phase-2-auth     ← CURRENT: auth + per-user scoping + public read, Codex-reviewed + fixed
```
Phase-2-auth commits (newest first): `1e0af2d` sec round 2 · `1a7ddd2` IDOR fix · `efa3d0a` phase 2 ·
`3e36395` phase-1 review r2 · `bdeb062` phase-1 review · `3f74335` phase-1b storage · `d285786` phase-1a db.

Nothing is merged to `main` yet — the user reviews branches on GitHub. Phases stack; merge in order when ready.

## 4. How to run it

**Backend** (from `server/`, venv at `server/.venv`):
```bash
cd server
./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app --reload-dir ../pipeline
```
- `--reload-dir ../pipeline` is important: pipeline edits must trigger reload too.
- On startup it bootstraps an admin user: `admin@haydari.local` / `changeme-admin` (override with
  `HAYDARI_ADMIN_EMAIL` / `HAYDARI_ADMIN_PASSWORD`). Logs a warning if `HAYDARI_SECRET_KEY` unset.
- Gotcha: only ONE uvicorn can hold :8000. Kill stale ones: `pkill -f "uvicorn app.main"` or `lsof -ti tcp:8000 | xargs kill -9`.

**Frontend** (from `web/`): `npm run dev` (port 3000). `npm run typecheck` before considering FE work done.

**Tests** (offline, mock pipeline, no network): `cd server && ./.venv/bin/python -m pytest -q` → **35 pass**.

**Postgres path** (prod DB) — set `DATABASE_URL=postgresql://...`; schema auto-created from `server/db/schema_pg.sql`.
Local Postgres test cluster (docker daemon was off; used local binaries):
```bash
PGDATA=/tmp/hpg; initdb -D $PGDATA -U postgres --auth-local=trust --auth-host=trust
pg_ctl -D $PGDATA -o "-p 5433 -k /tmp" start; createdb -h localhost -p 5433 -U postgres haydari
DATABASE_URL=postgresql://postgres@localhost:5433/haydari ./.venv/bin/python -m pytest ...
```

## 5. Architecture (key files + decisions)

**Data layer — dual backend (`server/app/db.py`):** SQLite for dev/tests, Postgres for prod, chosen by
`DATABASE_URL`. A `Conn` wrapper rewrites `?`→`%s` (and doubles literal `%`) for Postgres; `_insert_id` does
`RETURNING` (PG) vs `lastrowid` (SQLite). Two schema files: `server/db/schema.sql` (SQLite) + `schema_pg.sql` (PG),
kept row-compatible. `_migrate()` adds new columns to existing DBs. Verified on real Postgres 16.

**Storage (`server/app/storage.py`):** pluggable — `LocalStorage` (dev) / `S3Storage` (Cloudflare R2 or AWS,
`STORAGE_BACKEND=s3`). PDFs stored under key `books/<id>/<file>`; `source_pdf` holds the KEY. `materialize()`
gives the ingest worker a real local file (temp copy for S3, cleaned up via explicit `is_temp` ownership).
`safe_key()` blocks path traversal.

**Auth (`server/app/auth.py` + `main.py`):** stdlib only. PBKDF2 password hashing; HMAC-signed session cookie
(`HAYDARI_SECRET_KEY`). Deps: `current_user` (nullable), `require_user`, `require_admin`. Central rule
`_require_book_access(conn, book, user, write=)`: anon may READ published books; creators read/write their own
(+ legacy NULL-owner); admins all; readers are read-only. Endpoints `/api/auth/{login,logout,me,users}`.
First admin bootstrapped at startup. **Prod hard-fails** (HAYDARI_ENV=production) without secret/admin/secure config.

**Ingest pipeline (`server/app/ingest.py`):** incremental, per-page (render→OCR→translate→QA), commits after each
page → live progress + resumable. Options `{from_page,to_page,max_pages,force}`. Per-run cap
`HAYDARI_MAX_PAGES_PER_RUN` (default 20) = token safety. Per-page + per-segment resilience (one failure doesn't
abort the run); network retries in `pipeline/translate/adapters.py` + `pipeline/ocr/engines.py`. Live progress
detail in `JOB_DETAIL` → surfaced via `/status`'s `detail.message`. Single in-process worker thread (one book at
a time); stale-`processing` books are reset on startup.

**Translation (`pipeline/translate/`):** two-tier via OpenRouter — bulk `TRANSLATION_MODEL_BULK`
(gemini-2.5-flash) + frontier `TRANSLATION_MODEL_FRONTIER` (gemini-2.5-pro) for doctrinal/long/low-confidence.
Sacred (Qurʾān/Hadith) → canonical detect-and-replace (`sacred.py`), MT-fallback on canonical miss (no more blank
verses). Refine-truncation guard. Sentence-level segmentation in `pipeline/ocr/engines.py::_split_long_paragraph`.

**Learning loop (WORKS):** approve → `insert_correction` (SFT/DPO training data) + `upsert_tm`. New translations
inject glossary (enforced), style rules, per-book instructions, and **exact TM reuse** (`db.tm_lookup` →
`engine=tm-exact`). NOTE: the embedder is a hash MOCK → only EXACT Arabic reuse is reliable (fuzzy needs real
embeddings). Fine-tuning from corrections is export-only (`server/export_training.py`), not automated.

**Chat assistant (`server/app/chat.py`):** `/api/chat`, OpenRouter tool-calling (set notes, add glossary, get
status). Tools now authorized per-book via an `authorize` callback. Floating `ChatWidget` in the frontend.

## 6. Security review status (Codex)

Both phases peer-reviewed by Codex (gpt-5.5, high, read-only). **Phase 1: PASSED.** **Phase 2:** Codex found 5
real blockers — all FIXED + regression-tested (commit `1e0af2d`): prod hard-fail, segment IDOR, chat-tool
scoping, import ownership, book-scoped term/style ownership; + reader read-only + upload cleanup.
**Deferred (non-blocking for private team; revisit for public launch):** stateless sessions replayable until 30d
expiry (no revocation); CSRF relies on SameSite=Lax (fine for same-site deploy); `next_book_id`/`next_user_id`
races (rare at team scale); connection pooling (Phase 4); real embeddings for fuzzy TM.

## 7. ROADMAP + immediate next steps

**Phases:** 1 Data layer (Postgres+R2) ✅ · 2 Auth + scoping + public read ✅ · 3 Per-user quotas + global spend
cap · 4 Deploy (Dockerfile/render.yaml, standalone worker, HTTPS+domain) · 5 Polish.

**DO NEXT (in order):**
1. **Frontend auth UI** (unblocks the app): login page, an auth context/provider, `credentials: "include"` on all
   fetches in `web/lib/api/http.ts`, handle 401 → redirect to login, show published-only library when logged out,
   a logout control, and an admin "add user" screen. CORS already `allow_credentials=True`; verify
   `config.cors_origins()` lists the exact frontend origin (not `*`) for credentialed requests.
2. `next_book_id` atomic allocation (Codex asked to do this in Phase 2 before real concurrent uploads).
3. Then Phase 3 (quotas) and Phase 4 (deploy — needs the user to create **Render + Cloudflare R2** accounts;
   see `server/DEPLOY.md` for every env var).

**Adopt from competitor research (see `server/DEPLOY.md` + below):** bilingual reader toggle (AR/EN/side-by-side);
public library filters (scholar/subject/century/status); provenance + editorial-status badges;
**seed canonical Qurʾān+Hadith from sunnah.com API + a Qurʾān API** (fixes canonical-miss — high value);
peer-review/multi-reviewer publishing; donation-funded open-source model.

## 8. Codex peer-review workflow (the user wants this on substantial work)

```bash
# read-only review, background; gpt-5.5 was used (gpt-5.6 NOT available on this ChatGPT account)
codex exec --skip-git-repo-check -m gpt-5.5 --config model_reasoning_effort="high" \
  --sandbox read-only -C /Users/uffsf/Alhaydari "REVIEW PROMPT ..." </dev/null 2>/dev/null
# resume the same session to communicate/reconcile (identify yourself as Claude):
echo "This is Claude ..." | codex exec --skip-git-repo-check resume --last </dev/null 2>/dev/null
```
Treat Codex as a peer: verify its claims, push back with evidence when it's wrong. It has been high-signal here.

## 9. Competitor landscape (researched 2026-07-28)

Closest prior art: **Turathly** (private translate-workbench + TM — very close to our workbench, no
publishing/social/open-source); **Kutub** & **Shamela Translate** (public AI reading libraries); **Dragomen**
(open-source + crowdsourced, Wikipedia-style license — closest to our movement ethos). **No one combines** the
rigorous workbench + open publishing + social layer + Shia niche + sacred canonical-substitution → that's our moat.
The space is heating up (2024–26 entrants), so community + open-source + niche + speed matter.

## 10. Runtime state at handoff

- Backend was UP on :8000 (dev, --reload). Frontend was DOWN.
- Env config reference: `server/DEPLOY.md` (DATABASE_URL, STORAGE_BACKEND + S3_*, HAYDARI_SECRET_KEY,
  HAYDARI_ADMIN_EMAIL/PASSWORD, HAYDARI_COOKIE_SECURE, HAYDARI_ENV, TRANSLATION_MODEL_*, OCR_MODEL, etc.).
- Measured cost: ~$0.013/page translate + ~$0.001/page OCR; frontier model ≈85% of cost; ~60s/page currently
  (parallel ingestion is the big speedup, not yet built — Phase 5).

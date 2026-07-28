# Deploying Haydari (production)

The app runs on **SQLite + local files** by default (dev). For production it
switches to **Postgres + S3/R2** purely via environment variables — no code
changes. Same code, both modes.

## Environment variables

### Database
| Var | Dev (default) | Production |
|-----|---------------|------------|
| `DATABASE_URL` | *(unset → SQLite)* | `postgresql://USER:PASS@HOST:5432/DBNAME` |

When `DATABASE_URL` is set, the app uses Postgres (schema auto-created from
`server/db/schema_pg.sql` on startup). When unset, it uses a local SQLite file.

### File storage (PDFs, page images)
| Var | Dev (default) | Production (Cloudflare R2 / AWS S3) |
|-----|---------------|-------------------------------------|
| `STORAGE_BACKEND` | `local` | `s3` |
| `S3_BUCKET` | — | your bucket name |
| `S3_ENDPOINT_URL` | — | R2: `https://<account_id>.r2.cloudflarestorage.com` (omit for AWS) |
| `S3_REGION` | — | `auto` for R2, else the AWS region |
| `S3_ACCESS_KEY_ID` | — | access key |
| `S3_SECRET_ACCESS_KEY` | — | secret key |

### Auth (Phase 2)
| Var | Notes |
|-----|-------|
| `HAYDARI_SECRET_KEY` | **secret** — signs session cookies. MUST be set in production (a dev fallback is used otherwise). Rotating it logs everyone out. |
| `HAYDARI_ADMIN_EMAIL` | bootstrap admin email (created once, on first startup when no users exist) |
| `HAYDARI_ADMIN_PASSWORD` | bootstrap admin password — set a strong one; change it after first login |
| `HAYDARI_COOKIE_SECURE` | `true` in production (HTTPS) so the session cookie is Secure-only |

Access model: anonymous visitors can read **published** books (the public library); creators/reviewers log in to manage their own books; admins manage everything and provision accounts via `POST /api/auth/users`.

### Translation (already in use)
| Var | Notes |
|-----|-------|
| `OPENROUTER_API_KEY` | **secret** — set in the host's secret store, never in git |
| `TRANSLATION_MODEL_BULK` | e.g. `google/gemini-2.5-flash` |
| `TRANSLATION_MODEL_FRONTIER` | e.g. `google/gemini-2.5-pro` |
| `OCR_MODEL` | vision model, e.g. `google/gemini-2.5-flash` |
| `HAYDARI_CHAT_MODEL` | assistant model |
| `HAYDARI_MAX_PAGES_PER_RUN` | per-run page cap (default 20) |

## One-time setup (owner)
1. **Render** account → create a **PostgreSQL** instance (copy its `DATABASE_URL`)
   and a **Web Service** (this repo) + a **Background Worker** (the ingest worker).
2. **Cloudflare R2** → create a bucket + an API token; note the account endpoint,
   bucket name, and keys.
3. Paste all env vars above into the Render service's Environment settings.

## Still to build before public launch
- Phase 2: accounts + login (per-user data scoping)
- Phase 3: per-user quotas + global spend cap
- Phase 4: Dockerfile / render.yaml, dedicated worker, HTTPS + domain

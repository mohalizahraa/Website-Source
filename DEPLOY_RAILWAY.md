# Deploying Haydari to Railway + Cloudflare

Railway **ignores `render.yaml`**. It builds each service from that service's
**Root Directory**, using a Dockerfile found there (or Nixpacks auto-detect).
This is a monorepo, so you create **two services + one database** from the same
repo, each with a different Root Directory:

| Railway service | Root Directory | Builds |
|---|---|---|
| **haydari-api** (backend + ingest worker) | `/` (repo root) | `server/Dockerfile` (via `railway.json`) — includes `pipeline/` + poppler |
| **haydari-web** (Next.js) | `web` | `web/Dockerfile` (node:20) |
| **Postgres** | — | Railway managed database |

Replace `haydari.org` with your domain throughout.

---

## Fix the `npm: not found` build (frontend)
That service is building from the **repo root** (where Railway sees the Python
backend — no npm). Point it at the web folder:

1. Open the frontend service → **Settings → Source / Build**.
2. Set **Root Directory = `web`**.
3. Redeploy. Railway now uses `web/Dockerfile` (node:20) → npm is present → build succeeds.

That's the whole fix for the error you hit. The rest below is the full setup.

## 1. Backend service (haydari-api)
1. **New → Deploy from GitHub repo →** `hhabdul/haydari`.
2. **Settings → Root Directory = `/`** (blank/root). Railway reads `railway.json`
   → builds `server/Dockerfile` with the repo root as context.
3. Railway sets `PORT`; the app binds it. Health check is `/api/health`.

## 2. PostgreSQL
1. In the project: **New → Database → Add PostgreSQL**.
2. On **haydari-api → Variables**, add `DATABASE_URL` = reference
   `${{Postgres.DATABASE_URL}}` (Railway's variable reference picker). The app
   auto-creates its schema on first boot from `server/db/schema_pg.sql`.

## 3. Backend variables (haydari-api → Variables)
| Var | Value |
|-----|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `HAYDARI_ENV` | `production` |
| `HAYDARI_COOKIE_SECURE` | `true` |
| `HAYDARI_SECRET_KEY` | a long random string (session signing) |
| `HAYDARI_ADMIN_EMAIL` | your admin email |
| `HAYDARI_ADMIN_PASSWORD` | a strong password |
| `OPENROUTER_API_KEY` | your OpenRouter key |
| `STORAGE_BACKEND` | `s3` |
| `S3_BUCKET` | your R2 bucket name |
| `S3_ENDPOINT_URL` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_ACCESS_KEY_ID` | R2 token key |
| `S3_SECRET_ACCESS_KEY` | R2 token secret |
| `HAYDARI_CORS_ORIGINS` | `https://haydari.org` |
| `TRANSLATION_MODEL_BULK` | `google/gemini-2.5-flash` |
| `TRANSLATION_MODEL_FRONTIER` | `google/gemini-2.5-pro` |
| `OCR_MODEL` | `google/gemini-2.5-flash` |

> With `HAYDARI_ENV=production` the API refuses to boot unless `HAYDARI_SECRET_KEY`,
> `HAYDARI_ADMIN_EMAIL`, `HAYDARI_ADMIN_PASSWORD`, and `HAYDARI_COOKIE_SECURE=true`
> are set — so set all four.

## 4. Frontend variables (haydari-web → Variables)
| Var | Value |
|-----|-------|
| `NEXT_PUBLIC_DATA_SOURCE` | `api` |
| `NEXT_PUBLIC_API_BASE` | `https://api.haydari.org/api` |

`NEXT_PUBLIC_*` are inlined at **build** time (Railway passes variables to the
Docker build). `web/Dockerfile` already defaults `NEXT_PUBLIC_API_BASE` to the
production URL, so it works even before you set it — but set it to be explicit,
then **redeploy** if you change it.

## 5. Cloudflare R2 (storage)
1. Cloudflare → **R2** → create a bucket (e.g. `haydari-files`).
2. **Manage R2 API Tokens** → create a token with **Object Read & Write** on that
   bucket. Copy the Access Key ID + Secret. Endpoint is
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Fill the `S3_*` vars above.

## 6. Domains
1. **haydari-web → Settings → Networking → Custom Domain** → add `haydari.org`.
2. **haydari-api → Settings → Networking → Custom Domain** → add `api.haydari.org`.
   Railway shows a CNAME target for each.
3. In **Cloudflare → DNS** add CNAMEs to those targets:
   - `api` → `<haydari-api>.up.railway.app` (or the shown target)
   - `@` / `haydari.org` → `<haydari-web>.up.railway.app` (Cloudflare flattens the apex CNAME)
   - Start **DNS only** (grey cloud) so TLS validates; you can enable the proxy
     (orange, SSL **Full (strict)**) afterward.

Because `haydari.org` and `api.haydari.org` share the registrable domain, the
`SameSite=Lax; Secure` session cookie flows on the frontend's credentialed calls,
and `HAYDARI_CORS_ORIGINS` pins CORS to exactly your frontend.

## 7. First login
Visit `https://haydari.org/login` → sign in with `HAYDARI_ADMIN_EMAIL` /
`HAYDARI_ADMIN_PASSWORD`. Add team members and set spend caps / the per-run page
limit under the avatar menu → **Admin settings**.

---

## Operating notes
- **Keep haydari-api at 1 replica.** The ingest queue + worker thread are
  in-memory; a restart interrupts an in-flight ingest but it's resumable
  (committed pages persist; stale `processing` books reset on startup).
- **Schema/migrations run on startup** (idempotent).
- Full env-var reference: `server/DEPLOY.md`. Model spend (OpenRouter) is separate
  and bounded by the quotas you set in Admin settings.

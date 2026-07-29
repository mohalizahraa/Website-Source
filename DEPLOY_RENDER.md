# Deploying Haydari to Render + Cloudflare

Architecture: **Render** runs the API (+ in-process ingest worker), the Next.js
frontend, and PostgreSQL. **Cloudflare** provides the domain (DNS) and an **R2**
bucket for PDF/image storage. Everything lives under your one domain so the
session cookie and CORS stay locked to your origin.

```
Cloudflare  ──▶  DNS (haydari.com, api.haydari.com) + R2 bucket
Render      ──▶  haydari-api (Docker)  ·  haydari-web (Node)  ·  haydari-db (Postgres)
```

Replace `haydari.com` below with your real domain throughout.

---

## 1. Cloudflare R2 (file storage)
1. Cloudflare dashboard → **R2** → *Create bucket* → name it e.g. `haydari-files`.
2. R2 → *Manage R2 API Tokens* → **Create API token** → permission **Object Read & Write**,
   scoped to that bucket. Copy the **Access Key ID** and **Secret Access Key** (shown once).
3. Note your **account endpoint**: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   (your account ID is in the R2 overview URL / bucket settings).

You now have: `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
(`S3_REGION` is already `auto` in the blueprint.)

## 2. Get the code into your account
Already done if I pushed it for you → `github.com/hhabdul/haydari` (private).
It contains `render.yaml`, `server/Dockerfile`, and this guide.

## 3. Create the Render Blueprint
1. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**.
2. Connect GitHub, pick **hhabdul/haydari**, branch **main**. Render reads `render.yaml`
   and proposes: `haydari-db`, `haydari-api`, `haydari-web`.
3. Click **Apply**. The database and both services are created. `DATABASE_URL` and
   `HAYDARI_SECRET_KEY` are wired/generated automatically.
   - If a `plan` value isn't offered on your account, pick an available one when prompted.

## 4. Set the secret env vars (dashboard)
On **haydari-api** → *Environment*, fill the `sync:false` vars:

| Var | Value |
|-----|-------|
| `HAYDARI_ADMIN_EMAIL` | your admin email (bootstrap account) |
| `HAYDARI_ADMIN_PASSWORD` | a strong password (change after first login) |
| `OPENROUTER_API_KEY` | your OpenRouter key |
| `S3_BUCKET` | `haydari-files` |
| `S3_ENDPOINT_URL` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_ACCESS_KEY_ID` | from step 1 |
| `S3_SECRET_ACCESS_KEY` | from step 1 |
| `HAYDARI_CORS_ORIGINS` | `https://haydari.com` (your frontend origin, exact) |

On **haydari-web** → *Environment*:

| Var | Value |
|-----|-------|
| `NEXT_PUBLIC_API_BASE` | `https://api.haydari.com/api` |

> `NEXT_PUBLIC_API_BASE` is baked in at **build** time — after changing it, trigger a
> *Manual Deploy → Clear build cache & deploy* on haydari-web.

Save → both services redeploy.

## 5. Custom domains + Cloudflare DNS
1. **haydari-api** → *Settings → Custom Domains* → add `api.haydari.com`. Render shows a
   target hostname (`…onrender.com`).
2. **haydari-web** → add `haydari.com` (and `www` if you want).
3. In **Cloudflare → DNS**, add **CNAME** records to the Render targets:
   - `api` → `haydari-api-….onrender.com`
   - `@` (or `haydari.com`) → `haydari-web-….onrender.com`
   - Start **DNS only** (grey cloud) so Render can issue TLS and validate. Once green in
     Render, you may enable the proxy (orange) with SSL mode **Full (strict)**.
4. Wait for Render to show the domains **Verified / Certificate Issued**.

Because `api.haydari.com` and `haydari.com` share the same registrable domain, the
`SameSite=Lax; Secure` session cookie is sent on the frontend's credentialed calls, and
`HAYDARI_CORS_ORIGINS` pins CORS to exactly your frontend.

## 6. First login
Visit `https://haydari.com/login` → sign in with `HAYDARI_ADMIN_EMAIL` /
`HAYDARI_ADMIN_PASSWORD`. Then:
- Change the admin password path (re-provision or rotate) and add team members via the
  avatar menu → **Add team member**.
- Set spend caps + the per-run page limit via **Admin settings**.

---

## Operating notes
- **Single API instance.** The ingest queue and worker thread are in-memory; keep
  `haydari-api` at 1 instance (don't enable autoscaling). A deploy/restart interrupts an
  in-flight ingest, but it's resumable — committed pages persist and stale `processing`
  books reset on startup.
- **Schema & migrations run on startup.** `init_db` creates tables from `schema_pg.sql`
  and applies additive migrations each boot — idempotent. (For multi-instance later, run
  migrations once before scaling.)
- **Production safety gate.** With `HAYDARI_ENV=production` the API refuses to boot unless
  `HAYDARI_SECRET_KEY`, `HAYDARI_ADMIN_EMAIL`, `HAYDARI_ADMIN_PASSWORD`, and
  `HAYDARI_COOKIE_SECURE=true` are set (all handled by the blueprint + step 4).
- **Cost** (approx, US): Postgres `basic-256mb` + two `starter` services ≈ low-$20s/mo.
  A `free` Postgres/instance works to try it but sleeps/expires — not for the always-on
  worker. Model spend is separate (OpenRouter, ~$0.013/translated page) and capped by the
  quotas you set.
- **Full env-var reference:** `server/DEPLOY.md`.

## Future scaling (not needed now)
Dedicated worker service backed by a DB-polled job queue (instead of the in-process
queue), so the API can scale horizontally and the worker survives API restarts.

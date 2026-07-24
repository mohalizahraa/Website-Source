# Miʿrāj — Haydari Review Workbench (web)

Next.js (App Router) + TypeScript frontend for the Haydari translation platform.
It provides the **Library / ingestion** home screen and the **review workbench**
(confidence triage, tracked-changes editing, QA insights, and model teaching).

The UI is a review-driven learning flywheel: every edit, score, and approval is
captured as structured data and sent back to improve the next page.

## Design language

Green + off-white + gold. Green (`--lapis*`) is the brand accent; **gold
(`--gilt*`) is reserved exclusively for sacred / Qurʾān elements** and is never
part of the confidence scale. The confidence heatmap is semantic and distinct:
high (green), medium (amber), low (red). Full light **and** dark themes,
`prefers-reduced-motion` aware, keyboard-navigable, correct RTL for Arabic.

## Run it

Requires Node 18+.

```bash
cd web
npm install      # first time only (needs network for the registry)
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

## Standalone (no backend required)

The whole app runs offline against local fixtures. All server access goes
through a single data layer (`lib/api`) with two adapters selected by an env
flag:

| `NEXT_PUBLIC_DATA_SOURCE` | Adapter | Behaviour |
| ------------------------- | ------------------- | ------------------------------------- |
| `mock` (default)          | `lib/api/mock.ts`   | In-memory fixtures, no network needed |
| `api`                     | `lib/api/http.ts`   | Real FastAPI backend                  |

Copy `.env.local.example` to `.env.local` to configure:

```bash
NEXT_PUBLIC_DATA_SOURCE=mock      # or "api"
NEXT_PUBLIC_API_BASE=/api         # backend base URL (api adapter only)
```

The mock fixtures (`lib/fixtures/seed.ts`) mirror `server/seed.py`: the same
eight review segments — including the sacred **Qurʾān 57:3 (al-Ḥadīd)** segment,
which is locked, gilt-styled, and rendered from the canonical DB (never
machine-translated) — plus a small multi-book library with varied statuses
(uploaded / processing / in review / published) and a simulated ingestion job so
progress polling works offline.

## Routes

- `/` — **Library**: book grid (Arabic + English title, status pill, progress
  bar), a drag-and-drop **upload** zone (single & bulk PDFs + optional metadata),
  glossary/termbase CSV import, and per-book **Ingest** actions with live
  progress polling.
- `/review/[bookId]` — the **review workbench**.

## Components

| Component | Role |
| ------------------------ | ---------------------------------------------------------------- |
| `TopBar` | Book title (Arabic RTL + English), page pager, save state, keyboard hints, reviewer avatar |
| `SegmentRail` | Progress ring, confidence heatmap list (green/amber/red + sacred=gold), Focus-mode toggle |
| `DocEditor` | Doc-style editable surface, tracked changes (ins/del), linked footnote superscripts, locked sacred segments |
| `ContextPanel` | Arabic source (RTL), source scan, insights (confidence/bt-sim/self-consistency/engine/judge note/alternatives), 1–5 quality scores, MQM chips, teach-the-model actions |
| `Library` / `UploadZone` | Home screen: library grid, upload + ingestion, termbase import |
| `Toast` | Subtle "learning" toast confirming captured feedback |

## API calls wired (see `ARCHITECTURE.md`)

- `GET /books`, `GET /books/{id}`
- `POST /books/upload` (multipart), `POST /books/import`
- `POST /books/{id}/ingest`, `GET /books/{id}/status` (polled)
- `POST /termbase/import` (multipart CSV)
- `GET /books/{id}/pages/{n}`, `GET /segments/{id}`
- `POST /segments/{id}/review`
- `POST /termbase`, `POST /style-rules`, `GET /learning/summary`

## Keyboard

`J` / `K` move between segments · `A` approve · `⌘S` / `Ctrl+S` save. Editing a
segment suspends J/K/A so typing is unaffected; `⌘S` always works. All controls
are reachable by Tab with visible focus rings.

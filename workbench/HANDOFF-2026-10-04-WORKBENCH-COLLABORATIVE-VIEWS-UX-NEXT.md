# HANDOFF — 2026-10-04 — Workbench collaborative views / UX next

Status: restart-safe continuation projection for the Haydari Translation Workbench UX work.  
Repository: `mohalizahraa/Website-Source`  
Branch: `workbench`  
Current implemented code wave: guarded English Book opens + founder-approved Board viewing scope.  
Current live-deployment state: **repo implementation complete; production Cloudflare Pages still serving the prior Board markup at last verification**.

This handoff does **not** replace book-local truth. Repentance remains owned by:

- `workbench/HANDOFF-2026-10-04-REPENTANCE-132-OF-132-NEEDS-REVIEW-PROGRESS-INVARIANT-FIX.md`

Repentance is complete at **132/132**, fully formatted, and **Needs Review**. Do not resume stale translation checkpoints.

## 1. Founder-approved collaboration model — implemented in repo

The founder approved separate Board viewing scopes:

- **Zahraa** — books assigned to Zahraa plus `Both`;
- **Mohammed** — books assigned to Mohammed plus `Both`;
- **Shared** — Zahraa + Mohammed + `Both` across the normal five status columns, with `Unassigned` retained visibly as a distinct team inbox.

The Board scope is independent of the global actor identity. Changing the Board view never changes assignment or mutation attribution.

Implementation details now present on `workbench`:

- Board-local segmented control: `Zahraa | Mohammed | Shared`;
- locally remembered `haydariBoardScope`;
- default scope: `Shared`;
- individual scopes include `Both`;
- Shared scope keeps `Unassigned` visible in a separate team-inbox section;
- five workflow columns and drag/drop status semantics remain intact;
- responsive styling is included for the scope control and Unassigned queue.

Canonical product contract was updated in `workbench/README.md`.

Relevant commits:

- `15730564d4aad9e60a9b70fd8fc447c1e71128f0` — guarded English Book opens + Board scope client logic;
- `e8125701b2d55a497dce62cdffaaebe01d01aa75` — Board scope markup;
- `31a57dc7694ef7056f884eedc4ee204e0e489057` — Board scope / Unassigned styling;
- `f6520994dbfd36bd8859d751861ccb106a92d1dd` — Board scope canonical README contract.

## 2. English Book access-guard regression — repaired in repo

The canonical invariant remains:

> a linked English Book must be access-checked before opening so a collaborator is never sent to Google's Request access screen.

The server-side guard already existed at:

- `workbench/functions/api/english-book/[id].js`

The prior browser client bypassed it through direct `google_doc_url` navigation. That regression is now repaired in `workbench/public/app.js`.

Current browser behavior:

- linked **English Book** actions resolve through `/api/english-book/:id` before navigation;
- **Work on Book** resolves the English Book through the guard before navigating and only then releases the reserved Arabic-PDF window;
- post-link continuation validates the saved link and resolves through the same guard before navigation;
- direct project-URL navigation and direct linked-Doc anchors were removed.

Static source verification after the edit confirmed:

- final `app.js` parses;
- no direct `window.location.assign(project.google_doc_url)` remains;
- no linked English Book anchor points directly at `google_doc_url`;
- all remaining English Book navigation values are returned by the guard endpoint.

## 3. Verification state

### Repo/static

Manual exact-source checks passed for the new Board semantics and English Book routing.

The repository's self-hosted **Workbench static acceptance** run for the latest code-changing commit is:

- run `37189437051`;
- head `31a57dc7694ef7056f884eedc4ee204e0e489057`;
- state at last check: **pending**.

Earlier runs for the immediately preceding commits were cancelled by the workflow's existing `cancel-in-progress` concurrency behavior.

Do not claim the full acceptance workflow passed until that self-hosted run reaches success.

### Production deployment

The Workbench is documented as a Cloudflare Pages Git-integrated deployment:

- production branch: `workbench`;
- root: `workbench`;
- output: `public`;
- Functions: `functions`;
- D1 binding: `DB`.

Fresh production checks against:

- `https://haydari-translation-workbench.pages.dev/`

still returned the **old** Board markup:

`<section class="view" id="board-view"><div class="board" id="board"></div></section>`

rather than the new Board scope toolbar.

GitHub combined commit status on the new commits reports only a failing **Vercel** status pointing to Vercel's blocked-deployment page. No Cloudflare deployment status is attached. The repository contains no Cloudflare deployment workflow or Wrangler deploy command; production currently depends on the external Cloudflare Git integration.

Therefore the truthful current state is:

> **implemented and statically checked in the repo; not yet verified live.**

Do not silently equate branch state with production state.

## 4. Next deployment action / blocker

The next agent-owned action is to re-check production and the self-hosted acceptance run.

If production remains stale, the unresolved blocker is the external Cloudflare Pages Git integration / deployment state. Do not invent credentials or claim deployment access that is not available. If a supported Cloudflare control surface or credential-backed deploy path becomes available, deploy the current `workbench` branch without changing the D1 data model and verify the actual user path afterward.

Do not fall back to Railway. Founder platform policy blocks Railway.

## 5. Pending UX recommendations — founder approval required

These were recommendations from the prior UX review and remain **unapproved**. Do not implement them merely because Board scope was approved.

### A. Reuse viewing scope on Timeline + clarify identity wording

Recommended:

- reuse the `Zahraa | Mohammed | Shared` view-scope primitive on Timeline;
- individual Timeline views include `Both`;
- Shared shows team schedule and keeps Unassigned dated work distinct;
- rename global `Using as` to clearer identity/attribution wording such as **Editing as** or **Identity** so it cannot be confused with view scope.

### B. Dashboard drill-down navigation

Make existing Dashboard summaries navigational:

- By person → corresponding scoped Board/Projects view;
- Needs review / deadlines / missing PDF etc. → matching filtered destination.

Do **not** turn Dashboard into an automatic priority/task-recommendation engine.

### C. Activity filters

Add lightweight filters such as:

- All / Zahraa / Mohammed / System;
- optional event-type filtering.

Keep the current terse activity wording; do not revive semantic field-by-field prose.

### D. Scan-speed ownership badges

Add a small assignee chip near compact Board-card metadata.

- render `Both` as human-facing **Shared**;
- retain the actual assignment value `Both` in data.

### E. Mobile Board status navigation

Make Board status usable without horizontal five-column panning or drag-only interaction:

- one status column at a time / status tabs on narrow screens;
- tap-friendly status change control on each card;
- desktop drag/drop remains an enhancement.

### F. Suspicious-date warning

When a newly entered deadline is unusually far in the past, show a non-blocking confirmation such as:

> This deadline is in the past — keep it?

Do not globally ban historical dates.

## 6. Existing founder constraints still governing

Do not undo these:

- no automatic “what should I work on next?” Dashboard prioritizer;
- no semantic field-by-field Activity narration;
- no priority/blocker metadata resurrection;
- no new Workbench project creation unless explicitly requested;
- preserve the archival parchment / oxblood / gold / sage identity while keeping modern touch/form affordances;
- mobile/iPhone paths must remain practical;
- shared state remains live-synced;
- assignment is organizational metadata, not an ACL;
- `Both` means shared assignment;
- zero paid GitHub compute; self-hosted runners only for GitHub Actions execution;
- Railway remains blocked.

## 7. Suspended infrastructure loops

Keep visible without letting them hijack the UX wave:

- Google Drive “Anyone with the link → Editor” permissions remain a separate sharing-state concern from Workbench guard routing unless independently verified;
- permanent self-hosted runner capacity/routing remains an infrastructure loop.

## Exact continuation

1. Re-check `37189437051` and the production `#board-view`.
2. If production is current, verify Board scope and guarded English Book behavior on the deployed surface.
3. If production is still stale, preserve the Cloudflare Git-integration blocker exactly; do not claim live completion.
4. Ask the founder to approve/reject the six pending UX recommendation groups above.
5. Implement only the approved groups, then run static + deployed verification.

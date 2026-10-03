# Haydari Workbench

Internal collaborative work manager for translating Sayyid Kamal al-Haydari's books. This is intentionally separate from the public archive/publication surface.

## Product contract

- One shared workspace and database for Zahraa + Mohammed (Brother).
- No account/login/password UI.
- Access uses one long shared capability key carried in the URL fragment (`#key=...`); the browser remembers it locally and sends it only to the same-origin API.
- Either collaborator may edit or reassign any project. Assignee is organizational metadata, not an ACL.
- Device identity is selected as `Zahraa` or `Mohammed` and is used only for activity attribution.
- Statuses: **Not Started → In Progress → Review → Completed → Published**.
- The Workbench preserves the archive's parchment / paper / oxblood / gold / sage visual language and Amiri + EB Garamond typography.
- The primary Arabic-source action must open the direct PDF file. A catalogue detail/download page is never labeled as the Arabic PDF.
- Projects without a direct PDF are visibly labeled **PDF missing** and can be filtered as a group.
- **Completed means ready for publishing.**
- Translation progress numerator = `Completed + Published`.
- Publication progress numerator = `Published` only.
- `blocked` is a separate flag, not a status.

## Data boundary

The public book catalogue metadata is committed as `functions/_catalog.js` and is derived from the canonical archive on `main`. The Workbench reconciles that catalogue into D1 without overwriting existing assignment/progress state.

Private work state — assignments, deadlines, progress, notes, working Google Doc links, activity, and the shared access key — remains runtime data in D1 / encrypted Cloudflare secrets and must not be committed to this public repository.

Current catalogue denominator: **176 books**. The latest full HTTP/PDF audit verified **62 working direct PDFs** and classified **114 as missing/unusable**. A filename ending in `.pdf` is not enough; availability is based on an actual retrievable PDF response.

## Cloudflare Pages + D1

Recommended Git-integrated Pages settings:

- Production branch: `workbench`
- Root directory: `workbench`
- Framework preset: none
- Build command: blank
- Build output directory: `public`
- Functions directory: `functions/`

Required runtime configuration:

- D1 binding named `DB`
- encrypted secret `WORKBENCH_ACCESS_TOKEN`

The shared capability URL is `https://<workbench-host>/#key=<long-random-secret>`. Anyone who obtains the key can access/edit the workspace, by design.

## Verification

`npm run check` syntax-checks the browser application and Pages Functions. Apply `schema.sql` to D1 before the first production launch, then seed the authorized project data directly into D1 without committing it to Git.


## PDF availability contract

A URL that merely ends in `.pdf` is not considered available. Candidate URLs are validated server-side in small batches and persisted in D1 as `unchecked`, `available`, or `missing`.

- The UI exposes an **Arabic PDF** button only for `available` files.
- Verified files open through the Workbench's inline PDF proxy, avoiding flaky direct navigation to the legacy archive host. The proxy forwards byte-range requests so Safari/iPhone can render and seek large PDFs inline.
- HTTP 404/410 or a successful response that is not actually a PDF becomes `missing`.
- Transient/rate-limit/server failures remain `unchecked` for later retry rather than being falsely labeled missing.
- Editing a PDF URL resets it to `unchecked`.
- The Projects view supports **Missing PDF only** filtering.

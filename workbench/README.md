# Haydari Workbench

Internal collaborative work manager for translating Sayyid Kamal al-Haydari's books. This is intentionally separate from the public archive/publication surface.

## Product contract

- One shared workspace and database for Zahraa + Brother.
- No account/login/password UI.
- Access uses one long shared capability key carried in the URL fragment (`#key=...`); the browser remembers it locally and sends it only to the same-origin API.
- Either collaborator may edit or reassign any project. Assignee is organizational metadata, not an ACL.
- Device identity is selected as `Zahraa` or `Brother` and is used only for activity attribution.
- Statuses: **Not Started → In Progress → Review → Completed → Published**.
- **Completed means ready for publishing.**
- Translation progress numerator = `Completed + Published`.
- Publication progress numerator = `Published` only.
- `blocked` is a separate flag, not a status.

## Private data boundary

Project assignments, deadlines, progress, notes, working Google Doc links, activity, and the shared access key are runtime data. They belong in D1 / encrypted Cloudflare secrets and must not be committed to this public repository.

The initial project list is provisioned directly into D1 from the authorized source document during deployment. The repository contains only schema and application code.

## Cloudflare Pages + D1

Pages project root: `workbench/`  
Static output: `public/`  
Functions: `functions/`

Required runtime configuration:

- D1 binding named `DB`
- encrypted secret `WORKBENCH_ACCESS_TOKEN`

The shared capability URL is `https://<workbench-host>/#key=<long-random-secret>`. Anyone who obtains the key can access/edit the workspace, by design.

## Verification

`npm run check` syntax-checks the browser application and Pages Functions. Apply `schema.sql` to D1 before the first production launch, then seed the authorized project data directly into D1 without committing it to Git.

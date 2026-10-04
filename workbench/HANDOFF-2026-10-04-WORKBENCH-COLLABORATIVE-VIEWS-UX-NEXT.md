# HANDOFF — 2026-10-04 — Workbench collaborative views / UX next

Status: restart-safe continuation projection for the Haydari Translation Workbench UX work.  
Repository: `mohalizahraa/Website-Source`  
Branch: `workbench`  
Implementation head before this handoff: `d5c19597183c6b620f8c293b78e23f3879044cd1`

This handoff does **not** replace the current Repentance completion handoff. Book-local truth remains owned by:

- `workbench/HANDOFF-2026-10-04-REPENTANCE-132-OF-132-NEEDS-REVIEW-PROGRESS-INVARIANT-FIX.md`

Repentance is complete at **132/132** and **Needs Review**. Do not resume stale translation checkpoints.

## 1. Current product direction

The founder noticed that the Board currently mixes all assignees into one Kanban and proposed that collaborators should be able to see:

- Zahraa's work;
- Mohammed's work;
- a shared/team view.

The recommended Board model was:

- **Zahraa** — books assigned to Zahraa **plus `Both`**;
- **Mohammed** — books assigned to Mohammed **plus `Both`**;
- **Shared** — the combined team board, with shared/team work visible together and Unassigned kept visible rather than silently lost.

The global identity control remains a separate concept: it determines actor attribution and personal Dashboard behavior. Board viewing scope must not silently mutate assignments or actor identity.

The founder responded positively (“Ooh nice. Yeah”), so treat the **Board-scoping direction as founder-approved**, while exact microcopy/layout remains implementation-owned unless later corrected.

The Board scope has **not yet been implemented** as of this handoff.

## 2. Current Board implementation

Current `renderBoard()` in `workbench/public/app.js`:

- applies only global search text;
- then divides the full matching project set into the five workflow columns;
- has no local assignee/team scope;
- supports desktop drag/drop for status changes;
- compact Board cards expose assignee and deadline quick controls but not a tap-friendly status control.

Current global actor state is persisted in `localStorage` as `haydariActor` and currently personalizes:

- Dashboard assigned-project surfaces;
- Dashboard live translation progress;
- Projects “My assignments”.

The Board does not currently react to actor identity except indirectly through API attribution on mutations.

## 3. Recommended next UX wave

### A. Founder-approved Board scope

Add a Board-local segmented scope control:

> Zahraa | Mohammed | Shared

Behavior:

- Zahraa = `assignee === Zahraa || assignee === Both`;
- Mohammed = `assignee === Mohammed || assignee === Both`;
- Shared = Zahraa + Mohammed + Both; keep Unassigned visible as a distinct queue/section rather than making it disappear;
- scope changes **view only**, never assignee or actor identity;
- remember the chosen Board/view scope locally on that device;
- preserve the five existing status columns and their drag/status semantics.

### B. Recommended: use the same view-scope concept on Timeline

The Timeline is another coordination surface and currently shows every dated project.

Recommended:

- reuse the same `Zahraa | Mohammed | Shared` viewing scope;
- individual views include `Both`;
- Shared shows the team schedule;
- Unassigned dated work remains visible distinctly;
- use one reusable “view scope” owner rather than separate ad-hoc filtering logic per screen.

Do **not** automatically scope the corpus-wide Stats model unless that is separately approved; Stats currently has different semantics.

### C. Recommended: disambiguate identity from viewing scope

Once local view scope exists, `Using as` becomes easy to confuse with “whose projects am I looking at?”

Recommended:

- rename the global control to something explicit such as **Editing as** or **Identity**;
- local collaboration controls should use **View** / **Viewing** language;
- changing identity continues to control attribution + personalized Dashboard;
- changing view scope controls only what a Board/Timeline surface displays.

### D. Recommended: make Dashboard summaries navigational

The Dashboard's **Right now** and **By person** rows are currently inert summaries.

Recommended:

- clicking Zahraa/Mohammed/Both from **By person** opens the corresponding scoped Board or Projects view;
- clicking **Needs review**, **With deadlines**, **Missing PDF**, etc. opens the relevant filtered destination;
- this turns existing information into low-click navigation without creating a new priority/“what should I do next” system.

This respects the founder's existing decision **not** to convert Dashboard into an automatically prioritized task list.

### E. Recommended: Activity filters, not Activity prose expansion

Activity currently renders one unfiltered chronological feed.

Recommended lightweight controls:

- All / Zahraa / Mohammed / System;
- optionally event type such as translation progress vs project changes;
- retain the current terse event wording.

Do **not** revive the previously rejected semantic field-by-field Activity prose expansion.

### F. Recommended: make shared ownership legible at scan speed

On compact Board cards, assignment is currently visible mainly in a small select lower on the card.

Recommended:

- add a small assignee chip/badge near the status metadata;
- render `Both` as human-facing **Shared**;
- Shared scope should make Unassigned work visibly distinct.

This improves scanning without introducing another data model.

### G. Recommended: make Board fully usable on iPhone/touch

The current Board is five `minmax(220px)` columns in a horizontal scroller and status changes primarily rely on drag/drop.

Recommended mobile behavior:

- use status tabs/chips or one status column at a time on narrow screens rather than requiring a five-column pan;
- provide a tap-friendly status change action on each Board card so drag/drop is never the only practical status control;
- preserve desktop drag/drop as an enhancement.

This aligns with the existing Workbench mobile usability contract.

### H. Recommended: suspicious-date warning

A live data incident put **Our Ethics** at deadline `2023-01-18`, stretching the whole Timeline back to 2023.

That record was repaired and a live verification found **zero pre-2026 start/deadline values** afterward.

Do not ban historical dates globally; legitimate overdue/backdated work may exist.

Recommended instead:

- when a newly entered deadline is unusually far in the past, show an inline warning/confirmation such as **“This deadline is in the past — keep it?”**;
- keep valid historical dates possible.

This catches likely mistypes without corrupting legitimate schedule semantics.

## 4. Urgent existing regression discovered during this UX review

The canonical README still requires:

> linked English Books must be access-checked before opening so users are not sent to Google's Request access screen.

The server-side guard still exists:

- `workbench/functions/api/english-book/[id].js`

But the **current browser client bypasses it**:

- `googleDocLinkMarkup(p)` renders a direct `<a href="google_doc_url">`;
- `startWorkOnBook(id)` navigates directly with `window.location.assign(project.google_doc_url)`;
- post-link continuation also navigates directly to the supplied URL.

This is a **real implementation regression against an already-canonical invariant**, not a new UX recommendation.

Repair it before or alongside the collaborative-view wave:

- restore guarded resolution through `/api/english-book/:id` before every English Book open;
- preserve the create/link flow;
- ensure Work on Book still opens the canonical Arabic PDF plus the verified English Book;
- do not reintroduce the prior JavaScript syntax-corruption incident while restoring the guard;
- syntax-check the exact final `app.js` and verify the deployed user path.

## 5. Timeline incident — repaired state

The 2023 Timeline stretch was traced to one erroneous live D1 value:

- project 80 / `book-72` / **Our Ethics**
- bad deadline: `2023-01-18`

Activity proved that date had been manually written from a previously-null deadline.

The bad deadline was cleared through the live Workbench API with a guard that refused to mutate unless the current value was still exactly `2023-01-18`.

Verification run:

- repo: `mohalizahraa/userpkm`
- branch: `tmp/workbench-pdf-audit-20261003`
- run: `37183848131`
- conclusion: success

Verified live dated projects afterward:

- Repentance: due `2026-10-05`;
- The Infallibility of the Prophets in the Noble Qurʾān: due `2026-10-03`;
- pre-2026 dated projects: **0**.

Do not misdiagnose that incident as a Timeline calculation bug; it was a bad live deadline value.

## 6. Current Repentance state / return edge

Repentance is no longer an active translation task.

Current authority:

- project 3 / `book-123`;
- authoritative physical denominator: **132**;
- verified progress: **132/132**;
- status: **Needs Review**;
- full formatting pass complete;
- 170 native footnotes preserved;
- ordinary Arabic-letter residue in English body: 0 at verification.

If the UX tangent completes and book work resumes, the next Repentance-local action is **human review/QA**, not translation.

## 7. Other suspended-open infrastructure loops

Keep these visible but do not let them hijack the UX wave:

- Google Drive public sharing: the underlying “Anyone with the link → Editor” permission remains separate from Workbench routing/access validation unless independently verified fixed;
- permanent self-hosted runner capacity/routing remains an infrastructure loop, though userpkm self-hosted runners successfully supported Workbench PDF/progress/timeline work;
- founder zero-paid-GitHub-compute policy remains absolute.

## 8. Existing founder constraints that still govern this UX work

Do not undo these current product decisions:

- no automatic “what should I work on next?” Dashboard prioritizer;
- no semantic field-by-field Activity narration;
- no priority/blocker metadata resurrection;
- no new Workbench project creation unless explicitly requested;
- preserve the archival parchment/oxblood/gold/sage identity while keeping modern touch/form affordances;
- mobile/iPhone paths must remain practical;
- shared state remains live-synced;
- assignment is organizational metadata, not an ACL;
- `Both` means shared assignment.

## 9. Recommended implementation order after approval checkpoint

1. Repair the already-authorized English Book access-guard regression.
2. Implement founder-approved Board view scope.
3. Generalize the same view-scope primitive to Timeline and disambiguate global identity wording.
4. Add Dashboard drill-down navigation.
5. Add Activity filtering.
6. Add scan-speed assignee badges / Shared treatment.
7. Improve mobile Board status navigation/control.
8. Add non-blocking suspicious-date warning.

The recommendations beyond the Board direction have **not yet been founder-approved**. Present them for approval before durable product promotion/implementation unless the founder explicitly approves all in the continuation chat.

## Restart sentence

Freshly load `mohalizahraa/operator-protocol/AGENTS.md`, Core, the materially routed owners/profiles, `workbench/README.md`, the current `workbench/public/index.html`, `app.js`, and `styles.css`. Treat Repentance as **132/132 Needs Review**. Treat Board scoping (`Zahraa | Mohammed | Shared`) as the approved next collaborative-view direction. Before implementing optional UX recommendations, present the consolidated pending list for founder approval. Independently repair the existing English Book access-guard regression because it violates an already-canonical Workbench invariant.

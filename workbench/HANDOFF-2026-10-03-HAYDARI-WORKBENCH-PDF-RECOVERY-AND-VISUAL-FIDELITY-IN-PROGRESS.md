# Haydari Workbench — Restart-Safe Handoff

**Date:** 2026-10-03  
**Branch:** `workbench`  
**Repository:** `mohalizahraa/Website-Source`  
**Live app:** `https://haydari-translation-workbench.pages.dev/`  
**Current pre-handoff implementation head:** `dc132b23d6387cfa387856f8a672d2522b81a536`  
**Cloudflare Pages check at that head:** successful.

> **Security:** Never commit or reproduce the shared capability token, private Google Doc URLs, assignments/progress, notes, deadlines, or other private Workbench state in this public repository. The user-facing secret-link fragment remains outside Git. Runtime work state belongs in D1; the access token belongs in the encrypted Cloudflare secret `WORKBENCH_ACCESS_TOKEN`.

---

## 1. What this product is

This is the **internal Haydari Translation Workbench** used by Zahraa and her brother Mohammed to manage translation work across Sayyid Kamal al-Haydari's book corpus.

It is **not** the future official public publication/archive website.

The future official site will expose the public Arabic materials and, once ready, English PDF/publication links. The Workbench is the operational layer: assignments, statuses, progress, deadlines, working Google Docs, blockers, notes, completion/publication state, and activity history.

Do not collapse those two products back together.

---

## 2. Founder-locked collaboration / access model

The user explicitly does **not** want accounts, login screens, passwords, or normal authentication friction.

Required model:

- one shared Workbench website;
- one shared workspace/database;
- access by one long shared capability link;
- no separate "Zahraa site" and "Mohammed site";
- both collaborators see all projects and each other's progress;
- both collaborators may edit/reassign **any** project;
- assignment is organizational ownership, **not an access-control rule**;
- if Zahraa decides to take one of Mohammed's books, she must be able to reassign it herself from her side;
- device-selected identity is only for attribution/activity history;
- supported identities are **Zahraa** and **Mohammed**;
- activity should preserve who changed what;
- do not introduce individual capability links or per-assignee edit locks unless the founder explicitly reverses this model.

Anyone who obtains the shared capability key can access/edit the Workbench by design. Do not misrepresent this as stronger authentication.

---

## 3. Project/work model

The **project/book record is the system of record**. Trello-style boards are only one view of that data, not the underlying data model.

Every book/project should support, as applicable:

- Arabic title;
- English working title;
- canonical catalogue metadata;
- assignee: Zahraa / Mohammed / Both / Unassigned;
- status;
- priority;
- start date;
- deadline;
- direct Arabic PDF;
- working Google Doc;
- blocker flag + blocker reason;
- notes;
- completion date + actor;
- publication date + actor;
- activity/history;
- search/filter metadata;
- canonical source/catalogue provenance.

Either collaborator may change these fields.

### Locked lifecycle

`Not Started → In Progress → Review → Completed → Published`

Meaning:

- **Completed = translation work is finished and ready for publishing.**
- **Published = it has actually been released/published.**
- `Blocked` is a separate flag, not a lifecycle status.
- Do not add unnecessary intermediate lifecycle statuses such as "Finalizing" unless real workflow evidence later earns them.

### Locked progress semantics

**Translation Progress numerator = Completed + Published.**

So a book moving to `Completed` must immediately advance the main translation progress bar even before publication.

Moving that same book from `Completed` to `Published` must **not** advance translation progress a second time.

**Publication Progress numerator = Published only.**

The dashboard should make this distinction obvious.

---

## 4. Required views / interaction model

The user accepted a workflow roughly combining the useful parts of Trello, Monday, Todoist, and Nexus, but specialized for this translation corpus.

Current/required surfaces:

- **Dashboard**
  - Translation Progress;
  - Publication Progress;
  - active/review/blocked/deadline/PDF-availability summaries;
  - progress by person;
  - recently updated work.
- **Projects**
  - canonical all-books database/list;
  - search;
  - filters;
  - inline/project-detail editing;
  - PDF availability labeling/filtering.
- **Board**
  - columns based on the five lifecycle statuses;
  - drag-and-drop changes status and persists to D1.
- **Timeline**
  - deadlines/schedule;
  - overdue visibility.
- **Activity**
  - actor-attributed project changes.

Google Doc links belong on the corresponding project record as translation work proceeds.

The Workbench must remain convenient to manipulate directly in the browser; it is not a read-only dashboard.

---

## 5. Visual design requirement — do not overwrite the archive language again

The first Workbench redesign replaced the old Haydari visual identity with a generic green app-shell aesthetic. The founder explicitly objected: **"The old design is completely overwritten."**

The Workbench must preserve/restore the visual language of the earlier archive rather than inventing a generic SaaS dashboard.

Canonical visual reference: `main/index.html`.

Important old-design primitives already recovered and currently represented on `workbench`:

- parchment ground `#F3ECDA`;
- paper `#FFF8EA`;
- ink `#1F2E28`;
- gold `#B8925A`;
- oxblood `#7A2E2E`;
- sage `#6B7F6E`;
- Amiri for Arabic;
- EB Garamond for literary/display English;
- folio-like rows;
- rosette ornament;
- restrained borders/chips/buttons rather than generic app cards;
- warm archive/editorial feel.

Do not regress to the generic green shell.

**Important status:** the restored visual treatment is implemented, but the founder has not yet explicitly approved the current deployed visual result after the repair. Treat live visual fidelity as requiring real user-facing verification, not merely CSS-source inspection.

---

## 6. Corpus scope and initial assignment state

The canonical archive on `main` contains **176 books**.

The Workbench is intended to represent the **whole book corpus**, not only Zahraa's initially assigned books.

The authorized source document initially seeded **11 books assigned to Zahraa** in D1. Preserve that private work state. Do not commit the private assignment list/source document to the public repository.

When the full catalogue is reconciled into D1:

- existing work records must preserve their assignment/status/progress/private fields;
- catalogue metadata may fill missing public metadata;
- other catalogue books should enter as `Unassigned` / `Not Started` unless private runtime state says otherwise;
- catalogue sync must never overwrite existing human work state.

---

## 7. Arabic PDF requirement — strongest current user correction

The founder wants the **Arabic source/PDF action to open the actual PDF directly**, not an intermediate "download the PDF" page.

This applies to **ALL books on the Workbench**.

If no working direct PDF exists for a book:

- do not show a misleading Arabic PDF button;
- visibly label it **PDF missing**;
- provide a **Missing PDF only** filter so all such books can be viewed together immediately.

### Critical regression evidence

The user tapped a supposed direct Arabic PDF on iPhone/Safari and got an Apache-style **404 Not Found** page on `archive.alhaydari.com`.

That proves:

- a URL ending in `.pdf` is not sufficient evidence;
- copying the official Haydari site's download URL is not sufficient evidence;
- even an official catalogue/detail page can point at a dead legacy file.

Never again classify a PDF as working merely from the extension, catalogue field, or official-link provenance.

### Current PDF-validity contract

A book receives an Arabic PDF action only after positive evidence that the candidate is actually retrievable as a PDF.

Current implementation supports per-project PDF state such as:

- `unchecked`
- `available`
- `missing`

Expected interpretation:

- valid PDF response → `available`;
- 404/410 or successful non-PDF content → `missing`;
- transient/rate-limit/server ambiguity → keep/retry as `unchecked`, not false-missing.

Editing a PDF URL should reset its verification state.

Verified PDFs currently open through the Workbench's inline proxy, and the proxy supports byte-range requests so Safari/iPhone can render/seek large PDFs without relying on flaky direct navigation to the legacy archive host.

### Current denominator

Latest full audit recorded in the repo:

- **176 total books**
- **62 verified working direct PDFs**
- **114 currently missing/unusable under the tested candidates**

Treat **114 as the current unresolved/unusable set, not proof that no PDF exists anywhere**.

The parent task is not merely to label those 114. Continue source recovery where practical:

1. inspect official detail/source pages;
2. inspect actual page HTML/download targets;
3. search alternate official/legacy paths and filename variants;
4. use public-source recovery methods when normal frontend paths fail;
5. inspect repository/local mirrors or preserved copies if present;
6. only promote a replacement URL when it is actually retrievable as a PDF;
7. re-run the availability audit after candidate changes.

Do not sacrifice truthfulness to maximize the "available" count. If no working PDF can be found after the relevant search/recovery path, keep the book visibly missing.

The 404 case from the user's screenshot must remain a regression case for the final verification.

---

## 8. Current implementation state on `workbench`

Current branch head before this handoff: `dc132b23d6387cfa387856f8a672d2522b81a536`.

Recent implementation includes:

- full 176-book public catalogue projection;
- D1 catalogue reconciliation that preserves private work fields;
- restored old archive visual language;
- PDF-state exposure;
- direct-PDF workflow;
- Missing PDF filter;
- server-side PDF verification/audit;
- recovery of some direct URLs from verified source pages;
- further web-discovered source-page candidates;
- inline PDF proxy;
- Safari byte-range support;
- cover caching/archiving support;
- README documentation of the verified PDF audit denominator.

Current `workbench/README.md` is a useful compact product/technical contract and should be loaded alongside this handoff.

Cloudflare Pages is Git-integrated to the `workbench` branch, so branch pushes can deploy automatically. Verify the exact check/run after every consequential deployment rather than assuming the live site updated.

Vercel status may continue to show failure because that old account is blocked; **Vercel is not the deployment target for this Workbench**.

---

## 9. Hosting / cost / privacy constraints

Provisioned runtime:

- Cloudflare Pages project: `haydari-translation-workbench`;
- repository: `mohalizahraa/Website-Source`;
- branch: `workbench`;
- root: `workbench`;
- output: `public`;
- Functions: `functions`;
- D1 database: `haydari-workbench`;
- D1 binding: `DB`;
- encrypted secret: `WORKBENCH_ACCESS_TOKEN`.

Hard constraints:

- **$0 cost**;
- no Railway;
- do not depend on the blocked Vercel deployment;
- do not expose the secret capability token in Git;
- do not expose private work state in the public repository;
- keep `main` / the existing public archive separate unless the founder explicitly asks to change it.

---

## 10. Exact continuation order

Freshly load Operator `AGENTS.md`, Core, and the routed owners/profiles required for implementation/research/verification. Never substitute this handoff for live authority.

Then:

1. **Read current `workbench` HEAD, `workbench/README.md`, current PDF-audit/proxy code, and current deployment check.** There may be newer commits than the pre-handoff head recorded above.
2. **Do not redesign the product.** Preserve every founder-locked requirement above.
3. **Resume the 114-book PDF recovery/verification frontier.**
   - Determine which entries have recoverable direct PDFs from authoritative/public sources.
   - Verify actual bytes/content, not URL shape.
   - Keep unresolved books flagged.
4. **Reconcile recovered URLs into the catalogue/runtime without touching private project state.**
5. **Re-run the full 176-book PDF audit.**
   - Report exact available / missing / unchecked denominator.
   - Do not call transient unknowns "missing."
6. **Verify recipient path on iPhone/Safari semantics.**
   - Arabic PDF action opens an actual PDF inline for representative verified books.
   - byte-range/seek works where material;
   - the old 404 URL cannot surface as an "available PDF."
7. **Verify Missing PDF UX.**
   - all unavailable books visibly labeled;
   - filter returns the exact current missing set.
8. **Verify visual fidelity against `main/index.html`.**
   - parchment/paper/oxblood/gold/sage;
   - Amiri/EB Garamond;
   - folio/editorial hierarchy;
   - responsive mobile rendering;
   - no generic green-app regression.
9. **Verify the work-management behaviors were not broken by catalogue/PDF work.**
   - same shared workspace;
   - Zahraa/Mohammed identity attribution;
   - both can edit/reassign anything;
   - statuses;
   - drag/drop;
   - persistence;
   - timeline/activity;
   - translation/publication progress semantics;
   - 11 existing Zahraa work records preserved.
10. **Deploy and verify the actual live Cloudflare recipient path.**
11. Continue recursively through any discovered regressions until no material agent-owned repair remains.

Do not stop at source-code success if the live mobile/user path is still broken.

---

## 11. Definition of done for the active repair

The current repair is done only when all of the following are true:

- the Workbench retains the old archive's intended aesthetic rather than the overwritten generic design;
- the complete 176-book corpus is represented;
- every visible Arabic PDF action is backed by a positively verified retrievable PDF;
- clicking representative verified PDF actions works on the real live site, including mobile Safari;
- unavailable books are plainly labeled `PDF missing`;
- the Missing PDF filter returns the full current unavailable set;
- no dead 404 link is presented as a valid PDF;
- the full PDF denominator is re-audited and reported exactly;
- private work data/token remain outside the public Git repo;
- the original 11 Zahraa project records and their mutable work state remain intact;
- collaboration/status/progress behavior still matches the locked model;
- Cloudflare's actual deployed recipient path is verified after the final code/data changes.

---

## 12. Restart prompt

> Continue the Haydari Translation Workbench from `workbench/HANDOFF-2026-10-03-HAYDARI-WORKBENCH-PDF-RECOVERY-AND-VISUAL-FIDELITY-IN-PROGRESS.md`. Freshly load Operator `AGENTS.md`, Core, every materially routed owner/profile, `workbench/README.md`, current `workbench` HEAD, and the complete affected dependency cone. Preserve all founder-locked product/access/status/progress/visual/privacy/cost requirements. Resume the 176-book PDF recovery and verification frontier from the current live state: a PDF is available only if the actual file is positively retrievable; official/dead `.pdf` links are not evidence. Keep unresolved books labeled/filterable as PDF missing, preserve the 11 existing Zahraa work records, verify representative PDFs through the live iPhone/Safari recipient path, re-audit the full denominator, repair any regressions, and continue until the active repair reaches the floor. Never commit the capability key or private work state.


## 2026-10-03 post-recovery workflow update

This section supersedes the older in-progress PDF denominator and records the newest Workbench state.

- Full PDF byte audit: **172 / 176 available, 4 missing, 0 unchecked**.
- Assignments can now be changed inline to Zahraa / Mohammed / Both / Unassigned without opening the full editor. Legacy `Brother` projection normalizes to Mohammed.
- Deadlines can be set or cleared inline in Projects, Board, recent-project rows, and Timeline.
- Every working book surface exposes **English Book**. Unlinked books open a Google-Doc linking flow (including a `docs.new` shortcut); linked books open their saved Google Doc.
- A per-project `cover_url` runtime field exists for private/manual overrides.
- The public official-cover recovery map now contains **138 / 176** books. Missing/broken images fall back to the archive rosette; the remaining 38 books can use manual cover overrides.
- A new Stats view and dashboard pace panel provide translated/published counts, progress by person, deadline summaries, recent completion pace, cumulative translation progress, and a finish-date projection once enough completion history exists.
- New Google Doc links, cover URLs, and date inputs are validated server-side.
- Current edited JS/API modules parse successfully; all literal DOM id references resolve; Cloudflare Pages has deployed the feature-bearing head successfully.
- Temporary userPKM self-hosted scan workflows used for public cover recovery were removed after use. No paid GitHub compute was used.

Still requiring recipient-path proof before declaring the whole Workbench fully closed:
- confirm the private D1 state still contains the original 11 Zahraa-assigned records after live migration;
- exercise actual assignment, unassignment, deadline, English Book linking, and cover override persistence through the private live link;
- verify representative Arabic PDFs through the real Safari/iPhone path, including byte-range behavior;
- visually inspect the deployed authenticated Workbench at desktop/mobile widths and obtain founder acceptance of the restored archive visual treatment.

Do not commit or echo the private capability link, private Google Doc URLs, assignments, deadlines, or notes while performing those checks.

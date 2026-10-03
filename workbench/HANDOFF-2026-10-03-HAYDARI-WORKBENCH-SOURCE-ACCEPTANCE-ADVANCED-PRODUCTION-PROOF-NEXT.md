# Haydari Translation Workbench — source acceptance advanced; production recipient proof next

Date: 2026-10-03  
Repository: `mohalizahraa/Website-Source`  
Branch: `workbench`

## Continuation base

This continuation started from:

- prior handoff: `workbench/HANDOFF-2026-10-03-HAYDARI-WORKBENCH-COVERS-COMPLETE-ACCEPTANCE-NEXT.md`
- prior handoff commit: `0fbd1b559ed8aa78c1ab7f28bb52c74e42267992`

Do not reopen already-settled founder decisions from that handoff.

## Hard constraints still governing

- $0 cost only.
- No Railway.
- Cloudflare Pages + D1 is the Workbench production runtime.
- Do not depend on the blocked Vercel deployment.
- Never commit, print, or echo the Workbench capability key.
- Never commit private D1 work state.
- Keep the public Haydari archive/main separate from the private Workbench.
- Founder explicitly rejected recommendation #1 (auto-prioritized dashboard) and recommendation #3 (semantic field-by-field Activity prose). Do not implement either.

## Canonical public corpus state reverified

Source-level checks against current `workbench` content still resolve to:

- catalogue books: **176**
- canonical topics: **10**
- cover mappings: **176 / 176**
- verified direct PDFs: **172 / 176**
- missing direct PDFs: **4 / 176**
- unchecked PDFs: **0**

The four canonical missing PDF records remain:

- `book-4`
- `book-23`
- `book-32`
- `book-43`

No cover-recovery loop should be reopened absent a regression.

## Acceptance defect found and repaired

A real recipient-local date bug existed in deadline logic.

The Projects schedule filter, Timeline overdue state, and Stats deadline windows used:

`new Date().toISOString().slice(0,10)`

That makes the app use the UTC calendar date rather than the recipient's local calendar date. A Michigan/iPhone recipient could therefore cross into "tomorrow" several hours early and see incorrect overdue / due-this-month / next-30-days results.

Fixed in:

- commit `b4c3beab72f727c0a77cc40fb8b25e1a01840763`
- message: `Fix recipient-local deadline date semantics`

The shared UI owner now uses local calendar-date helpers for those comparisons.

Post-commit refetch confirmed:

- local-date helper present
- all three UTC deadline-boundary expressions removed
- next-30-days boundary uses the same local calendar semantics

## New zero-cost acceptance guard

Added a self-hosted Workbench acceptance workflow and static invariant checker.

Primary implementation commit:

- `cb4405dc92fbba84e44bdbda3f2a7c38eec7956a`
- message: `Add zero-cost Workbench acceptance guard`

Runner-efficiency refinement:

- `1b49f2bca02a3417c793b1a8721354924db46303`
- message: `Limit Workbench acceptance runner to executable changes`

New files / changes:

- `.github/workflows/workbench-static-acceptance.yml`
- `workbench/scripts/check-static-acceptance.mjs`
- `workbench/package.json` now has `check:acceptance`

The workflow is explicitly:

- `runs-on: self-hosted`
- no GitHub-hosted paid compute
- triggered only by executable Workbench code/data paths plus its own workflow file
- not triggered by README/handoff-only edits

The static checker asserts:

- 176 catalogue rows
- 176 unique catalogue IDs
- exact ten canonical topics
- 176 cover mappings
- 176 PDF audit rows
- 172 available / 4 missing / 0 unchecked
- exact expected four missing PDF IDs
- recipient-local date helper remains present
- the old UTC deadline-boundary expression does not regress

It also runs the existing Workbench syntax check.

### Current run state

Latest self-hosted acceptance run:

- run: `37154526192`
- head: `1b49f2bca02a3417c793b1a8721354924db46303`
- state at handoff writing: **queued**

The immediately prior acceptance run `37154439311` was cancelled by the intentional follow-up workflow commit because the workflow uses `cancel-in-progress: true`.

An older cover-archive job `37151878639` was also still queued when checked. Do not infer runner failure from "queued" alone; the observable fact is only that the jobs had not started.

## Source-level acceptance results

### 1. Private D1 preservation

Source inspection passes the non-destructive requirement for the human work fields.

`ensureCatalog()` updates catalogue/public metadata and PDF-audit metadata, but does **not** overwrite the human state fields used for:

- assignee
- status
- priority
- Google Doc link
- cover override
- start/deadline
- blocker state
- notes
- completion/publication attribution

This strongly supports preservation logic, but it is **not** proof that the production D1 still contains the original authorized state. The production rows must still be checked through the authenticated recipient path.

Never print the private seeded book list.

### 2. Shared work-management source paths

Code review confirms the expected mutation paths exist:

- assign / reassign / unassign
- inline deadlines
- batch assignee / status / deadline edits
- English Book Google Doc linking
- manual cover URL override
- device cover upload
- uploaded-cover removal with fallback restoration
- status editing
- activity attribution

Both named actors use the same D1-backed project APIs; actor selection is attribution metadata, not a data partition. This supports shared visibility by construction, but live cross-recipient persistence still requires production proof.

### 3. Topics and filters

Source/public-data verification passes:

- exact ten canonical topics are present
- topic filter derives from project data
- assignee / status / schedule / blocked / missing PDF / missing cover / no-English filters remain wired
- all 176 catalogue records currently have public cover mappings, so the static catalogue-level missing-cover denominator is zero
- no-English filtering depends on the project/D1 `google_doc_url`, not a public static list

### 4. Stats

Source review preserves the founder-approved semantics:

- official translation progress = Completed + Published book count
- publication progress = Published book count
- workload/page-equivalent pace remains a secondary estimate
- known page counts are used where available
- missing page counts use a median fallback
- indexed volume records are protected against obvious double multiplication
- finish projection remains history-dependent rather than fabricated before enough completion history exists

### 5. Board / Timeline / Activity

Source paths remain intact:

- Board drag/drop patches status
- Timeline renders/sorts deadlines and now uses recipient-local overdue semantics
- Activity is actor-attributed and remains the existing event-log design
- excluded semantic Activity rewrite was **not** implemented

Live persistence still needs recipient-path exercise.

### 6. PDF path

The PDF proxy source still:

- only exposes a PDF button when `pdf_status === available`
- keeps the four canonical missing records from surfacing as available
- forwards a real upstream 206 response when the source honors Range
- synthesizes bounded 206 byte-range responses when the legacy source ignores Range

Safari/WebKit is known to care about correct 206 + Content-Range handling for range requests, so the existing proxy direction is appropriate. Production iPhone/Safari open-and-seek behavior still requires the explicit live test from the prior handoff; do not convert source review into a live-pass claim.

### 7. Cover upload D1 representation

Current Cloudflare D1 documentation confirms BLOB reads are returned as JavaScript arrays, so the existing `Uint8Array.from(row.image_bytes)` cover-response conversion is compatible with D1's documented Worker binding behavior.

## Deployment/status boundary

GitHub's combined status on the Workbench code commit showed a **Vercel failure** from the blocked Vercel integration. That is not the Workbench deployment authority and must not be treated as a Cloudflare failure.

The current execution environment could not query the authenticated Cloudflare Pages deployment or open the private production recipient path. Therefore:

- do not claim the newest Workbench head is Cloudflare-green until Cloudflare itself is verified
- do not claim production D1 preservation/persistence until the authenticated recipient path is exercised
- do not use or recover the private capability key from memory/history to bypass this boundary

The prior handoff's last known Cloudflare-green implementation evidence remains historical evidence for the earlier head only.

## Current branch delta from prior handoff

Relative to `0fbd1b559ed8aa78c1ab7f28bb52c74e42267992`, the branch is three implementation commits ahead before this documentation commit:

1. `b4c3beab72f727c0a77cc40fb8b25e1a01840763` — local deadline semantics repair
2. `cb4405dc92fbba84e44bdbda3f2a7c38eec7956a` — zero-cost static acceptance guard
3. `1b49f2bca02a3417c793b1a8721354924db46303` — narrow runner triggers to executable changes

Changed executable files across that delta:

- `workbench/public/app.js`
- `workbench/package.json`
- `workbench/scripts/check-static-acceptance.mjs`
- `.github/workflows/workbench-static-acceptance.yml`

## Exact remaining acceptance queue

Continue in this order:

1. **Self-hosted guard result**
   - inspect run `37154526192`
   - if it fails, fetch the job logs, repair the actual failure, and re-run through a normal `workbench` code push
   - if it passes, bind the exact run/job IDs to the acceptance record

2. **Newest Cloudflare deployment**
   - verify Cloudflare Pages deployed the newest executable head
   - distinguish Cloudflare evidence from the irrelevant blocked-Vercel status

3. **Production private-D1 preservation**
   - through the authenticated live Workbench, verify the authorized pre-existing work state is still intact
   - do not print the private project list or private links/notes/history

4. **Production mutation/persistence path**
   - assignment -> reassign -> unassign -> restore
   - deadline set/edit/remove
   - batch mutation
   - English Book link
   - cover URL override
   - device cover upload -> reload -> remove -> fallback
   - reload persistence
   - shared visibility across the two actor contexts

5. **Production filters/stats/regressions**
   - composite topic filters
   - no-English D1 filter
   - Board status persistence
   - Timeline deadline behavior
   - Activity attribution
   - official book-count stats and secondary workload stats

6. **Production PDF recipient path**
   - representative verified PDF opens inline
   - iPhone/Safari initial load and later-page seek/range behavior
   - four missing PDFs never surface as available

7. **Rendered acceptance**
   - desktop
   - mobile/iPhone
   - touch targets / no accidental zoom
   - typography, parchment/gold/oxblood/sage fidelity
   - founder explicit final visual approval

8. **Final closure**
   - newest Cloudflare deployment green
   - no privacy leak
   - no paid compute introduced
   - only then declare Workbench acceptance complete

## Restart instruction

Freshly load the live Operator `AGENTS.md` and exactly routed owners/profiles, then load this handoff plus the prior acceptance handoff and current `workbench` HEAD. Verify the self-hosted acceptance run first. Continue directly into the production recipient-path queue. Do not reopen completed cover recovery, do not implement rejected recommendations #1/#3, do not expose the capability key/private D1 state, and do not treat Vercel as the Workbench deployment authority.

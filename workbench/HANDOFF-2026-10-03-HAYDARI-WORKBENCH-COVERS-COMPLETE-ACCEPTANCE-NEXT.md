# Haydari Translation Workbench — cover recovery complete; recipient-path acceptance next

**Date:** 2026-10-03  
**Repository:** `mohalizahraa/Website-Source`  
**Branch:** `workbench`  
**Implementation head before this handoff:** `52b1209665cd6e1fcd6c4643472be857c87f7e15`  
**Deployment target:** Cloudflare Pages project `haydari-translation-workbench`  
**Live site:** `https://haydari-translation-workbench.pages.dev/`

> This handoff is a continuation projection. Freshly load Operator `AGENTS.md`, Core, every materially routed owner/profile, `workbench/README.md`, the current `workbench` HEAD, and the complete affected dependency cone before consequential action. Never substitute this handoff for live authority.

---

## 1. Grand outcome

Finish the private collaborative Workbench for translating Sayyid Kamal al-Haydari's complete 176-book corpus so Zahraa + Mohammed can manage assignments, deadlines, working English Google Docs, Arabic PDFs, covers, statuses, progress, stats, blockers, Timeline, Board, and Activity in one shared no-account workspace.

The Workbench is intentionally separate from the public archive/publication site.

Hard constraints that remain active:

- **$0 cost** only;
- no Railway;
- Cloudflare Pages + D1 is the actual hosting/runtime target;
- do not depend on the blocked Vercel deployment;
- do not commit or echo the shared capability key;
- do not commit private assignments, Google Doc links, deadlines, notes, or other D1 work state;
- keep the existing public archive/main branch separate unless the founder explicitly changes that decision.

---

## 2. Founder-locked access/work model

- One shared workspace + one shared database for Zahraa and Mohammed.
- No user accounts/login/password UX.
- Access is one long shared capability link; browser stores the key locally.
- Device identity is only Zahraa / Mohammed for activity attribution.
- Both collaborators can see all books and edit/reassign anything.
- Assignee is organization metadata, not an ACL.
- Assignment states: `Zahraa`, `Mohammed`, `Both`, `Unassigned`.
- Legacy `Brother` projection normalizes to Mohammed.
- Lifecycle: `Not Started → In Progress → Review → Completed → Published`.
- `Blocked` remains a separate flag.
- Translation progress numerator = **Completed + Published**.
- Publication progress numerator = **Published only**.

---

## 3. Visual/product contract

Preserve the recovered archive/editorial visual language:

- parchment `#F3ECDA`;
- paper `#FFF8EA`;
- ink `#1F2E28`;
- gold `#B8925A`;
- oxblood `#7A2E2E`;
- sage `#6B7F6E`;
- Amiri for Arabic;
- EB Garamond for literary/display English;
- folio/archive hierarchy and restrained scholarly feel.

Do **not** regress to a generic green SaaS shell.

Founder decision from this improvement pass:

- **Do NOT implement recommendation #1:** do not turn Dashboard into an automatically prioritized “what should we do next?” control center.
- **Do NOT implement recommendation #3:** do not rewrite Activity into field-by-field semantic prose as part of this pass.

Those are explicit exclusions, not forgotten ideas.

---

## 4. Corpus / topic taxonomy

Denominator remains **176 books**.

The catalogue now carries the Sayyid website's own ten subject categories and Projects can filter directly by them:

1. Qurʾānic Exegesis and Sciences
2. Theology and Doctrine
3. Mysticism
4. Ethics and Education
5. Jurisprudence
6. Principles of Jurisprudence
7. Epistemology
8. Philosophy
9. Logic
10. Thought, Culture, and Biography

Use these canonical catalogue fields rather than inventing a parallel tag system.

---

## 5. Work-management features now implemented

### Assignment
Assignment/reassignment/unassignment can be done inline wherever a book is being worked with. Unassigning is explicit and does not require opening the full editor.

### Deadlines
Deadlines can be set/cleared inline per book and remain represented in Timeline/schedule behavior.

### English Book
Every book always exposes an **English Book** action.

- If no Google Doc is linked, the action opens a linking flow.
- The flow provides a `docs.new` shortcut to create a Google Doc.
- After pasting/linking the Doc URL, the same English Book action opens that Doc.

### Covers
There are three cover layers:

1. public official cover map in `workbench/public/cover-map.json`;
2. private per-project URL override (`cover_url`) in D1;
3. authenticated device-uploaded cover storage for manual photo import.

The project editor supports importing JPEG/PNG/WebP cover photos from the user's device and removing an uploaded photo. Missing/broken covers fall back to the archive rosette.

### Filters
Projects currently support:

- topic;
- assignee;
- lifecycle status;
- blocked only;
- Missing PDF only;
- Missing cover only;
- No English Book;
- overdue;
- due this month;
- no deadline.

### Batch operations
Projects support multi-select batch changes for:

- assignment;
- status;
- deadline.

### Mobile
The current CSS pass increased interactive touch targets to roughly 44px and uses 16px form text on mobile to reduce accidental Safari zoom / tiny controls.

### Stats
The existing official progress definition stays **book-count based**.

Stats additionally expose:

- translated count;
- published count;
- recent 30-day pace;
- rolling 90-day context;
- progress by person;
- deadline summaries;
- cumulative progress graph;
- projected finish line;
- a clearly secondary workload estimate based on known page counts.

Workload estimation rules:

- use real page counts where known;
- use corpus-median page fallback where page count is missing;
- weight a multi-volume umbrella record by volumes only when it is not already an individually indexed volume record.

Do not silently replace official book-count progress with workload progress.

---

## 6. Cover recovery — COMPLETE

Current `workbench/public/cover-map.json` contains **176 / 176 cover mappings**.

Latest authoritative implementation head recorded before this handoff:
`52b1209665cd6e1fcd6c4643472be857c87f7e15`

Relevant closure commits:

- `f2eafa34b1f68de63876b67ffa289d9d354798e5` — complete 176-book official cover recovery
- `eb23455973675f627baf7d9078faea7d57776fbe` — remove temporary cover recovery probe
- `52b1209665cd6e1fcd6c4643472be857c87f7e15` — record complete cover recovery

Current map provenance accounting:

- **141** mappings from directly recovered legacy official page imagery;
- **22** `official-series-cover` mappings;
- **12** `official-exact-cover` mappings;
- **1** `official-announcement-cover` mapping.

Important provenance rule:

Some volume records use verified official **series art** because the exact volume page did not expose a distinct image. Those entries are explicitly labeled `provenance: "official-series-cover"` and often retain `source_book`. Do not later pretend those were independently verified exact-volume covers.

A major recovery bug was fixed during this pass: a later scan had accidentally dropped 3 previously verified covers. The recovery script is now **cumulative**, so newer scans merge with existing verified mappings instead of replacing the whole map and losing old truth.

The temporary public cover-recovery probe was removed after completion. Do not re-add it unless a future recovery need genuinely requires it.

The temporary userPKM self-hosted cover-recovery workflow file is also absent now.

---

## 7. PDF state — stable audited baseline

Full byte-level audit remains:

- **172 / 176 available**
- **4 missing**
- **0 unchecked**

Audit version:
`audit-2026-10-03T09:24:31.074Z-172ok-4missing-0unchecked`

Evidence:
- `workbench/public/pdf-audit.json`
- GitHub Actions run `37112926137`
- job `111174193227`
- ran on the founder's self-hosted Mac/ARM64 runner
- $0 paid GitHub compute

Verified-missing records:

1. `book-4` — **موسوعة الإمامة في الفكر الشيعي**
   - official archive provides a RAR package for the 12-volume umbrella collection rather than one direct PDF.

2. `book-23` — **موسوعة شرح نهاية الحكمة**
   - official archive provides a ZIP package for the umbrella record; individual volumes exist separately.

3. `book-43` — **موسوعة شرح حلقات الأصول**
   - official archive provides a ZIP package for the umbrella record; constituent works exist separately.

4. `book-32` — **قراءات في المنظومة المعرفية للسيد كمال الحيدري – ج 2**
   - official direct-PDF target currently returns 404; no verified alternate direct PDF recovered.

PDF truth contract:

- a `.pdf` suffix is not proof;
- available requires a positively retrievable real PDF;
- 404/410 or successful non-PDF = missing;
- transient/rate-limit/server ambiguity = unchecked, not missing;
- editing a PDF URL resets it to unchecked;
- only verified PDFs expose the Arabic PDF action;
- verified PDFs open through the Workbench proxy;
- proxy must preserve byte-range behavior for Safari/iPhone.

---

## 8. Private state that must be preserved

The initial authorized runtime seed included **11 books assigned to Zahraa**.

That private D1 state must survive all catalogue/schema/UI work.

Do not commit or print:

- the 11-book assignment list;
- private Google Doc URLs;
- private deadlines;
- private notes;
- private work history;
- capability token.

Catalogue sync must never overwrite human work state.

---

## 9. Latest deployment evidence

Cloudflare Pages check on implementation head `52b1209665cd6e1fcd6c4643472be857c87f7e15`:

- status: **completed**
- conclusion: **success**
- completed: `2026-10-03T21:01:41Z`

This proves the branch deployed successfully. It is **not** by itself proof that every authenticated recipient-path interaction works correctly.

---

## 10. What is actually done vs still open

### Done / evidence-backed

- 176-book catalogue represented.
- 176 / 176 cover mappings present.
- cover recovery is cumulative.
- device cover upload support exists.
- manual cover URL overrides exist.
- topic taxonomy is present and filterable.
- batch assignment/status/deadline UI is implemented.
- Missing cover / No English Book / schedule filters are implemented.
- mobile touch-size pass is implemented.
- stats/workload additions are implemented.
- 172/4/0 PDF denominator is evidence-backed.
- temporary public cover probe removed.
- Cloudflare Pages deployed the implementation head successfully.
- founder exclusions (#1 Dashboard priority redesign, #3 Activity semantic rewrite) are persisted in README.

### Still open / requires acceptance proof

The Workbench as a whole is **not yet safe to call fully done** until the authenticated recipient path is exercised.

1. **Private D1 preservation**
   - verify the original 11 Zahraa records still exist with their mutable human state intact.

2. **Live work-management behavior**
   - assignment;
   - reassignment;
   - unassignment;
   - inline deadlines;
   - batch assignment/status/deadline edits;
   - Google Doc/English Book linking;
   - manual cover URL override;
   - device cover upload/remove;
   - persistence after reload;
   - shared visibility between Zahraa and Mohammed.

3. **Topic/filter behavior**
   - verify all 10 topics render correctly;
   - topic + assignee/status/schedule filters compose correctly;
   - Missing cover should now return zero catalogue-cover gaps unless a private/manual runtime condition changes that;
   - No English Book filter should reflect D1 state, not public repo guesses.

4. **Stats correctness against live data**
   - official translation/publication numerators remain correct;
   - weighted projection remains visibly secondary;
   - page fallback/multi-volume logic does not distort indexed-volume records.

5. **Board / Timeline / Activity regression check**
   - status drag/drop persists;
   - Timeline deadlines still work;
   - Activity still records attribution;
   - do not implement the excluded semantic Activity rewrite.

6. **PDF recipient path**
   - representative verified Arabic PDFs open inline through the real live private site;
   - Safari/iPhone byte-range/seek behavior works;
   - none of the 4 verified-missing books can surface as available.

7. **Rendered visual fidelity**
   - inspect authenticated Workbench at desktop + mobile widths;
   - confirm parchment/editorial/archive feel;
   - no generic SaaS regression;
   - founder has not yet explicitly approved the final deployed visual result.

---

## 11. Exact continuation order

On restart:

1. Freshly load Operator `AGENTS.md`, Core, and routed owners/profiles.
2. Fetch current `workbench` HEAD first; there may be commits newer than the pre-handoff implementation head.
3. Read `workbench/README.md`, this handoff, the current `cover-map.json`, `pdf-audit.json`, and the current Workbench UI/API implementation.
4. Do **not** reopen cover recovery unless current live evidence shows a cover regression. The current denominator is 176/176.
5. Move directly into authenticated recipient-path acceptance:
   - private D1 preservation;
   - assignment/deadline/batch/English Book/cover persistence;
   - topics/filters;
   - stats;
   - Board/Timeline/Activity regressions;
   - mobile rendering;
   - representative PDF/Safari range behavior.
6. If a defect is found, repair the highest correct owner, redeploy, and rerun the affected acceptance path.
7. Continue until all agent-owned acceptance work reaches the floor or a genuine unavailable credential/user-owned visual approval boundary remains.
8. Never expose the private capability link or D1 data in Git/chat while verifying.

---

## 12. Definition of done

Do not declare the Workbench complete until all of these are true:

- all 176 books remain represented;
- 176/176 cover mappings remain present or any future exceptions are truthfully surfaced;
- cover provenance remains truthful;
- 172 verified PDFs remain available, 4 remain correctly missing, and 0 are falsely classified;
- representative PDFs work on the live Safari/iPhone path;
- original 11 Zahraa runtime records remain intact;
- assignment/reassignment/unassignment persist;
- deadlines persist;
- English Book linking/opening persists;
- cover URL override + device upload/remove persist;
- topic/filter combinations work;
- batch operations work;
- stats preserve official book-count semantics;
- Board/Timeline/Activity remain intact;
- the final rendered site preserves the archive visual language;
- Cloudflare deployment is green after the final accepted repair;
- no private token/state is committed;
- no paid compute/service is introduced.

---

## 13. Restart prompt

> Continue the Haydari Translation Workbench from `workbench/HANDOFF-2026-10-03-HAYDARI-WORKBENCH-COVERS-COMPLETE-ACCEPTANCE-NEXT.md`. Freshly load Operator `AGENTS.md`, Core, every materially routed owner/profile, `workbench/README.md`, current `workbench` HEAD, and the complete affected dependency cone. Preserve the founder-locked shared-workspace model, status/progress semantics, archive visual language, privacy boundary, Cloudflare/$0 constraints, and the explicit decision **not** to implement the Dashboard “what next” redesign or semantic Activity rewrite. Treat cover recovery as closed at 176/176 unless current evidence shows regression; preserve provenance distinctions for exact vs official-series cover art. PDF baseline is 172 available / 4 missing / 0 unchecked. Resume at authenticated recipient-path acceptance: verify the private 11 Zahraa records survive, exercise assignment/reassignment/unassignment, deadlines, batch actions, English Book linking, cover override/device upload, topic/filter composition, stats correctness, Board/Timeline/Activity regressions, visual fidelity, and representative Safari/iPhone PDF byte-range behavior. Repair discovered defects and continue to the floor without exposing the capability key or private D1 state.

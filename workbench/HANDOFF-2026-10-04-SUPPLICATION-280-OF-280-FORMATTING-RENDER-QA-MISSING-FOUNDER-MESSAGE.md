# Handoff — Supplication 280/280 source pass, formatting/render QA in progress, missing founder message

Date: 2026-10-04  
Repository: `mohalizahraa/Website-Source`  
Branch: `workbench`  
Pre-handoff branch head: `04a4677d27b0f567d537a79e5ea37dc04f7c36c9`

## Critical restart instruction

Load the current `mohalizahraa/operator-protocol/AGENTS.md` fresh before substantive work, then route the smallest required Operator owners. For this task the Arabic-book translation profile is material; execution/knowledge/assurance/communication are material while editing/verifying the live Google Doc.

**Do not substitute this handoff for canonical Operator/project truth.**

## Immediate founder-context loss — highest-priority continuity warning

The founder explicitly said:

> "Wait wtf dude did you get the rest of my message? Four points before I sent that image?"

Those **four points are NOT present in the visible conversation context available to the current agent**. A personal-context recovery attempt did not recover a matching current-message four-point set; it surfaced an unrelated older four-point conversation from 2026-10-02, which must **not** be substituted.

The only visible current founder input after the formatting work was an image showing the rendered Google Doc around **"A Gleam"** and the beginning of **"Dedication..."**.

Therefore:

- Do **not** invent or infer the missing four points.
- Do **not** treat the screenshot alone as a complete statement of the founder's requested corrections.
- On restart, first recover the missing message if the host exposes it; otherwise ask the founder to resend the four points.
- Preserve all safe formatting work already completed unless those recovered founder points explicitly require revisions.

## Parent outcome

Finish the English edition of:

**Supplication: Its Illuminations and Implications**  
Arabic: **الدعاء إشراقاته ومعطياته**

The current focus is the **formatting / publication-production pass**, not ordinary body translation.

Founder instruction immediately before the lost-message issue:

> Keep track of other things in the doc that don't look right and present them **AFTER** formatting is finished, **only if anything remains after formatting**.

This means:
- silently maintain a defect list while working;
- repair defects that are agent-owned and safely resolvable;
- do **not** interrupt with a running list;
- after formatting is actually finished, present only defects that remain.

## Live manuscript identity

Google Doc:  
`https://docs.google.com/document/d/15MMgcj6TPtdCotBecPUJW9xX59-Py_ODsHqRqh_dDLc/edit`

Document ID: `15MMgcj6TPtdCotBecPUJW9xX59-Py_ODsHqRqh_dDLc`  
Tab: `t.0`

Fresh revision read immediately before this handoff:

`ANLCKQnUaxmZARVOMa-t4AHaQcFeafDtky0RNCvTzQ2bJiXHNCQADaQB9jJZOWNZgSZc4TeVob-ZAG3hv0D_HssCTFL6M9tjyDx32xNCJcs`

Paragraph count on that read: **1713**.

Source PDF:
`https://archive.alhaydari.com/ebook/ar/%D9%83%D8%AA%D8%A8-%D8%A7%D9%84%D8%A3%D8%AE%D9%84%D8%A7%D9%82/%D8%A7%D9%84%D8%AF%D8%B9%D8%A7%D8%A1-%D8%A5%D8%B4%D8%B1%D8%A7%D9%82%D8%A7%D8%AA%D9%87-%D9%88%D9%85%D8%B9%D8%B7%D9%8A%D8%A7%D8%AA%D9%87.pdf`

Haydari source page:
`https://alhaydari.com/ar/2012/08/34150/`

Workbench project ID: **4**  
Catalog ID: **book-132**

## Translation / coverage state

### Source-page pass

The sequential physical-source-page translation pass reached:

**280 / 280 physical PDF pages**

This includes:
- authored body through the formal conclusion;
- Qurʾanic-verse index rebuilt for the English edition;
- narration/report index rebuilt for the English edition;
- 75-source bibliography;
- source contents reconciled against English heading coverage rather than replaced with a hand-built static TOC;
- 109-item published/in-print works list.

Do **not** interpret 280/280 as publication completion.

### Footnotes / note layer

A full Docs read established:
- **207 native Google Docs footnotes already exist** and are populated;
- these correspond to the earlier note layer;
- the later draft uses temporary hidden placeholders beginning at **NF208**;
- remaining placeholder range is **NF208–NF369**;
- that is **162 source notes** requiring translation/migration to native Google Docs footnotes;
- **NF281 appears twice** and requires reconciliation rather than blind duplication.

Temporary `NF...` markers and the `WBPROGRESS` marker were re-hidden during formatting at 1 pt / white. They are production telemetry, not publication content.

Native-footnote migration is **not complete**.

## Workbench / website state

The founder required the Workbench to stay updated as translation progress advances.

Two website fixes were already committed/deployed on Cloudflare:

1. `fbe31e6a9021dd7d5b08d336fbf7d0a5b4b2d128`  
   **Workbench: make shared progress refresh near real time**
   - lightweight revision polling about every 2 seconds;
   - full state reload only when the revision changes;
   - fast retry after transient failure;
   - focus/visibility resync;
   - browser API reads explicitly no-store.

2. `04a4677d27b0f567d537a79e5ea37dc04f7c36c9`  
   **Workbench: auto-sync verified translation markers**
   - temporary hidden `⟦WBPROGRESS:<project>:<pages>:<total>⟧` marker in the Google Doc;
   - same-origin production route reads the public Doc export;
   - exact public-export SHA-256 identity;
   - reconciles through the existing guarded progress checkpoint owner rather than writing a parallel counter.

Earlier production verification showed the path working end-to-end and project 4 eventually reporting **280 translated pages** / status **review**.

Do not regress to manual Git-backed progress state or a parallel unverified counter.

## Formatting work completed in the live Doc

The current formatting pass already made substantial live edits.

### Hierarchy repair

Later Chapter 6–8 material had been appended as ordinary paragraphs. The pass promoted real headings into native Google Docs H1–H4 structure, including:

- Chapter Six title surface;
- Chapter Seven title surface;
- Chapter Eight title surface;
- major section headings;
- subheadings for times/places of supplication;
- conclusion and back-matter section headings.

This was done specifically so the eventual **native Google Docs TOC** can derive from real heading structure.

### Chapter opener / heading geometry

Applied profile-driven formatting:
- chapter labels centered and bold;
- chapter labels own the page break;
- H1 chapter titles do not add a second page break immediately after a chapter label;
- H2 starts on a new page;
- H1/H2/H3/H4 normalized to **24 / 20 / 18 / 16 pt**;
- heading spacing and keep-with-next behavior normalized;
- heading colors normalized to black.

Post-write structural check reported:
- H1–H4 formatting checks clean;
- no detected heading-geometry mismatches.

### Body / lists / back matter

Applied the Arabic-book translation profile's REAL SCALE v2:
- body **Amiri 14 pt**;
- body first-line indent **18 pt**;
- paragraph rhythm **0 pt above / 4 pt below**;
- line spacing 115;
- list geometry zeroed to avoid double indentation;
- chapter overview bullets centered and compact;
- back matter zero first-line indent with tighter spacing.

Post-write list geometry check reported clean native list indentation.

### Existing native footnotes

All **207 existing native footnotes** were normalized to:
- Amiri **10 pt**;
- first-line indent **18 pt**;
- zero left/right indent;
- zero before/after spacing;
- 115 line spacing.

A post-write footnote geometry check reported **0 bad footnotes** across all 207.

### Important failed request that did not partially mutate

One mixed body+footnote formatting batch initially failed because Docs rejected a footnote range/request shape. The request failed atomically before changing anything. Body and footnotes were then split and applied successfully with corrected footnote segment ranges.

Do not treat that failed batch as partial state.

## Render state

After formatting, the live Google Doc was exported to PDF.

Current rendered export length:

**281 pages**

Current-session export artifact existed at:
`/mnt/data/Supplication: Its Illuminations and Implications — English Translation.pdf`

Current-session page renders were produced under:
`/mnt/data/supp_renders/`

These paths are **session-local evidence**, not durable project files. A fresh agent should re-export/re-render as needed rather than assuming the paths survive.

### Founder screenshot

The founder then sent a screenshot showing the rendered pages around:

- **A Gleam**
- footnote 1
- beginning of **Dedication...**

Visible screenshot characteristics included:
- large vertical whitespace around the A Gleam page;
- centered heading;
- centered quotation presentation;
- footnote at bottom;
- Dedication beginning on the next page.

However, because the founder says a **four-point message immediately preceded the screenshot and that message was not received**, do not infer which of these visual features the founder intended to criticize until the four points are recovered/resend.

## Native TOC state

Founder previously clarified repeatedly:

**Use Google Docs' native TOC. Do not create a hand-built static TOC.**

Native TOC remains **not yet inserted/refreshed**.

Correct ordering:
1. finish semantic note migration and formatting/layout changes;
2. perform visual/render QA and repair;
3. only then insert/refresh the **native Google Docs TOC** as a terminal production action.

Do not add a static contents list as a substitute.

## Formatting QA state

API-level structure checks completed:
- heading geometry: clean;
- native list indentation: clean;
- 207 native footnote geometry: clean.

Visual/render QA was **in progress** when the context interruption occurred.

The current agent had begun checking:
- blank/near-blank pages;
- chapter opener placement;
- font fallback;
- clipping/overflow;
- odd whitespace;
- back matter;
- first and last rendered pages.

The founder's screenshot arrived before this visual QA was completed.

Therefore **do not claim formatting is finished**.

## Remaining live queue — dependency order

### 1. Recover founder's missing four-point message
Status: **BLOCKED on missing conversation content / founder resend if host cannot recover it.**

This is the highest-priority user-owned evidence gap because it may change the formatting corrections.

Do not substitute any older unrelated "four points" from memory.

### 2. Continue visual/render QA
Status: **IN PROGRESS / admissible once the missing four points are known, or only for clearly safe noncontroversial defects meanwhile.**

Inspect the actual rendered PDF, especially:
- title/front matter;
- A Gleam / Dedication sequence;
- chapter openers;
- pages around newly promoted Chapter 6–8 hierarchy;
- conclusion;
- back matter;
- blank/near-blank pages;
- clipping/overflow;
- font fallback;
- excessive or accidental whitespace;
- orphan/widow behavior where clearly bad.

Keep a separate defect ledger. Repair safe defects during the pass. Do not present the ledger until formatting is finished; then present only surviving issues, per founder instruction.

### 3. Migrate NF208–NF369 to native footnotes
Status: **OPEN.**

Requirements:
- translate each source note against the authoritative Arabic source;
- insert true native Google Docs footnotes;
- remove the corresponding temporary `NF...` marker only after readback;
- reconcile duplicated NF281 before migration;
- preserve citation/source identity;
- do not guess note text.

This may change pagination, so native TOC must remain deferred until this is complete.

### 4. Final hierarchy/body/layout pass after footnote migration
Status: **OPEN.**

Because footnote migration changes pagination, re-render afterward and re-run visual QA.

### 5. Insert/refresh native Google Docs TOC
Status: **OPEN / TERMINAL.**

Only after all content, note, formatting, and layout changes are finished.

### 6. Final publication QA
Status: **OPEN.**

Required before "text-complete" / publication-ready claims:
- zero unintended Arabic residue;
- no temporary `NF...` or `WBPROGRESS` telemetry visible in publication output;
- native footnote coverage complete;
- native TOC present and refreshed;
- visual/render QA clean;
- headings/footnotes/body consistent;
- no clipping/overflow/accidental blank pages;
- exact source coverage and citation integrity verified.

## Status-language guard

Current correct state is **not publication complete**.

Source-page pass: **280/280**.  
Formatting: **substantially applied but render QA unfinished**.  
Native footnotes: **207 existing + 162 later placeholders still to migrate**.  
Native TOC: **not yet inserted/refreshed**.  
Final publication QA: **not complete**.

## Exact next action for a fresh agent

1. Load fresh Operator router and Arabic-book translation profile.
2. Read this handoff from the `workbench` branch.
3. Recover the founder's missing current four-point message if possible.
4. If it cannot be recovered, tell the founder exactly that and ask them to resend the four points before interpreting the screenshot.
5. Fresh-read the live Doc revision before any write.
6. Continue formatting/render QA and note migration in the dependency order above.
7. Keep the founder's "show remaining defects only after formatting is done" instruction active.
8. Keep Workbench progress/status synchronized without weakening the verified-checkpoint invariant.

## Return edge

This handoff was requested because the conversation appears to have dropped a founder message immediately before a screenshot. The work to resume is **Supplication formatting/render QA**, with **missing founder instructions** as the first continuity gap to resolve.

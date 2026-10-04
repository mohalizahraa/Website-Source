# Haydari Workbench

Internal collaborative work manager for translating Sayyid Kamal al-Haydari's books. This is intentionally separate from the public archive/publication surface.

## Product contract

- One shared workspace and database for Zahraa + Mohammed (Brother).
- No account/login/password UI.
- The deployed Workbench URL opens the shared workspace directly; there is no private-link/capability-key gate.
- Either collaborator may edit or reassign any project. Assignee is organizational metadata, not an ACL.
- Device identity is selected as `Zahraa` or `Mohammed`. It is used for activity attribution **and** to personalize the Dashboard's **My assigned projects** surface; `Both` assignments appear for either collaborator.
- Workflow statuses: **Not Started → Translating → Needs Formatting → Needs Review → Publish Ready**. **Published** is tracked separately.
- The Workbench preserves the archive's parchment / paper / oxblood / gold / sage visual language and Amiri + EB Garamond typography.
- The primary Arabic-source action must open the direct PDF file. A catalogue detail/download page is never labeled as the Arabic PDF.
- Projects without a direct PDF are visibly labeled **PDF missing** and can be filtered as a group.
- **Translating** means the English translation is still in progress.
- **Needs Formatting** means translation is finished and the formatting pass is still pending.
- **Needs Review** means translation and formatting are finished and the book is waiting for Zahraa's human review. This is a human-review gate, not an automated completion state.
- **Publish Ready** means translation, formatting, and Zahraa's human review are finished.
- Translation progress numerator = `Needs Formatting + Needs Review + Publish Ready`.
- Publication progress numerator = books independently marked **Published**.
- `blocked` is a separate flag, not a status.

- Assignment can be changed inline on a book: Zahraa / Mohammed / Both / Unassigned.
- Priority is not part of the Workbench project model; projects are organized by workflow status, assignment, deadlines, and topic instead. The runtime schema migration removes the former legacy `priority` column rather than leaving it as hidden active state.
- Start dates and deadlines can be set or cleared and are reflected automatically in a real horizontal Timeline: ranges span start→deadline, single-date projects render as milestones, overdue work is visually distinct, and undated active work remains in a separate section. Deadline removal is an explicit UI action rather than relying on a browser date-picker clear affordance; it is available inline, in the project editor, and for selected books in batch.
- Every book always exposes an **English Book** action. If no translation Doc is linked yet, the action opens the linking flow; once linked, the same action opens that Google Doc.
- **English Book access invariant:** a linked Google Doc must be shared as **Anyone with the link → Editor**. Restricted/private Docs are not valid Workbench English Book targets. The Workbench must validate new links and guard every open so no user is ever sent to Google's **Request access** screen; an existing restricted link is treated as an access defect that must be fixed, not as a usable English Book.
- Every book exposes a primary **Work on Book** action. If the English Book is not linked yet it opens the existing linking flow and automatically continues into the working materials after the link is saved; once linked, it opens the English Book and, when a verified Arabic PDF exists, opens that PDF alongside it.
- Book covers use an automatic official-cover map plus a per-project cover override.
- Stats use live project state and real completion/publication timestamps for translated/published counts, pace, finish projection, progress-by-person, deadline summaries, and a cumulative progress graph. Every successful project/status mutation reloads shared state and re-renders Stats automatically; moving a book to **Publish Ready** updates translation counts without falsely marking it Published.
- Projects can be filtered by the Sayyid site's own ten subject categories: Qurʾānic Exegesis and Sciences, Theology and Doctrine, Mysticism, Ethics and Education, Jurisprudence, Principles of Jurisprudence, Epistemology, Philosophy, Logic, and Thought/Culture/Biography.
- Projects also support overdue/due-this-month/no-deadline, missing-cover, and missing-English-Book filters plus multi-select batch assignment/status/deadline edits.
- Projects can be sorted by recently updated, deadline, title, lifecycle status, assignee, or topic without changing the underlying project state. The chosen sort is remembered locally on that device.
- The Projects filter surface has a one-click **Clear filters** action that clears search + filter constraints while preserving the user's chosen sort.
- Mobile controls use touch-sized targets and 16px form text so the iPhone/Safari recipient path is practical without accidental zoom/tiny controls.
- The official translation progress definition remains book-count based. Stats may additionally show a clearly secondary workload estimate using known page counts, corpus-median fallback for unknown page counts, and multi-volume weighting only for umbrella records rather than individually indexed volumes.
- Founder decision 2026-10-03: do **not** turn the Dashboard into an automatically prioritized "what to do next" screen, and do **not** expand Activity into semantic field-by-field change prose as part of this improvement pass.
- Founder decision 2026-10-03: keep the improvement wave deliberately narrow—**Work on Book**, **Projects sorting**, automatic continuation after English Book linking, remembered sort choice, and **Clear filters**; do not carry forward the other proposed workflow-expansion ideas from that review.

## Data boundary

The public book catalogue metadata is committed as `functions/_catalog.js` and is derived from the canonical archive on `main`. The Workbench reconciles that catalogue into D1 without overwriting existing assignment/progress state.

Private work state — assignments, deadlines, progress, notes, working Google Doc links, and activity — remains runtime data in D1 and must not be committed to this public repository.

Cover recovery now contains **176/176 cover mappings** from the original Haydari book pages. Books without an imported image keep the archive fallback and can receive a per-book cover override in the Workbench.

Current catalogue denominator: **176 books**. The fresh full byte-level audit completed on the founder's self-hosted Mac/ARM64 runner on 2026-10-03 and verified **172 working direct PDFs**, **4 missing**, and **0 unchecked**. Evidence is preserved in `public/pdf-audit.json` and in GitHub Actions run `37112926137` / job `111174193227`. The Workbench runtime audit owner is `functions/_pdf_audit.js`.

The four verified-missing records are:
- `book-4` — *موسوعة الإمامة في الفكر الشيعي*: the official archive exposes a RAR package for the 12-volume collection rather than one direct PDF.
- `book-23` — *موسوعة شرح نهاية الحكمة*: the official archive exposes a ZIP package for the 12-volume umbrella record; the individual volumes are represented separately.
- `book-43` — *موسوعة شرح حلقات الأصول*: the official archive exposes a ZIP package for the umbrella record; constituent works are represented separately.
- `book-32` — *قراءات في المنظومة المعرفية للسيد كمال الحيدري – ج 2*: the official direct-PDF target currently returns 404 and no verified alternate direct PDF has been recovered.

A filename ending in `.pdf` is not enough; availability is based on an actual retrievable PDF response. Transient fetch/server ambiguity is `unchecked`, not `missing`.

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

The normal Workbench URL opens the workspace directly.

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


## Production-stage status migration — 2026-10-03

Existing data migrates semantically once: old Review → Needs Review; old Completed → Publish Ready; old Published remains Publish Ready with its publication timestamp. Newly translated books enter Needs Formatting. Published is independent from workflow status.


## Official series / standalone organization

The Workbench has an optional **Group: Series / standalone** Projects mode. Normal flat Projects remains the default.

Series metadata is public catalogue metadata in `public/series-map.json`, derived from Sayyid Kamal al-Haydari's official website and official archive bibliography. It distinguishes:
- numbered or named series members;
- umbrella / complete-set catalogue records;
- collections whose component books are also separately catalogued;
- true standalones (any catalogue record not mapped to an official series/collection).

In grouped mode, each official series/collection is rendered as a parchment-and-gold visual shelf with its Arabic and English series name and members ordered by official part/volume position. Standalones remain together in a quieter dedicated section. Filtering still applies before grouping; the chosen grouping mode is remembered locally on that device.

Do not infer series membership merely from similar titles or from `volumes > 1`; add relationships only when supported by the official site/archive.


### Official-site series correction — 2026-10-03

A second official-site sweep recovered the seven-book **مفاهيم قرآنية، عقائدية، أخلاقية** series. The official archive numbers the current catalogue members 1–7, from **الاسم الأعظم حقيقته ومظاهره** through **أولويات منهجية في فهم المعارف الدينية**. These records must not appear as standalones.

## Personalized workspace + modern UI floor — 2026-10-03

- The Dashboard no longer shows a generic **Recently updated** list. It shows **My assigned projects** for the selected **Using as** identity, including projects assigned to `Both`, and exposes every matching book rather than truncating the list.
- Projects offers a **My assignments** filter whose meaning follows the current **Using as** identity.
- The visual system uses contemporary component treatment (intentional selects/inputs, larger radii, focus states, quieter surfaces, modern dialogs/cards) while preserving the parchment / editorial / archival identity. Browser-default or form-era chrome is not an acceptable final visual state.

### Identity and filter interaction refinement

- The global identity control is a Zahraa/Mohammed segmented switch rather than a visible native select; the underlying semantic state remains the same.
- The Projects filter surface can be collapsed to reduce persistent form chrome.
- Timeline bars are directly clickable and open their project editor.

### Visual congruence + cover resilience — 2026-10-03

- Equivalent action roles now share one font-size/line-height/height/padding/radius contract across Dashboard, Projects, Board, Timeline, and dialogs. The prior `English Book` button font-inheritance override is explicitly eliminated.
- Official cover images are now requested through a same-origin `/api/official-cover/:catalogId` proxy with edge caching and a fallback that strips obsolete PageSpeed URL wrappers. This prevents brittle direct hotlink rendering from making mapped covers appear missing.
- Timeline now uses workflow-status color on bars, explicit due-end markers for ranges, and a `Today` control that centers the current date without changing project data.


## Live source-page translation progress — 2026-10-04

Each project can store a source-PDF page counter (`translated_pages`) against its authoritative catalogue page denominator. The Dashboard exposes one compact **Live translation progress** panel for the selected `Using as` identity: its assigned books (including `Both`) plus up to the five most recent page updates from those same currently assigned books. It must not leak another collaborator's assigned-book progress into the selected identity's feed. Project/assigned cards show a subtle per-book bar only after translation has begun. Translation-progress changes are written to Activity as a dedicated event, so the Activity view remains an auditable chronological feed without turning every screen into a social-feed surface.

Page progress is source-relative: **X/Y means X physical pages of the authoritative Arabic PDF have been processed into the English translation target**, not Google Doc pages. A positive first progress update automatically moves a Not Started book to Translating, but page count alone does not certify formatting, semantic review, or publication readiness.


### Assigned-workload progress baseline — 2026-10-04

The selected collaborator's assigned books now show source-page progress even at **0/Y**. The Dashboard live translation panel shows the complete assigned workload for the current `Using as` identity (including `Both`), with active work sorted first, rather than hiding books until translation begins. Assigned project cards likewise retain a quiet 0% progress track from the beginning.

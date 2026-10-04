# HANDOFF — 2026-10-04 — Repentance 132/132, formatting complete, Needs Review

Status: restart-safe current continuation projection.  
Repository: `mohalizahraa/Website-Source`  
Branch: `workbench`

This **supersedes** `workbench/HANDOFF-2026-10-04-REPENTANCE-34-OF-131-WORKBENCH-PDF-BRIDGE.md`.

## Current project truth

- Workbench project id: `3`
- catalog id: `book-123`
- book: **Repentance: Its Reality, Conditions, and Effects**
- authoritative source: Workbench canonical PDF
- source PDF SHA-256: `94a440d9d4fe96cbd5cd651eac0fc39fa38198957aee4a3493234feca00f58f0`
- authoritative physical PDF denominator: **132 pages**
- live verified progress: **132/132**
- live Workbench status: **completed / Needs Review**
- English Doc: `https://docs.google.com/document/d/1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg/edit`
- Google Doc revision after second thorough formatting pass: `ANLCKQksZtCXp0cymOBAawCRBCDqrvcvv7hRi46Pyn1CuqXHqmb87amwa-BVWwT-yiDmbkgbPORu9sMGHk7Xc0EHIFDzNDSc0USs4fZOp4g`
- native footnotes preserved: **170**
- ordinary Arabic-letter residue in English body at verification: **0**

## What happened

The old continuation state and Workbench counter drifted behind the actual Google Doc. The site eventually showed `100/131` while the manuscript already contained translated material through the final physical PDF page. The catalogue denominator was also wrong: the canonical PDF is 132 physical pages, and physical page 132 contains real back matter.

The live manuscript was reconciled against the canonical source structure. It contains the full chapter sequence through Chapter Three, Summary, Qurʾānic index, hadith/narration index, principal sources/references, and the final “Other Works by the Author” back matter. The source table-of-contents pages remain structural witnesses rather than duplicated target content.

## Permanent progress invariant repair

Workbench progress is now **verification-owned state**, not ordinary editable project metadata:

- generic project PATCH rejects `translated_pages`;
- the project editor no longer submits `translated_pages`;
- the progress field is read-only in the ordinary editor;
- verified progress uses `/api/projects/:id/progress`;
- checkpoint writes require expected previous count, source denominator, source-PDF SHA-256, and Google Doc revision;
- stale writers fail closed with conflict instead of overwriting newer progress;
- every accepted checkpoint is persisted in `translation_progress_checkpoints`;
- regression coverage is in `workbench/scripts/check-progress-invariant.mjs`;
- Repentance catalogue denominator is corrected from 131 to **132**.

The temporary `userpkm` writer that previously pushed fixed numbers through the generic project endpoint was retired and used only for verified synchronization/guarding.

## Formatting repair completed

The later translation batches had formatting drift. The Google Doc was normalized without changing translation text:

- body font normalized to **Amiri**;
- chapter labels normalized and page-broken consistently;
- chapter titles normalized;
- later section headings repaired;
- Chapter Three repaired;
- Summary and back-matter headings repaired;
- Qurʾānic/hadith indexes, sources/references, and author-works headings repaired;
- native footnotes remained at 170;
- ordinary Arabic-letter residue remained zero after the formatting write.

Live workflow state was then advanced from **Needs Formatting** to **Needs Review**.

## Restart rule

Do **not** resume translation from page 35, 40, 100, or any other stale checkpoint. Translation text is complete at **132/132**.

The next admissible book-local work is **review/QA**, not additional translation text. Before any edit, re-read the current Google Doc revision and use revision-guarded writes. Do not lower or independently rewrite the live page counter; source-page progress is owned by verified checkpoints.

## Suspended open loops

- Google Drive “Anyone with the link → Editor” sharing remains a separate infrastructure/permissions question unless independently verified fixed.
- Permanent cross-repo/self-hosted runner capacity remains a broader infrastructure loop, but it is not a blocker for this completed Repentance translation.


## Second thorough formatting pass — completed

The founder requested a second, exhaustive formatting pass after the initial normalization. This pass audited both connector-visible structure and the rendered Google Docs PDF, not merely font family.

Repairs/verification included:

- restored the established **14 pt Amiri** main-body baseline through the substantive chapters;
- kept back matter intentionally denser, with the final author-works list locally tightened rather than shrinking the book globally;
- normalized actual Docs heading hierarchy for chapter/section/subsection structure while preserving the edition's custom Amiri presentation;
- normalized all three chapter-opening topic pages against the Arabic source structure;
- removed the inherited native bullets from Chapter Two's opening outline because the Arabic source presents those lines as plain centered topics;
- converted **131 literal typed bullets** into native Google Docs bullet lists;
- converted the **15 Principal Sources** and **21 Other Works** entries into separate native numbered lists;
- normalized every Qurʾānic bracketed quotation span to the established green treatment: **135/135** opening-bracket spans covered across **112** Qurʾān-bearing paragraphs;
- normalized all **170 native footnotes** to Amiri 10 pt with the established first-line indent;
- normalized verse-index sūrah labels, hadith-index authority subheads, editorial notes, and back-matter headings;
- eliminated the sparse intro continuation page, the sparse pre–Chapter Three continuation page, and the one-item trailing final page without removing content;
- final exported PDF is **107 pages**;
- visual QA inspected the complete rendered book: pages 1–8 and 107 on the final snapshot were directly re-inspected after the last local edits, while final pages 7–106 were pixel-identical to pages 8–107 of the immediately preceding fully inspected snapshot;
- final connector readback: **0 ordinary Arabic-letter residue**, **0 non-Amiri body text runs**, **0 literal bullet markers**, **0 literal back-matter number prefixes**, **0 footnote-formatting outliers**, **112/112 Qurʾān-bearing paragraphs fully green**;
- HTML export confirms native structure: **32 unordered lists, 2 ordered lists, 167 list items**, with all **21** Other Works entries in the final ordered list.

The current Google Doc revision is `ANLCKQksZtCXp0cymOBAawCRBCDqrvcvv7hRi46Pyn1CuqXHqmb87amwa-BVWwT-yiDmbkgbPORu9sMGHk7Xc0EHIFDzNDSc0USs4fZOp4g`.

No translation wording was added or removed during this formatting pass.

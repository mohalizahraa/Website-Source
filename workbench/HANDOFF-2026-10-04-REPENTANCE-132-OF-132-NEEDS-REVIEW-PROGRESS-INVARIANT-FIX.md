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
- Google Doc revision after formatting repair: `ANLCKQmNtHI2JDSbcQ67eGEt0c17Z4q8i-XZ7O_Hx1JB0DQ9h6oKlfGjT0YKJXj2iA0_togmLg-rlcgjxTT7GO7pOUAUaghwE_h9GgRF7f8`
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

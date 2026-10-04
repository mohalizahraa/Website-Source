> **SUPERSEDED — DO NOT RESUME FROM 34/131.** Current authority is `workbench/HANDOFF-2026-10-04-REPENTANCE-132-OF-132-NEEDS-REVIEW-PROGRESS-INVARIANT-FIX.md`, with Repentance verified at **132/132** and **Needs Review**. The old denominator/checkpoint below is preserved only as historical incident context.

# HANDOFF — 2026-10-04 — Repentance 34/131, Workbench PDF bridge live

Status: restart-safe continuation projection.  
Repository: `mohalizahraa/Website-Source`  
Branch: `workbench`  
Implementation head before this handoff: `c5d196de61ba9fb251854ca5ab1e86484739cf31`

This supersedes the older continuation projection:

- `workbench/HANDOFF-2026-10-04-ZAHRAA-11-BOOK-TRANSLATION-TAWBAH-5-OF-131-LIVE-PROGRESS.md`

Canonical project truth remains in the Workbench code/README/D1 and the Google Doc. This file preserves only the live continuation graph.

## 1. Immediate outcome

Continue translating **Repentance: Its Reality, Conditions, and Effects** / `التوبة حقيقتها وشروطها وآثارها` one physical source page at a time into the existing English Google Doc, keeping the Workbench page counter synchronized only after a physical Arabic source page is fully covered.

Do **not** move to Supplication or another book until Repentance is genuinely complete. Do **not** create new Workbench projects.

## 2. Current authoritative project state

Workbench project:

- project id: `3`
- catalog id: `book-123`
- English title: `Repentance: Its Reality, Conditions, and Effects`
- Arabic title: `التوبة حقيقتها وشروطها وآثارها`
- assignee: Zahraa
- status: `in_progress` / Translating
- Workbench denominator: `131`
- verified/synchronized progress: **34/131**
- current English Book URL: `https://docs.google.com/document/d/1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg/edit`

The 34/131 state was written to the live Workbench by the self-hosted runner and returned by the API itself:

- repo: `mohalizahraa/userpkm`
- branch: `tmp/workbench-pdf-audit-20261003`
- run: `37183273057`
- job: `111379943013`
- conclusion: success
- response confirmed `project.id=3`, `catalog_id=book-123`, `status=in_progress`, `translated_pages=34`, `pages=131`, and the correct Repentance Google Doc URL.

## 3. English manuscript state

Google Doc:

- id: `1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg`
- title: **Repentance: Its Reality, Conditions, and Effects — English Translation**
- tab: `t.0`
- revision at handoff: `ANLCKQnicyFrsdecUCi6mU7avbRCAloqmCVqB8C33-HS4zbmFOVnURmI3Z00dqDPuI0lVn1BwDzo9-a6sSVJkGTAwXNwGfrgSs4rzEl0z14`
- body end at handoff: `32214`
- paragraphs at handoff: `100`
- highest native footnote number: **54**

The manuscript has been read back after the latest writes. Source pages **1–34 are covered** against the physical PDF-page sequence used by the Workbench progress system.

The latest completed material covers the subsection on the individual/social effects of sins. The manuscript currently ends with:

> Likewise, Glorified is He, says: “Had the people of the towns believed and been Godwary, We would surely have opened for them blessings from heaven and earth. But they denied, so We seized them for what they used to earn.”

That is the end of the page-34 batch. The next native footnote number should therefore be **55** unless a concurrent editor adds something first.

Always re-read the latest Doc revision before the next write and use `requiredRevisionId`. If the revision changed, reconcile the new tail instead of overwriting it.

## 4. Exact resume point

**Resume at physical Arabic PDF page 35.**

Page 35 first continues the discussion of the social effects of sins, then introduces the Arabic heading:

- `عود على بدء`

Pages 35 onward were already rendered in the current session, but those local images are not durable continuation authority. A fresh session should re-render from the canonical PDF artifact/source described below.

Do not increment the Workbench counter beyond 34 until page 35 is fully translated and structurally verified.

## 5. Canonical PDF source access is now solved

The translation environment originally could not resolve/read the Cloudflare Pages hostname directly even though the Workbench Arabic PDF button worked in the browser.

A working zero-dollar bridge now exists through the already-live **userpkm self-hosted runner**.

Successful canonical source fetch:

- Workbench route used: `https://haydari-translation-workbench.pages.dev/api/pdf/3`
- runner: `userpkm-mac-arm64-light`
- machine: `Zahraas-MacBook-Pro`
- source bridge run: `37181922135`
- job: `111376045256`
- conclusion: success
- fetched PDF bytes: `686222`
- PDF SHA-256: `94a440d9d4fe96cbd5cd651eac0fc39fa38198957aee4a3493234feca00f58f0`
- PDFKit page count reported by the runner: **132**

Full PDF artifact:

- artifact name: `workbench-repentance-pdf`
- artifact id: `11294674305`
- artifact ZIP SHA-256: `47a309193b1bf3649e8f63cff064bf30e0259066a973fc3d2eaa83f43196329a`
- run: `37181922135`
- retention: 1 day
- expires: approximately `2026-10-05T06:08:23Z`

Rendered pages 6–20 artifact:

- artifact id: `11295118718`
- artifact ZIP SHA-256: `1c02528bcc3c3c1de21cc177ff932d663f0413fa55b947e72e5a3cde4d23c77c`

A fresh session can use the GitHub artifact download action/tool, materialize/unzip the full PDF, and render page 35 onward locally. Once the full PDF is materialized, another runner job is **not** required for every batch.

If artifact `11294674305` has expired, re-trigger the temporary bridge on:

- repo: `mohalizahraa/userpkm`
- branch: `tmp/workbench-pdf-audit-20261003`
- workflow file: `.github/workflows/tmp-workbench-tawbah-source-render.yml`

That workflow currently fetches the PDF **through the Workbench route itself**, not from a separately chosen source.

## 6. Important denominator anomaly

The Workbench/D1 project currently reports `pages=131`, and the website progress system therefore shows `X/131`.

The exact canonical PDF returned by the Workbench route reports **132 PDF pages**. Page 132 is not blank; it contains Arabic back-matter/listing content.

Do **not** silently change the denominator during continuation. Preserve the current 34/131 website truth while translating, and reconcile the 131-vs-132 denominator before final completion accounting. The progress contract remains physical-source-page based, so this mismatch must be explicitly resolved rather than ignored at the end.

## 7. Translation/formatting behavior already in use

Continue the existing English-only publication format:

- publication-quality English, not summary;
- Amiri body text;
- native Google Docs footnotes, not inline pseudo-footnotes;
- Qurʾānic quotations styled in green as already established in the Doc;
- subsection headings centered/bold with the established page-break behavior;
- preserve source order;
- translate/source-check notes as well as body text;
- use source-page progress only when the whole physical source page is covered.

Recent batches were appended with Google Docs revision guards and structural readback. A concurrent edit once changed the revision mid-write; the guard correctly blocked the stale write. Keep this concurrency protection.

## 8. English Book routing corrections are now durable

A serious cross-link was found and repaired:

- **Repentance / book-123** must route to:
  `1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg`
- **A Study on Imamate / book-122** must route to:
  `1-uFLmhiFV_G4lFsYhiEA9iAFpoeKMirptUloqinWN9M`

The Imamate Doc was verified to be titled **A Study on Imamate — English Translation**.

All 11 portfolio English Docs were title-checked against their intended book, and the Imamate Doc was checked as the 12th known linked Doc. The Workbench now has a one-time routing lock in `workbench/functions/_lib.js` that pins those known Doc IDs to the intended `catalog_id` and removes those Doc IDs from a wrong project if cross-wired.

The temporary public audit endpoint used during verification was removed.

No new Workbench project should be created for any of these books.

## 9. Workbench PDF bridge in Website-Source

A generic project-local bridge was also added to `Website-Source`:

- `workbench/source-access-request.txt`
- `.github/workflows/workbench-source-fetch.yml`
- documented under the Workbench README

Its intended contract is:

1. choose a Workbench project id;
2. self-hosted runner downloads `/api/pdf/<id>`;
3. verify a real PDF;
4. upload a short-lived Actions artifact.

However, the `Website-Source` self-hosted queue was not executing reliably. Do not wait on that queue when the working `userpkm-mac-arm64-light` path is available.

## 10. Suspended-open runner-capacity loop

The founder explicitly raised that more runners may be needed.

Current evidence:

- `Website-Source` self-hosted jobs had been stuck queued;
- `userpkm-mac-arm64-light` is alive and successfully ran the Workbench PDF bridge and progress-sync jobs;
- Operator and Nexus also have their own self-hosted runner paths;
- founder policy is **$0 paid GitHub compute**. Do not switch to billable GitHub-hosted compute.

Immediate translation is unblocked through the userpkm runner, so runner provisioning is **not a blocker to page 35**.

Still-open infrastructure question: establish a permanent reliable runner path for `Website-Source`—either a dedicated runner or a properly managed shared pool—rather than continuing to depend on temporary cross-repo routing. Do not create runners blindly; reconcile labels, concurrency, repo authorization, and existing Mac capacity first.

Return to this infrastructure loop after the translation is safely moving, or sooner if the userpkm bridge becomes unavailable.

## 11. Suspended-open sharing-permission defect

The Workbench now guards English Book opening so a restricted Google Doc does not silently send users to a Google “Request access” page, and new restricted links are rejected.

But the underlying Google Drive connector does **not** expose the public “Anyone with the link” permission. Earlier audit found the generated translation Docs were generally owner-only, while the Imamate Doc was the public-editable exception.

This is an underlying Drive-sharing open loop, separate from routing correctness. Do not claim those permissions were fixed unless the actual Google sharing state is changed and verified.

## 12. Exact continuation order

1. Freshly load Operator routing + Arabic-book-translation profile + current Workbench authority.
2. Re-read the Repentance Google Doc and confirm current revision/tail before writing.
3. Download/materialize canonical PDF artifact `11294674305` if still available; otherwise re-trigger the userpkm temporary bridge.
4. Render source page 35 onward from that exact PDF.
5. Translate page 35 completely, including notes, preserving established Doc formatting and using a `requiredRevisionId`.
6. Read back the write structurally.
7. Sync Workbench from 34 to 35 only after page 35 is fully covered.
8. Continue sequentially in efficient batches, but keep progress accounting page-accurate.
9. Before final completion, reconcile the **131-vs-132** PDF denominator.
10. Keep the runner-capacity and Drive-sharing defects visible as suspended-open loops; neither should silently disappear.

## Restart sentence

Freshly load `mohalizahraa/operator-protocol/AGENTS.md`, Core, every materially routed owner/profile, and the current Workbench authorities; verify routing/dependency completeness before consequential action. Resume **Repentance / book-123 / project 3** at **34/131**, source physical page **35**, in Google Doc `1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg`. Use the canonical Workbench PDF with SHA-256 `94a440d9d4fe96cbd5cd651eac0fc39fa38198957aee4a3493234feca00f58f0`; prefer artifact `11294674305` while live, otherwise re-trigger the working userpkm self-hosted bridge. Re-read the latest Google Doc revision before every write, preserve native footnotes/Qurʾān styling, and update the Workbench counter only after full physical-page coverage.

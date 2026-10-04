# Handoff — Zahraa 11-book English translation portfolio / Tawbah 5 of 131 / live page progress

Date: 2026-10-04
Repository: `mohalizahraa/Website-Source`
Branch: `workbench`
Handoff base head observed before this handoff: `497d8e50f1d44532a8602ada1af51e0db5a2b233`
Canonical production site: https://haydari-translation-workbench.pages.dev/

## Restart contract

Freshly load the live Operator Protocol from `mohalizahraa/operator-protocol` starting with `AGENTS.md`, then the materially routed owners including Core, Execution, Knowledge, Assurance, Communication, Handoff, and `profiles/arabic-book-translation.md`. Load the current Workbench authorities from this repository before mutation.

**Do not substitute this handoff or memory for live authority.** Re-read the live Workbench project records and branch head because multiple concurrent sessions have touched this project.

## Founder outcome

For each of Zahraa's **11 existing assigned Workbench books/projects**:

1. use the existing Arabic PDF/source already attached to that existing book;
2. create/use one native English Google Doc;
3. translate the complete authoritative Arabic PDF into English;
4. format the English edition under the live Operator Arabic-book translation profile, currently REAL SCALE v2 where applicable;
5. set the Google Doc sharing to **Anyone with the link → Editor**;
6. link the Doc to that same existing Workbench book's **English Book** field;
7. expose source-page translation progress on the Workbench as **X/Y source pages translated**;
8. do not mark semantic/review/publication gates complete merely because page translation exists.

### Hard founder constraints

- **DO NOT CREATE ANY NEW WORKBENCH PROJECTS.** Only mutate the already-existing Zahraa projects.
- User explicitly caught and rejected any path that looked like Add Project/New Project. Existing project IDs 1–11 are the translation portfolio.
- Actual Arabic→English translation work is **strictly one book at a time** to prevent book/text/footnote/page-counter/doc mixups.
- Mechanical setup across the 11 may be parallel, but translation content must not be interleaved.
- Current translation order: **finish Tawbah / Repentance first**, then move to the next book.
- Progress denominator is the **physical/source page count of the authoritative Arabic PDF**, not Google Doc pages.
- Page progress must be truthful: unreadable/unverified source pages do not count.
- Hard $0 cost constraint remains. Do not switch queued GitHub work to paid/hosted compute. Self-hosted runner is the fallback.
- Railway remains banned.
- No secrets/private URLs or private data should be exposed publicly beyond the deliberately linked English Docs once their sharing rule is satisfied.

## Live portfolio state — verified from production API on 2026-10-04

All 11 are still assigned to Zahraa and all 11 have `pdf_available=true`.

| Project | Arabic title | Source pages | translated_pages | Live English Doc |
|---:|---|---:|---:|---|
| 1 | عصمة الأنبياء في القرآن الكريم | 209 | 0 | `1KJBqjZ41Zasg_LqrKNr4wJXZCkpOcJ77PXQal2KU1qM` |
| 2 | التدابير النبوية لحفظ الرسالة الإلهية | 584 | 0 | `1C8ZOE14w9mUF27hBowwnk42d_fG2cl32R2T5GAeepS8` |
| 3 | التوبة حقيقتها وشروطها وآثارها | 131 | **5** | **CONFLICT — see below** |
| 4 | الدعاء إشراقاته ومعطياته | 273 | 0 | `15MMgcj6TPtdCotBecPUJW9xX59-Py_ODsHqRqh_dDLc` |
| 5 | التوسّل بصاحب الوسيلة | 375 | 0 | `1H4wfN_tAi4seppBApq2KoDgYrzrK2GZQOW2CllvDeSg` |
| 6 | صفات عباد الرحمن في القرآن | 487 | 0 | `1DmCHtfaYsWwWKavXipTrWZo9oq0E4tq2FZVySoSa18A` |
| 7 | معالم التجديد الفقهي | 214 | 0 | `1fOo0Y8M1UcaKHR-odP87jGRRlCAT3x9i6AVX7qi6lB0` |
| 8 | فقه الصيام ـ أسئلة وردود | 258 | 0 | `1AWIyWa5nGXmmGXfM9YqxnggeaKInLt0z9D2hD6mmz9k` |
| 9 | العلامة الطباطبائي ملامح من سيرته الذاتية ومنهجه العلمي | 194 | 0 | `1OKZtuUcgsqYxjKMBtQCtwuwSWJyeVHrW098EIgCs3xA` |
| 10 | المرجع الديني السيد كمال الحيدري نبذة عن حياته، منهجه، مشروعه الاصلاحي | 298 | 0 | `1iiiuDLR_NV8mUjg4RMTxZRgt94l5w3masRqPQJZtsog` |
| 11 | مناسك الحج | 291 | 0 | `175AdOpqDeN1ul2PStNR_-QWLgjOM4VxesOukEBobjSI` |

The 11 Docs were created as native Google Docs and moved into Drive folder:

- Folder name: `ChatGPT`
- Folder ID: `1RjIU_LmFKWQYboKmMkDT1_v6aVNLJVkY`

A repository migration at commit `ed56948ad3d1a9ec2dec0d436b0019220034ca7b` added the intended Google Doc links for project IDs 1–11 without creating new projects.

## CRITICAL concurrency conflict — project 3 / Tawbah

Do **not** continue or relink project 3 blindly.

### Accessible translated Doc we created and edited

- Doc ID: `1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg`
- Title: `Repentance: Its Reality, Conditions, and Effects — English Translation`
- Parent folder: the `ChatGPT` folder above.
- Drive metadata verified this Doc exists and is accessible.
- This is the Doc containing the **verified pages 1–5 translation work described below**.
- Drive metadata at handoff time: `shared=false`; public link editing has **not** been established.

### Current live Workbench project 3 link

Production API currently reports project 3 `google_doc_url` as:

`https://docs.google.com/document/d/1-uFLmhiFV_G4lFsYhiEA9iAFpoeKMirptUloqinWN9M/edit?usp=drivesdk`

The connected Google Drive account cannot find/access that Doc ID (404).

Production API also currently reports:

- raw status: `completed` (UI semantic: **Needs Review** under the current status model)
- `completed_at=2026-10-04T04:26:52.677Z`
- `completed_by=Zahraa`
- `translated_pages=5`
- `translation_progress_at=2026-10-04T02:27:18.240Z`

This is internally inconsistent with the known page progress and was written by another concurrent process/session after our earlier linking. **First resume action must reconcile this conflict** from live activity/repo/Drive evidence before changing project 3's link or status. Preserve both candidates until authority is established.

Likely intended Doc from this workstream is `1xBI...`, because that is the native Doc created in the approved ChatGPT folder and contains the verified 5-page work, but do not silently overwrite a potentially newer concurrent artifact without checking what happened.

## Tawbah / Repentance translation state

Authoritative Workbench Arabic source:

`https://archive.alhaydari.com/ebook/ar/%D9%83%D8%AA%D8%A8-%D8%A7%D9%84%D8%A3%D8%AE%D9%84%D8%A7%D9%82/%D8%A7%D9%84%D8%AA%D9%88%D8%A8%D8%A9-%D8%AD%D9%82%D9%8A%D9%82%D8%AA%D9%87%D8%A7-%D9%88%D8%B4%D8%B1%D9%88%D8%B7%D9%87%D8%A7-%D9%88%D8%A2%D8%AB%D8%A7%D8%B1%D9%87%D8%A7.pdf`

Source denominator: **131 physical PDF pages**.

### Verified translation progress

**5/131 source pages translated and written into Doc `1xBI...`.**

Production Workbench page counter was live-tested and verified at **5/131 (4%)** without changing other fields in that specific progress update.

### What pages 1–5 contain in the accessible Doc

Pages 1–3:
- title/front matter;
- title rendered as `Repentance — A Study of Its Conditions and Effects`;
- Sayyid Kamal al-Haydari attribution;
- basmala / blessing opening matter;
- `The Book of Repentance`.

Pages 4–5:
- `Section One: The Meaning of Repentance`;
- H3 topic: definition of repentance in language;
- H3 topic: definition of repentance in technical usage;
- dictionary/source quotations;
- Qurʾanic span `﴾Then He turned toward them﴿ (al-Tawbah 9:118)`;
- ten native Google Docs footnotes.

### Formatting/QA state for pages 1–5

Translator profile was freshly loaded from:

`mohalizahraa/operator-protocol/profiles/arabic-book-translation.md`

Active preferred formatting is REAL SCALE v2:
- ordinary body: 14 pt Amiri, 115%, 18 pt first-line indent, 0 above / 4 below, ragged-right;
- H1/H2 page-break hierarchy; H3/H4 continuous;
- Qurʾanic translation uses flipped Qurʾanic brackets and green `#38761D`;
- source/scholarly quotations bold by semantic role;
- native footnotes 10 pt Amiri, 115%, 0 above/below, 18 pt first-line indent, exactly one literal space after host marker.

Pilot discoveries/fixes:
- Google Docs inherited `pageBreakBefore` from front matter into later content. This was detected before scaling and corrected.
- Post-fix intended forced breaks were restricted to actual title/major-section surfaces; an inherited empty-paragraph break was also cleared.
- **10/10 footnotes are native Google Docs footnotes**, populated and structurally read back.
- Footnotes were verified with the required one-space marker separation and 10 pt / 115% / 18 pt first-line geometry.
- Current English Doc was exported to PDF and visually inspected; pages 4–5 rendered cleanly with footnotes at the page bottom, consistent typography, and the Qurʾanic span styling intact.
- Do not treat this pilot as whole-book publication QA.

### Source extraction boundary

The Arabic PDF's embedded text layer is unreliable/garbled. Do **not** translate future pages from garbage extraction.

Browser/rendered-page reading established pages 1–5 sufficiently for the current translation. Pages 6–8 were **not** considered reliable enough through the browser text layer and therefore were not counted.

A self-hosted source-fetch path was subsequently added to the repository:

- head commit observed before handoff: `497d8e50f1d44532a8602ada1af51e0db5a2b233` — `Document identity-scoped live translation feed`
- workflow: `.github/workflows/workbench-source-fetch.yml`
- current source-fetch run: **37175653645**
- job: **111357609627**
- state observed before handoff: **queued** on self-hosted runner
- intended artifact: `tawbah-source`, retention 1 day
- exact current head Cloudflare deployment: **success**

Do not pay to skip the queue. Once the self-hosted run succeeds, prefer the authoritative downloaded PDF artifact/rendered pages for pages 6 onward.

## Workbench live-progress implementation

Source-page progress is first-class Workbench state.

Key ancestor commits:
- `08af591e72bb333d33b4431be7c55ef9e62263cd` — `Add live page translation progress feed`
- `3e4e777ace219f5c59dff82c484de912406fa72b` — `Show progress for every assigned translation`

Behavior now intended/deployed:
- project field `translated_pages`;
- Dashboard **Live translation progress** panel;
- recent translation-page update feed;
- per-book source-page bars;
- selected `Using as` collaborator sees **every assigned book**, including untouched books at **0/Y**;
- active work is sorted/emphasized ahead of quiet 0% baselines;
- Zahraa's 11 assigned books should therefore all be visible as progress rows/bars;
- activity entries for progress show `X/Y pages translated`.

The `3e4e777...` Cloudflare deploy passed. The current later branch head `497d8e50f1d44532a8602ada1af51e0db5a2b233` also has a successful Cloudflare Pages check.

## Google Doc sharing requirement — OPEN / BLOCKED ON AUTHENTICATED UI

Founder requirement for all 11 Docs:

> **Anyone with the link → Editor**

This is not optional and must be verified per Doc before the sharing gate is closed.

Current connected Google Drive API can create/edit Docs and inspect permissions but does not expose the public anonymous-link permission needed here.

A TinyFish setup session was previously offered for Google Drive, but current TinyFish profile state still shows:

- profile `prof_7e57954994d843d4`
- `signed_in_sites=[]`

Therefore Google sign-in/profile setup was **not completed** in the browser profile at handoff time.

At least the accessible Tawbah Doc `1xBI...` was explicitly verified as `shared=false` with only owner-level permission. No 11/11 public-edit sharing verification exists yet.

Do not silently substitute named-user, domain-wide, viewer, or commenter permissions.

## Current repo/deploy chronology relevant to this workstream

Recent branch commits observed:
- `ed56948ad3d1a9ec2dec0d436b0019220034ca7b` — Link Zahraa English Docs to existing projects
- `3e4e777ace219f5c59dff82c484de912406fa72b` — Show progress for every assigned translation
- several temporary Tawbah source bridge/parser attempts were added/removed by concurrent work
- `f93f61a25101e919a173d5c588b3d3023e0f41ea` — Fetch Tawbah source on self-hosted runner

Because the branch is active concurrently, **re-fetch head before every mutation** and do not overwrite concurrent changes.

## Exact next actions

1. **Re-fetch the `workbench` branch head and live project 3 record.**
2. **Reconcile the project 3 concurrency conflict**:
   - inspect Workbench Activity/repo history around `2026-10-04T04:26:52Z`;
   - determine what produced inaccessible Doc `1-uFLm...` and raw `completed` status;
   - inspect any accessible evidence for that concurrent artifact;
   - preserve `1xBI...` and its verified 5-page content;
   - only then repair the Workbench link/status if warranted.
3. Check self-hosted source-fetch run `37175653645`; if successful, retrieve/use the authoritative Tawbah PDF artifact. Do not switch to paid compute.
4. Resume Tawbah at **source page 6**, not page 1 and not another book.
5. Work in bounded verified page batches; for every batch:
   - read authoritative rendered source pages;
   - translate faithfully under the Arabic-book profile;
   - write into the same authoritative English Doc after the doc conflict is resolved;
   - preserve semantic heading/quotation/footnote structure;
   - read back native Docs structure;
   - render/export where layout-sensitive;
   - only after QA, advance `translated_pages` to the last source page actually translated.
6. Finish all **131/131 Tawbah pages** before beginning another book's translation.
7. After text completion, perform whole-book translation/profile gates; do not promote to Needs Formatting/Needs Review/Publish Ready until the appropriate semantic and formatting gates really pass.
8. Resolve the Google authenticated-browser permission gate and set **Anyone with the link → Editor** on all 11 Docs; verify 11/11.
9. Continue the remaining 10 books **sequentially**, never interleaving their content translation.

## Completion semantics

Do not conflate:
- `X/Y source pages translated`;
- text-complete;
- formatting complete;
- semantic/review complete;
- Publish Ready;
- Published.

The founder explicitly wants page progress to remain live and truthful throughout the process.

## Resume prompt

> Freshly load Operator `AGENTS.md`, Core, every materially routed owner/profile including Arabic Book Translation and Handoff, then load the live `Website-Source` Workbench authorities. Treat this handoff as continuity evidence, not replacement authority. Re-fetch the branch head and production project records. First reconcile the Tawbah project-3 concurrent Doc/status conflict without destroying the verified `1xBI...` 5-page translation. Then check the queued self-hosted Tawbah source-fetch run, resume authoritative rendered-source translation at page 6, keep page progress truthful on the Workbench, finish Tawbah end-to-end before touching another book's translation, and preserve the founder's 11/11 Anyone-with-link Editor sharing requirement and no-new-project rule.

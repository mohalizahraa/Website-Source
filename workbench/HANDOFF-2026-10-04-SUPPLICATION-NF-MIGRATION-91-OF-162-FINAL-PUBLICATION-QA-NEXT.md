# Handoff — Supplication: NF migration 91/162 complete, 71 placeholders remain, final publication QA next

Date: 2026-10-04  
Repository: `mohalizahraa/Website-Source`  
Branch: `workbench`

## Critical restart instruction

Before substantive work, freshly read `mohalizahraa/operator-protocol/AGENTS.md` and route the smallest material Operator owners. For this book, the Arabic-book translation profile is material; execution, knowledge, assurance, communication, and research/source-access are material whenever editing/verifying the live Google Doc or authoritative Arabic source.

Do **not** substitute this handoff for current Operator or project authority.

## Parent outcome

Finish the publication-ready English edition of:

**Supplication: Its Illuminations and Implications**  
Arabic: **الدعاء إشراقاته ومعطياته**

The source-page translation pass is already complete at **280/280 physical PDF pages**. The remaining work is production: complete native-footnote migration, re-run layout/render QA, perform the terminal native Google Docs TOC refresh, and pass final publication gates.

The founder’s standing presentation instruction remains active:

> Track defects while working; repair what is safely agent-owned; **only present remaining defects after formatting is finished**, and only if anything still remains.

## Live manuscript identity

Google Doc:  
`https://docs.google.com/document/d/15MMgcj6TPtdCotBecPUJW9xX59-Py_ODsHqRqh_dDLc/edit`

Document ID: `15MMgcj6TPtdCotBecPUJW9xX59-Py_ODsHqRqh_dDLc`  
Tab: `t.0`

Fresh live revision at handoff creation:

`ANLCKQkgmZALbL2CwvrgR8PwlJEcJbvAq4gvCL3vSuVwWiQIAAxH-fDPdInr8wmV0a5R7Q75jtXVvZDcIkgH8BTxn69MLvhdJruhGGgWQyI`

Fresh structural counts from that exact revision:

- **436 native Google Docs footnotes**
- **71 temporary NF placeholders**
- **71 unique placeholder numbers**
- no duplicate placeholder numbers in the fresh scan
- remaining ranges: **NF209–NF269, NF272–NF277, NF280–NF283**

Earlier pre-migration state was 345 native footnotes + 162 placeholders, so **91 of the 162 placeholder notes have now been migrated natively** and **71 remain**.

If every remaining placeholder maps one-to-one as established, the fully migrated document should end at **507 native footnotes**.

## Source authority

Primary authoritative Arabic PDF:

`https://archive.alhaydari.com/ebook/ar/%D9%83%D8%AA%D8%A8-%D8%A7%D9%84%D8%A3%D8%AE%D9%84%D8%A7%D9%82/%D8%A7%D9%84%D8%AF%D8%B9%D8%A7%D8%A1-%D8%A5%D8%B4%D8%B1%D8%A7%D9%82%D8%A7%D8%AA%D9%87-%D9%88%D9%85%D8%B9%D8%B7%D9%8A%D8%A7%D8%AA%D9%87.pdf`

Haydari source page:

`https://alhaydari.com/ar/2012/08/34150/`

A cleaner same-book PDF mirror was useful as an **access/reconstruction aid** for page-footer extraction:

`https://h-najaf.iq/upload/pdf/%D8%A7%D9%84%D8%AF%D8%B9%D8%A7%D8%A1%20%D8%A7%D8%B4%D8%B1%D8%A7%D9%82%D8%A7%D8%AA%D9%87%20%D9%88%D9%85%D8%B9%D8%B7%D9%8A%D8%A7%D8%AA%D9%87.pdf`

Do not silently promote the mirror above the Haydari source; use it to recover formatting/text when the authoritative extraction is garbled, and verify any material ambiguity against the authoritative witness.

## Exact NF/source mapping rule

The remaining temporary `NF...` markers are not arbitrary IDs. The stable mapping established from the source is:

> **NF208 is the first printed footnote on source page 137. Continue in printed-page order and within each page in footnote-number order.**

This yields a complete one-to-one NF208–NF369 mapping. A naive global regex over extracted markdown is unsafe because body lines can look like `(1)` footnotes and produce false starts. Use structured page extraction / printed-page footer boundaries.

One special parsing caveat: the printed **page 139** note is malformed in the extraction and can be skipped by footer regex. It is **NF213**. Do not let automated page-footer counting omit it.

### Remaining NF → printed source page map

| Printed source page | Remaining NF marker(s) |
|---:|---|
| 137 | 209 |
| 138 | 210–212 |
| 139 | 213 |
| 140 | 214 |
| 141 | 215–216 |
| 142 | 217 |
| 143 | 218 |
| 145 | 219–220 |
| 146 | 221 |
| 147 | 222–224 |
| 148 | 225–226 |
| 150 | 227 |
| 151 | 228–229 |
| 152 | 230 |
| 158 | 231 |
| 159 | 232 |
| 162 | 233–234 |
| 165 | 235–236 |
| 168 | 237 |
| 169 | 238–239 |
| 170 | 240–243 |
| 171 | 244–245 |
| 172 | 246–248 |
| 173 | 249 |
| 174 | 250 |
| 175 | 251–253 |
| 176 | 254 |
| 177 | 255 |
| 179 | 256–258 |
| 180 | 259–262 |
| 181 | 263–264 |
| 182 | 265–267 |
| 183 | 268 |
| 184 | 269 |
| 185 | 272 |
| 186 | 273 |
| 187 | 274 |
| 188 | 275–276 |
| 189 | 277 |
| 190 | 280 |
| 191 | 281–282 |
| 192 | 283 |

The gaps in the NF ranges are intentional current state: **NF208, NF270–271, NF278–279, and NF284–NF369 have already been migrated and their placeholders removed**.

## Native-footnote migration invariant

For every remaining marker:

1. identify the exact Arabic source note against the authoritative source;
2. translate the note at publication quality with source/citation identity preserved;
3. insert a **true native Google Docs footnote** at the marker’s exact callout;
4. verify native-footnote readback;
5. only then remove that temporary NF marker;
6. preserve marker until native insertion is proven;
7. do not simulate footnotes with body text or bracketed references.

Do not guess through damaged source extraction. Preserve an explicit source anomaly if exact wording cannot be established.

## Important formatting/production decisions already applied

The founder’s earlier missing-message issue has been resolved. The recovered requirements were:

1. preserve scholarly transliteration diacritics consistently;
2. restore the correct sacred/revered-person glyphs and their actual glyph font;
3. use **native Google Docs page numbers**, upper-right;
4. vertically center dedicated display/opening compositions appropriately, while chapter teaser bullets form a centered column with **left-aligned item text to a shared edge** rather than ragged individually centered lines;
5. use real Google Docs named styles for semantic titles/headings rather than font-size imitation, while not promoting body prose into heading styles.

### Verified/applied live

- Title page now reads: `Based on the Research of Āyatullāh Sayyid Kamāl al-Ḥaydarī ﵋`.
- `Qurʾān` / `Qurʾānic` scholarly diacritics were normalized where addressed.
- `﵊` / `﵋` glyph runs were audited and repaired to the intended glyph font in the previously inspected body/existing-footnote surfaces.
- All eight chapter-opener teaser lists were changed from individually centered lines to a shared-edge teaser column with stable hanging geometry.
- Dedicated-page spacer/centering geometry was adjusted, including Dedication.
- The doc has real semantic heading structure; an earlier audit found 160 named heading paragraphs and no established long body-prose block incorrectly promoted solely by the semantic audit.
- Page numbers were inserted through Google Docs’ **native dynamic page-number UI**, not manually typed. Model readback verified a `PAGE_NUMBER` autoText element in a right-aligned header and no footer. The page-number run was styled Amiri 10 pt.

Any later pagination-affecting change — especially native-footnote migration — invalidates final render and TOC evidence, so all final visual checks and TOC refresh must occur after the remaining note migration.

## Chapter opener state

The active opener model is:

- chapter label/title remain centered;
- the source-supported teaser list remains part of the opener composition;
- the teaser list is centered **as a column**, but its item text is left-aligned to one shared edge with stable hanging/wrap geometry;
- preserve bullets only where edition-supported;
- dedicated display compositions must be visually/vertically verified in the rendered artifact, not inferred from paragraph settings alone.

Spacer values were adjusted as a calibration pass, but **final visual proof must be re-done after all remaining footnotes change pagination**.

## Native TOC rule

Founder explicitly requires the **native Google Docs TOC**.

Do **not** hand-build a static contents list.

The TOC is terminal:

1. complete all native footnotes;
2. complete any remaining layout/format repairs;
3. export/render and complete final all-page visual QA;
4. then insert/refresh the **native Google Docs TOC**;
5. reverify exact final pagination.

Any later content, note, heading, font, spacing, or layout edit invalidates the TOC and requires another terminal refresh.

## Workbench / website continuity

Workbench project ID: **4**  
Catalog ID: **book-132**

The source-page pass remains **280/280**. The website’s progress plumbing was previously repaired to read hidden `⟦WBPROGRESS:<project>:<pages>:<total>⟧` state and refresh near-real-time.

Relevant Website-Source commits already landed:

- `fbe31e6a9021dd7d5b08d336fbf7d0a5b4b2d128` — near-real-time Workbench refresh
- `04a4677d27b0f567d537a79e5ea37dc04f7c36c9` — auto-sync verified translation markers

Do not regress to a second manual progress counter. The source-page number does not increase beyond 280 merely because formatting/note migration continues.

## Operator translation-profile updates already made

Canonical `mohalizahraa/operator-protocol/profiles/arabic-book-translation.md` was updated for these production rules in commits including:

- `6e87d3ea320f18712fe2ee6e193e3d041d614214`
- `733285c3e3b3201f2e65786e6af51071ca2454aa`
- `24cc55ed3c53775543850fc0a45a5540ad46e805`
- `3844effc4c9deb278be26f8601a405cbada863b9`

The `operator-translation` projection was verified synced to the canonical translation profile after that sequence.

Page-number UI workflow history:
- `20aeeeeae8ef9d2c91eadd7f101b7487404c3838` temporarily added a one-shot push/default-doc route;
- `1584e696a454de60f330ffcef3720ad3df07f56e` restored the workflow to manual-only after successful native page-number insertion.

**Important Operator lifecycle debt:** the earlier Operator mutations had green invariants/projection checks, but the mandatory **whole-repository DMSC-to-the-floor pass** required by current AGENTS was not proven complete in the prior session. Do not claim the Operator mutation lifecycle fully closed unless that whole-repo floor is actually run and evidenced.

This debt is separate from finishing the book itself unless the next agent needs to close/report the Operator mutation.

## Exact remaining production queue

### 1. Finish NF migration
Status: **IN PROGRESS**

Current denominator:
- 162 original temporary notes
- 91 migrated
- **71 remaining**
- remaining markers: `209–269, 272–277, 280–283`

Continue from the exact live document state, not from a stale assumption that NF208–369 all remain.

### 2. Fresh final formatting/layout pass
Status: **OPEN after note migration**

Recheck:
- title/front matter;
- A Gleam / Dedication;
- every chapter opener and immediate following page;
- chapter teaser column geometry;
- semantic heading/native style correctness;
- glyph rendering/fallback;
- footnote typography and continuation behavior;
- blank/near-blank pages;
- clipping/overflow;
- accidental whitespace;
- back matter;
- first/last pages.

### 3. Fresh full render / visual QA
Status: **OPEN**

Generate a fresh final PDF after the last layout-changing edit and inspect the **entire exact edition**, not only structural API state or samples.

### 4. Terminal native Google Docs TOC refresh
Status: **OPEN / TERMINAL**

Perform only after content + layout have stabilized.

### 5. Final publication gates
Status: **OPEN**

Before any publication-complete claim, prove on the exact final artifact:

- no NF placeholders remain;
- native footnote count/readback is complete;
- native TOC is present and refreshed against final pagination;
- no unintended visible `WBPROGRESS` or other telemetry;
- no unintended Arabic residue in the English-only publication surface;
- source/citation integrity is preserved;
- headings/body/footnotes are typographically consistent;
- sacred/revered glyphs render correctly;
- native page numbers still render correctly;
- no clipping, overflow, accidental blank/near-blank pages, or broken opener geometry;
- full-page visual QA passes.

## Correct status language

Current state is **not publication complete**.

- Source-page translation: **280/280**
- Temporary-footnote migration: **91/162 complete**
- Native footnotes now present: **436**
- Temporary NF placeholders remaining: **71**
- Final full-render publication QA: **not yet complete**
- Native TOC terminal refresh: **not yet complete**

## Exact next action for a fresh agent

1. Fresh-load Operator router + required owners/profile.
2. Read this handoff from `Website-Source@workbench`.
3. Fresh-read the live Google Doc and recompute the marker/native-footnote counts before writing, because another agent may have advanced it.
4. Continue only the markers that still exist; never recreate already-migrated ones.
5. Use printed source-page mapping above and authoritative Haydari PDF; use the h-najaf mirror only as an access aid.
6. Insert native footnote → read back → remove marker, one safely verified unit/batch at a time.
7. After zero NF markers remain, run the final formatting + all-page render QA.
8. Refresh native Google Docs TOC **last**.
9. Only then evaluate publication completion.
10. Keep the founder’s “show only surviving defects after formatting is finished” instruction active.

## Return edge

The user asked to “finish up,” then asked for a handoff during the remaining native-footnote migration. Resume the **Supplication final production pass**, with **71 NF placeholders remaining at this handoff’s exact live read**.

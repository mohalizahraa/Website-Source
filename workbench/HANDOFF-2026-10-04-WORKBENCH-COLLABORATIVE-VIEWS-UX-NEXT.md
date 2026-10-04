# HANDOFF — 2026-10-04 — Workbench collaborative UX wave implemented

Status: restart-safe continuation projection for the Haydari Translation Workbench UX work.  
Repository: `mohalizahraa/Website-Source`  
Branch: `workbench`

Repentance remains **132/132, fully formatted, Needs Review**. Do not resume stale translation checkpoints.

## Founder-approved UX state

The founder approved all six recommendations from the prior collaborative-views handoff. They are now implemented together as one coherent UX model:

1. **Shared collaboration viewing scope**
   - Board and Timeline use the same remembered `Zahraa | Mohammed | Shared` scope.
   - Zahraa/Mohammed include `Both`.
   - Shared includes team work and keeps Unassigned work visibly distinct.
   - The global actor selector is now labeled **Editing as** and remains attribution/personal-dashboard identity only.

2. **Dashboard drill-down navigation**
   - Right-now metrics open matching Projects filters.
   - Zahraa/Mohammed person summaries open their scoped Board view.
   - Shared/Unassigned summaries open matching Projects filters.

3. **Activity filters**
   - All / Zahraa / Mohammed / System actor filters.
   - All events / Translation progress / Project changes type filter.
   - Existing terse event wording remains intact.

4. **Scan-speed ownership**
   - Compact Board cards show assignee badges.
   - Stored `Both` renders as human-facing **Shared**.

5. **Mobile Board status UX**
   - Narrow screens use status tabs / one Board column at a time instead of a five-column pan.
   - Board cards expose a tap-friendly status selector.
   - Desktop drag/drop remains available.

6. **Suspicious deadline guard**
   - Newly entered deadlines more than 90 days in the past show an inline warning.
   - Saving/applying such a date requires explicit keep-confirmation.
   - Historical dates remain allowed.

The previously repaired English Book access guard remains in force: every linked English Book open resolves through `/api/english-book/:id`.

## Canonical owner updates

`workbench/README.md` now records the six-part 2026-10-04 founder-approved UX wave and reconciles it against the earlier 2026-10-03 anti-bloat/narrow-wave decision. The later approval is scoped to these six items; it is not permission for unrelated feature expansion.

## Verification requirements

Before calling this wave complete:

1. `workbench/public/app.js` must parse.
2. `npm --prefix workbench run check:acceptance` must pass on a self-hosted runner.
3. Production `https://haydari-translation-workbench.pages.dev/` must visibly contain the new Board/Timeline scope controls and mobile/activity UX rather than the old markup.
4. English Book opens must remain guarded in deployed behavior.

The previous deployment blocker remains relevant until disproved: Cloudflare Pages was serving stale Board markup even after newer `workbench` commits, while GitHub commit status only exposed a blocked Vercel status and no Cloudflare deployment status.

## Suspended infrastructure loops

- Cloudflare Pages Git-integration/deployment freshness if production remains stale.
- Google Drive Anyone-with-link → Editor permission state, separate from Workbench guard routing.
- Permanent self-hosted runner capacity/routing.

## Exact continuation

Re-check the newest self-hosted Workbench static-acceptance run and production HTML after this UX commit. If production is still stale, preserve that as an explicit Cloudflare deployment blocker; do not claim branch state is live state.


## Latest exact state after implementation

- Six-part UX implementation commit: `7bbd61b581c782d78d5f007f6f30fd8880ed9c36`.
- Follow-up Dashboard person-drilldown cleanup commit: `dfc4f6bf5bb18617e19efbcc8af0d2e75f0c01c7`.
- Latest self-hosted Workbench static-acceptance run: `37190338758` on `dfc4f6bf`; state at verification: **queued**.
- Fresh production verification after `dfc4f6bf`: **still stale**.
  - live identity label remains `Using as`;
  - live Board still contains only the old bare `#board` container;
  - live Timeline has no collaboration-scope toolbar;
  - live Activity has no filters.
- GitHub combined status still exposes only the blocked Vercel status; no Cloudflare deployment status is attached.

Truth boundary: the UX wave is **implemented on the workbench branch but not verified/deployed in production**. The next execution step is infrastructure/deployment recovery, not more UX design.


## Whole-site English-title consistency correction

Founder noticed that English book titles were present only on some surfaces. The catalogue/runtime already carries `title_en`; the defect was projection-level. The Workbench now has a reusable bilingual title renderer and uses it on the previously Arabic-only secondary surfaces:

- live translation rows;
- recent translation feed;
- Timeline labels;
- Timeline Unassigned cards;
- Activity events.

Canonical invariant is recorded in `workbench/README.md`: if an English title exists, every visible book-title surface shows it alongside Arabic. Static acceptance now guards the projection.


## English Book sharing verification boundary

Founder reaffirmed that book deliverables must not be restricted. The live Workbench denominator is **176 projects / 12 currently linked English Google Docs**.

Full Drive-permission audit:

- **2/12 PASS — Anyone with the link → Editor (`anyone / writer`)**: Repentance; A Study on Imamate.
- **10/12 FAIL — restricted/owner-only, no `anyone` permission**: Supplication: Its Illuminations and Implications; The Infallibility of the Prophets in the Noble Qurʾān; The Prophetic Measures for Preserving the Divine Message; Seeking Intercession through the Possessor of the Means; The Attributes of the Servants of the All-Merciful in the Qurʾān; Features of Jurisprudential Renewal; The Jurisprudence of Fasting: Questions and Answers; ʿAllāmah al-Ṭabāṭabāʾī: Aspects of His Biography and Scholarly Method; The Religious Marjaʿ Sayyid Kamal al-Ḥaydarī: A Sketch of His Life, Method, and Reformist Project; Rites of Ḥajj.

The Workbench runtime guard remains an anonymous reachability/Request-access check. It cannot certify the Drive role is Editor, so the canonical project contract uses a two-gate model: Operator must verify `anyone + writer` in Drive metadata before linking, and the Workbench independently verifies public no-sign-in reachability.

Current remediation boundary: the connected Google Drive action can inspect permissions and share to a named user or Workspace domain, but it does **not** expose creation of a public `type=anyone` permission for consumer Gmail. A tested Workspace-domain share attempt correctly failed as inapplicable. Metered browser automation is not admissible under the founder's $0 boundary. Therefore the 10 permission mutations remain an explicit external-control blocker; do not report the 12-link audit as closed until all 12 show `anyone / writer`.


## Static asset cache regression repaired

Production HTML had advanced to the collaborative UX build while `/app.js?v=uxwave6` still served the older cached JavaScript, which prevented the newly committed bilingual-title projection from reaching users. The fix adds a fresh shared asset version to JS/CSS and a Cloudflare Pages `public/_headers` rule requiring cache revalidation. Production verification must check the unique current asset URL, not merely the HTML shell.

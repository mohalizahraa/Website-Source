import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [catalogSource, coverMap, pdfAudit, seriesMap, appSource, indexSource] = await Promise.all([
  fs.readFile(new URL('functions/_catalog.js', root), 'utf8'),
  fs.readFile(new URL('public/cover-map.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('public/pdf-audit.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('public/series-map.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('public/app.js', root), 'utf8'),
  fs.readFile(new URL('public/index.html', root), 'utf8'),
]);
const libSource = await fs.readFile(new URL('functions/_lib.js', root), 'utf8');
const coverProxySource = await fs.readFile(new URL('functions/api/official-cover/[id].js', root), 'utf8');
const coverSourcesSource = await fs.readFile(new URL('functions/_cover_sources.js', root), 'utf8');
const stylesSource = await fs.readFile(new URL('public/styles.css', root), 'utf8');
const projectPatchSource = await fs.readFile(new URL('functions/api/projects/[id].js', root), 'utf8');


const marker = 'export const BOOK_CATALOG = ';
const markerIndex = catalogSource.indexOf(marker);
assert(markerIndex >= 0, 'BOOK_CATALOG export was not found.');
const arrayStart = catalogSource.indexOf('[', markerIndex);
const arrayEnd = catalogSource.lastIndexOf('];');
assert(arrayStart >= 0 && arrayEnd > arrayStart, 'BOOK_CATALOG array could not be isolated.');
const catalog = JSON.parse(catalogSource.slice(arrayStart, arrayEnd + 1));

const expectedTopics = new Set([
  'Qurʾānic Exegesis and Sciences',
  'Theology and Doctrine',
  'Mysticism',
  'Ethics and Education',
  'Jurisprudence',
  'Principles of Jurisprudence',
  'Epistemology',
  'Philosophy',
  'Logic',
  'Thought, Culture, and Biography',
]);

assert(catalog.length === 176, `Expected 176 catalogue books, found ${catalog.length}.`);
const catalogIds = new Set(catalog.map(book => book.catalog_id));
assert(catalogIds.size === 176, `Expected 176 unique catalogue IDs, found ${catalogIds.size}.`);

const topics = new Set(catalog.map(book => book.topic_en).filter(Boolean));
assert(topics.size === expectedTopics.size, `Expected 10 topics, found ${topics.size}.`);
for (const topic of expectedTopics) assert(topics.has(topic), `Missing canonical topic: ${topic}`);

const covers = coverMap.covers || {};
assert(Object.keys(covers).length === 176, `Expected 176 cover mappings, found ${Object.keys(covers).length}.`);
for (const id of catalogIds) assert(covers[id], `Missing cover mapping for ${id}.`);

const auditedBooks = pdfAudit.books || {};
const auditRows = Object.entries(auditedBooks).filter(([id]) => id.startsWith('book-'));
assert(auditRows.length === 176, `Expected 176 PDF audit rows, found ${auditRows.length}.`);

const counts = auditRows.reduce((acc, [id, evidence]) => {
  assert(catalogIds.has(id), `PDF audit references unknown catalogue ID ${id}.`);
  acc[evidence.status] = (acc[evidence.status] || 0) + 1;
  return acc;
}, {});
assert((counts.available || 0) === 172, `Expected 172 available PDFs, found ${counts.available || 0}.`);
assert((counts.missing || 0) === 4, `Expected 4 missing PDFs, found ${counts.missing || 0}.`);
assert((counts.unchecked || 0) === 0, `Expected 0 unchecked PDFs, found ${counts.unchecked || 0}.`);

const expectedMissing = new Set(['book-4', 'book-23', 'book-32', 'book-43']);
const actualMissing = new Set(auditRows.filter(([, evidence]) => evidence.status === 'missing').map(([id]) => id));
assert(actualMissing.size === expectedMissing.size, 'Unexpected number of missing PDF records.');
for (const id of expectedMissing) assert(actualMissing.has(id), `Expected missing PDF record ${id} was not missing.`);

assert(appSource.includes('function localDateKey(date = new Date())'), 'Recipient-local date helper is missing.');
assert(!appSource.includes("const today = new Date().toISOString().slice(0,10);"), 'UTC deadline boundary regression detected.');
assert(appSource.includes('function startWorkOnBook(id)'), 'Work on Book behavior is missing.');
assert(appSource.includes('data-work-on-book'), 'Work on Book action is missing from project rendering.');
assert(appSource.includes("function sortProjects(projects, sort='updated')"), 'Projects sorting behavior is missing.');
assert(indexSource.includes('id="sort-projects"'), 'Projects sort control is missing.');
assert(appSource.includes("localStorage.setItem('haydariProjectSort'"), 'Projects sort persistence is missing.');
assert(appSource.includes('openEnglishBookDialog(id,true)'), 'Work on Book auto-continue into English Book linking is missing.');
assert(appSource.includes('reservedPdfWindow'), 'Work on Book post-link popup-safe continuation is missing.');
assert(indexSource.includes('Anyone with the link → Editor') && indexSource.includes('public Editor links'), 'English Book sharing requirement/boundary is missing from the UI.');
assert(projectPatchSource.includes('publicly accessible without sign-in') && projectPatchSource.includes('Anyone with the link → Editor'), 'English Book public-access guard messaging is missing or misleading.');
assert(appSource.includes('function clearProjectFilters()'), 'Clear filters behavior is missing.');
assert(indexSource.includes('id="clear-project-filters"'), 'Clear filters control is missing.');
assert(indexSource.includes('id="my-projects"') && indexSource.includes('id="my-projects-count"'), 'Personal assigned-project dashboard is missing.');
assert(indexSource.includes('data-actor-choice="Zahraa"') && indexSource.includes('data-actor-choice="Mohammed"'), 'Segmented actor switch is missing.');
assert(appSource.includes('function syncActorSwitch()'), 'Segmented actor switch synchronization is missing.');
assert(indexSource.includes('Editing as') && !indexSource.includes('>Using as<'), 'Identity/view-scope wording is ambiguous.');
assert(indexSource.match(/data-view-scope="Zahraa"/g)?.length === 2 && indexSource.match(/data-view-scope="Mohammed"/g)?.length === 2 && indexSource.match(/data-view-scope="Shared"/g)?.length === 2, 'Board and Timeline do not expose the shared collaboration scope.');
assert(appSource.includes("localStorage.setItem('haydariViewScope'") && appSource.includes('function viewScopeMatches(project)'), 'Shared Board/Timeline scope persistence is missing.');
assert(indexSource.includes('id="timeline-unassigned"') && appSource.includes('Unassigned schedule'), 'Timeline does not retain Unassigned work distinctly in Shared view.');
assert(indexSource.includes('id="board-status-tabs"') && appSource.includes('data-board-status'), 'Mobile Board status tabs are missing.');
assert(appSource.includes("root.querySelectorAll('.quick-status')"), 'Tap-friendly Board status mutation is missing.');
assert(appSource.includes('assigneeBadgeMarkup(p)') && appSource.includes("value === 'Both' ? 'Shared'"), 'Scan-speed Shared assignee badge behavior is missing.');
assert(indexSource.includes('data-dashboard-preset') === false, 'Dashboard drill-down controls must be rendered from live state, not hard-coded stale counts.');
assert(appSource.includes('data-dashboard-preset=') && appSource.includes('function openProjectsPreset(preset)') && appSource.includes('function openPersonWork(person)'), 'Dashboard summaries are not navigational.');
assert(indexSource.includes('data-activity-actor="System"') && indexSource.includes('id="activity-type"') && appSource.includes('function activityActorGroup(activity)'), 'Activity filtering controls/logic are missing.');
assert(indexSource.includes('id="due-date-warning"') && appSource.includes('function confirmSuspiciousDeadline(value,currentValue=') && appSource.includes('deadlineDaysAgo(value) > 90'), 'Suspicious-past-deadline warning/confirmation is missing.');
assert(appSource.includes('/api/official-cover/'), 'Official covers are not routed through the same-origin proxy.');
assert(coverProxySource.includes('sourceCandidates') && coverProxySource.includes('pagespeed'), 'Official cover proxy PageSpeed fallback is missing.');
assert(coverSourcesSource.includes('book-1') && coverSourcesSource.includes('book-176'), 'Generated official cover source projection is incomplete.');
assert(stylesSource.includes('--type-action:11px') && stylesSource.includes('.english-book-button{font-family:"Inter"'), 'Shared action geometry contract is missing.');
assert(!stylesSource.includes('.english-book-button{font:inherit}'), 'English Book font inheritance regression remains.');
assert(indexSource.includes('id="timeline-jump-today"'), 'Timeline Today control is missing.');
assert(appSource.includes('timeline-due-marker'), 'Timeline due marker is missing.');
assert(appSource.includes('async function setProjectDeadline(id, value)'), 'Shared deadline mutation helper is missing.');
assert(appSource.includes('function renderTranslationLive()'), 'Live translation progress renderer is missing.');
assert(appSource.includes('function bookTitleMarkup(project') && appSource.includes('function activityBookTitleMarkup(activity)'), 'Whole-site bilingual book-title projection helpers are missing.');
assert(appSource.includes('live-translation-copy">\${bookTitleMarkup(p,{compact:true})}') && appSource.includes('timeline-label-title">\${bookTitleMarkup(p,{compact:true})}') && appSource.includes('activityBookTitleMarkup(a)'), 'One or more secondary surfaces regressed to Arabic-only book titles.');
assert(appSource.includes("p.assignee===state.actor || p.assignee==='Both'"), 'Live progress is not scoped to the selected collaborator.');
assert(appSource.includes('translationProgressMarkup(p,true,true)'), 'Assigned books do not show zero-state page progress.');
assert(indexSource.includes('id="live-progress-summary"'), 'Assigned live-progress summary is missing.');
assert(indexSource.includes('id="live-translation-active"') && indexSource.includes('id="live-translation-feed"'), 'Live translation Dashboard surface is missing.');
assert(indexSource.includes('id="translated-pages"'), 'Project source-page progress field is missing.');
assert(appSource.includes("a.action === 'translation progress'"), 'Activity does not render translation-page events specially.');
assert(appSource.includes('due_date:value || null'), 'Deadline clearing does not send explicit null.');
assert(appSource.includes('data-clear-deadline'), 'Inline Remove deadline action is missing.');
assert(indexSource.includes('id="clear-due-date"'), 'Editor Remove deadline action is missing.');
assert(indexSource.includes('id="clear-batch-deadlines"'), 'Batch Remove deadlines action is missing.');
assert(appSource.includes('async function clearBatchDeadlines()'), 'Batch deadline clearing behavior is missing.');
assert(indexSource.includes('id="filter-toggle"') && indexSource.includes('id="filter-content"'), 'Collapsible filter surface is missing.');
assert(appSource.includes("querySelectorAll('.timeline-bar').forEach"), 'Timeline bars are not directly interactive.');
assert(appSource.includes("p.assignee === state.actor || p.assignee === 'Both'"), 'Actor-scoped assignment logic is missing.');
assert(indexSource.includes('value="__mine__">My assignments'), 'My assignments filter is missing.');
assert(appSource.includes("if ($('filter-assignee')?.value === '__mine__') renderProjects();"), 'Actor changes do not refresh My assignments filtering.');
assert(indexSource.includes('id="timeline-visual"') && indexSource.includes('id="timeline-unscheduled"'), 'Real timeline surface is missing.');
assert(appSource.includes('function timelineMonths(minDay,maxDay)') && appSource.includes('timeline-bar'), 'Time-axis renderer is missing.');
assert(appSource.includes('function render() { renderDashboard(); renderProjects(); renderBoard(); renderTimeline(); renderStats();'), 'Central render no longer refreshes Stats.');
assert(appSource.includes("els.dialog.close(); await loadData();"), 'Project save does not reload live state after mutation.');
assert(indexSource.includes('id="group-projects"'), 'Series grouping control is missing.');
assert(appSource.includes('function seriesGroupedMarkup(list)'), 'Series grouping renderer is missing.');
assert(appSource.includes("localStorage.setItem('haydariProjectGrouping'"), 'Series grouping preference is not remembered.');
assert(seriesMap.version === '2026-10-03-official-series-v2', 'Unexpected series-map version.');
assert(seriesMap.books['book-3']?.group === 'educational-ethics' && seriesMap.books['book-3']?.position === 5, 'Educational Ethics mapping is incomplete.');
assert(seriesMap.books['book-37']?.group === 'quranic-doctrinal-ethical-concepts' && seriesMap.books['book-37']?.position === 1, 'Concepts-series opening volume is missing.');
assert(seriesMap.books['book-133']?.group === 'quranic-doctrinal-ethical-concepts' && seriesMap.books['book-133']?.position === 7, 'Concepts-series seventh volume is missing.');
assert(seriesMap.books['book-43']?.role === 'umbrella' && seriesMap.groups['usul-lessons-commentary']?.total === 20, 'Uṣūl umbrella mapping is incomplete.');
assert(seriesMap.books['book-152']?.role === 'umbrella' && seriesMap.groups['creed-ethics-collection']?.type === 'collection', 'Creed/Ethics collection mapping is incomplete.');
for (const id of Object.keys(seriesMap.books || {})) assert(catalogIds.has(id), `Series map references unknown catalogue ID ${id}.`);
assert(appSource.includes("review: 'Needs Formatting'") && appSource.includes("completed: 'Needs Review'") && appSource.includes("published: 'Publish Ready'"), 'Production-stage labels are missing.');
assert(indexSource.includes('id="published"'), 'Separate Published control is missing.');
assert(libSource.includes("'production-stages-v2'"), 'Status-model migration is missing.');
assert(!indexSource.includes('>In Progress</option>') && !indexSource.includes('>Review</option>') && !indexSource.includes('>Completed</option>'), 'Legacy status labels remain in the UI.');

console.log('Workbench static acceptance passed: 176 books, 10 topics, 176 covers, 172 available PDFs, 4 missing, 0 unchecked.');

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
assert(appSource.includes('function clearProjectFilters()'), 'Clear filters behavior is missing.');
assert(indexSource.includes('id="clear-project-filters"'), 'Clear filters control is missing.');
assert(indexSource.includes('id="group-projects"'), 'Series grouping control is missing.');
assert(appSource.includes('function seriesGroupedMarkup(list)'), 'Series grouping renderer is missing.');
assert(appSource.includes("localStorage.setItem('haydariProjectGrouping'"), 'Series grouping preference is not remembered.');
assert(seriesMap.version === '2026-10-03-official-series-v1', 'Unexpected series-map version.');
assert(seriesMap.books['book-3']?.group === 'educational-ethics' && seriesMap.books['book-3']?.position === 5, 'Educational Ethics mapping is incomplete.');
assert(seriesMap.books['book-43']?.role === 'umbrella' && seriesMap.groups['usul-lessons-commentary']?.total === 20, 'Uṣūl umbrella mapping is incomplete.');
assert(seriesMap.books['book-152']?.role === 'umbrella' && seriesMap.groups['creed-ethics-collection']?.type === 'collection', 'Creed/Ethics collection mapping is incomplete.');
for (const id of Object.keys(seriesMap.books || {})) assert(catalogIds.has(id), `Series map references unknown catalogue ID ${id}.`);
assert(appSource.includes("review: 'Needs Formatting'") && appSource.includes("completed: 'Needs Review'") && appSource.includes("published: 'Publish Ready'"), 'Production-stage labels are missing.');
assert(indexSource.includes('id="published"'), 'Separate Published control is missing.');
assert(libSource.includes("'production-stages-v2'"), 'Status-model migration is missing.');
assert(!indexSource.includes('>In Progress</option>') && !indexSource.includes('>Review</option>') && !indexSource.includes('>Completed</option>'), 'Legacy status labels remain in the UI.');

console.log('Workbench static acceptance passed: 176 books, 10 topics, 176 covers, 172 available PDFs, 4 missing, 0 unchecked.');

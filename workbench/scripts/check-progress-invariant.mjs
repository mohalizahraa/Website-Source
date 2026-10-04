import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const generic = read('functions/api/projects/[id].js');
const progress = read('functions/api/projects/[id]/progress.js');
const app = read('public/app.js');
const catalog = read('functions/_catalog.js');

assert(
  generic.includes("Translation progress is verification-owned. Use the dedicated progress checkpoint endpoint."),
  'Generic project PATCH must reject translated_pages.'
);
assert(
  !/translated_pages\s*:\s*Number\(\$\('translated-pages'\)/.test(app),
  'Project editor must not submit translated_pages.'
);
for (const required of ['expected_previous_pages','source_total_pages','source_pdf_sha256','google_doc_revision']) {
  assert(progress.includes(required), `Progress endpoint missing required checkpoint field: ${required}`);
}
assert(
  progress.includes('Stale translation-progress checkpoint'),
  'Progress endpoint must fail closed on stale expected_previous_pages.'
);
assert(
  progress.includes('translation_progress_checkpoints'),
  'Progress endpoint must persist checkpoint evidence.'
);

const book123 = catalog.match(/"catalog_id": "book-123"[\s\S]*?"date": "2013-02-03"/)?.[0] || '';
assert(book123.includes('"pages": 132'), 'Repentance physical PDF denominator must remain 132.');

console.log('Translation progress invariants: PASS');

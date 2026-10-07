import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const schema = read('schema.sql');
const lib = read('functions/_lib.js');
const helper = read('functions/_translation.js');
const context = read('functions/api/projects/[id]/translation-context.js');
const sourcePack = read('functions/api/projects/[id]/source-pack.js');
const current = read('functions/api/translations/current.js');
const project = read('functions/api/projects/[id].js');
const progress = read('functions/api/projects/[id]/progress.js');
const progressSync = read('functions/api/projects/[id]/progress-sync.js');

assert(schema.includes('CREATE TABLE IF NOT EXISTS translation_focus'), 'translation_focus table is missing.');
assert(schema.includes('CREATE TABLE IF NOT EXISTS translation_source_packs'), 'translation_source_packs table is missing.');
assert(lib.includes('ON CONFLICT(assignee) DO NOTHING'), 'Focus bootstrap must not overwrite an explicit runtime focus.');
assert(lib.includes("catalog_id='book-2'") && lib.includes('official-transcript-series'), 'Known book-2 source-recovery seed is missing.');
assert(helper.includes("context_version: 'translation-fast-start-v1'"), 'Composite fast-start context version is missing.');
assert(helper.includes('effective_translated_pages') && helper.includes('verified-marker-ahead-of-d1'), 'Context does not reconcile a verified live marker ahead of D1.');
assert(helper.includes('workbench_pdf_url') && helper.includes('source_pdf_sha256'), 'Context is missing canonical source identity/access.');
assert(helper.includes("sentinel: '[[NEXT_BATCH]]'"), 'Context is missing the exact manuscript continuation sentinel.');
assert(helper.includes("project.assignee === 'Both' && TRANSLATORS.has(actor)"), 'Shared-book focus preservation is missing.');
assert(context.includes('getTranslationContext'), 'Per-project translation-context endpoint is not wired to the composite owner.');
assert(sourcePack.includes('translation_source_packs') && sourcePack.includes('recovery_routes'), 'Source-pack persistence endpoint is incomplete.');
assert(current.includes('resolveCurrentTranslation') && current.includes('getTranslationContext'), 'Current-translation endpoint does not resolve and return a one-hop context.');
assert(project.includes('syncTranslationFocusForProject'), 'Project lifecycle updates do not synchronize translation focus.');
assert(progress.includes('syncTranslationFocusForProject'), 'Verified page progress does not synchronize translation focus.');
assert(progressSync.includes('readPublicProgressMarker'), 'Live marker parsing is not consolidated at the shared translation helper.');

console.log('Translation fast-start invariants: PASS');

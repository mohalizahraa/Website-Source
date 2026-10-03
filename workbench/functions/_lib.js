import { BOOK_CATALOG, CATALOG_VERSION } from './_catalog.js';

const CATALOG_COLUMNS = [
  ['catalog_id','TEXT'],['translit','TEXT'],['author','TEXT'],['author_ar','TEXT'],['category','TEXT'],
  ['topic_en','TEXT'],['topic_ar','TEXT'],['package_url','TEXT'],['pages','INTEGER'],['volumes','INTEGER'],['catalog_date','TEXT'],
  ['pdf_status',"TEXT NOT NULL DEFAULT 'unchecked'"],['pdf_checked_at','TEXT'],['pdf_check_note','TEXT']
];

export async function ensureCatalog(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS workbench_meta (key TEXT PRIMARY KEY, value TEXT)').run();
  const existingColumns = await db.prepare('PRAGMA table_info(projects)').all();
  const names = new Set((existingColumns.results || []).map(row => row.name));
  for (const [name, type] of CATALOG_COLUMNS) {
    if (!names.has(name)) await db.prepare(`ALTER TABLE projects ADD COLUMN ${name} ${type}`).run();
  }
  await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_catalog_id ON projects(catalog_id) WHERE catalog_id IS NOT NULL').run();
  await db.prepare(
    "UPDATE projects SET pdf_status='missing', pdf_check_note=COALESCE(pdf_check_note,'No direct PDF candidate in catalog') WHERE (source_pdf_url IS NULL OR source_pdf_url='') AND pdf_status='unchecked'"
  ).run();
  const current = await db.prepare("SELECT value FROM workbench_meta WHERE key = 'catalog_version'").first();
  if (current?.value === CATALOG_VERSION) return;

  const statements = [];
  for (const book of BOOK_CATALOG) {
    statements.push(db.prepare(
      `UPDATE projects SET
         catalog_id = COALESCE(catalog_id, ?),
         title_en = CASE WHEN title_en IS NULL OR title_en = '' THEN ? ELSE title_en END,
         translit = ?, author = ?, author_ar = ?, category = ?, topic_en = ?, topic_ar = ?,
         source_url = ?,
         source_pdf_url = CASE WHEN source_pdf_url IS NULL OR source_pdf_url = '' THEN ? ELSE source_pdf_url END,
         package_url = ?, pages = ?, volumes = ?, catalog_date = ?, updated_at = updated_at
       WHERE catalog_id = ? OR title_ar = ?`
    ).bind(
      book.catalog_id, book.title_en || null, book.translit || null, book.author || null, book.author_ar || null,
      book.category || null, book.topic_en || null, book.topic_ar || null, book.detail_url || null,
      book.pdf_url || null, book.package_url || null, book.pages, book.volumes, book.date,
      book.catalog_id, book.title_ar
    ));
    statements.push(db.prepare(
      `INSERT INTO projects (
         title_ar,title_en,catalog_id,translit,author,author_ar,category,topic_en,topic_ar,source_url,source_pdf_url,package_url,pages,volumes,catalog_date,
         assignee,status,priority,blocked,pdf_status,pdf_check_note
       )
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Unassigned','not_started','normal',0,
              CASE WHEN ? IS NULL OR ? = '' THEN 'missing' ELSE 'unchecked' END,
              CASE WHEN ? IS NULL OR ? = '' THEN 'No direct PDF candidate in catalog' ELSE NULL END
       WHERE NOT EXISTS (SELECT 1 FROM projects WHERE catalog_id = ? OR title_ar = ?)`
    ).bind(
      book.title_ar, book.title_en || null, book.catalog_id, book.translit || null, book.author || null, book.author_ar || null,
      book.category || null, book.topic_en || null, book.topic_ar || null, book.detail_url || null, book.pdf_url || null,
      book.package_url || null, book.pages, book.volumes, book.date,
      book.pdf_url || null, book.pdf_url || null, book.pdf_url || null, book.pdf_url || null,
      book.catalog_id, book.title_ar
    ));
  }
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
  await db.prepare("INSERT INTO workbench_meta (key,value) VALUES ('catalog_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(CATALOG_VERSION).run();
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function actorFromRequest(request) {
  const actor = (request.headers.get('x-workbench-actor') || '').trim();
  return ['Zahraa', 'Mohammed', 'Brother'].includes(actor) ? actor : 'Unknown';
}

export function requireAccess(context) {
  const expected = context.env.WORKBENCH_ACCESS_TOKEN;
  if (!expected) return json({ error: 'Workbench access secret is not configured.' }, 503);
  const supplied = context.request.headers.get('x-workbench-key') || '';
  if (supplied !== expected) return json({ error: 'Not authorized.' }, 401);
  return null;
}

export async function recordActivity(db, projectId, actor, action, before, after) {
  await db.prepare(
    `INSERT INTO activity (project_id, actor, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    projectId ?? null,
    actor,
    action,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
  ).run();
}

export function normalizeProject(row) {
  const pdfStatus = row.pdf_status || (!row.source_pdf_url ? 'missing' : 'unchecked');
  return {
    ...row,
    blocked: Boolean(row.blocked),
    pdf_status: pdfStatus,
    pdf_available: pdfStatus === 'available' && Boolean(row.source_pdf_url),
    pdf_missing: pdfStatus === 'missing' || !row.source_pdf_url,
    pdf_unchecked: pdfStatus === 'unchecked' && Boolean(row.source_pdf_url),
  };
}

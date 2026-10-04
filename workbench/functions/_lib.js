import { BOOK_CATALOG, CATALOG_VERSION } from './_catalog.js';
import { PDF_AUDIT, PDF_AUDIT_VERSION } from './_pdf_audit.js';

const CATALOG_COLUMNS = [
  ['catalog_id','TEXT'],['translit','TEXT'],['author','TEXT'],['author_ar','TEXT'],['category','TEXT'],
  ['topic_en','TEXT'],['topic_ar','TEXT'],['package_url','TEXT'],['pages','INTEGER'],['volumes','INTEGER'],['catalog_date','TEXT'],['cover_url','TEXT'],
  ['translated_pages','INTEGER NOT NULL DEFAULT 0'],['translation_progress_at','TEXT'],
  ['pdf_status',"TEXT NOT NULL DEFAULT 'unchecked'"],['pdf_checked_at','TEXT'],['pdf_check_note','TEXT']
];

export async function ensureCatalog(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS workbench_meta (key TEXT PRIMARY KEY, value TEXT)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS project_covers (project_id INTEGER PRIMARY KEY, mime_type TEXT NOT NULL, image_bytes BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)').run();
  const existingColumns = await db.prepare('PRAGMA table_info(projects)').all();
  const names = new Set((existingColumns.results || []).map(row => row.name));
  for (const [name, type] of CATALOG_COLUMNS) {
    if (!names.has(name)) await db.prepare(`ALTER TABLE projects ADD COLUMN ${name} ${type}`).run();
  }
  await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_catalog_id ON projects(catalog_id) WHERE catalog_id IS NOT NULL').run();
  const statusModel = await db.prepare("SELECT value FROM workbench_meta WHERE key='status_model_version'").first();
  if (statusModel?.value !== 'production-stages-v2') {
    await db.batch([
      db.prepare(`UPDATE projects
        SET status = CASE
          WHEN status='review' THEN 'completed'
          WHEN status='completed' THEN 'published'
          ELSE status
        END,
        completed_at = CASE
          WHEN status='review' AND completed_at IS NULL THEN COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
          ELSE completed_at
        END
        WHERE status IN ('review','completed')`),
      db.prepare("INSERT INTO workbench_meta(key,value) VALUES('status_model_version','production-stages-v2') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    ]);
  }
  await db.prepare(
    "UPDATE projects SET pdf_status='missing', pdf_check_note=COALESCE(pdf_check_note,'No direct PDF candidate in catalog') WHERE (source_pdf_url IS NULL OR source_pdf_url='') AND pdf_status='unchecked'"
  ).run();
  const englishDocLinks = await db.prepare("SELECT value FROM workbench_meta WHERE key='zahraa_english_doc_links_v1'").first();
  if (englishDocLinks?.value !== 'applied') {
    await db.batch([
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1KJBqjZ41Zasg_LqrKNr4wJXZCkpOcJ77PXQal2KU1qM/edit", 1),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1C8ZOE14w9mUF27hBowwnk42d_fG2cl32R2T5GAeepS8/edit", 2),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg/edit", 3),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/15MMgcj6TPtdCotBecPUJW9xX59-Py_ODsHqRqh_dDLc/edit", 4),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1H4wfN_tAi4seppBApq2KoDgYrzrK2GZQOW2CllvDeSg/edit", 5),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1DmCHtfaYsWwWKavXipTrWZo9oq0E4tq2FZVySoSa18A/edit", 6),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1fOo0Y8M1UcaKHR-odP87jGRRlCAT3x9i6AVX7qi6lB0/edit", 7),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1AWIyWa5nGXmmGXfM9YqxnggeaKInLt0z9D2hD6mmz9k/edit", 8),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1OKZtuUcgsqYxjKMBtQCtwuwSWJyeVHrW098EIgCs3xA/edit", 9),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/1iiiuDLR_NV8mUjg4RMTxZRgt94l5w3masRqPQJZtsog/edit", 10),
      db.prepare("UPDATE projects SET google_doc_url = CASE WHEN google_doc_url IS NULL OR google_doc_url = '' THEN ? ELSE google_doc_url END WHERE id = ?").bind("https://docs.google.com/document/d/175AdOpqDeN1ul2PStNR_-QWLgjOM4VxesOukEBobjSI/edit", 11),
      db.prepare("INSERT INTO workbench_meta(key,value) VALUES('zahraa_english_doc_links_v1','applied') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    ]);
  }

  const current = await db.prepare("SELECT value FROM workbench_meta WHERE key = 'catalog_version'").first();

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
  if (current?.value !== CATALOG_VERSION) {
    for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
    await db.prepare("INSERT INTO workbench_meta (key,value) VALUES ('catalog_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(CATALOG_VERSION).run();
  }

  const auditCurrent = await db.prepare("SELECT value FROM workbench_meta WHERE key = 'pdf_audit_version'").first();
  if (auditCurrent?.value !== PDF_AUDIT_VERSION) {
    const auditStatements = [];
    for (const [catalogId, evidence] of Object.entries(PDF_AUDIT)) {
      const verifiedUrl = evidence?.url || null;
      const candidateUrl = evidence?.candidate_url || null;
      const status =
        evidence?.status === 'available' && verifiedUrl
          ? 'available'
          : evidence?.status === 'unchecked' && candidateUrl
            ? 'unchecked'
            : 'missing';
      const sourcePdfUrl =
        status === 'available'
          ? verifiedUrl
          : status === 'unchecked'
            ? candidateUrl
            : null;

      auditStatements.push(db.prepare(
        `UPDATE projects
            SET source_pdf_url = ?,
                pdf_status = ?,
                pdf_checked_at = ?,
                pdf_check_note = ?
          WHERE catalog_id = ?`
      ).bind(
        sourcePdfUrl,
        status,
        evidence?.checked_at || null,
        evidence?.note || null,
        catalogId
      ));
    }
    for (let i = 0; i < auditStatements.length; i += 80) await db.batch(auditStatements.slice(i, i + 80));
    await db.prepare("INSERT INTO workbench_meta (key,value) VALUES ('pdf_audit_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(PDF_AUDIT_VERSION).run();
  }
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

export function normalizeGoogleDocUrl(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !url.pathname.startsWith('/document/')) return false;
    return url.href;
  } catch { return false; }
}

export function normalizeHttpUrl(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const url = new URL(String(raw).trim());
    if (!['https:','http:'].includes(url.protocol)) return false;
    return url.href;
  } catch { return false; }
}

export function validIsoDate(raw) {
  return raw === null || raw === undefined || raw === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(raw));
}

export function actorFromRequest(request) {
  const actor = (request.headers.get('x-workbench-actor') || '').trim();
  return ['Zahraa', 'Mohammed', 'Brother'].includes(actor) ? actor : 'Unknown';
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
  const hasPdfUrl = Boolean(row.source_pdf_url);
  return {
    ...row,
    assignee: row.assignee === 'Brother' ? 'Mohammed' : row.assignee,
    blocked: Boolean(row.blocked),
    has_uploaded_cover: Boolean(row.has_uploaded_cover),
    pdf_status: pdfStatus,
    pdf_available: pdfStatus === 'available' && hasPdfUrl,
    pdf_missing: pdfStatus === 'missing' || (!hasPdfUrl && pdfStatus !== 'unchecked'),
    pdf_unchecked: pdfStatus === 'unchecked',
    published: Boolean(row.published_at),
  };
}

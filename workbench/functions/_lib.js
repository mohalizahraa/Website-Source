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
  await db.prepare(`CREATE TABLE IF NOT EXISTS translation_progress_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    from_pages INTEGER NOT NULL,
    to_pages INTEGER NOT NULL,
    source_total_pages INTEGER NOT NULL,
    source_page_basis TEXT NOT NULL DEFAULT 'physical_pdf',
    source_pdf_sha256 TEXT NOT NULL,
    google_doc_revision TEXT NOT NULL,
    verification_note TEXT,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_translation_progress_project_created ON translation_progress_checkpoints(project_id, created_at DESC)').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS translation_focus (
    assignee TEXT PRIMARY KEY CHECK (assignee IN ('Zahraa','Mohammed','Brother')),
    project_id INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_translation_focus_project ON translation_focus(project_id)').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS translation_source_packs (
    project_id INTEGER PRIMARY KEY,
    source_text_kind TEXT,
    source_text_url TEXT,
    recovery_routes_json TEXT NOT NULL DEFAULT '[]',
    page_alignment_note TEXT,
    known_issues TEXT,
    resume_note TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  const existingColumns = await db.prepare('PRAGMA table_info(projects)').all();
  const names = new Set((existingColumns.results || []).map(row => row.name));
  for (const obsolete of ['priority','blocked','blocker_reason']) {
    if (!names.has(obsolete)) continue;
    await db.prepare(`ALTER TABLE projects DROP COLUMN ${obsolete}`).run();
    names.delete(obsolete);
  }
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
         source_pdf_url = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE source_pdf_url END,
         package_url = ?, pages = ?, volumes = ?, catalog_date = ?, updated_at = updated_at
       WHERE catalog_id = ? OR title_ar = ?`
    ).bind(
      book.catalog_id, book.title_en || null, book.translit || null, book.author || null, book.author_ar || null,
      book.category || null, book.topic_en || null, book.topic_ar || null, book.detail_url || null,
      book.pdf_url || null, book.pdf_url || null, book.pdf_url || null,
      book.package_url || null, book.pages, book.volumes, book.date,
      book.catalog_id, book.title_ar
    ));
    statements.push(db.prepare(
      `INSERT INTO projects (
         title_ar,title_en,catalog_id,translit,author,author_ar,category,topic_en,topic_ar,source_url,source_pdf_url,package_url,pages,volumes,catalog_date,
         assignee,status,pdf_status,pdf_check_note
       )
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Unassigned','not_started',
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

  // One-time repair for the 2026-10-04 English-Book cross-link:
  // book-123 (Repentance) was pointed at the public A Study on Imamate Doc.
  // Move that live misplaced URL to book-122 and restore Repentance's existing
  // translation target. Keep the repair in D1/runtime state, not catalogue data.
  const englishBookRoutingRepair = await db.prepare(
    "SELECT value FROM workbench_meta WHERE key='english_book_routing_repair_2026_10_04'"
  ).first();
  if (englishBookRoutingRepair?.value !== 'applied') {
    const repentance = await db.prepare(
      "SELECT * FROM projects WHERE catalog_id='book-123' OR title_ar='التوبة حقيقتها وشروطها وآثارها' LIMIT 1"
    ).first();
    const imamate = await db.prepare(
      "SELECT * FROM projects WHERE catalog_id='book-122' OR title_ar='بحث حول الإمامة' LIMIT 1"
    ).first();
    const repentanceUrl = "https://docs.google.com/document/d/1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg/edit";
    const misplacedImamateUrl = repentance?.google_doc_url && repentance.google_doc_url !== repentanceUrl
      ? repentance.google_doc_url
      : null;

    if (repentance && imamate && misplacedImamateUrl) {
      const now = new Date().toISOString();
      const repentanceAfter = {
        ...repentance,
        google_doc_url: repentanceUrl,
        status: Number(repentance.translated_pages || 0) < Number(repentance.pages || 0) ? 'in_progress' : repentance.status,
        completed_at: Number(repentance.translated_pages || 0) < Number(repentance.pages || 0) ? null : repentance.completed_at,
        published_at: Number(repentance.translated_pages || 0) < Number(repentance.pages || 0) ? null : repentance.published_at,
        updated_at: now,
      };
      const imamateAfter = { ...imamate, google_doc_url: misplacedImamateUrl, updated_at: now };

      await db.batch([
        db.prepare(
          "UPDATE projects SET google_doc_url=?, status=?, completed_at=?, published_at=?, updated_at=? WHERE id=?"
        ).bind(
          repentanceAfter.google_doc_url,
          repentanceAfter.status,
          repentanceAfter.completed_at,
          repentanceAfter.published_at,
          now,
          repentance.id
        ),
        db.prepare(
          "UPDATE projects SET google_doc_url=?, updated_at=? WHERE id=?"
        ).bind(misplacedImamateUrl, now, imamate.id),
        db.prepare(
          "INSERT INTO activity (project_id, actor, action, before_json, after_json) VALUES (?, 'System', 'repaired English Book routing', ?, ?)"
        ).bind(repentance.id, JSON.stringify(repentance), JSON.stringify(repentanceAfter)),
        db.prepare(
          "INSERT INTO activity (project_id, actor, action, before_json, after_json) VALUES (?, 'System', 'repaired English Book routing', ?, ?)"
        ).bind(imamate.id, JSON.stringify(imamate), JSON.stringify(imamateAfter)),
        db.prepare(
          "INSERT INTO workbench_meta(key,value) VALUES('english_book_routing_repair_2026_10_04','applied') ON CONFLICT(key) DO UPDATE SET value=excluded.value"
        ),
      ]);
    }
  }

  const managedEnglishRouting = await db.prepare(
    "SELECT value FROM workbench_meta WHERE key='english_book_routing_v2_2026_10_04'"
  ).first();
  if (managedEnglishRouting?.value !== 'applied') {
    const managed = [
      ['book-80',  'https://docs.google.com/document/d/1KJBqjZ41Zasg_LqrKNr4wJXZCkpOcJ77PXQal2KU1qM/edit'],
      ['book-67',  'https://docs.google.com/document/d/1C8ZOE14w9mUF27hBowwnk42d_fG2cl32R2T5GAeepS8/edit'],
      ['book-123', 'https://docs.google.com/document/d/1xBIpS5TXEQT42_JuoKlu5CgW95_B2wenYSk8LN_wcRg/edit'],
      ['book-132', 'https://docs.google.com/document/d/15MMgcj6TPtdCotBecPUJW9xX59-Py_ODsHqRqh_dDLc/edit'],
      ['book-2',   'https://docs.google.com/document/d/1H4wfN_tAi4seppBApq2KoDgYrzrK2GZQOW2CllvDeSg/edit'],
      ['book-1',   'https://docs.google.com/document/d/1DmCHtfaYsWwWKavXipTrWZo9oq0E4tq2FZVySoSa18A/edit'],
      ['book-97',  'https://docs.google.com/document/d/1fOo0Y8M1UcaKHR-odP87jGRRlCAT3x9i6AVX7qi6lB0/edit'],
      ['book-99',  'https://docs.google.com/document/d/1AWIyWa5nGXmmGXfM9YqxnggeaKInLt0z9D2hD6mmz9k/edit'],
      ['book-117', 'https://docs.google.com/document/d/1OKZtuUcgsqYxjKMBtQCtwuwSWJyeVHrW098EIgCs3xA/edit'],
      ['book-107', 'https://docs.google.com/document/d/1iiiuDLR_NV8mUjg4RMTxZRgt94l5w3masRqPQJZtsog/edit'],
      ['book-131', 'https://docs.google.com/document/d/175AdOpqDeN1ul2PStNR_-QWLgjOM4VxesOukEBobjSI/edit'],
      ['book-122', 'https://docs.google.com/document/d/1-uFLmhiFV_G4lFsYhiEA9iAFpoeKMirptUloqinWN9M/edit'],
    ];

    const operations = [];
    for (const [catalogId, url] of managed) {
      operations.push(
        db.prepare(
          "UPDATE projects SET google_doc_url=NULL, updated_at=CURRENT_TIMESTAMP WHERE google_doc_url=? AND catalog_id<>?"
        ).bind(url, catalogId)
      );
      operations.push(
        db.prepare(
          "UPDATE projects SET google_doc_url=?, updated_at=CURRENT_TIMESTAMP WHERE catalog_id=?"
        ).bind(url, catalogId)
      );
    }
    operations.push(
      db.prepare(
        "UPDATE projects SET status='in_progress', completed_at=NULL, published_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE catalog_id='book-123' AND COALESCE(translated_pages,0) < COALESCE(pages,131)"
      )
    );
    operations.push(
      db.prepare(
        "INSERT INTO workbench_meta(key,value) VALUES('english_book_routing_v2_2026_10_04','applied') ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      )
    );
    for (let i = 0; i < operations.length; i += 80) await db.batch(operations.slice(i, i + 80));
  }

  // Bootstrap an explicit per-translator focus only when none exists yet.
  // This derives from current runtime state and never overwrites a later explicit focus.
  for (const assignee of ['Zahraa','Mohammed','Brother']) {
    await db.prepare(`
      INSERT INTO translation_focus(assignee, project_id, updated_at)
      SELECT ?, id, CURRENT_TIMESTAMP
      FROM projects
      WHERE status='in_progress' AND (assignee=? OR assignee='Both')
      ORDER BY COALESCE(translation_progress_at, updated_at, created_at) DESC, id DESC
      LIMIT 1
      ON CONFLICT(assignee) DO NOTHING
    `).bind(assignee, assignee).run();
  }

  // Public source-recovery seed for book-2. Live refinements belong in D1 and
  // this seed never overwrites a source pack once agents have updated it.
  const tawassul = await db.prepare("SELECT id FROM projects WHERE catalog_id='book-2' LIMIT 1").first();
  if (tawassul?.id) {
    const routes = JSON.stringify([
      { kind:'official-transcript', url:'https://alhaydari.com/ar/2013/04/47258/', label:'Official tawassul lecture transcript', note:'Clean Arabic recovery witness for the blind-man / tawassul discussion.' },
      { kind:'official-transcript', url:'https://alhaydari.com/ar/2013/05/47568/', label:'Official tawassul lecture transcript', note:'Clean Arabic recovery witness for the continuation of the tawassul argument.' },
      { kind:'official-transcript', url:'https://alhaydari.com/ar/2013/05/47818/', label:'Official tawassul lecture transcript', note:'Clean Arabic recovery witness for later tawassul evidence.' }
    ]);
    await db.prepare(`
      INSERT INTO translation_source_packs(
        project_id, source_text_kind, source_text_url, recovery_routes_json,
        page_alignment_note, known_issues, resume_note, updated_at
      ) VALUES(?, 'official-transcript-series', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project_id) DO NOTHING
    `).bind(
      tawassul.id,
      'https://alhaydari.com/ar/2013/04/47258/',
      routes,
      'Canonical physical PDF remains the page and semantic authority. Use official alhaydari.com lecture transcripts only as clean recovery witnesses, and align recovered wording back to the canonical PDF before advancing physical-page progress.',
      'The canonical PDF text layer becomes heavily garbled in later sections. Do not translate damaged glyph extraction by guess; switch to the stored official transcript recovery routes and verify against the PDF.',
      'Resume from the highest verified WBPROGRESS marker and the [[NEXT_BATCH]] sentinel in the linked English Google Doc.'
    ).run();
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

      const physicalPages = Number.isInteger(Number(evidence?.physical_pages)) && Number(evidence.physical_pages) > 0
        ? Number(evidence.physical_pages)
        : null;
      auditStatements.push(db.prepare(
        `UPDATE projects
            SET source_pdf_url = ?,
                pdf_status = ?,
                pdf_checked_at = ?,
                pdf_check_note = ?,
                pages = COALESCE(?, pages)
          WHERE catalog_id = ?`
      ).bind(
        sourcePdfUrl,
        status,
        evidence?.checked_at || null,
        evidence?.note || null,
        physicalPages,
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

export function googleDocIdFromUrl(raw) {
  const normalized = normalizeGoogleDocUrl(raw);
  if (!normalized || normalized === false) return null;
  try {
    const match = new URL(normalized).pathname.match(/^\/document\/d\/([^/]+)/);
    return match?.[1] || null;
  } catch { return null; }
}

export async function verifyGoogleDocLinkAccess(raw) {
  const id = googleDocIdFromUrl(raw);
  if (!id) return { accessible: false, reason: 'invalid' };
  const probe = `https://docs.google.com/document/d/${encodeURIComponent(id)}/export?format=txt`;
  try {
    const response = await fetch(probe, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': 'Haydari-Translation-Workbench/1.0' },
    });
    if (response.ok) return { accessible: true, reason: 'public' };
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        const target = new URL(location, probe);
        if (target.hostname.endsWith('googleusercontent.com')) return { accessible: true, reason: 'public' };
        if (target.hostname === 'accounts.google.com') return { accessible: false, reason: 'restricted' };
      }
    }
    if ([401, 403, 404].includes(response.status)) return { accessible: false, reason: 'restricted' };
    return { accessible: false, reason: 'unverified' };
  } catch {
    return { accessible: false, reason: 'unverified' };
  }
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
  const pageEvidence = row.catalog_id ? PDF_AUDIT[row.catalog_id] : null;
  const catalogBook = row.catalog_id ? BOOK_CATALOG.find(book => book.catalog_id === row.catalog_id) : null;
  const verifiedPhysicalPages = catalogBook && !['book-4','book-23','book-32','book-43'].includes(row.catalog_id)
    ? Number(catalogBook.pages)
    : (Number.isInteger(Number(pageEvidence?.physical_pages)) && Number(pageEvidence.physical_pages) > 0
      ? Number(pageEvidence.physical_pages)
      : null);
  const { priority: _legacyPriority, blocked: _legacyBlocked, blocker_reason: _legacyBlockerReason, ...project } = row;
  return {
    ...project,
    assignee: row.assignee === 'Brother' ? 'Mohammed' : row.assignee,
    has_uploaded_cover: Boolean(row.has_uploaded_cover),
    page_count_verified: verifiedPhysicalPages !== null && Number(row.pages) === verifiedPhysicalPages,
    page_count_basis: verifiedPhysicalPages !== null ? 'physical_pdf' : 'catalog_metadata',
    pdf_status: pdfStatus,
    pdf_available: pdfStatus === 'available' && hasPdfUrl,
    pdf_missing: pdfStatus === 'missing' || (!hasPdfUrl && pdfStatus !== 'unchecked'),
    pdf_unchecked: pdfStatus === 'unchecked',
    published: Boolean(row.published_at),
  };
}

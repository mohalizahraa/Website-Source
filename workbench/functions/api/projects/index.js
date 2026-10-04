import { actorFromRequest, ensureCatalog, json, normalizeGoogleDocUrl, normalizeHttpUrl, normalizeProject, recordActivity, validIsoDate, verifyGoogleDocLinkAccess } from '../../_lib.js';

const validStatuses = new Set(['not_started','in_progress','review','completed','published']);
const validAssignees = new Set(['Zahraa','Mohammed','Brother','Both','Unassigned']);

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const { results } = await context.env.DB.prepare(
    "SELECT p.*, EXISTS(SELECT 1 FROM project_covers c WHERE c.project_id=p.id) AS has_uploaded_cover FROM projects p ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1 WHEN 'not_started' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END, COALESCE(due_date, '9999-12-31'), id"
  ).all();
  return json({ projects: (results || []).map(normalizeProject) });
}

export async function onRequestPost(context) {
  await ensureCatalog(context.env.DB);
  const body = await context.request.json().catch(() => null);
  if (!body?.title_ar?.trim()) return json({ error: 'Arabic title is required.' }, 400);
  const assignee = validAssignees.has(body.assignee) ? body.assignee : 'Unassigned';
  let status = validStatuses.has(body.status) ? body.status : 'not_started';
  if (body.published) status = 'published';
  const googleDocUrl = normalizeGoogleDocUrl(body.google_doc_url);
  if (googleDocUrl === false) return json({ error: 'English Book must be a Google Docs document link.' }, 400);
  if (googleDocUrl) {
    const access = await verifyGoogleDocLinkAccess(googleDocUrl);
    if (!access.accessible) return json({ error: 'English Book must be shared as Anyone with the link → Editor before it can be linked.' }, 400);
  }
  const coverUrl = normalizeHttpUrl(body.cover_url);
  if (coverUrl === false) return json({ error: 'Cover image must use an http(s) URL.' }, 400);
  if (!validIsoDate(body.start_date) || !validIsoDate(body.due_date)) return json({ error: 'Dates must use YYYY-MM-DD.' }, 400);
  const actor = actorFromRequest(context.request);
  const now = new Date().toISOString();
  const completedAt = ['review','completed','published'].includes(status) ? now : null;
  const completedBy = completedAt ? actor : null;
  const publishedAt = body.published ? now : null;
  const publishedBy = publishedAt ? actor : null;
  const pdfUrl = body.source_pdf_url || null;
  const pdfStatus = pdfUrl ? 'unchecked' : 'missing';
  const pdfNote = pdfUrl ? 'Awaiting validation' : 'No direct PDF URL';
  const result = await context.env.DB.prepare(
    `INSERT INTO projects (title_ar, title_en, assignee, status, source_url, source_pdf_url, pdf_status, pdf_check_note, google_doc_url, cover_url, start_date, due_date, blocked, blocker_reason, notes, completed_at, completed_by, published_at, published_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  ).bind(
    body.title_ar.trim(), body.title_en?.trim() || null, assignee, status,
    body.source_url || null, pdfUrl, pdfStatus, pdfNote, googleDocUrl, coverUrl,
    body.start_date || null, body.due_date || null, body.blocked ? 1 : 0,
    body.blocker_reason || null, body.notes || null, completedAt, completedBy, publishedAt, publishedBy,
  ).first();
  await recordActivity(context.env.DB, result.id, actor, 'created project', null, result);
  return json({ project: normalizeProject(result) }, 201);
}

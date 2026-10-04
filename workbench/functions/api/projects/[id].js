import { actorFromRequest, ensureCatalog, json, normalizeGoogleDocUrl, normalizeHttpUrl, normalizeProject, recordActivity, validIsoDate, verifyGoogleDocLinkAccess } from '../../_lib.js';

const fields = new Set([
  'title_ar','title_en','assignee','status','source_url','source_pdf_url','google_doc_url','cover_url',
  'start_date','due_date','notes'
]);
const validStatuses = new Set(['not_started','in_progress','review','completed','published']);
const validAssignees = new Set(['Zahraa','Mohammed','Brother','Both','Unassigned']);

function idFrom(context) {
  const n = Number(context.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id = idFrom(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);
  const row = await context.env.DB.prepare('SELECT p.*, EXISTS(SELECT 1 FROM project_covers c WHERE c.project_id=p.id) AS has_uploaded_cover FROM projects p WHERE p.id = ?').bind(id).first();
  return row ? json({ project: normalizeProject(row) }) : json({ error: 'Project not found.' }, 404);
}

export async function onRequestPatch(context) {
  await ensureCatalog(context.env.DB);
  const id = idFrom(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);
  const before = await context.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!before) return json({ error: 'Project not found.' }, 404);
  const body = await context.request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body.' }, 400);

  if (body.published === true) body.status = 'published';
  if (body.status !== undefined && !validStatuses.has(body.status)) return json({ error: 'Invalid status.' }, 400);
  if (body.assignee !== undefined && !validAssignees.has(body.assignee)) return json({ error: 'Invalid assignee.' }, 400);

  if (body.google_doc_url !== undefined) {
    const normalized = normalizeGoogleDocUrl(body.google_doc_url);
    if (normalized === false) return json({ error: 'English Book must be a Google Docs document link.' }, 400);
    if (normalized) {
      const access = await verifyGoogleDocLinkAccess(normalized);
      if (!access.accessible) {
        return json({ error: 'English Book must be shared as Anyone with the link → Editor before it can be linked.' }, 400);
      }
    }
    body.google_doc_url = normalized || '';
  }
  if (body.cover_url !== undefined) {
    const normalized = normalizeHttpUrl(body.cover_url);
    if (normalized === false) return json({ error: 'Cover image must use an http(s) URL.' }, 400);
    body.cover_url = normalized || '';
  }
  if ((body.start_date !== undefined && !validIsoDate(body.start_date)) || (body.due_date !== undefined && !validIsoDate(body.due_date))) {
    return json({ error: 'Dates must use YYYY-MM-DD.' }, 400);
  }
  if (body.translated_pages !== undefined) {
    return json({ error: 'Translation progress is verification-owned. Use the dedicated progress checkpoint endpoint.' }, 400);
  }

  const updates = [];
  const values = [];
  for (const [key, raw] of Object.entries(body)) {
    if (!fields.has(key)) continue;
    const value = raw === '' ? null : raw;
    updates.push(`${key} = ?`);
    values.push(value);
  }
  if (body.source_pdf_url !== undefined) {
    const nextPdf = body.source_pdf_url === '' ? null : body.source_pdf_url;
    if ((before.source_pdf_url || null) !== nextPdf) {
      if (nextPdf) {
        updates.push("pdf_status = 'unchecked'");
        updates.push('pdf_checked_at = NULL');
        updates.push("pdf_check_note = 'Awaiting validation'");
      } else {
        updates.push("pdf_status = 'missing'");
        updates.push('pdf_checked_at = NULL');
        updates.push("pdf_check_note = 'No direct PDF URL'");
      }
    }
  }

  const now = new Date().toISOString();
  const actor = actorFromRequest(context.request);
  const translatedStatuses = new Set(['review','completed','published']);
  const nextStatus = body.status ?? before.status;
  const wasTranslated = translatedStatuses.has(before.status);
  const willBeTranslated = translatedStatuses.has(nextStatus);

  if (!wasTranslated && willBeTranslated) {
    updates.push('completed_at = ?'); values.push(now);
    updates.push('completed_by = ?'); values.push(actor);
  } else if (wasTranslated && !willBeTranslated) {
    updates.push('completed_at = NULL');
    updates.push('completed_by = NULL');
  }

  if (body.published !== undefined) {
    if (body.published && !before.published_at) {
      updates.push('published_at = ?'); values.push(now);
      updates.push('published_by = ?'); values.push(actor);
    } else if (!body.published && before.published_at) {
      updates.push('published_at = NULL');
      updates.push('published_by = NULL');
    }
  } else if (body.status !== undefined && body.status !== 'published' && before.published_at) {
    updates.push('published_at = NULL');
    updates.push('published_by = NULL');
  }

  if (!updates.length) return json({ project: normalizeProject(before) });
  updates.push('updated_at = ?'); values.push(now);
  values.push(id);

  const after = await context.env.DB.prepare(
    `UPDATE projects SET ${updates.join(', ')} WHERE id = ? RETURNING *`
  ).bind(...values).first();

  await recordActivity(context.env.DB, id, actor, 'updated project', before, after);
  return json({ project: normalizeProject(after) });
}

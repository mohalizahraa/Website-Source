import { actorFromRequest, json, normalizeProject, recordActivity, requireAccess } from '../../_lib.js';

const fields = new Set([
  'title_ar','title_en','assignee','status','priority','source_url','source_pdf_url','google_doc_url',
  'start_date','due_date','blocked','blocker_reason','notes'
]);
const validStatuses = new Set(['not_started','in_progress','review','completed','published']);
const validAssignees = new Set(['Zahraa','Mohammed','Brother','Both','Unassigned']);
const validPriorities = new Set(['low','normal','high','urgent']);

function idFrom(context) {
  const n = Number(context.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function onRequestGet(context) {
  const denied = requireAccess(context);
  if (denied) return denied;
  const id = idFrom(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);
  const row = await context.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  return row ? json({ project: normalizeProject(row) }) : json({ error: 'Project not found.' }, 404);
}

export async function onRequestPatch(context) {
  const denied = requireAccess(context);
  if (denied) return denied;
  const id = idFrom(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);
  const before = await context.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!before) return json({ error: 'Project not found.' }, 404);
  const body = await context.request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body.' }, 400);

  if (body.status !== undefined && !validStatuses.has(body.status)) return json({ error: 'Invalid status.' }, 400);
  if (body.assignee !== undefined && !validAssignees.has(body.assignee)) return json({ error: 'Invalid assignee.' }, 400);
  if (body.priority !== undefined && !validPriorities.has(body.priority)) return json({ error: 'Invalid priority.' }, 400);

  const updates = [];
  const values = [];
  for (const [key, raw] of Object.entries(body)) {
    if (!fields.has(key)) continue;
    const value = key === 'blocked' ? (raw ? 1 : 0) : (raw === '' ? null : raw);
    updates.push(`${key} = ?`);
    values.push(value);
  }
  if (!updates.length) return json({ project: normalizeProject(before) });

  const now = new Date().toISOString();
  const actor = actorFromRequest(context.request);
  if (body.status === 'completed' && before.status !== 'completed' && before.status !== 'published') {
    updates.push('completed_at = ?'); values.push(now);
    updates.push('completed_by = ?'); values.push(actor);
  }
  if (body.status === 'published' && before.status !== 'published') {
    if (!before.completed_at) { updates.push('completed_at = ?'); values.push(now); updates.push('completed_by = ?'); values.push(actor); }
    updates.push('published_at = ?'); values.push(now);
    updates.push('published_by = ?'); values.push(actor);
  }
  if (body.status && !['completed','published'].includes(body.status) && ['completed','published'].includes(before.status)) {
    updates.push('completed_at = NULL');
    updates.push('completed_by = NULL');
    updates.push('published_at = NULL');
    updates.push('published_by = NULL');
  } else if (body.status === 'completed' && before.status === 'published') {
    updates.push('published_at = NULL');
    updates.push('published_by = NULL');
  }
  updates.push('updated_at = ?'); values.push(now);
  values.push(id);

  const after = await context.env.DB.prepare(
    `UPDATE projects SET ${updates.join(', ')} WHERE id = ? RETURNING *`
  ).bind(...values).first();

  await recordActivity(context.env.DB, id, actor, 'updated project', before, after);
  return json({ project: normalizeProject(after) });
}

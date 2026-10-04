import { actorFromRequest, ensureCatalog, json, normalizeProject } from '../../../_lib.js';

function idFrom(context) {
  const n = Number(context.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export async function onRequestPatch(context) {
  await ensureCatalog(context.env.DB);
  const id = idFrom(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);

  const before = await context.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!before) return json({ error: 'Project not found.' }, 404);

  const body = await context.request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body.' }, 400);

  const translatedPages = Number(body.translated_pages);
  const expectedPrevious = Number(body.expected_previous_pages);
  const sourceTotalPages = Number(body.source_total_pages);
  const sourcePdfSha256 = nonEmpty(body.source_pdf_sha256).toLowerCase();
  const googleDocRevision = nonEmpty(body.google_doc_revision);
  const verificationNote = nonEmpty(body.verification_note);
  const correction = body.correction === true;
  const correctionReason = nonEmpty(body.correction_reason);

  if (!Number.isInteger(translatedPages) || translatedPages < 0) {
    return json({ error: 'translated_pages must be a non-negative whole number.' }, 400);
  }
  if (!Number.isInteger(expectedPrevious) || expectedPrevious < 0) {
    return json({ error: 'expected_previous_pages must be a non-negative whole number.' }, 400);
  }
  if (!Number.isInteger(sourceTotalPages) || sourceTotalPages <= 0) {
    return json({ error: 'source_total_pages must be a positive whole number.' }, 400);
  }
  if (sourceTotalPages !== Number(before.pages || 0)) {
    return json({
      error: 'Source-page denominator mismatch. Refresh the project before publishing progress.',
      current_source_total_pages: Number(before.pages || 0),
    }, 409);
  }
  if (translatedPages > sourceTotalPages) {
    return json({ error: `translated_pages cannot exceed the verified source total of ${sourceTotalPages}.` }, 400);
  }
  if (expectedPrevious !== Number(before.translated_pages || 0)) {
    return json({
      error: 'Stale translation-progress checkpoint. Refresh before publishing another checkpoint.',
      current_translated_pages: Number(before.translated_pages || 0),
    }, 409);
  }
  if (translatedPages < expectedPrevious && !correction) {
    return json({ error: 'Translation progress is monotonic. A decrease requires correction=true and a correction_reason.' }, 409);
  }
  if (correction && translatedPages < expectedPrevious && !correctionReason) {
    return json({ error: 'A progress decrease requires correction_reason.' }, 400);
  }
  if (!/^[a-f0-9]{64}$/.test(sourcePdfSha256)) {
    return json({ error: 'source_pdf_sha256 must be the 64-character SHA-256 of the authoritative source PDF.' }, 400);
  }
  if (!googleDocRevision) {
    return json({ error: 'google_doc_revision is required so the checkpoint is tied to an exact verified target state (native Docs revision or public-export-sha256 identity).' }, 400);
  }

  const latest = await context.env.DB.prepare(
    'SELECT source_pdf_sha256 FROM translation_progress_checkpoints WHERE project_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(id).first();
  if (latest?.source_pdf_sha256 && latest.source_pdf_sha256 !== sourcePdfSha256 && body.source_changed !== true) {
    return json({ error: 'Source PDF hash changed. Pass source_changed=true only after reconciling the new authoritative source.' }, 409);
  }

  if (translatedPages === expectedPrevious) {
    return json({ project: normalizeProject(before), checkpoint: null, unchanged: true });
  }

  const now = new Date().toISOString();
  const actor = actorFromRequest(context.request);
  let nextStatus = before.status;
  let completedAt = before.completed_at;
  let completedBy = before.completed_by;

  if (translatedPages === sourceTotalPages && ['not_started','in_progress'].includes(before.status)) {
    nextStatus = 'review';
    completedAt = now;
    completedBy = actor;
  } else if (translatedPages > 0 && before.status === 'not_started') {
    nextStatus = 'in_progress';
  }

  if (translatedPages < sourceTotalPages && ['review','completed','published'].includes(before.status)) {
    return json({
      error: 'Progress cannot be moved below the source total while the project is already past Translating. Rewind workflow status first, then publish a correction checkpoint.'
    }, 409);
  }

  const afterForAudit = {
    ...before,
    translated_pages: translatedPages,
    translation_progress_at: now,
    status: nextStatus,
    completed_at: completedAt,
    completed_by: completedBy,
    updated_at: now,
  };
  const action = translatedPages < expectedPrevious ? 'translation progress correction' : 'translation progress';

  await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE projects
       SET translated_pages = ?, translation_progress_at = ?, status = ?, completed_at = ?, completed_by = ?, updated_at = ?
       WHERE id = ? AND translated_pages = ?`
    ).bind(translatedPages, now, nextStatus, completedAt, completedBy, now, id, expectedPrevious),
    context.env.DB.prepare(
      `INSERT INTO translation_progress_checkpoints
       (project_id, from_pages, to_pages, source_total_pages, source_page_basis, source_pdf_sha256, google_doc_revision, verification_note, actor, created_at)
       SELECT ?, ?, ?, ?, 'physical_pdf', ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM projects
         WHERE id = ? AND translated_pages = ? AND translation_progress_at = ?
       )`
    ).bind(
      id, expectedPrevious, translatedPages, sourceTotalPages, sourcePdfSha256, googleDocRevision,
      verificationNote || (correctionReason ? `Correction: ${correctionReason}` : null),
      actor, now, id, translatedPages, now
    ),
    context.env.DB.prepare(
      `INSERT INTO activity (project_id, actor, action, before_json, after_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM projects
         WHERE id = ? AND translated_pages = ? AND translation_progress_at = ?
       )`
    ).bind(id, actor, action, JSON.stringify(before), JSON.stringify(afterForAudit), now, id, translatedPages, now),
  ]);

  const after = await context.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!after || Number(after.translated_pages) !== translatedPages || after.translation_progress_at !== now) {
    return json({
      error: 'Translation progress changed concurrently. Refresh before retrying.',
      current_translated_pages: Number(after?.translated_pages || 0),
    }, 409);
  }

  const checkpoint = await context.env.DB.prepare(
    'SELECT * FROM translation_progress_checkpoints WHERE project_id = ? AND created_at = ? ORDER BY id DESC LIMIT 1'
  ).bind(id, now).first();

  return json({ project: normalizeProject(after), checkpoint });
}

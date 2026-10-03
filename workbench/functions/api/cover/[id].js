import { actorFromRequest, ensureCatalog, json, recordActivity } from '../../_lib.js';

const MAX_COVER_BYTES = 1_500_000;
const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp']);

function projectId(context) {
  const id = Number(context.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validImageMagic(bytes, type) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (type === 'image/webp') return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  return false;
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id = projectId(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);

  const row = await context.env.DB.prepare(
    'SELECT mime_type, image_bytes, updated_at FROM project_covers WHERE project_id = ?'
  ).bind(id).first();
  if (!row?.image_bytes) return json({ error: 'No uploaded cover for this book.' }, 404);

  const bytes = Uint8Array.from(row.image_bytes);
  return new Response(bytes, {
    headers: {
      'content-type': row.mime_type || 'image/jpeg',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'last-modified': row.updated_at ? new Date(row.updated_at.includes('T') ? row.updated_at : row.updated_at.replace(' ','T') + 'Z').toUTCString() : new Date().toUTCString(),
    },
  });
}

export async function onRequestPut(context) {
  await ensureCatalog(context.env.DB);
  const id = projectId(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);

  const project = await context.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!project) return json({ error: 'Project not found.' }, 404);

  const type = (context.request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return json({ error: 'Cover must be a JPEG, PNG, or WebP image.' }, 415);

  const announced = Number(context.request.headers.get('content-length') || 0);
  if (announced > MAX_COVER_BYTES) return json({ error: 'Cover image is too large after compression.' }, 413);

  const buffer = await context.request.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_COVER_BYTES) return json({ error: 'Cover image is empty or too large after compression.' }, 413);

  const bytes = new Uint8Array(buffer);
  if (!validImageMagic(bytes, type)) return json({ error: 'Uploaded file does not match its image type.' }, 400);

  const before = await context.env.DB.prepare('SELECT mime_type, length(image_bytes) AS bytes FROM project_covers WHERE project_id = ?').bind(id).first();
  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `INSERT INTO project_covers (project_id, mime_type, image_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET mime_type=excluded.mime_type, image_bytes=excluded.image_bytes, updated_at=excluded.updated_at`
  ).bind(id, type, buffer, now).run();
  await context.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, id).run();

  const actor = actorFromRequest(context.request);
  await recordActivity(
    context.env.DB,
    id,
    actor,
    before ? 'replaced book cover photo' : 'uploaded book cover photo',
    before ? { mime_type: before.mime_type, bytes: before.bytes } : null,
    { mime_type: type, bytes: buffer.byteLength },
  );

  return json({ ok: true, has_uploaded_cover: true, bytes: buffer.byteLength, mime_type: type });
}

export async function onRequestDelete(context) {
  await ensureCatalog(context.env.DB);
  const id = projectId(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);

  const before = await context.env.DB.prepare('SELECT mime_type, length(image_bytes) AS bytes FROM project_covers WHERE project_id = ?').bind(id).first();
  if (!before) return json({ ok: true, has_uploaded_cover: false });

  await context.env.DB.prepare('DELETE FROM project_covers WHERE project_id = ?').bind(id).run();
  const now = new Date().toISOString();
  await context.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, id).run();
  await recordActivity(
    context.env.DB,
    id,
    actorFromRequest(context.request),
    'removed uploaded book cover photo',
    { mime_type: before.mime_type, bytes: before.bytes },
    null,
  );

  return json({ ok: true, has_uploaded_cover: false });
}

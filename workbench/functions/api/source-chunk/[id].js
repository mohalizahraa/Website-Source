import { ensureCatalog, json } from '../../_lib.js';

const MAX_CHUNK_BYTES = 64 * 1024;

function projectId(context) {
  const id = Number(context.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function toBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id = projectId(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);

  const url = new URL(context.request.url);
  const offset = Number(url.searchParams.get('offset') || 0);
  const length = Number(url.searchParams.get('length') || MAX_CHUNK_BYTES);
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(length) || length < 1 || length > MAX_CHUNK_BYTES) {
    return json({ error: 'Invalid offset/length.' }, 400);
  }

  const project = await context.env.DB.prepare(
    'SELECT source_pdf_url, pdf_status FROM projects WHERE id = ?'
  ).bind(id).first();

  if (!project || project.pdf_status !== 'available' || !project.source_pdf_url) {
    return json({ error: 'No verified direct PDF is available for this book.' }, 404);
  }

  let source;
  try {
    source = await fetch(project.source_pdf_url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'application/pdf,*/*;q=0.8',
        'accept-encoding': 'identity',
        'user-agent': 'Haydari-Workbench-Source-Chunk/1.0',
      },
    });
  } catch {
    return json({ error: 'The source PDF could not be reached.' }, 502);
  }

  if (!source.ok) return json({ error: `Source returned HTTP ${source.status}.` }, 502);
  const type=(source.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/pdf')) return json({ error: 'Source is not a PDF.' }, 502);

  const all = new Uint8Array(await source.arrayBuffer());
  if (offset >= all.length) {
    return json({ project_id:id, offset, length:0, total:all.length, eof:true, base64:'' });
  }
  const end = Math.min(all.length, offset + length);
  const chunk = all.slice(offset, end);
  return json({
    project_id:id,
    offset,
    length:chunk.length,
    total:all.length,
    eof:end >= all.length,
    base64:toBase64(chunk),
  }, 200, { 'cache-control':'no-store' });
}

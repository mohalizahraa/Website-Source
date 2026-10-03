import { ensureCatalog, json } from '../../_lib.js';

function projectId(context) {
  const id = Number(context.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id = projectId(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);

  const project = await context.env.DB.prepare(
    'SELECT source_pdf_url, pdf_status FROM projects WHERE id = ?'
  ).bind(id).first();

  if (!project || project.pdf_status !== 'available' || !project.source_pdf_url) {
    return json({ error: 'No verified direct PDF is available for this book.' }, 404);
  }

  const range = context.request.headers.get('range');
  const requestHeaders = new Headers({
    'accept': 'application/pdf,*/*;q=0.8',
    'user-agent': 'Haydari-Workbench-PDF-Proxy/1.0',
  });
  if (range) requestHeaders.set('range', range);

  let source;
  try {
    source = await fetch(project.source_pdf_url, {
      method: 'GET',
      redirect: 'follow',
      headers: requestHeaders,
    });
  } catch {
    return json({ error: 'The source PDF could not be reached.' }, 502);
  }

  if (!source.ok && source.status !== 206) {
    try { await source.body?.cancel(); } catch {}
    return json({ error: `The source PDF returned HTTP ${source.status}.` }, 502);
  }

  const contentType = (source.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/pdf')) {
    try { await source.body?.cancel(); } catch {}
    return json({ error: 'The verified source no longer returns a PDF.' }, 502);
  }

  const headers = new Headers();
  headers.set('content-type', source.headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', 'inline; filename="haydari-book.pdf"');
  headers.set('cache-control', 'public, max-age=3600');

  for (const name of ['content-length','content-range','accept-ranges','etag','last-modified']) {
    const value = source.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');

  return new Response(source.body, {
    status: source.status === 206 ? 206 : 200,
    headers,
  });
}

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

  let source;
  try {
    source = await fetch(project.source_pdf_url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'accept': 'application/pdf,*/*;q=0.8',
        'user-agent': 'Haydari-Workbench-PDF-Proxy/1.0',
      },
    });
  } catch {
    return json({ error: 'The source PDF could not be reached.' }, 502);
  }

  if (!source.ok) {
    try { await source.body?.cancel(); } catch {}
    return json({ error: `The source PDF returned HTTP ${source.status}.` }, 502);
  }

  const headers = new Headers();
  headers.set('content-type', source.headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', 'inline; filename="haydari-book.pdf"');
  headers.set('cache-control', 'public, max-age=3600');
  const length = source.headers.get('content-length');
  if (length) headers.set('content-length', length);

  return new Response(source.body, { status: 200, headers });
}

import { ensureCatalog, json } from './_lib.js';

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const project = await context.env.DB.prepare(
    'SELECT source_pdf_url, pdf_status FROM projects WHERE id = 3'
  ).first();
  if (!project || project.pdf_status !== 'available' || !project.source_pdf_url) {
    return json({ error: 'Verified Tawbah PDF unavailable.' }, 404);
  }
  let source;
  try {
    source = await fetch(project.source_pdf_url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'application/pdf,*/*;q=0.8',
        'accept-encoding': 'identity',
        'user-agent': 'Haydari-Workbench-Source-Proxy/1.0',
      },
    });
  } catch {
    return json({ error: 'Source PDF could not be reached.' }, 502);
  }
  if (!source.ok) return json({ error: `Source returned HTTP ${source.status}.` }, 502);
  const type=(source.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/pdf')) return json({ error: 'Source is not a PDF.' }, 502);
  const headers=new Headers({
    'content-type':'application/pdf',
    'content-disposition':'inline; filename="tawbah-source.pdf"',
    'cache-control':'public, max-age=300',
  });
  const len=source.headers.get('content-length');
  if (len) headers.set('content-length',len);
  return new Response(source.body,{status:200,headers});
}

import { ensureCatalog, json } from '../_lib.js';

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const row = await context.env.DB.prepare(
    "SELECT id FROM projects WHERE pdf_status='available' AND source_pdf_url IS NOT NULL AND source_pdf_url<>'' ORDER BY id LIMIT 1"
  ).first();
  if (!row?.id) return json({ ok:false, error:'No verified PDF row available.' }, 503);

  const target = new URL('/api/pdf/' + row.id, context.request.url);
  let response;
  try {
    response = await fetch(target.toString(), {
      headers: { range: 'bytes=0-31' },
      redirect: 'follow',
    });
  } catch (error) {
    return json({ ok:false, error:'Proxy request failed', kind:error?.name || 'Error' }, 502);
  }

  let magic = '';
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    magic = String.fromCharCode(...bytes.slice(0,5));
  } catch {}

  return json({
    ok: response.status === 206 && magic.startsWith('%PDF-'),
    status: response.status,
    content_type: response.headers.get('content-type'),
    content_range: response.headers.get('content-range'),
    accept_ranges: response.headers.get('accept-ranges'),
    content_length: response.headers.get('content-length'),
    pdf_magic: magic.startsWith('%PDF-'),
  });
}

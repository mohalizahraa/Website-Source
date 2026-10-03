import { ensureCatalog, json } from '../_lib.js';

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const row = await context.env.DB.prepare(
    "SELECT id, source_pdf_url FROM projects WHERE pdf_status='available' AND source_pdf_url IS NOT NULL AND source_pdf_url<>'' ORDER BY id LIMIT 1"
  ).first();
  if (!row?.id || !row?.source_pdf_url) return json({ ok:false, error:'No verified PDF row available.' }, 503);

  const baseHeaders = {
    'accept': 'application/pdf,*/*;q=0.8',
    'user-agent': 'Haydari-Workbench-PDF-Probe/1.0',
  };

  let head = null;
  try {
    const r = await fetch(row.source_pdf_url, { method:'HEAD', redirect:'follow', headers:baseHeaders });
    head = {
      status:r.status,
      content_length:r.headers.get('content-length'),
      accept_ranges:r.headers.get('accept-ranges'),
      content_type:r.headers.get('content-type'),
    };
    try { await r.body?.cancel(); } catch {}
  } catch {}

  let direct = null;
  try {
    const r = await fetch(row.source_pdf_url, {
      method:'GET', redirect:'follow',
      headers:{...baseHeaders, range:'bytes=0-31', 'accept-encoding':'identity'},
    });
    const bytes = new Uint8Array(await r.arrayBuffer());
    direct = {
      status:r.status,
      content_length:r.headers.get('content-length'),
      content_range:r.headers.get('content-range'),
      accept_ranges:r.headers.get('accept-ranges'),
      pdf_magic:String.fromCharCode(...bytes.slice(0,5)).startsWith('%PDF-'),
      bytes_received:bytes.length,
    };
  } catch {}

  let proxy = null;
  try {
    const target = new URL('/api/pdf/' + row.id, context.request.url);
    const r = await fetch(target.toString(), { headers:{range:'bytes=0-31'}, redirect:'follow' });
    const bytes = new Uint8Array(await r.arrayBuffer());
    proxy = {
      status:r.status,
      content_length:r.headers.get('content-length'),
      content_range:r.headers.get('content-range'),
      accept_ranges:r.headers.get('accept-ranges'),
      pdf_magic:String.fromCharCode(...bytes.slice(0,5)).startsWith('%PDF-'),
      bytes_received:bytes.length,
    };
  } catch {}

  return json({ ok:true, head, direct_range:direct, proxy_range:proxy });
}

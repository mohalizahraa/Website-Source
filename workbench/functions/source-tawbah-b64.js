import { ensureCatalog, json } from './_lib.js';

function bytesToBase64(bytes) {
  let binary='';
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i+step)));
  }
  return btoa(binary);
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const project=await context.env.DB.prepare(
    'SELECT source_pdf_url, pdf_status FROM projects WHERE id = 3'
  ).first();
  if(!project || project.pdf_status!=='available' || !project.source_pdf_url) {
    return json({error:'Verified Tawbah PDF unavailable.'},404);
  }
  let source;
  try {
    source=await fetch(project.source_pdf_url,{
      redirect:'follow',
      headers:{accept:'application/pdf,*/*;q=0.8','accept-encoding':'identity','user-agent':'Haydari-Workbench-SourceBridge/1.0'}
    });
  } catch {
    return json({error:'Source PDF could not be reached.'},502);
  }
  if(!source.ok) return json({error:`Source returned HTTP ${source.status}.`},502);
  const type=(source.headers.get('content-type')||'').toLowerCase();
  if(!type.includes('application/pdf')) return json({error:'Source is not a PDF.'},502);
  const bytes=new Uint8Array(await source.arrayBuffer());
  if(bytes.byteLength>2*1024*1024) return json({error:'Source exceeds temporary bridge limit.'},413);
  const url=new URL(context.request.url);
  const offset=Math.max(0,Number.parseInt(url.searchParams.get('offset') || '0',10) || 0);
  const requested=Math.max(1,Number.parseInt(url.searchParams.get('length') || '32768',10) || 32768);
  const length=Math.min(65536,requested);
  if(offset>=bytes.byteLength) return json({error:'Offset beyond source.',total_bytes:bytes.byteLength},416);
  const end=Math.min(bytes.byteLength,offset+length);
  const slice=bytes.subarray(offset,end);
  return new Response(`${offset} ${slice.byteLength} ${bytes.byteLength}\n${bytesToBase64(slice)}`,{
    status:200,
    headers:{
      'content-type':'text/plain; charset=utf-8',
      'cache-control':'no-store',
      'x-source-bytes':String(bytes.byteLength),
      'x-chunk-offset':String(offset),
      'x-chunk-bytes':String(slice.byteLength)
    }
  });
}

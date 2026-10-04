import { getDocument } from 'pdfjs-serverless';
import { ensureCatalog, json } from '../../_lib.js';

function projectId(context) {
  const id=Number(context.params.id);
  return Number.isInteger(id) && id>0 ? id : null;
}

function requestedRange(url,maxPages) {
  const first=Number(url.searchParams.get('page') || url.searchParams.get('from') || 1);
  const requestedTo=Number(url.searchParams.get('to') || first);
  if (!Number.isInteger(first) || !Number.isInteger(requestedTo) || first<1 || requestedTo<first) return null;
  const to=Math.min(requestedTo,first+maxPages-1);
  return {from:first,to};
}

function joinItems(items) {
  const rows=[];
  let row=[];
  let lastY=null;
  for(const item of items) {
    if (!('str' in item)) continue;
    const y=Array.isArray(item.transform) ? Number(item.transform[5]) : null;
    if (lastY!==null && y!==null && Math.abs(y-lastY)>3 && row.length) {
      rows.push(row.join(' ').replace(/\s+/g,' ').trim());
      row=[];
    }
    if (item.str) row.push(item.str);
    if (y!==null) lastY=y;
    if (item.hasEOL && row.length) {
      rows.push(row.join(' ').replace(/\s+/g,' ').trim());
      row=[];
      lastY=null;
    }
  }
  if(row.length) rows.push(row.join(' ').replace(/\s+/g,' ').trim());
  return rows.filter(Boolean).join('\n');
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id=projectId(context);
  if(!id) return json({error:'Invalid project id.'},400);
  const range=requestedRange(new URL(context.request.url),8);
  if(!range) return json({error:'Use ?page=N or ?from=N&to=N; at most 8 pages per request.'},400);

  const project=await context.env.DB.prepare(
    'SELECT title_ar, source_pdf_url, pdf_status, pages FROM projects WHERE id = ?'
  ).bind(id).first();
  if(!project || project.pdf_status!=='available' || !project.source_pdf_url) {
    return json({error:'No verified direct PDF is available for this book.'},404);
  }

  let source;
  try {
    source=await fetch(project.source_pdf_url,{
      redirect:'follow',
      headers:{accept:'application/pdf,*/*;q=0.8','accept-encoding':'identity','user-agent':'Haydari-Workbench-SourceText/1.0'}
    });
  } catch {
    return json({error:'The source PDF could not be reached.'},502);
  }
  if(!source.ok) return json({error:`The source PDF returned HTTP ${source.status}.`},502);
  const type=(source.headers.get('content-type')||'').toLowerCase();
  if(!type.includes('application/pdf')) return json({error:'Verified source is no longer a PDF.'},502);

  const data=new Uint8Array(await source.arrayBuffer());
  let document;
  try {
    document=await getDocument({data,useSystemFonts:true}).promise;
  } catch(error) {
    return json({error:'PDF parser failed.',detail:String(error?.message||error)},502);
  }

  const max=Math.min(document.numPages,Number(project.pages||document.numPages));
  if(range.from>max) return json({error:`Page must be between 1 and ${max}.`},400);
  const to=Math.min(range.to,max);
  const pages=[];
  try {
    for(let n=range.from;n<=to;n+=1) {
      const page=await document.getPage(n);
      const content=await page.getTextContent({includeMarkedContent:false,disableNormalization:false});
      pages.push({page:n,text:joinItems(content.items)});
      page.cleanup();
    }
  } finally {
    try { await document.destroy(); } catch {}
  }

  return json({
    project_id:id,
    title_ar:project.title_ar,
    source_pages:max,
    pdf_pages:document?.numPages || null,
    from:range.from,
    to,
    pages
  });
}

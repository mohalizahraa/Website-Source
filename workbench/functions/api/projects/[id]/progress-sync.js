import { ensureCatalog, json, normalizeProject } from '../../../_lib.js';
import { readPublicProgressMarker } from '../../../_translation.js';
import { onRequestPatch as publishProgress } from './progress.js';

function idFrom(context) {
  const n = Number(context.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function readMarker(context) {
  await ensureCatalog(context.env.DB);
  const id=idFrom(context);
  if (!id) return {status:400,data:{error:'Invalid project id.'}};

  const project=await context.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!project) return {status:404,data:{error:'Project not found.'}};

  const marker=await readPublicProgressMarker(project);
  return {
    status: marker.status,
    data: {
      project: normalizeProject(project),
      ...marker.data,
    },
  };
}

export async function onRequestGet(context) {
  const result=await readMarker(context);
  return json(result.data,result.status);
}

export async function onRequestPost(context) {
  const markerResult=await readMarker(context);
  if (markerResult.status !== 200 || !markerResult.data.marker_found) {
    return json(markerResult.data,markerResult.status);
  }

  const id=idFrom(context);
  const project=markerResult.data.project;
  const current=Number(project.translated_pages || 0);
  const pages=Number(markerResult.data.marker_pages);
  if (pages <= current) {
    return json({...markerResult.data,unchanged:true});
  }

  const latest=await context.env.DB.prepare(
    'SELECT source_pdf_sha256 FROM translation_progress_checkpoints WHERE project_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(id).first();
  const sourceHash=String(latest?.source_pdf_sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
    return json({
      error:'Verified marker sync cannot bootstrap source identity. Publish one direct source-hash checkpoint first.',
      current_translated_pages:current,
    },409);
  }

  const headers=new Headers(context.request.headers);
  headers.set('content-type','application/json');
  headers.set('x-workbench-actor','System');
  const request=new Request(context.request.url,{
    method:'PATCH',
    headers,
    body:JSON.stringify({
      translated_pages:pages,
      expected_previous_pages:current,
      source_total_pages:Number(markerResult.data.marker_total),
      source_pdf_sha256:sourceHash,
      google_doc_revision:`public-export-sha256:${markerResult.data.export_sha256}`,
      verification_note:'Auto-synced from a verified WBPROGRESS marker in the exact public Google Doc text export.',
    }),
  });

  return publishProgress({...context,request});
}

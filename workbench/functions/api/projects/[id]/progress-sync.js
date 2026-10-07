import { ensureCatalog, json, normalizeProject } from '../../../_lib.js';
import { readPublicProgressMarker } from '../../../_translation.js';
import { onRequestPatch as publishProgress } from './progress.js';

function idFrom(context) {
  const n = Number(context.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const MAX_SOURCE_HASH_BYTES = 64 * 1024 * 1024;

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,'0')).join('');
}

async function bootstrapSourcePdfSha256(project) {
  if (project?.pdf_status !== 'available' || !project?.source_pdf_url) {
    return { error: 'Cannot bootstrap source identity without a verified available source PDF.' };
  }

  let response;
  try {
    response = await fetch(project.source_pdf_url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'accept': 'application/pdf,*/*;q=0.8',
        'accept-encoding': 'identity',
        'user-agent': 'Haydari-Translation-Workbench/1.0',
      },
    });
  } catch {
    return { error: 'Could not reach the verified source PDF while bootstrapping source identity.' };
  }

  if (!response.ok) {
    try { await response.body?.cancel(); } catch {}
    return { error: `Verified source PDF returned HTTP ${response.status} while bootstrapping source identity.` };
  }

  const contentType=(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/pdf')) {
    try { await response.body?.cancel(); } catch {}
    return { error: 'Verified source no longer returns a PDF while bootstrapping source identity.' };
  }

  const declaredSize=Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_SOURCE_HASH_BYTES) {
    try { await response.body?.cancel(); } catch {}
    return { error: 'Verified source PDF is too large for the in-request source-identity bootstrap.' };
  }

  const bytes=new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength < 1000 ||
    bytes.byteLength > MAX_SOURCE_HASH_BYTES ||
    bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46
  ) {
    return { error: 'Verified source PDF failed source-identity bootstrap validation.' };
  }

  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return { sha256: hex(digest) };
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
  let sourceHash=String(latest?.source_pdf_sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
    const bootstrapped=await bootstrapSourcePdfSha256(project);
    if (!bootstrapped.sha256) {
      return json({
        error:bootstrapped.error || 'Could not bootstrap verified source identity.',
        current_translated_pages:current,
      },409);
    }
    sourceHash=bootstrapped.sha256;
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

import { actorFromRequest, ensureCatalog, json, normalizeHttpUrl, recordActivity } from '../../../_lib.js';
import { normalizeSourcePack } from '../../../_translation.js';

function idFrom(context) {
  const n = Number(context.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function optionalText(value, max = 8000) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`Text field exceeds ${max} characters.`);
  return text;
}
function normalizeRoutes(value) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 25) throw new Error('recovery_routes must be an array of at most 25 routes.');
  return value.map((route,index)=>{
    if (!route || typeof route !== 'object') throw new Error(`recovery_routes[${index}] must be an object.`);
    const normalized=normalizeHttpUrl(route.url);
    if (!normalized || normalized === false) throw new Error(`recovery_routes[${index}].url must be an http(s) URL.`);
    return {kind:optionalText(route.kind,120),url:normalized,label:optionalText(route.label,240),note:optionalText(route.note,1200)};
  });
}
export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id=idFrom(context);
  if (!id) return json({error:'Invalid project id.'},400);
  const project=await context.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(id).first();
  if (!project) return json({error:'Project not found.'},404);
  const row=await context.env.DB.prepare('SELECT * FROM translation_source_packs WHERE project_id=?').bind(id).first();
  return json({source_pack:normalizeSourcePack(row)});
}
export async function onRequestPatch(context) {
  await ensureCatalog(context.env.DB);
  const id=idFrom(context);
  if (!id) return json({error:'Invalid project id.'},400);
  const project=await context.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(id).first();
  if (!project) return json({error:'Project not found.'},404);
  const body=await context.request.json().catch(()=>null);
  if (!body || typeof body!=='object') return json({error:'Invalid JSON body.'},400);
  const beforeRow=await context.env.DB.prepare('SELECT * FROM translation_source_packs WHERE project_id=?').bind(id).first();
  const before=normalizeSourcePack(beforeRow);
  let sourceTextUrl;
  if (body.source_text_url !== undefined) {
    const normalized=normalizeHttpUrl(body.source_text_url);
    if (normalized === false) return json({error:'source_text_url must be an http(s) URL.'},400);
    sourceTextUrl=normalized || null;
  }
  let recoveryRoutes;
  try { recoveryRoutes=normalizeRoutes(body.recovery_routes); }
  catch (error) { return json({error:error.message},400); }
  const next={
    source_text_kind:body.source_text_kind!==undefined?optionalText(body.source_text_kind,160):before.source_text_kind,
    source_text_url:body.source_text_url!==undefined?sourceTextUrl:before.source_text_url,
    recovery_routes:recoveryRoutes!==undefined?recoveryRoutes:before.recovery_routes,
    page_alignment_note:body.page_alignment_note!==undefined?optionalText(body.page_alignment_note):before.page_alignment_note,
    known_issues:body.known_issues!==undefined?optionalText(body.known_issues):before.known_issues,
    resume_note:body.resume_note!==undefined?optionalText(body.resume_note):before.resume_note,
  };
  await context.env.DB.prepare(`
    INSERT INTO translation_source_packs(project_id,source_text_kind,source_text_url,recovery_routes_json,page_alignment_note,known_issues,resume_note,updated_at)
    VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(project_id) DO UPDATE SET
      source_text_kind=excluded.source_text_kind,source_text_url=excluded.source_text_url,
      recovery_routes_json=excluded.recovery_routes_json,page_alignment_note=excluded.page_alignment_note,
      known_issues=excluded.known_issues,resume_note=excluded.resume_note,updated_at=excluded.updated_at
  `).bind(id,next.source_text_kind,next.source_text_url,JSON.stringify(next.recovery_routes||[]),next.page_alignment_note,next.known_issues,next.resume_note).run();
  const afterRow=await context.env.DB.prepare('SELECT * FROM translation_source_packs WHERE project_id=?').bind(id).first();
  const after=normalizeSourcePack(afterRow);
  await recordActivity(context.env.DB,id,actorFromRequest(context.request),'updated translation source pack',before,after);
  return json({source_pack:after});
}

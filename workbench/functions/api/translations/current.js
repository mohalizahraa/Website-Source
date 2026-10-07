import { actorFromRequest, ensureCatalog, json, recordActivity } from '../../_lib.js';
import { getTranslationContext, resolveCurrentTranslation, setTranslationFocus, TRANSLATORS } from '../../_translation.js';

function assigneeFrom(request, body = null) {
  const urlValue=new URL(request.url).searchParams.get('assignee');
  const value=body?.assignee ?? urlValue;
  return TRANSLATORS.has(value) ? value : null;
}
export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const assignee=assigneeFrom(context.request);
  if (!assignee) return json({error:'assignee must be Zahraa, Mohammed, or Brother.'},400);
  const resolved=await resolveCurrentTranslation(context.env.DB,assignee);
  if (!resolved) return json({assignee,current_translation:null});
  const translation_context=await getTranslationContext(context.env.DB,context.request,resolved.project.id);
  return json({assignee,focus_source:resolved.focus_source,current_translation:translation_context});
}
export async function onRequestPatch(context) {
  await ensureCatalog(context.env.DB);
  const body=await context.request.json().catch(()=>null);
  if (!body || typeof body!=='object') return json({error:'Invalid JSON body.'},400);
  const assignee=assigneeFrom(context.request,body);
  if (!assignee) return json({error:'assignee must be Zahraa, Mohammed, or Brother.'},400);
  const projectId=Number(body.project_id);
  if (!Number.isInteger(projectId)||projectId<=0) return json({error:'project_id must be a positive whole number.'},400);
  const project=await context.env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(projectId).first();
  if (!project) return json({error:'Project not found.'},404);
  if (project.status!=='in_progress') return json({error:'Current translation focus must point to a Translating project.'},409);
  if (![assignee,'Both'].includes(project.assignee)) return json({error:'Project is not assigned to this translator.'},409);
  const before=await context.env.DB.prepare('SELECT * FROM translation_focus WHERE assignee=?').bind(assignee).first();
  await setTranslationFocus(context.env.DB,assignee,projectId);
  const after=await context.env.DB.prepare('SELECT * FROM translation_focus WHERE assignee=?').bind(assignee).first();
  await recordActivity(context.env.DB,projectId,actorFromRequest(context.request),'updated translation focus',before,after);
  const translation_context=await getTranslationContext(context.env.DB,context.request,projectId);
  return json({assignee,focus_source:'explicit',current_translation:translation_context});
}

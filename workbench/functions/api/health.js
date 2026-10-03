import { json, requireAccess } from '../_lib.js';

export async function onRequest(context) {
  const denied = requireAccess(context);
  if (denied) return denied;
  const result = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM projects').first();
  return json({ ok: true, projects: result?.count ?? 0 });
}

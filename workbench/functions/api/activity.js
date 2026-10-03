import { json, requireAccess } from '../_lib.js';

export async function onRequestGet(context) {
  const denied = requireAccess(context);
  if (denied) return denied;
  const { results } = await context.env.DB.prepare(
    `SELECT a.id, a.project_id, a.actor, a.action, a.before_json, a.after_json, a.created_at,
            p.title_ar
       FROM activity a
       LEFT JOIN projects p ON p.id = a.project_id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 100`
  ).all();
  return json({ activity: results || [] });
}

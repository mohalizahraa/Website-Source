import { json } from '../_lib.js';

export async function onRequestGet(context) {
  const [activity, paceEvents] = await Promise.all([
    context.env.DB.prepare(
      `SELECT a.id, a.project_id, a.actor, a.action, a.before_json, a.after_json, a.created_at,
              p.title_ar
         FROM activity a
         LEFT JOIN projects p ON p.id = a.project_id
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 100`
    ).all(),
    context.env.DB.prepare(
      `SELECT a.id, a.project_id, a.actor, a.action, a.before_json, a.after_json, a.created_at,
              p.title_ar
         FROM activity a
         LEFT JOIN projects p ON p.id = a.project_id
        WHERE a.action = 'translation progress'
          AND a.created_at >= datetime('now','-90 days')
        ORDER BY a.created_at ASC, a.id ASC`
    ).all(),
  ]);
  return json({
    activity: activity.results || [],
    pace_events: paceEvents.results || [],
  });
}

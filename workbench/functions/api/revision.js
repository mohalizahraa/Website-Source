import { json } from '../_lib.js';

export async function onRequestGet(context) {
  const latest = await context.env.DB.prepare(
    'SELECT COALESCE(MAX(id), 0) AS revision, MAX(created_at) AS changed_at FROM activity'
  ).first();

  return json({
    revision: Number(latest?.revision || 0),
    changed_at: latest?.changed_at || null,
  });
}

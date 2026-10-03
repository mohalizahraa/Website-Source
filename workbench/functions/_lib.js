export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function actorFromRequest(request) {
  const actor = (request.headers.get('x-workbench-actor') || '').trim();
  return ['Zahraa', 'Brother'].includes(actor) ? actor : 'Unknown';
}

export function requireAccess(context) {
  const expected = context.env.WORKBENCH_ACCESS_TOKEN;
  if (!expected) return json({ error: 'Workbench access secret is not configured.' }, 503);
  const supplied = context.request.headers.get('x-workbench-key') || '';
  if (supplied !== expected) return json({ error: 'Not authorized.' }, 401);
  return null;
}

export async function recordActivity(db, projectId, actor, action, before, after) {
  await db.prepare(
    `INSERT INTO activity (project_id, actor, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    projectId ?? null,
    actor,
    action,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
  ).run();
}

export function normalizeProject(row) {
  return { ...row, blocked: Boolean(row.blocked) };
}

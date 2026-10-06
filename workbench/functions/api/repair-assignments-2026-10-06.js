import { ensureCatalog, json } from '../_lib.js';

const MARKER_KEY = 'assignment_repair_156_20_2026_10_06';
const CONFIRM = 'repair-156-20-2026-10-06';

async function assignmentCounts(db) {
  const { results } = await db.prepare(
    'SELECT assignee, COUNT(*) AS count FROM projects GROUP BY assignee'
  ).all();
  const counts = {};
  let total = 0;
  for (const row of results || []) {
    const count = Number(row.count || 0);
    counts[row.assignee] = count;
    total += count;
  }
  return { total, counts };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (url.searchParams.get('confirm') !== CONFIRM) {
    return json({ error: 'Explicit repair confirmation is required.' }, 400);
  }

  const db = context.env.DB;
  await ensureCatalog(db);

  const before = await assignmentCounts(db);
  const marker = await db.prepare(
    'SELECT value FROM workbench_meta WHERE key = ?'
  ).bind(MARKER_KEY).first();

  if (marker?.value === 'applied') {
    return json({ status: 'already_applied', ...before });
  }

  const z = Number(before.counts.Zahraa || 0);
  const m = Number(before.counts.Mohammed || 0);
  const both = Number(before.counts.Both || 0);
  const unassigned = Number(before.counts.Unassigned || 0);
  const unexpected = Object.fromEntries(
    Object.entries(before.counts).filter(([key]) => !['Zahraa','Mohammed','Both','Unassigned'].includes(key))
  );

  if (
    before.total !== 176 ||
    m !== 20 ||
    unassigned !== 0 ||
    z + both !== 156 ||
    Object.keys(unexpected).length
  ) {
    return json({
      status: 'blocked',
      error: 'Live assignment state does not match the exact repair invariant; no mutation was performed.',
      before,
      expected_invariant: {
        total: 176,
        Mohammed: 20,
        Unassigned: 0,
        Zahraa_plus_Both: 156,
        unexpected_assignees: 0,
      },
    }, 409);
  }

  const now = new Date().toISOString();
  const expectedAfter = {
    total: 176,
    counts: { Zahraa: 156, Mohammed: 20 },
  };

  await db.batch([
    db.prepare(
      "UPDATE projects SET assignee='Zahraa', updated_at=? WHERE assignee='Both'"
    ).bind(now),
    db.prepare(
      `INSERT INTO activity (project_id, actor, action, before_json, after_json, created_at)
       VALUES (NULL, 'System', 'repaired accidental Shared assignments', ?, ?, ?)`
    ).bind(
      JSON.stringify(before),
      JSON.stringify({ ...expectedAfter, changed_from_both_to_zahraa: both }),
      now
    ),
    db.prepare(
      `INSERT INTO workbench_meta(key,value)
       VALUES(?, 'applied')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(MARKER_KEY),
  ]);

  const after = await assignmentCounts(db);
  const verified =
    after.total === 176 &&
    Number(after.counts.Zahraa || 0) === 156 &&
    Number(after.counts.Mohammed || 0) === 20 &&
    Number(after.counts.Both || 0) === 0 &&
    Number(after.counts.Unassigned || 0) === 0 &&
    Object.keys(after.counts).every(key => ['Zahraa','Mohammed'].includes(key));

  if (!verified) {
    return json({
      status: 'verification_failed',
      before,
      after,
      changed_from_both_to_zahraa: both,
    }, 500);
  }

  return json({
    status: 'repaired',
    before,
    after,
    changed_from_both_to_zahraa: both,
    verified: true,
  });
}

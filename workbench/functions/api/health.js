import { ensureCatalog, json } from '../_lib.js';

export async function onRequest(context) {
  await ensureCatalog(context.env.DB);
  const result = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM projects').first();
  const pdf = await context.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN pdf_status='available' THEN 1 ELSE 0 END) AS available,
       SUM(CASE WHEN pdf_status='missing' THEN 1 ELSE 0 END) AS missing,
       SUM(CASE WHEN pdf_status='unchecked' AND source_pdf_url IS NOT NULL AND source_pdf_url<>'' THEN 1 ELSE 0 END) AS unchecked
     FROM projects`
  ).first();
  return json({
    ok: true,
    projects: result?.count ?? 0,
    pdfs: {
      available: pdf?.available ?? 0,
      missing: pdf?.missing ?? 0,
      unchecked: pdf?.unchecked ?? 0,
    },
  });
}

import { ensureCatalog, json, requireAccess } from '../_lib.js';

export async function onRequest(context) {
  const denied = requireAccess(context);
  if (denied) return denied;
  await ensureCatalog(context.env.DB);
  const result = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM projects').first();
  const missing = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM projects WHERE source_pdf_url IS NULL OR source_pdf_url = \'\'').first();
  return json({ ok: true, projects: result?.count ?? 0, missing_pdfs: missing?.count ?? 0 });
}

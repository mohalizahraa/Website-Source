import { ensureCatalog, json } from '../_lib.js';
import { PDF_AUDIT_VERSION } from '../_pdf_audit.js';

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const counts = await context.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN pdf_status='available' THEN 1 ELSE 0 END) AS available,
       SUM(CASE WHEN pdf_status='missing' THEN 1 ELSE 0 END) AS missing,
       SUM(CASE WHEN pdf_status='unchecked' THEN 1 ELSE 0 END) AS unchecked
     FROM projects`
  ).first();
  return json({
    audit_version: PDF_AUDIT_VERSION,
    total: counts?.total ?? 0,
    available: counts?.available ?? 0,
    missing: counts?.missing ?? 0,
    unchecked: counts?.unchecked ?? 0
  });
}

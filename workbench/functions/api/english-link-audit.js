import { ensureCatalog, json, googleDocIdFromUrl, verifyGoogleDocLinkAccess } from '../_lib.js';

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const { results } = await context.env.DB.prepare(
    `SELECT id, catalog_id, title_ar, title_en, google_doc_url
       FROM projects
      WHERE google_doc_url IS NOT NULL AND google_doc_url <> ''
      ORDER BY id`
  ).all();

  const links = [];
  for (const row of results || []) {
    const docId = googleDocIdFromUrl(row.google_doc_url);
    const access = await verifyGoogleDocLinkAccess(row.google_doc_url);
    links.push({
      project_id: row.id,
      catalog_id: row.catalog_id,
      title_ar: row.title_ar,
      title_en: row.title_en,
      doc_fingerprint: docId ? await sha256(docId) : null,
      link_accessible: Boolean(access.accessible),
    });
  }
  return json({ count: links.length, links });
}

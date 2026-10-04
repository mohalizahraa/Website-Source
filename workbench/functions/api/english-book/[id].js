import { ensureCatalog, json, verifyGoogleDocLinkAccess } from '../../_lib.js';

function idFrom(context) {
  const n = Number(context.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id = idFrom(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);

  const row = await context.env.DB.prepare(
    'SELECT id, google_doc_url FROM projects WHERE id = ?'
  ).bind(id).first();

  if (!row) return json({ error: 'Project not found.' }, 404);
  if (!row.google_doc_url) return json({ error: 'No English Book is linked yet.' }, 404);

  const access = await verifyGoogleDocLinkAccess(row.google_doc_url);
  if (!access.accessible) {
    return json({
      error: 'English Book access needs fixing. Set the Google Doc to Anyone with the link → Editor before opening it.',
      code: 'english_book_access_required',
    }, 409);
  }

  return json({ url: row.google_doc_url });
}

import { ensureCatalog, json } from '../../../_lib.js';
import { getTranslationContext } from '../../../_translation.js';

function idFrom(context) {
  const n = Number(context.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id = idFrom(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);
  const translation_context = await getTranslationContext(context.env.DB, context.request, id);
  return translation_context
    ? json({ translation_context })
    : json({ error: 'Project not found.' }, 404);
}

import { ensureCatalog, json, requireAccess } from '../_lib.js';

async function inspectPdf(url) {
  if (!/^https:\/\//i.test(url || '')) {
    return { status: 'missing', note: 'No usable HTTPS PDF URL' };
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'accept': 'application/pdf,*/*;q=0.8',
        'range': 'bytes=0-15',
        'user-agent': 'Haydari-Workbench-PDF-Validator/1.0',
      },
    });
  } catch (error) {
    return { status: 'unchecked', note: `Fetch error: ${error?.message || 'unknown'}` };
  }

  const httpStatus = response.status;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (httpStatus === 404 || httpStatus === 410) {
    try { await response.body?.cancel(); } catch {}
    return { status: 'missing', note: `HTTP ${httpStatus}` };
  }

  if (httpStatus === 429 || httpStatus >= 500) {
    try { await response.body?.cancel(); } catch {}
    return { status: 'unchecked', note: `Deferred: HTTP ${httpStatus}` };
  }

  if (!response.ok) {
    try { await response.body?.cancel(); } catch {}
    return { status: 'missing', note: `HTTP ${httpStatus}` };
  }

  if (contentType.includes('application/pdf')) {
    try { await response.body?.cancel(); } catch {}
    return { status: 'available', note: `Verified PDF (HTTP ${httpStatus})` };
  }

  try {
    const reader = response.body?.getReader();
    if (!reader) return { status: 'missing', note: `Not a PDF: ${contentType || 'unknown content type'}` };
    const first = await reader.read();
    try { await reader.cancel(); } catch {}
    const bytes = first.value || new Uint8Array();
    const signature = String.fromCharCode(...bytes.slice(0, 5));
    if (signature === '%PDF-') {
      return { status: 'available', note: `Verified PDF signature (HTTP ${httpStatus})` };
    }
  } catch (error) {
    return { status: 'unchecked', note: `Validation error: ${error?.message || 'unknown'}` };
  }

  return { status: 'missing', note: `Not a direct PDF: ${contentType || 'unknown content type'}` };
}

export async function onRequestPost(context) {
  const denied = requireAccess(context);
  if (denied) return denied;

  await ensureCatalog(context.env.DB);

  const body = await context.request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(Number(body?.limit) || 8, 12));

  const { results } = await context.env.DB.prepare(
    `SELECT id, source_pdf_url
       FROM projects
      WHERE source_pdf_url IS NOT NULL
        AND source_pdf_url <> ''
        AND pdf_status = 'unchecked'
      ORDER BY id
      LIMIT ?`
  ).bind(limit).all();

  const rows = results || [];
  const checkedAt = new Date().toISOString();
  const outcomes = await Promise.all(rows.map(async row => ({
    id: row.id,
    ...(await inspectPdf(row.source_pdf_url)),
  })));

  if (outcomes.length) {
    await context.env.DB.batch(outcomes.map(result =>
      context.env.DB.prepare(
        'UPDATE projects SET pdf_status = ?, pdf_checked_at = ?, pdf_check_note = ? WHERE id = ?'
      ).bind(result.status, checkedAt, result.note, result.id)
    ));
  }

  const counts = await context.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN pdf_status='available' THEN 1 ELSE 0 END) AS available,
       SUM(CASE WHEN pdf_status='missing' THEN 1 ELSE 0 END) AS missing,
       SUM(CASE WHEN pdf_status='unchecked' AND source_pdf_url IS NOT NULL AND source_pdf_url<>'' THEN 1 ELSE 0 END) AS unchecked
     FROM projects`
  ).first();

  return json({
    processed: outcomes.length,
    available_now: outcomes.filter(x => x.status === 'available').length,
    missing_now: outcomes.filter(x => x.status === 'missing').length,
    deferred_now: outcomes.filter(x => x.status === 'unchecked').length,
    counts: {
      total: counts?.total ?? 0,
      available: counts?.available ?? 0,
      missing: counts?.missing ?? 0,
      unchecked: counts?.unchecked ?? 0,
    },
  });
}

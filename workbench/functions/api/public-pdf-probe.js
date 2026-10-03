import { BOOK_CATALOG } from '../_catalog.js';
import { PDF_CANDIDATE_OVERRIDES } from '../_pdf_candidates.js';

const MAX_BATCH = 10;
const TIMEOUT_MS = 20000;

async function candidateFor(book) {
  const override = PDF_CANDIDATE_OVERRIDES[book.catalog_id];
  if (override?.url) return override.url;

  if (override?.source_page) {
    try {
      const page = await fetch(override.source_page, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 Haydari-Workbench-PDF-Discovery/1.0' },
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
      });
      if (page.ok) {
        const html = await page.text();
        const matches = [...html.matchAll(/https:\/\/download\.almohsinlibrary\.com\/[^"'<>\\s]+?\.pdf(?:\?[^"'<>\\s]*)?/gi)];
        if (matches.length) return matches[0][0].replaceAll('&amp;', '&');
      }
    } catch {}
  }

  return book.pdf_url || null;
}

async function verifyPdf(url) {
  if (!url) return { status: 'missing', final_url: null, note: 'No direct PDF candidate' };

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        range: 'bytes=0-15',
        'user-agent': 'Haydari-Workbench-PDF-Probe/1.0',
      },
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
  } catch (error) {
    return { status: 'unchecked', final_url: null, note: `Deferred after fetch failure: ${error?.name || 'Error'}` };
  }

  const finalUrl = response.url || url;
  const type = (response.headers.get('content-type') || '').toLowerCase();

  if (response.status === 404 || response.status === 410) {
    try { await response.body?.cancel(); } catch {}
    return { status: 'missing', final_url: null, note: `HTTP ${response.status}` };
  }

  if (response.status === 429 || response.status >= 500) {
    try { await response.body?.cancel(); } catch {}
    return { status: 'unchecked', final_url: null, note: `Deferred: HTTP ${response.status}` };
  }

  if (!response.ok && response.status !== 206) {
    try { await response.body?.cancel(); } catch {}
    return { status: 'missing', final_url: null, note: `HTTP ${response.status}` };
  }

  let first = new Uint8Array();
  try {
    const reader = response.body?.getReader();
    if (reader) {
      const chunk = await reader.read();
      first = chunk.value || new Uint8Array();
      try { await reader.cancel(); } catch {}
    }
  } catch (error) {
    return { status: 'unchecked', final_url: null, note: `Deferred during PDF validation: ${error?.name || 'Error'}` };
  }

  const magic = new TextDecoder('latin1').decode(first.slice(0, 5));
  const isPdf = type.includes('application/pdf') || magic.startsWith('%PDF-');
  if (!isPdf) {
    return { status: 'missing', final_url: null, note: `Not a PDF (content-type: ${type || 'unknown'})` };
  }

  return {
    status: 'available',
    final_url: finalUrl,
    note: `Verified PDF: HTTP ${response.status}; ${type || 'PDF magic'}`,
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const start = Math.max(0, Math.min(Number(url.searchParams.get('start')) || 0, BOOK_CATALOG.length));
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || MAX_BATCH, MAX_BATCH));
  const books = BOOK_CATALOG.slice(start, start + limit);

  const results = await Promise.all(books.map(async book => {
    const candidate = await candidateFor(book);
    const verified = await verifyPdf(candidate);
    return {
      catalog_id: book.catalog_id,
      title_ar: book.title_ar,
      candidate_url: candidate,
      status: verified.status,
      url: verified.final_url,
      checked_at: new Date().toISOString(),
      note: verified.note,
    };
  }));

  return new Response(JSON.stringify({
    temporary_public_source_probe: true,
    total: BOOK_CATALOG.length,
    start,
    limit: results.length,
    next: start + results.length < BOOK_CATALOG.length ? start + results.length : null,
    results,
  }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

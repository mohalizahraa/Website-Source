import { ensureCatalog, json } from '../../_lib.js';

const MAX_SYNTHETIC_RANGE_BYTES = 8 * 1024 * 1024;

function projectId(context) {
  const id = Number(context.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function boundedByteRange(value) {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d+)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
  return { start, end, length: end - start + 1 };
}

function concatChunks(chunks, length) {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function extractBoundedRange(body, start, requestedEnd) {
  const reader = body?.getReader();
  if (!reader) return { error: 'Source PDF body is unavailable.' };

  const chunks = [];
  let collected = 0;
  let cursor = 0;
  let eof = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        eof = true;
        break;
      }
      const chunk = value || new Uint8Array();
      const chunkStart = cursor;
      const chunkEndExclusive = cursor + chunk.byteLength;

      const overlapStart = Math.max(start, chunkStart);
      const overlapEndExclusive = Math.min(requestedEnd + 1, chunkEndExclusive);
      if (overlapStart < overlapEndExclusive) {
        const from = overlapStart - chunkStart;
        const to = overlapEndExclusive - chunkStart;
        const slice = chunk.slice(from, to);
        chunks.push(slice);
        collected += slice.byteLength;
      }

      cursor = chunkEndExclusive;
      if (cursor > requestedEnd) {
        try { await reader.cancel(); } catch {}
        break;
      }
    }
  } catch {
    try { await reader.cancel(); } catch {}
    return { error: 'Source PDF stream failed while serving a byte range.' };
  }

  if (eof && start >= cursor) return { unsatisfiable: true, total: cursor };

  const actualEnd = start + collected - 1;
  if (collected <= 0 || actualEnd < start) {
    return eof
      ? { unsatisfiable: true, total: cursor }
      : { error: 'Could not extract the requested PDF byte range.' };
  }

  return {
    bytes: concatChunks(chunks, collected),
    actualEnd,
    total: eof ? cursor : null,
  };
}

function basePdfHeaders(source) {
  const headers = new Headers();
  headers.set('content-type', source.headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', 'inline; filename="haydari-book.pdf"');
  headers.set('cache-control', 'public, max-age=3600');
  for (const name of ['etag','last-modified']) {
    const value = source.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function onRequestGet(context) {
  await ensureCatalog(context.env.DB);
  const id = projectId(context);
  if (!id) return json({ error: 'Invalid project id.' }, 400);

  const project = await context.env.DB.prepare(
    'SELECT source_pdf_url, pdf_status FROM projects WHERE id = ?'
  ).bind(id).first();

  if (!project || project.pdf_status !== 'available' || !project.source_pdf_url) {
    return json({ error: 'No verified direct PDF is available for this book.' }, 404);
  }

  const range = context.request.headers.get('range');
  const requestHeaders = new Headers({
    'accept': 'application/pdf,*/*;q=0.8',
    'accept-encoding': 'identity',
    'user-agent': 'Haydari-Workbench-PDF-Proxy/1.1',
  });
  if (range) requestHeaders.set('range', range);

  let source;
  try {
    source = await fetch(project.source_pdf_url, {
      method: 'GET',
      redirect: 'follow',
      headers: requestHeaders,
    });
  } catch {
    return json({ error: 'The source PDF could not be reached.' }, 502);
  }

  if (!source.ok && source.status !== 206) {
    try { await source.body?.cancel(); } catch {}
    return json({ error: `The source PDF returned HTTP ${source.status}.` }, 502);
  }

  const contentType = (source.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/pdf')) {
    try { await source.body?.cancel(); } catch {}
    return json({ error: 'The verified source no longer returns a PDF.' }, 502);
  }

  // Best case: the upstream honors Range. Preserve its real partial response.
  if (source.status === 206) {
    const headers = basePdfHeaders(source);
    for (const name of ['content-length','content-range','accept-ranges']) {
      const value = source.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
    return new Response(source.body, { status: 206, headers });
  }

  // The legacy Haydari host currently ignores Range and streams a full 200
  // response without Content-Length. For a normal single bounded byte request,
  // synthesize a truthful 206 while buffering only the requested slice.
  const bounded = boundedByteRange(range);
  if (bounded && bounded.length <= MAX_SYNTHETIC_RANGE_BYTES) {
    const partial = await extractBoundedRange(source.body, bounded.start, bounded.end);
    if (partial.error) return json({ error: partial.error }, 502);
    if (partial.unsatisfiable) {
      const headers = new Headers({ 'accept-ranges': 'bytes' });
      if (Number.isSafeInteger(partial.total)) headers.set('content-range', `bytes */${partial.total}`);
      return new Response(null, { status: 416, headers });
    }

    const headers = basePdfHeaders(source);
    headers.set('accept-ranges', 'bytes');
    headers.set('content-length', String(partial.bytes.byteLength));
    headers.set(
      'content-range',
      `bytes ${bounded.start}-${partial.actualEnd}/${partial.total === null ? '*' : partial.total}`
    );
    return new Response(partial.bytes, { status: 206, headers });
  }

  // RFC Range processing is optional. For open-ended, suffix, multi-range, or
  // unusually large requests that cannot be synthesized safely with bounded
  // memory, return the full representation instead of pretending partial
  // semantics that the upstream did not provide.
  const headers = basePdfHeaders(source);
  headers.set('accept-ranges', 'bytes');
  const contentLength = source.headers.get('content-length');
  if (contentLength) headers.set('content-length', contentLength);
  return new Response(source.body, { status: 200, headers });
}

import { createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { BOOK_CATALOG } from '../functions/_catalog.js';
import { PDF_CANDIDATE_OVERRIDES } from '../functions/_pdf_candidates.js';

const CONCURRENCY = 3;
const DISCOVERY_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const ATTEMPTS = 3;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function candidateFor(book) {
  const override = PDF_CANDIDATE_OVERRIDES[book.catalog_id];
  if (override?.url) return override.url;
  if (override?.source_page) {
    try {
      const page = await fetch(override.source_page, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 Haydari-Workbench-PDF-Discovery/2.0' },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
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

async function preparePdfCounter(tempRoot) {
  const sourcePath = join(tempRoot, 'pdf-page-count.swift');
  const binaryPath = join(tempRoot, 'pdf-page-count');
  const source = `import Foundation
import PDFKit
guard CommandLine.arguments.count == 2 else { exit(64) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let document = PDFDocument(url: url), document.pageCount > 0 else { exit(65) }
print(document.pageCount)
`;
  await writeFile(sourcePath, source);
  execFileSync('xcrun', ['swiftc', '-framework', 'PDFKit', sourcePath, '-o', binaryPath], { stdio: 'inherit' });
  return filePath => {
    const raw = execFileSync(binaryPath, [filePath], { encoding: 'utf8', timeout: 30000 }).trim();
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid PDFKit page count: ${raw}`);
    return count;
  };
}

async function beginsWithPdfMagic(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(5);
    const { bytesRead } = await handle.read(buffer, 0, 5, 0);
    return bytesRead === 5 && buffer.toString('latin1') === '%PDF-';
  } finally {
    await handle.close();
  }
}

async function downloadPdf(url, destination) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'application/pdf,*/*;q=0.8',
        'user-agent': 'Haydari-Workbench-PDF-Page-Audit/1.0',
      },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: 'transient', note: `Fetch failure: ${error?.name || 'Error'}` };
  }
  const finalUrl = response.url || url;
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (response.status === 404 || response.status === 410) {
    try { await response.body?.cancel(); } catch {}
    return { kind: 'missing', finalUrl: null, note: `HTTP ${response.status}` };
  }
  if (response.status === 429 || response.status >= 500) {
    try { await response.body?.cancel(); } catch {}
    return { kind: 'transient', finalUrl: null, note: `Deferred: HTTP ${response.status}` };
  }
  if (!response.ok || !response.body) {
    try { await response.body?.cancel(); } catch {}
    return { kind: 'missing', finalUrl: null, note: `HTTP ${response.status}` };
  }
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  } catch (error) {
    return { kind: 'transient', finalUrl: null, note: `Download failure: ${error?.name || 'Error'}` };
  }
  const magic = await beginsWithPdfMagic(destination);
  if (!type.includes('application/pdf') && !magic) {
    return { kind: 'missing', finalUrl: null, note: `Not a PDF (content-type: ${type || 'unknown'})` };
  }
  if (!magic) return { kind: 'missing', finalUrl: null, note: 'Response lacked PDF magic bytes' };
  return { kind: 'pdf', finalUrl, note: `Verified full PDF: HTTP ${response.status}; ${type || 'PDF magic'}` };
}

async function verifyAndCount(book, candidate, tempRoot, countPages) {
  if (!candidate) return { status: 'missing', final_url: null, physical_pages: null, size_bytes: null, note: 'No direct PDF candidate' };
  const destination = join(tempRoot, `${book.catalog_id}.pdf`);
  let lastNote = 'unknown failure';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await rm(destination, { force: true });
    const downloaded = await downloadPdf(candidate, destination);
    lastNote = downloaded.note;
    if (downloaded.kind === 'missing') {
      await rm(destination, { force: true });
      return { status: 'missing', final_url: null, physical_pages: null, size_bytes: null, note: downloaded.note };
    }
    if (downloaded.kind === 'transient') {
      if (attempt < ATTEMPTS) await sleep(750 * attempt);
      continue;
    }
    try {
      const physicalPages = countPages(destination);
      const fileStat = await stat(destination);
      await rm(destination, { force: true });
      return { status: 'available', final_url: downloaded.finalUrl, physical_pages: physicalPages, size_bytes: fileStat.size, note: `${downloaded.note}; PDFKit physical pages: ${physicalPages}` };
    } catch (error) {
      lastNote = `PDFKit page-count failure: ${error?.message || error?.name || 'Error'}`;
      if (attempt < ATTEMPTS) await sleep(750 * attempt);
    }
  }
  await rm(destination, { force: true });
  return { status: 'unchecked', final_url: null, physical_pages: null, size_bytes: null, note: `Deferred after ${ATTEMPTS} attempts: ${lastNote}` };
}

const tempRoot = await mkdtemp(join(tmpdir(), 'haydari-pdf-page-audit-'));
let countPages;
try {
  countPages = await preparePdfCounter(tempRoot);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw new Error(`Cannot run physical-page audit: macOS PDFKit counter failed to build: ${error?.message || error}`);
}

const results = {};
let cursor = 0;
async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= BOOK_CATALOG.length) return;
    const book = BOOK_CATALOG[i];
    const candidate = await candidateFor(book);
    const verified = await verifyAndCount(book, candidate, tempRoot, countPages);
    const catalogPages = Number.isInteger(Number(book.pages)) ? Number(book.pages) : null;
    const physicalPages = Number.isInteger(verified.physical_pages) ? verified.physical_pages : null;
    results[book.catalog_id] = {
      title_ar: book.title_ar,
      candidate_url: candidate,
      status: verified.status,
      url: verified.final_url,
      checked_at: new Date().toISOString(),
      note: verified.note,
      catalog_pages: catalogPages,
      physical_pages: physicalPages,
      page_count_match: physicalPages === null || catalogPages === null ? null : physicalPages === catalogPages,
      page_count_delta: physicalPages === null || catalogPages === null ? null : physicalPages - catalogPages,
      size_bytes: verified.size_bytes,
    };
    const pageText = physicalPages === null ? '' : ` ${physicalPages} pages${physicalPages === catalogPages ? '' : ` (catalog ${catalogPages})`}`;
    process.stdout.write(`[${i + 1}/${BOOK_CATALOG.length}] ${book.catalog_id} ${verified.status}${pageText}\n`);
  }
}
try {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
const ordered = Object.fromEntries(BOOK_CATALOG.map(book => [book.catalog_id, results[book.catalog_id]]));
const rows = Object.values(ordered);
const available = rows.filter(x => x.status === 'available').length;
const missing = rows.filter(x => x.status === 'missing').length;
const unchecked = rows.filter(x => x.status === 'unchecked').length;
const pageCountVerified = rows.filter(x => Number.isInteger(x.physical_pages) && x.physical_pages > 0).length;
const pageCountMismatches = rows.filter(x => x.page_count_match === false).length;
const version = `audit-${new Date().toISOString()}-${available}ok-${missing}missing-${unchecked}unchecked-${pageCountVerified}pagecounts-${pageCountMismatches}mismatches`;
const js = `// Generated by workbench/scripts/audit-pdfs.mjs. Do not hand-edit.\nexport const PDF_AUDIT_VERSION = ${JSON.stringify(version)};\nexport const PDF_AUDIT = ${JSON.stringify(ordered, null, 2)};\n`;
const json = JSON.stringify({
  version,
  available,
  missing,
  unchecked,
  page_count_verified: pageCountVerified,
  page_count_mismatches: pageCountMismatches,
  page_count_basis: 'physical pages opened with macOS PDFKit from the complete verified PDF byte stream',
  books: ordered,
}, null, 2) + '\n';
await writeFile(new URL('../functions/_pdf_audit.js', import.meta.url), js);
await writeFile(new URL('../public/pdf-audit.json', import.meta.url), json);
console.log(`PDF audit complete: ${available} available, ${missing} missing, ${unchecked} unchecked; ${pageCountVerified} physical page counts verified; ${pageCountMismatches} catalog mismatches found.`);
if (unchecked > 0 || pageCountVerified !== available) process.exitCode = 2;

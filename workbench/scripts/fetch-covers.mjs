import { mkdir, writeFile } from 'node:fs/promises';
import { BOOK_CATALOG } from '../functions/_catalog.js';

const OUT = new URL('../public/covers/', import.meta.url);
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;

await mkdir(OUT, { recursive: true });

function htmlDecode(value='') {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&#038;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&apos;', "'");
}

function absoluteUrl(value, base) {
  try { return new URL(htmlDecode(value), base).href; } catch { return null; }
}

function titleTokens(value='') {
  return value
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token.length >= 3)
    .slice(0, 8);
}

function imageCandidates(html, base, book) {
  const candidates = [];
  const seen = new Set();
  const tokens = titleTokens(book.title_ar);

  const add = (raw, score=0, context='') => {
    const url = absoluteUrl(raw, base);
    if (!url || seen.has(url)) return;
    const lower = url.toLowerCase();
    if (!/^https?:/.test(url)) return;
    if (/\.svg(?:\?|$)/i.test(lower)) return;
    if (/(favicon|avatar|emoji|icon|logo|sprite|loading|spinner|social|facebook|twitter|youtube|instagram|whatsapp|telegram|header|footer|banner|flag)/i.test(lower)) score -= 9;
    if (/wp-content\/uploads/i.test(lower)) score += 4;
    if (/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(lower)) score += 2;
    if (/aligncenter|wp-image|attachment|book|cover/i.test(context)) score += 3;
    const normalizedContext = context.replace(/[\u064B-\u065F\u0670]/g, '');
    const tokenHits = tokens.filter(t => normalizedContext.includes(t)).length;
    score += Math.min(8, tokenHits * 2);
    seen.add(url);
    candidates.push({ url, score });
  };

  const metas = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/gi,
  ];
  for (const pattern of metas) {
    for (const match of html.matchAll(pattern)) add(match[1], 4, match[0]);
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const sources = [];
    for (const attr of ['src','data-src','data-lazy-src','data-original']) {
      const m = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
      if (m?.[1]) sources.push(m[1]);
    }
    const srcset = tag.match(/(?:srcset|data-srcset)=["']([^"']+)["']/i)?.[1];
    if (srcset) {
      for (const item of srcset.split(',')) {
        const raw = item.trim().split(/\s+/)[0];
        if (raw) sources.push(raw);
      }
    }
    let score = 0;
    const width = Number(tag.match(/\bwidth=["']?(\d+)/i)?.[1] || 0);
    const height = Number(tag.match(/\bheight=["']?(\d+)/i)?.[1] || 0);
    if (width >= 180 && height >= 240) score += 3;
    if (width && height && height > width * 1.15) score += 3;
    if (width && height && width > height * 1.6) score -= 3;
    for (const source of sources) add(source, score, tag);
  }

  for (const match of html.matchAll(/<a\b[^>]+href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["'][^>]*>/gi)) {
    add(match[1], 1, match[0]);
  }

  // Broad legacy-page fallback: old WordPress/PageSpeed pages sometimes hide the
  // actual image URL in inline CSS, lazy-load JSON, or script attributes rather
  // than a conventional <img src>. Repeated site furniture is still removed by
  // the cross-book source de-duplication pass below.
  for (const match of html.matchAll(/(?:https?:\\/\\/[^"'<>\\s)]+|\\/ar\\/files\\/[^"'<>\\s)]+)\.(?:jpe?g|png|webp|gif)(?:[^"'<>\\s)]*)?/gi)) {
    add(match[0], 0, match[0]);
  }
  for (const match of html.matchAll(/url\(\s*["']?([^"'()]+\.(?:jpe?g|png|webp|gif)(?:\?[^"'()]*)?)["']?\s*\)/gi)) {
    add(match[1], 0, match[0]);
  }

  return candidates.sort((a,b)=>b.score-a.score);
}

function extFor(type, url) {
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  const m = url.match(/\.([a-z0-9]{3,4})(?:\?|$)/i);
  return ['jpg','jpeg','png','webp','gif'].includes(m?.[1]?.toLowerCase()) ? m[1].toLowerCase().replace('jpeg','jpg') : 'jpg';
}

async function fetchImageCandidate(candidate) {
  try {
    const image = await fetch(candidate.url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 Haydari-Workbench-Cover-Archive/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const type = (image.headers.get('content-type') || '').toLowerCase();
    if (!image.ok || !type.startsWith('image/')) return null;
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (bytes.length < 3000 || bytes.length > 8_000_000) return null;
    return { source_url: image.url || candidate.url, type, bytes, score:candidate.score };
  } catch { return null; }
}

const discovered = {};
let cursor = 0;
async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= BOOK_CATALOG.length) return;
    const book = BOOK_CATALOG[i];
    if (!book.detail_url) continue;
    try {
      const page = await fetch(book.detail_url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 Haydari-Workbench-Cover-Archive/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!page.ok) continue;
      const html = await page.text();
      const candidates = imageCandidates(html, page.url || book.detail_url, book).slice(0, 14);
      for (const candidate of candidates) {
        if (candidate.score < -2) continue;
        const image = await fetchImageCandidate(candidate);
        if (!image) continue;
        discovered[book.catalog_id] = image;
        process.stdout.write(`[${i+1}/${BOOK_CATALOG.length}] ${book.catalog_id} cover candidate (score ${candidate.score})\n`);
        break;
      }
    } catch {}
  }
}
await Promise.all(Array.from({length:CONCURRENCY}, worker));

const bySource = new Map();
for (const [id, item] of Object.entries(discovered)) {
  const key = item.source_url.replace(/\?.*$/, '');
  const ids = bySource.get(key) || [];
  ids.push(id); bySource.set(key, ids);
}

const map = {};
for (const [id, item] of Object.entries(discovered)) {
  const key = item.source_url.replace(/\?.*$/, '');
  if ((bySource.get(key) || []).length >= 3) continue; // repeated theme/logo image, not a book-specific cover
  const ext = extFor(item.type, item.source_url);
  const name = `${id}.${ext}`;
  await writeFile(new URL(name, OUT), item.bytes);
  map[id] = { path: `/covers/${name}`, source_url: item.source_url };
}

await writeFile(new URL('../public/cover-map.json', import.meta.url), JSON.stringify({generated_at:new Date().toISOString(),covers:map}, null, 2)+'\n');
console.log(`Saved ${Object.keys(map).length} unique official cover images.`);

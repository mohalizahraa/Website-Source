import { mkdir, rm, writeFile } from 'node:fs/promises';
import { BOOK_CATALOG } from '../functions/_catalog.js';

const OUT = new URL('../public/covers/', import.meta.url);
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;

await mkdir(OUT, { recursive: true });

function htmlDecode(value='') {
  return value.replaceAll('&amp;', '&').replaceAll('&#038;', '&').replaceAll('&quot;', '"');
}

function firstImage(html, base) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      try { return new URL(htmlDecode(match[1]), base).href; } catch {}
    }
  }
  return null;
}

function extFor(type, url) {
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  const m = url.match(/\.([a-z0-9]{3,4})(?:\?|$)/i);
  return ['jpg','jpeg','png','webp','gif'].includes(m?.[1]?.toLowerCase()) ? m[1].toLowerCase().replace('jpeg','jpg') : 'jpg';
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
      const imageUrl = firstImage(html, page.url || book.detail_url);
      if (!imageUrl) continue;
      const image = await fetch(imageUrl, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 Haydari-Workbench-Cover-Archive/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const type = (image.headers.get('content-type') || '').toLowerCase();
      if (!image.ok || !type.startsWith('image/')) continue;
      const bytes = new Uint8Array(await image.arrayBuffer());
      if (bytes.length < 3000 || bytes.length > 8_000_000) continue;
      discovered[book.catalog_id] = { source_url: image.url || imageUrl, type, bytes };
      process.stdout.write(`[${i+1}/${BOOK_CATALOG.length}] ${book.catalog_id} cover candidate\n`);
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

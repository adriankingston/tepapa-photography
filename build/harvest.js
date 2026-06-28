// build/harvest.js — collect every openly-licensed photography record's metadata.
//
// The Te Papa API caps deep paging (`from`) at ~50k, so we can't page straight
// through 54k. Instead we recursively partition the numeric `id` space into
// ranges small enough to enumerate within the window (id range queries + sort are
// both supported), guaranteeing full coverage regardless of sort semantics.
//
// Output:
//   build/records.json        working file (full text + image URLs) — gitignored
//   ../public/data/index.json lean, committed index aligned 1:1 with the embeddings
//
// Run:  node build/harvest.js     (needs TEPAPA_API_KEY in ../.env)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// --- env ---
const envTxt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const KEY = (envTxt.match(/^\s*TEPAPA_API_KEY\s*=\s*(.*)$/m) || [])[1].trim().replace(/^["']|["']$/g, '');
if (!KEY) { console.error('No TEPAPA_API_KEY in ../.env'); process.exit(1); }

const BASE = 'collection:"Photography" AND hasRepresentation.rights.allowsDownload:true';
const SAFE = 9000;          // enumerate a range only when its count is this small
const ID_MAX = 20_000_000;  // upper bound on record ids (samples seen up to ~2M)

// --- cultural sensitivity (mirror the site) ---
const SENSITIVE = ['mummif','mummy','mummies','sarcophag','mokomokai','toi moko','kōiwi','koiwi','tūpāpaku','tupapaku','human remains','human skull','human skeleton','human bone','human hair','human teeth','human skin','shrunken head','preserved head','dried head','trophy head','severed head','post-mortem','postmortem','post mortem','deathbed','death bed','tangihanga'];
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
function isSensitive(rec) {
  const materials = [rec.isMadeOfSummary, ...arr(rec.isMadeOf).map((c) => c && c.title)].filter(Boolean).join(' ').toLowerCase();
  if (materials.includes('human')) return true;
  const text = [rec.title, rec.caption, ...arr(rec.isTypeOf).map((c) => c && c.title)].filter(Boolean).join(' · ').toLowerCase();
  return SENSITIVE.some((t) => text.includes(t));
}

// --- API ---
async function search(body, tries = 8) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch('https://data.tepapa.govt.nz/collection/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json;profile=full', 'x-api-key': KEY },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (attempt >= tries) throw e;
      const wait = Math.min(800 * 2 ** attempt, 12000) + Math.random() * 600;
      await new Promise((res) => setTimeout(res, wait));
    }
  }
}
const rangeQuery = (lo, hi) => `(${BASE}) AND id:[${lo} TO ${hi}]`;
async function countOf(lo, hi) {
  const j = await search({ query: rangeQuery(lo, hi), size: 0, filters: [{ field: 'type', keyword: 'Object' }] });
  return (j._metadata && j._metadata.resultset && j._metadata.resultset.count) || 0;
}

// --- record → our shape ---
function pickImage(rec) {
  const imgs = arr(rec.hasRepresentation).filter((r) => r && r.type === 'ImageObject' && r.thumbnailUrl);
  return imgs.find((r) => r.rights && r.rights.allowsDownload === true) || null;
}
const firstProd = (rec, key) => { for (const p of arr(rec.production)) if (p && p[key]) return p[key]; return null; };
function toRecord(rec) {
  if (isSensitive(rec)) return null;
  const img = pickImage(rec);
  if (!img) return null;
  const mid = (String(img.thumbnailUrl).match(/\/collection\/(\d+)\//) || [])[1];
  if (!mid) return null;
  const maker = (firstProd(rec, 'contributor') || {}).title || '';
  const date = firstProd(rec, 'displayDate') || firstProd(rec, 'date') || '';
  const place = (firstProd(rec, 'spatial') || {}).title || '';
  const category = arr(rec.isTypeOf).map((c) => c && c.title).filter(Boolean);
  const title = rec.title || '(untitled)';
  const caption = rec.caption || '';
  // What the embedding sees — concise, most salient first.
  const text = [title, maker, date, place, category.join(', '), caption].filter(Boolean).join('. ');
  return {
    id: rec.id, t: title, m: maker, d: date, p: place, c: category,
    mid: Number(mid), w: img.width || 0, h: img.height || 0,
    r: (img.rights && img.rights.title) || '',
    text,
  };
}

// --- recursive harvest over the id space ---
const out = [];
const seen = new Set();
let apiCalls = 0;
function keep(rec) {
  if (seen.has(rec.id)) return;
  const m = toRecord(rec);
  if (!m) { seen.add(rec.id); return; }   // mark seen even if skipped (sensitive/no-image)
  seen.add(rec.id);
  out.push(m);
}
async function enumerate(lo, hi) {
  const split = async () => { const mid = Math.floor((lo + hi) / 2); await enumerate(lo, mid); await enumerate(mid + 1, hi); };
  let total;
  try { total = await countOf(lo, hi); apiCalls++; }
  catch (e) { if (hi > lo) await split(); return; }
  if (total === 0) return;
  if (total > SAFE && hi > lo) { await split(); return; }
  for (let from = 0; from < total; from += 1000) {
    let results;
    try {
      const j = await search({ query: rangeQuery(lo, hi), size: 1000, from, sort: [{ field: 'id', order: 'asc' }], filters: [{ field: 'type', keyword: 'Object' }] });
      results = j.results || [];
    } catch (e) {
      // A page in this range persistently failed — recover the leftover by
      // subdividing (smaller ranges page from 0, dodging the bad offset). seen
      // dedupes the records we already have. Give up only on a single id.
      if (hi > lo) { console.warn(`\n  ! page ${lo}-${hi}@${from} ${e.message} — subdividing`); await split(); }
      return;
    }
    apiCalls++;
    for (const rec of results) keep(rec);
    process.stdout.write(`\r  harvested ${out.length} records · seen ${seen.size} · ${apiCalls} api calls   `);
    if (results.length < 1000) break;
  }
}

(async () => {
  const t0 = Date.now();
  const grand = await countOf(0, ID_MAX);
  console.log(`Openly-licensed photography Objects: ${grand}`);
  await enumerate(0, ID_MAX);
  console.log(`\nDone: ${out.length} kept of ${seen.size} seen (${grand} reported) in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${apiCalls} api calls`);

  // stable order by id so embeddings/index/clip all align
  out.sort((a, b) => a.id - b.id);

  fs.writeFileSync(path.join(__dirname, 'records.json'), JSON.stringify(out));
  // lean committed index (drop the heavy `text`; keep what a UI needs)
  const lean = out.map(({ text, ...rest }) => rest);
  const dataDir = path.join(ROOT, 'public', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(lean));
  console.log(`Wrote build/records.json and public/data/index.json (${lean.length} records)`);
})();

// build/harvest.js — collect every openly-licensed photography record's metadata.
//
// The Te Papa API caps deep paging (`from`) at ~50k, so we can't page straight
// through 54k. Instead we recursively partition the numeric `id` space into
// ranges small enough to enumerate within the window (id range queries + sort
// are both supported — see lib.js), guaranteeing full coverage regardless of
// sort semantics.
//
// Year taken (`y`) and quality score (`q`) are captured here too — they're in
// the same response — so no second enumeration pass is ever needed for them.
//
// Output:
//   build/records.json        working file (full text + image URLs) — gitignored
//   ../public/data/index.json lean, committed index aligned 1:1 with the embeddings
//   build/set-stamp.json      the record-set stamp every derived artifact must match
//
// A re-harvest changes the record set, so EVERYTHING downstream must be
// regenerated: download-thumbs, embed-* (fresh, not resumed), score-tags,
// build-tags, build-shards. The stamp makes the stale ones refuse to run.
//
// Run:  node build/harvest.js     (needs TEPAPA_API_KEY in ../.env)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, arr, loadKey, grandTotal, enumerate, yearOf, qualityOf, writeStamp } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY = loadKey();

// --- cultural sensitivity (mirror the site) ---
const SENSITIVE = ['mummif','mummy','mummies','sarcophag','mokomokai','toi moko','kōiwi','koiwi','tūpāpaku','tupapaku','human remains','human skull','human skeleton','human bone','human hair','human teeth','human skin','shrunken head','preserved head','dried head','trophy head','severed head','post-mortem','postmortem','post mortem','deathbed','death bed','tangihanga'];
function isSensitive(rec) {
  const materials = [rec.isMadeOfSummary, ...arr(rec.isMadeOf).map((c) => c && c.title)].filter(Boolean).join(' ').toLowerCase();
  if (materials.includes('human')) return true;
  const text = [rec.title, rec.caption, ...arr(rec.isTypeOf).map((c) => c && c.title)].filter(Boolean).join(' · ').toLowerCase();
  return SENSITIVE.some((t) => text.includes(t));
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
  const place = (firstProd(rec, 'spatial') || {}).title || '';
  const category = arr(rec.isTypeOf).map((c) => c && c.title).filter(Boolean);
  const title = rec.title || '(untitled)';
  const caption = rec.caption || '';
  const y = yearOf(rec);
  const date = y ? String(y) : '';
  // What the embedding sees — concise, most salient first.
  const text = [title, maker, date, place, category.join(', '), caption].filter(Boolean).join('. ');
  return {
    id: rec.id, t: title, m: maker, d: date, p: place, c: category,
    mid: Number(mid), w: img.width || 0, h: img.height || 0,
    r: (img.rights && img.rights.title) || '',
    y: y || 0, q: Math.round(qualityOf(rec) * 100) / 100,
    text,
  };
}

// --- recursive harvest over the id space ---
const out = [];
const seen = new Set();
function keep(rec) {
  if (seen.has(rec.id)) return;
  const m = toRecord(rec);
  seen.add(rec.id);   // mark seen even if skipped (sensitive/no-image)
  if (m) out.push(m);
}

const t0 = Date.now();
const grand = await grandTotal(KEY);
console.log(`Openly-licensed photography Objects: ${grand}`);
const apiCalls = await enumerate(KEY, (results, calls) => {
  for (const rec of results) keep(rec);
  process.stdout.write(`\r  harvested ${out.length} records · seen ${seen.size} · ${calls} api calls   `);
});
console.log(`\nDone: ${out.length} kept of ${seen.size} seen (${grand} reported) in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${apiCalls} api calls`);

// stable order by id so embeddings/index/shards all align
out.sort((a, b) => a.id - b.id);

fs.writeFileSync(path.join(__dirname, 'records.json'), JSON.stringify(out));
// lean committed index (drop the heavy `text`; keep what a UI needs)
const lean = out.map(({ text, ...rest }) => rest);
const dataDir = path.join(ROOT, 'public', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(lean));
const stamp = writeStamp(out.map((r) => r.id));
console.log(`Wrote build/records.json and public/data/index.json (${lean.length} records, stamp ${stamp.stamp})`);
console.log('Next: download-thumbs → embed-clip/embed-text/embed-siglip2 (fresh) → score-tags → build-tags → build-shards');

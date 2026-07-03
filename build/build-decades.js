// build/build-decades.js — capture the year each photograph was taken and bucket
// it into decades, for the decade selector.
//
// The date lives in production[].facetCreatedDate.year (with createdDate /
// verbatimCreatedDate as fallbacks) — it was never captured in the original
// harvest (the old code read the non-existent displayDate/date fields). Since
// the decade can't be queried server-side (nested production.* fields return 0,
// like isTypeOf), the selector filters a baked list client-side instead.
//
// This re-fetches year + _meta.qualityScore for every record via the same
// id-range enumeration as harvest.js, then:
//   • patches public/data/index.json in place — adds `y` (year int) and `q`
//     (quality score) per record, and fills `d` (year string) which was empty.
//     Order/count are unchanged, so the embeddings stay aligned.
//   • writes public/data/decades-index.json — [{key,label,count}] per decade,
//     loaded on page load to build the selector.
//
// Run:  node build/build-decades.js     (needs TEPAPA_API_KEY in ../.env)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');

const envTxt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const KEY = (envTxt.match(/^\s*TEPAPA_API_KEY\s*=\s*(.*)$/m) || [])[1].trim().replace(/^["']|["']$/g, '');
if (!KEY) { console.error('No TEPAPA_API_KEY in ../.env'); process.exit(1); }

const BASE = 'collection:"Photography" AND hasRepresentation.rights.allowsDownload:true';
const SAFE = 9000, ID_MAX = 20_000_000;
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

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
      await new Promise((res) => setTimeout(res, Math.min(800 * 2 ** attempt, 12000) + Math.random() * 600));
    }
  }
}
const rangeQuery = (lo, hi) => `(${BASE}) AND id:[${lo} TO ${hi}]`;
const F = [{ field: 'type', keyword: 'Object' }];
async function countOf(lo, hi) {
  const j = await search({ query: rangeQuery(lo, hi), size: 0, filters: F });
  return (j._metadata && j._metadata.resultset && j._metadata.resultset.count) || 0;
}

// year from a record's production dates (prefer the structured facet)
function yearOf(rec) {
  for (const p of arr(rec.production)) {
    const f = p && p.facetCreatedDate;
    if (f) { const y = parseInt(f.year || f.temporal, 10); if (y >= 1800 && y <= 2035) return y; }
  }
  for (const p of arr(rec.production)) {
    const c = p && (p.createdDate || p.verbatimCreatedDate);
    if (c) { const m = String(c).match(/\b(1[89]\d\d|20[0-3]\d)\b/); if (m) return parseInt(m[1], 10); }
  }
  return null;
}
const qualityOf = (rec) => (rec._meta && typeof rec._meta.qualityScore === 'number') ? rec._meta.qualityScore : 0;

const info = new Map();   // id → { y, q }
let apiCalls = 0;

async function enumerate(lo, hi) {
  const split = async () => { const mid = Math.floor((lo + hi) / 2); await enumerate(lo, mid); await enumerate(mid + 1, hi); };
  let total;
  try { total = await countOf(lo, hi); apiCalls++; } catch (e) { if (hi > lo) await split(); return; }
  if (total === 0) return;
  if (total > SAFE && hi > lo) { await split(); return; }
  for (let from = 0; from < total; from += 1000) {
    let results;
    try {
      const j = await search({ query: rangeQuery(lo, hi), size: 1000, from, sort: [{ field: 'id', order: 'asc' }], filters: F });
      results = j.results || [];
    } catch (e) { if (hi > lo) await split(); return; }
    apiCalls++;
    for (const rec of results) if (!info.has(rec.id)) info.set(rec.id, { y: yearOf(rec), q: qualityOf(rec) });
    process.stdout.write(`\r  seen ${info.size} records · ${apiCalls} api calls   `);
    if (results.length < 1000) break;
  }
}

const decadeOf = (y) => (y == null ? null : `${Math.floor(y / 10) * 10}s`);

(async () => {
  const t0 = Date.now();
  const grand = await countOf(0, ID_MAX);
  console.log(`Re-fetching year + quality for ${grand} records…`);
  await enumerate(0, ID_MAX);
  console.log(`\nGathered ${info.size} records in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${apiCalls} api calls`);

  // patch index.json (order/count preserved)
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
  let dated = 0;
  for (const e of index) {
    const rec = info.get(e.id);
    const y = rec ? rec.y : null;
    e.y = y || 0;
    e.q = rec ? Math.round((rec.q || 0) * 100) / 100 : 0;
    e.d = y ? String(y) : '';
    if (y) dated++;
  }
  fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify(index));

  // decade buckets over the dated records. Show only decades within the
  // photographic era (1840s+) with a real presence (≥25) — this drops a handful
  // of pre-photography misparses ("1800s") and the near-empty in-copyright tail
  // (1990s–2020s), which would otherwise clutter the selector.
  const MIN_YEAR = 1840, MIN_COUNT = 25;
  const buckets = new Map();
  for (const e of index) { const d = decadeOf(e.y || null); if (!d) continue; buckets.set(d, (buckets.get(d) || 0) + 1); }
  const decades = [...buckets.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .filter((d) => parseInt(d.key) >= MIN_YEAR && d.count >= MIN_COUNT)
    .sort((a, b) => parseInt(a.key) - parseInt(b.key));
  fs.writeFileSync(path.join(DATA, 'decades-index.json'), JSON.stringify({
    source: 'Year taken, from production.facetCreatedDate', decades,
  }));

  console.log(`\nDated: ${dated}/${index.length} (${(dated / index.length * 100).toFixed(1)}%)`);
  decades.forEach((d) => console.log(`  ${String(d.count).padStart(5)}  ${d.label}`));
  const kb = Math.round(fs.statSync(path.join(DATA, 'index.json')).size / 1024);
  console.log(`\nPatched index.json (${kb} KB, +y/+q/+d) and wrote decades-index.json (${decades.length} decades)`);
})();

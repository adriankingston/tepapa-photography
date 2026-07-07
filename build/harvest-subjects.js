// build/harvest-subjects.js — fetch the catalogued SUBJECTS (depicts) and
// references (refersTo) for every record. The depicts Category terms seed the
// image-tag candidate pool (build-tag-candidates.js): they're the museum's own
// vocabulary for this collection, so tagging images with them lets
// thin-catalogued records inherit the same terms search already speaks.
// (Genre/format is already in index.json `c`.)
//
// Same id-range enumeration as build-decades.js. depicts/refersTo entries are
// { type: Category|Person|Place|Organisation, title }. We keep title + a 1-char
// type tag; only Category titles feed the candidate pool (topical subjects) —
// Person/Place/Organisation are named entities, kept for the record.
//
//   out: build/subjects.json  { "<id>": { d:[[type,title]…], r:[[type,title]…] } }   (gitignored)
//
// Run:  node build/harvest-subjects.js     (needs TEPAPA_API_KEY in ../.env)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const KEY = ((fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^\s*TEPAPA_API_KEY\s*=\s*(.*)$/m) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
if (!KEY) { console.error('No TEPAPA_API_KEY in ../.env'); process.exit(1); }

const BASE = 'collection:"Photography" AND hasRepresentation.rights.allowsDownload:true';
const SAFE = 9000, ID_MAX = 20_000_000;
const F = [{ field: 'type', keyword: 'Object' }];
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const TYPE = { Category: 'c', Person: 'p', Place: 'l', Organisation: 'o' };

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
async function countOf(lo, hi) {
  const j = await search({ query: rangeQuery(lo, hi), size: 0, filters: F });
  return (j._metadata && j._metadata.resultset && j._metadata.resultset.count) || 0;
}
const pick = (list) => arr(list).map((x) => x && [TYPE[x.type] || '?', x.title]).filter((x) => x && x[1]);

const out = {};
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
    for (const rec of results) {
      if (out[rec.id]) continue;
      const d = pick(rec.depicts), r = pick(rec.refersTo);
      out[rec.id] = { d, r };
    }
    process.stdout.write(`\r  ${Object.keys(out).length} records · ${apiCalls} api calls   `);
    if (results.length < 1000) break;
  }
}

(async () => {
  const t0 = Date.now();
  const grand = await countOf(0, ID_MAX);
  console.log(`Harvesting subjects for ${grand} records…`);
  await enumerate(0, ID_MAX);
  const n = Object.keys(out).length;
  const withD = Object.values(out).filter((x) => x.d.length).length;
  console.log(`\nGathered ${n} records in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${apiCalls} api calls`);
  console.log(`  with ≥1 depicts subject: ${withD} (${(withD / n * 100).toFixed(1)}%)`);
  fs.writeFileSync(path.join(__dirname, 'subjects.json'), JSON.stringify(out));
  console.log(`Wrote build/subjects.json (${Math.round(fs.statSync(path.join(__dirname, 'subjects.json')).size / 1024 / 1024 * 10) / 10} MB)`);
})();

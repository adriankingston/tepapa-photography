// build/lib.js — shared helpers for the offline pipeline scripts.
//
// Two halves:
//   • Te Papa API access — .env key loading, search-with-retry, and the
//     id-range enumeration that dodges the API's ~50k deep-paging cap
//     (recursively partition the numeric id space until each range is small
//     enough to page in full).
//   • pure data helpers — year/decade/quality extraction, the record-set
//     stamp that keeps every derived artifact provably aligned to one
//     harvest, and the shard builders behind public/data/decade/ and /tag/.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
export const DATA = path.join(ROOT, 'public', 'data');

export const BASE = 'collection:"Photography" AND hasRepresentation.rights.allowsDownload:true';
export const OBJECT_FILTER = [{ field: 'type', keyword: 'Object' }];
export const SAFE = 9000;          // enumerate a range only when its count is this small
export const ID_MAX = 20_000_000;  // upper bound on record ids (samples seen up to ~2M)

export const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/* ---- .env / API ---------------------------------------------------------- */
export function loadKey() {
  let txt = '';
  try { txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch { /* no .env */ }
  const key = ((txt.match(/^\s*TEPAPA_API_KEY\s*=\s*(.*)$/m) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
  if (!key) { console.error('No TEPAPA_API_KEY in ../.env'); process.exit(1); }
  return key;
}

export async function search(key, body, tries = 8) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch('https://data.tepapa.govt.nz/collection/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json;profile=full', 'x-api-key': key },
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

// Total matching records (the pre-enumeration headline count).
export async function grandTotal(key, { base = BASE, filters = OBJECT_FILTER } = {}) {
  const j = await search(key, { query: `(${base}) AND id:[0 TO ${ID_MAX}]`, size: 0, filters });
  return (j._metadata && j._metadata.resultset && j._metadata.resultset.count) || 0;
}

// Walk the entire id space, calling onRecords(results, apiCalls) once per
// fetched page. Callers must dedupe by id — a failed page is recovered by
// subdividing its range, which can re-deliver records already seen.
// Returns the total api call count.
export async function enumerate(key, onRecords, { base = BASE, filters = OBJECT_FILTER } = {}) {
  const rangeQuery = (lo, hi) => `(${base}) AND id:[${lo} TO ${hi}]`;
  let apiCalls = 0;
  async function walk(lo, hi) {
    const split = async () => { const mid = Math.floor((lo + hi) / 2); await walk(lo, mid); await walk(mid + 1, hi); };
    let total;
    try {
      const j = await search(key, { query: rangeQuery(lo, hi), size: 0, filters });
      apiCalls++;
      total = (j._metadata && j._metadata.resultset && j._metadata.resultset.count) || 0;
    } catch { if (hi > lo) await split(); return; }
    if (total === 0) return;
    if (total > SAFE && hi > lo) { await split(); return; }
    for (let from = 0; from < total; from += 1000) {
      let results;
      try {
        const j = await search(key, { query: rangeQuery(lo, hi), size: 1000, from, sort: [{ field: 'id', order: 'asc' }], filters });
        results = j.results || [];
      } catch (e) {
        // A page in this range persistently failed — recover the leftover by
        // subdividing (smaller ranges page from 0, dodging the bad offset).
        // Give up only on a single id.
        if (hi > lo) { console.warn(`\n  ! page ${lo}-${hi}@${from} ${e.message} — subdividing`); await split(); }
        return;
      }
      apiCalls++;
      onRecords(results, apiCalls);
      if (results.length < 1000) break;
    }
  }
  await walk(0, ID_MAX);
  return apiCalls;
}

/* ---- record field extraction --------------------------------------------- */
// Year a photo was taken, from production dates (prefer the structured facet).
// Mirrors yearOfRec in public/app.js — keep the two in step.
export function yearOf(rec) {
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
export const qualityOf = (rec) => ((rec._meta && typeof rec._meta.qualityScore === 'number') ? rec._meta.qualityScore : 0);
export const decadeOf = (y) => (y ? `${Math.floor(y / 10) * 10}s` : null);
export const isAlbumEntry = (e) => arr(e.c).some((c) => /photograph album/i.test(c));

/* ---- record-set stamp ----------------------------------------------------- */
// The pipeline's alignment invariant: every derived artifact (embedding
// matrices, score files, shards) is row-aligned to ONE harvested record set.
// The stamp is a hash of the ordered id list; harvest.js writes it to
// build/set-stamp.json (committed) and every consumer verifies its inputs
// carry the same stamp before doing anything expensive or silently wrong.
const STAMP_PATH = path.join(__dirname, 'set-stamp.json');
export const stampOf = (ids) => crypto.createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 16);
export function writeStamp(ids) {
  const stamp = { stamp: stampOf(ids), count: ids.length, generatedAt: new Date().toISOString() };
  fs.writeFileSync(STAMP_PATH, JSON.stringify(stamp, null, 2) + '\n');
  return stamp;
}
export function readStamp() {
  try { return JSON.parse(fs.readFileSync(STAMP_PATH, 'utf8')); } catch { return null; }
}
// Throws when `ids` doesn't match the stamped harvest; warns (and passes) when
// no stamp exists yet — artifacts from a pre-stamp harvest are grandfathered.
export function checkStamp(ids, what) {
  const want = readStamp();
  if (!want) { console.warn(`  ! no build/set-stamp.json — cannot verify ${what} against the harvest`); return null; }
  const got = stampOf(ids);
  if (got !== want.stamp) {
    throw new Error(`${what} is out of step with the harvest (stamp ${got} ≠ ${want.stamp}; `
      + `${ids.length} vs ${want.count} records) — re-run the pipeline from the step that changed`);
  }
  return got;
}

/* ---- shards ---------------------------------------------------------------- */
// Group the lean index by decade taken, best quality first — one file per
// decade, so a decade browse downloads only its own slice (entries keep the
// exact index.json shape). Albums never render, so they're dropped here.
export function shardDecades(index) {
  const byDecade = new Map();
  for (const e of index) {
    const d = decadeOf(e.y);
    if (!d || isAlbumEntry(e)) continue;
    if (!byDecade.has(d)) byDecade.set(d, []);
    byDecade.get(d).push(e);
  }
  for (const list of byDecade.values()) list.sort((a, b) => (b.q || 0) - (a.q || 0));
  return byDecade;
}
// Per-tag photo metadata: just the index entries a tag's id list needs to
// render (the ordered ids themselves stay in the small, eagerly-loaded
// tags.json). A photo in several tags is duplicated across shards — fine,
// each individual fetch stays small.
export function shardTagPhotos(index, terms) {
  const byId = new Map(index.map((e) => [e.id, e]));
  const shards = new Map();
  for (const t of terms) {
    const photos = {};
    for (const id of t.ids) {
      const e = byId.get(id);
      if (!e || isAlbumEntry(e)) continue;
      photos[id] = e;
    }
    shards.set(t.key, { photos });
  }
  return shards;
}

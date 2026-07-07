// build/build-shards.js — split the committed index into per-decade and
// per-tag files so the client never downloads the whole ~13MB index.json.
//
// A decade browse fetches only /data/decade/<key>.json (that decade's index
// entries, best-quality-first); a tag browse fetches /data/tag/<key>.json
// (the photo metadata for that tag's ids — the ordered ids themselves ship in
// tags.json, which stays small and eagerly loaded for search + detail chips).
//
// decades-index.json (the counts behind the selector row) is derived here too,
// since the decade grouping is computed anyway. Counts exclude photograph
// albums — matching what a browse actually shows.
//
//   in:  public/data/index.json, public/data/tags.json
//   out: public/data/decade/<key>.json, public/data/tag/<key>.json,
//        public/data/decades-index.json
//
// Run after harvest.js (and after build-tags.js when verdicts change):
//   node build/build-shards.js

import fs from 'node:fs';
import path from 'node:path';
import { DATA, shardDecades, shardTagPhotos, checkStamp } from './lib.js';

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
checkStamp(index.map((e) => e.id), 'public/data/index.json');

const MIN_YEAR = 1840;   // photographic era — drops the handful of misparsed "1800s"
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// ---- decades ----------------------------------------------------------------
const decDir = path.join(DATA, 'decade');
fs.rmSync(decDir, { recursive: true, force: true });   // clear stale shards
fs.mkdirSync(decDir, { recursive: true });
const byDecade = shardDecades(index);
const keys = [...byDecade.keys()]
  .filter((k) => parseInt(k, 10) >= MIN_YEAR)
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
let decBytes = 0, biggest = ['', 0];
for (const k of keys) {
  const f = path.join(decDir, `${k}.json`);
  fs.writeFileSync(f, JSON.stringify(byDecade.get(k)));
  const size = fs.statSync(f).size;
  decBytes += size;
  if (size > biggest[1]) biggest = [k, size];
}
fs.writeFileSync(path.join(DATA, 'decades-index.json'), JSON.stringify({
  source: 'Year taken, from production.facetCreatedDate',
  decades: keys.map((k) => ({ key: k, label: k, count: byDecade.get(k).length })),
}));
console.log(`decade/: ${keys.length} files, ${mb(decBytes)} total (largest ${biggest[0]} at ${mb(biggest[1])})`);

// ---- tags ---------------------------------------------------------------------
const tagDir = path.join(DATA, 'tag');
fs.rmSync(tagDir, { recursive: true, force: true });
const tagsPath = path.join(DATA, 'tags.json');
if (fs.existsSync(tagsPath)) {
  fs.mkdirSync(tagDir, { recursive: true });
  const tags = JSON.parse(fs.readFileSync(tagsPath, 'utf8'));
  const shards = shardTagPhotos(index, tags.terms);
  let tagBytes = 0;
  for (const [key, shard] of shards) {
    const f = path.join(tagDir, `${key}.json`);
    fs.writeFileSync(f, JSON.stringify(shard));
    tagBytes += fs.statSync(f).size;
  }
  console.log(`tag/: ${shards.size} files, ${mb(tagBytes)} total`);
} else {
  console.log('tag/: skipped — no public/data/tags.json yet');
}

// build/enrich-identifiers.js — join the registration number (the API's
// `identifier`, e.g. "O.030278") onto the EXISTING harvest by id.
//
// Unlike a re-harvest this cannot change the record set: identifiers are
// matched onto the ids we already have, live ids we don't know are ignored,
// so the set stamp is untouched and no embedding or derived artifact is
// invalidated. (harvest.js now captures `n` directly; this script backfills
// the current harvest without forcing the full regeneration chain.)
//
// Patches in place (adds `n` per entry):
//   build/records.json
//   public/data/index.json
//   public/data/emotions.json      (photos map)
//   public/data/compositions.json  (photos map)
//
// Then run:  node build/build-shards.js   (decade + tag photo shards inherit
//            `n` from index.json)
//
// Run:  node build/enrich-identifiers.js   (needs TEPAPA_API_KEY in ../.env)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadKey, enumerate } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY = loadKey();

const regOf = new Map();
const t0 = Date.now();
const apiCalls = await enumerate(KEY, (results) => {
  for (const rec of results) {
    if (rec && rec.id != null && rec.identifier) regOf.set(rec.id, String(rec.identifier));
  }
  process.stdout.write(`\r  collected ${regOf.size} identifiers   `);
});
console.log(`\n${regOf.size} identifiers in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${apiCalls} api calls`);

function patchList(file) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hit = 0, miss = 0;
  const out = list.map((e) => {
    const n = regOf.get(e.id);
    if (n) { hit++; return { ...e, n }; }
    miss++;
    return e;
  });
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`${path.relative(ROOT, file)}: ${hit} stamped, ${miss} without (drifted out of the live set)`);
}

function patchPhotos(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hit = 0;
  for (const [id, e] of Object.entries(d.photos || {})) {
    const n = regOf.get(Number(id));
    if (n) { e.n = n; hit++; }
  }
  fs.writeFileSync(file, JSON.stringify(d));
  console.log(`${path.relative(ROOT, file)}: ${hit} photos stamped`);
}

const recordsPath = path.join(__dirname, 'records.json');
if (fs.existsSync(recordsPath)) patchList(recordsPath);
patchList(path.join(ROOT, 'public', 'data', 'index.json'));
patchPhotos(path.join(ROOT, 'public', 'data', 'emotions.json'));
patchPhotos(path.join(ROOT, 'public', 'data', 'compositions.json'));
console.log('Next: node build/build-shards.js');

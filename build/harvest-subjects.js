// build/harvest-subjects.js — fetch the catalogued SUBJECTS (depicts) and
// references (refersTo) for every record. The depicts Category terms seed the
// image-tag candidate pool (build-tag-candidates.js): they're the museum's own
// vocabulary for this collection, so tagging images with them lets
// thin-catalogued records inherit the same terms search already speaks.
// (Genre/format is already in index.json `c`.)
//
// Same id-range enumeration as harvest.js (see lib.js). depicts/refersTo
// entries are { type: Category|Person|Place|Organisation, title }. We keep
// title + a 1-char type tag; only Category titles feed the candidate pool
// (topical subjects) — Person/Place/Organisation are named entities, kept for
// the record.
//
//   out: build/subjects.json  { "<id>": { d:[[type,title]…], r:[[type,title]…] } }   (gitignored)
//
// Run:  node build/harvest-subjects.js     (needs TEPAPA_API_KEY in ../.env)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arr, loadKey, grandTotal, enumerate } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY = loadKey();

const TYPE = { Category: 'c', Person: 'p', Place: 'l', Organisation: 'o' };
const pick = (list) => arr(list).map((x) => x && [TYPE[x.type] || '?', x.title]).filter((x) => x && x[1]);

const out = {};
const t0 = Date.now();
const grand = await grandTotal(KEY);
console.log(`Harvesting subjects for ${grand} records…`);
const apiCalls = await enumerate(KEY, (results, calls) => {
  for (const rec of results) {
    if (out[rec.id]) continue;
    out[rec.id] = { d: pick(rec.depicts), r: pick(rec.refersTo) };
  }
  process.stdout.write(`\r  ${Object.keys(out).length} records · ${calls} api calls   `);
});

const n = Object.keys(out).length;
const withD = Object.values(out).filter((x) => x.d.length).length;
console.log(`\nGathered ${n} records in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${apiCalls} api calls`);
console.log(`  with ≥1 depicts subject: ${withD} (${(withD / n * 100).toFixed(1)}%)`);
fs.writeFileSync(path.join(__dirname, 'subjects.json'), JSON.stringify(out));
console.log(`Wrote build/subjects.json (${Math.round(fs.statSync(path.join(__dirname, 'subjects.json')).size / 1024 / 1024 * 10) / 10} MB)`);

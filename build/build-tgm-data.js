// build/build-tgm-data.js — assemble the TGM classification from the crosswalk.
//
// Per record: crosswalk its genre/format (index.json `c`) and its catalogued
// subjects (build/subjects.json depicts Categories) onto TGM. Then:
//   • patch public/data/index.json — add `tg` (numeric TGM ids the record is
//     catalogued with). Order/count unchanged, embeddings stay aligned.
//   • write public/data/tgm-index.json — the terms that actually occur, with
//     counts, kind (genre/subject/both) and broader/narrower ids for browsing.
//   • write public/data/tgm-crosswalk.json — raw Te Papa term → {tgm id,label}
//     for the detail view (client shows the TGM equivalents of a record's terms).
//
// Run (after harvest-subjects.js):  node build/build-tgm-data.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchTGM } from './crosswalk-tgm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data');
const TERMS = JSON.parse(fs.readFileSync(path.join(__dirname, 'tgm-terms.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const subjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'subjects.json'), 'utf8'));

const num = (id) => parseInt(id.replace(/\D/g, ''), 10);   // "tgm001234" → 1234
const pad = (n) => 'tgm' + String(n).padStart(6, '0');

// cache the crosswalk of each distinct raw string
const xcache = new Map();
const xwalk = (s) => { if (!xcache.has(s)) xcache.set(s, matchTGM(s)); return xcache.get(s); };

const crosswalk = {};                 // raw TP term → { id:num, label }
const count = new Map();               // tgm num → catalogued record count
const sug = new Map();                 // tgm num → suggested-only record count
const kind = new Map();                // tgm num → { g:bool, s:bool }
const markKind = (n, k) => { const e = kind.get(n) || { g: false, s: false }; e[k] = true; kind.set(n, e); };

let recWithGenre = 0, recWithSubject = 0, subjCatSeen = 0, subjCatMapped = 0;

for (const e of index) {
  const ids = new Set();
  // genre / format
  for (const t of (e.c || [])) {
    const m = xwalk(t);
    if (m) { crosswalk[t] = { id: num(m.id), label: m.label }; ids.add(num(m.id)); markKind(num(m.id), 'g'); }
  }
  if ((e.c || []).some((t) => xwalk(t))) recWithGenre++;
  // subjects (depicts Categories only — c-type; Person/Place/Org are named entities)
  const subj = subjects[e.id];
  let hadSubj = false;
  if (subj) for (const [type, title] of (subj.d || [])) {
    if (type !== 'c') continue;
    subjCatSeen++;
    const m = xwalk(title);
    if (m) { subjCatMapped++; crosswalk[title] = { id: num(m.id), label: m.label }; ids.add(num(m.id)); markKind(num(m.id), 's'); hadSubj = true; }
  }
  if (hadSubj) recWithSubject++;
  for (const n of ids) count.set(n, (count.get(n) || 0) + 1);
  e.tg = [...ids].sort((a, b) => a - b);
  // preserve any CLIP-suggested tags (embed-tgm.js); count them per term
  for (const n of (e.tgc || [])) { sug.set(n, (sug.get(n) || 0) + 1); markKind(n, 's'); }
}

// browse index: every term that occurs (catalogued or suggested), with hierarchy
const usedIds = new Set([...count.keys(), ...sug.keys()]);
const terms = [...usedIds].map((n) => {
  const t = TERMS[pad(n)] || {};
  const k = kind.get(n) || {};
  const term = {
    id: n, label: t.label || pad(n), count: count.get(n) || 0, sug: sug.get(n) || 0,
    kind: k.g && k.s ? 'b' : k.g ? 'g' : 's',
    bt: (t.bt || []).map(num),
  };
  if (t.scope && t.scope !== 'Main Term') term.scope = t.scope;
  return term;
}).sort((a, b) => (b.count + b.sug) - (a.count + a.sug));

fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(DATA, 'tgm-index.json'), JSON.stringify({
  source: 'Library of Congress Thesaurus for Graphic Materials (TGM), via crosswalk of Te Papa cataloguing',
  terms,
}));
fs.writeFileSync(path.join(DATA, 'tgm-crosswalk.json'), JSON.stringify(crosswalk));
// per-record CLIP-suggested tags (from the image, not the catalogue) for the
// detail view — small, so it needn't ship the whole index.
const suggested = {};
for (const e of index) if (e.tgc && e.tgc.length) suggested[e.id] = e.tgc;
fs.writeFileSync(path.join(DATA, 'tgm-suggested.json'), JSON.stringify(suggested));

const N = index.length;
console.log(`Records: ${N}`);
console.log(`  ≥1 TGM genre:   ${recWithGenre} (${(recWithGenre / N * 100).toFixed(1)}%)`);
console.log(`  ≥1 TGM subject: ${recWithSubject} (${(recWithSubject / N * 100).toFixed(1)}%)`);
console.log(`  any TGM term:   ${index.filter((e) => e.tg.length).length} (${(index.filter((e) => e.tg.length).length / N * 100).toFixed(1)}%)`);
console.log(`  distinct depicts Categories mapped: ${subjCatMapped}/${subjCatSeen} (${(subjCatMapped / subjCatSeen * 100).toFixed(1)}%)`);
console.log(`Distinct TGM terms used: ${terms.length}  (genre-only ${terms.filter((t) => t.kind === 'g').length} · subject-only ${terms.filter((t) => t.kind === 's').length} · both ${terms.filter((t) => t.kind === 'b').length})`);
console.log(`\nTop 25 terms:`);
terms.slice(0, 25).forEach((t) => console.log(`  ${String(t.count).padStart(6)}  [${t.kind}] ${t.label}`));
console.log(`\nindex.json now ${Math.round(fs.statSync(path.join(DATA, 'index.json')).size / 1024 / 1024 * 10) / 10} MB · tgm-index ${Math.round(fs.statSync(path.join(DATA, 'tgm-index.json')).size / 1024)} KB · crosswalk ${Math.round(fs.statSync(path.join(DATA, 'tgm-crosswalk.json')).size / 1024)} KB`);

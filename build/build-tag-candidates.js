// build/build-tag-candidates.js — assemble the candidate tag pool to score.
//
// Three sources, deduped:
//   • the hand vocabulary (build/tag-vocab.js — curated, grouped, prompt-tuned)
//   • its agent-drafted expansion (build/tag-vocab-expansion.json — same
//     schema, generated group-by-group then deduped/quality-scanned)
//   • Te Papa's own catalogued subject terms (build/subjects.json depicts
//     Categories), frequency-filtered. These are human-applied museum terms for
//     THIS collection; scoring them against images lets the thin-catalogued
//     records inherit the same vocabulary the rest of the collection uses.
//
// The pool is deliberately over-broad — the calibration sheet decides what
// ships. Vocabulary size is an OUTPUT of measurement, not an input guess.
//
//   out: build/tag-candidates.json  [{ key, label, prompt, group, src, n? }]
//
// Run (after harvest-subjects.js):  node build/build-tag-candidates.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOCAB, GROUPS } from './tag-vocab.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIN_COUNT = Number(process.env.MIN_COUNT || 15);

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// crude singular/plural fold so "Sheep farms"/"sheep farm" collide
const fold = (s) => norm(s).split(' ').map((w) => w.replace(/(?:es|s)$/, '')).join(' ');

const expansion = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-vocab-expansion.json'), 'utf8'));
const out = [];
const seen = new Map();   // folded label → candidate (for dedupe)
for (const t of [...VOCAB, ...expansion]) {
  const c = { ...t, src: 'hand' };
  out.push(c);
  seen.set(fold(t.label), c);
  seen.set(fold(t.prompt), c);
}

// ---- Te Papa depicts Categories -------------------------------------------
const subjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'subjects.json'), 'utf8'));
const counts = new Map();
for (const id in subjects) {
  for (const [type, title] of (subjects[id].d || [])) {
    if (type !== 'c') continue;
    counts.set(title, (counts.get(title) || 0) + 1);
  }
}

// Not everything catalogued is depictable. Drop obvious non-visual buckets:
// formats/processes (the `c` genre field covers those), eras, meta-terms.
const NONVISUAL = /photograph|negative|print|postcard|album|portrait|carte|cabinet|stereo|daguerreotype|slide|transparen|lantern|silver|collodion|studio|copy|proof|advertis|documentary|art$|history|heritage|centennial|jubilee|anniversar|colonial|victorian|edwardian|century|decade|war$|world war|new zealand|aotearoa/i;

let added = 0, dropped = 0, merged = 0;
const tepapa = [...counts.entries()]
  .filter(([, n]) => n >= MIN_COUNT)
  .sort((a, b) => b[1] - a[1]);
for (const [title, n] of tepapa) {
  if (NONVISUAL.test(title)) { dropped++; continue; }
  const f = fold(title);
  const hit = seen.get(f);
  if (hit) { hit.src = 'both'; hit.n = n; merged++; continue; }
  const key = 'tp-' + norm(title).replace(/ /g, '-');
  const c = { key, label: title, prompt: title.toLowerCase(), group: 'tepapa', src: 'tepapa', n };
  out.push(c);
  seen.set(f, c);
  added++;
}

fs.writeFileSync(path.join(__dirname, 'tag-candidates.json'), JSON.stringify(out, null, 1));
console.log(`Hand vocabulary: ${VOCAB.length} core + ${expansion.length} expansion terms in ${Object.keys(GROUPS).length} groups`);
console.log(`Te Papa depicts Categories: ${counts.size} distinct · ${tepapa.length} with ≥${MIN_COUNT} uses`);
console.log(`  added ${added} · merged into hand terms ${merged} · dropped non-visual ${dropped}`);
console.log(`Candidate pool: ${out.length} terms → build/tag-candidates.json`);

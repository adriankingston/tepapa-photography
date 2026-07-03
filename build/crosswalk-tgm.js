// build/crosswalk-tgm.js — map Te Papa's catalogued vocabulary onto TGM.
//
// Te Papa already catalogues genre/format (isTypeOf) and subjects (depicts) with
// vocabulary that is ~90% TGM-aligned. We match those strings to TGM preferred
// terms (and Used-For variants) deterministically — normalisation + a small
// British→American spelling map + singular/plural — and fall back to a
// conservative trigram similarity for near-misses. Anything left is reported for
// review, not force-mapped (a wrong controlled term reads as a cataloguing error).
//
// This module exports the matcher; `node build/crosswalk-tgm.js` runs a genre
// self-test against the local index.
//
//   in: build/tgm-terms.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TERMS = JSON.parse(fs.readFileSync(path.join(__dirname, 'tgm-terms.json'), 'utf8'));

// British → American, and a few Te Papa idioms, applied on normalised tokens.
const SPELL = {
  colour: 'color', colours: 'colors', coloured: 'colored', 'hand-coloured': 'hand-colored',
  catalogue: 'catalog', grey: 'gray', aeroplane: 'airplane', aeroplanes: 'airplanes',
  harbour: 'harbor', harbours: 'harbors', theatre: 'theater', theatres: 'theaters',
  honour: 'honor', metre: 'meter', centre: 'center', jewellery: 'jewelry',
  moustache: 'mustache', plough: 'plow', artefact: 'artifact', artefacts: 'artifacts',
  aluminium: 'aluminum', tyre: 'tire', mould: 'mold', pyjamas: 'pajamas',
};
// Hand-verified aliases where Te Papa's label differs from TGM's canonical term
// (keys are NORMALISED Te Papa strings; values are exact TGM preferred labels).
// Te Papa labels negatives/positives by tonality+binder; TGM by process/support,
// with generic parents (Negatives / Transparencies / Slides) we fall back to.
const ALIAS = {
  'black and white negatives': 'Negatives', 'gelatin silver negatives': 'Negatives',
  'color negatives': 'Negatives',
  'color transparencies': 'Transparencies', 'black and white transparencies': 'Transparencies',
  'color slides': 'Slides', 'black and white slides': 'Slides',
  'landscapes': 'Landscape photographs', 'stereoscopic photographs': 'Stereographs',
  'picture postcards': 'Postcards', 'exterior views': 'Views', 'interior views': 'Interiors',
  'relief halftones': 'Halftone photomechanical prints', 'personal correspondence': 'Correspondence',
};
function norm(s) {
  let t = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.split(' ').map((w) => SPELL[w] || w).join(' ').replace(/\s+/g, ' ').trim();
  return t;
}
// naive singular/plural toggles of the LAST word (TGM prefers plural count-nouns)
function variants(n) {
  const v = new Set([n]);
  const parts = n.split(' '); const last = parts[parts.length - 1];
  const swap = (w) => { parts[parts.length - 1] = w; v.add(parts.join(' ')); };
  if (/ies$/.test(last)) swap(last.replace(/ies$/, 'y'));
  else if (/(ses|xes|zes|ches|shes)$/.test(last)) swap(last.replace(/es$/, ''));
  else if (/s$/.test(last) && !/ss$/.test(last)) swap(last.replace(/s$/, ''));
  else if (/y$/.test(last)) swap(last.replace(/y$/, 'ies'));
  else swap(last + 's');
  return [...v];
}

// index: normalised label/variant → tgm id (prefLabel wins over altLabel)
const byNorm = new Map();
const add = (key, id, pref) => { const cur = byNorm.get(key); if (!cur || (pref && !cur.pref)) byNorm.set(key, { id, pref }); };
for (const [id, t] of Object.entries(TERMS)) {
  add(norm(t.label), id, true);
  for (const a of t.alt) add(norm(a), id, false);
}
// trigram sets for fuzzy fallback
const trig = (s) => { const g = new Set(); const p = `  ${s} `; for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3)); return g; };
const TGM_TRI = Object.entries(TERMS).map(([id, t]) => ({ id, label: t.label, n: norm(t.label), g: trig(norm(t.label)) }));
function jaccard(a, b) { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); }

// match one Te Papa string → { id, label, how } | null
export function matchTGM(str, { fuzzy = 0.86 } = {}) {
  const n = norm(str);
  if (!n) return null;
  for (const v of variants(n)) { const hit = byNorm.get(v); if (hit) return { id: hit.id, label: TERMS[hit.id].label, how: hit.pref ? 'exact' : 'variant' }; }
  if (ALIAS[n]) { const hit = byNorm.get(norm(ALIAS[n])); if (hit) return { id: hit.id, label: TERMS[hit.id].label, how: 'alias' }; }
  // conservative fuzzy: best trigram jaccard over TGM labels
  const g = trig(n); let best = null;
  for (const c of TGM_TRI) { const s = jaccard(g, c.g); if (!best || s > best.s) best = { id: c.id, label: c.label, s }; }
  if (best && best.s >= fuzzy) return { id: best.id, label: best.label, how: `fuzzy:${best.s.toFixed(2)}` };
  return null;
}
export const tgmLabel = (id) => (TERMS[id] ? TERMS[id].label : id);

// ---- self-test: genre/format terms from the local index ----
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'index.json'), 'utf8'));
  const freq = new Map();
  for (const e of index) for (const t of (e.c || [])) freq.set(t, (freq.get(t) || 0) + 1);
  const terms = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  let hit = 0, recHit = 0, recTot = 0; const miss = [], fuzzy = [];
  for (const [t, n] of terms) {
    const m = matchTGM(t);
    if (m) { hit++; if (m.how.startsWith('fuzzy')) fuzzy.push(`${t} → ${m.label} (${m.how})`); }
    else miss.push([t, n]);
  }
  for (const e of index) { const cats = e.c || []; if (!cats.length) continue; recTot++; if (cats.some((c) => matchTGM(c))) recHit++; }
  console.log(`GENRE terms: ${terms.length} · matched ${hit} (${(hit / terms.length * 100).toFixed(0)}%) · records with ≥1 genre→TGM: ${(recHit / recTot * 100).toFixed(1)}%`);
  console.log(`\nFuzzy matches (review): \n  ${fuzzy.join('\n  ')}`);
  console.log(`\nUnmatched (${miss.length}):\n  ${miss.map(([t, n]) => `${t} (${n})`).join('\n  ')}`);
}

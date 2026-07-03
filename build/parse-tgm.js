// build/parse-tgm.js — parse the Library of Congress Thesaurus for Graphic
// Materials (TGM) SKOS/RDF N-Triples dump into a structured vocabulary.
//
// TGM (id.loc.gov/vocabulary/graphicMaterials) is public domain. One flat scheme
// of ~7,840 concepts; there is no genre-vs-subject split in the data, so we let
// Te Papa's own cataloguing decide that (isTypeOf = genre, depicts = subject).
//
//   in:  build/tgm.nt.gz         (download: build/fetch-tgm.js)
//   out: build/tgm-terms.json    { "tgm001234": {label, alt:[], scope, bt:[], nt:[], rt:[]} }
//
// Run:  node build/parse-tgm.js

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NT = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'tgm.nt.gz'))).toString('utf8');

const BASE = 'http://id.loc.gov/vocabulary/graphicMaterials/';
const P = (p) => `http://www.w3.org/2004/02/skos/core#${p}`;
const idOf = (uri) => (uri.startsWith(BASE) ? uri.slice(BASE.length) : null);
// N-Triples literal unescape (\" \\ \n \t \uXXXX …) — JSON.parse handles it.
const unlit = (s) => { try { return JSON.parse(`"${s}"`); } catch (e) { return s.replace(/\\(.)/g, '$1'); } };

const terms = new Map();
const get = (id) => { let t = terms.get(id); if (!t) { t = { label: '', alt: [], scope: '', bt: [], nt: [], rt: [] }; terms.set(id, t); } return t; };
const inScheme = new Set();

const reLit = /^<([^>]+)> <([^>]+)> "((?:[^"\\]|\\.)*)"(?:@\w+|\^\^<[^>]+>)? \.$/;
const reRef = /^<([^>]+)> <([^>]+)> <([^>]+)> \.$/;

for (const line of NT.split('\n')) {
  if (!line) continue;
  let m = reLit.exec(line);
  if (m) {
    const id = idOf(m[1]); if (!id) continue;
    const pred = m[2], val = unlit(m[3]);
    if (pred === P('prefLabel')) get(id).label = val;
    else if (pred === P('altLabel')) get(id).alt.push(val);
    else if (pred === P('scopeNote')) {
      // "Main Term" is a status marker, not a definition — prefer a real note
      const cur = get(id).scope;
      if (val !== 'Main Term' && (!cur || cur === 'Main Term')) get(id).scope = val;
      else if (!cur) get(id).scope = val;
    }
    continue;
  }
  m = reRef.exec(line);
  if (m) {
    const id = idOf(m[1]); if (!id) continue;
    const pred = m[2], tgt = idOf(m[3]);
    if (pred === P('inScheme') && m[3] === 'http://id.loc.gov/vocabulary/graphicMaterials') inScheme.add(id);
    else if (tgt && pred === P('broader')) get(id).bt.push(tgt);
    else if (tgt && pred === P('narrower')) get(id).nt.push(tgt);
    else if (tgt && pred === P('related')) get(id).rt.push(tgt);
  }
}

// keep only concepts actually in the TGM scheme with a preferred label
const out = {};
for (const id of inScheme) { const t = terms.get(id); if (t && t.label) out[id] = t; }

fs.writeFileSync(path.join(__dirname, 'tgm-terms.json'), JSON.stringify(out));
const withScope = Object.values(out).filter((t) => t.scope).length;
const withAlt = Object.values(out).filter((t) => t.alt.length).length;
console.log(`TGM parsed: ${Object.keys(out).length} concepts`);
console.log(`  with scope note: ${withScope} · with UF variants: ${withAlt}`);
console.log(`  sample: ${Object.entries(out).slice(0, 3).map(([id, t]) => `${id}=${t.label}`).join(' · ')}`);
console.log(`Wrote build/tgm-terms.json (${Math.round(fs.statSync(path.join(__dirname, 'tgm-terms.json')).size / 1024)} KB)`);

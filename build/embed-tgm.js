// build/embed-tgm.js — CLIP supplement to the TGM crosswalk.
//
// The crosswalk (build-tgm-data.js) is authoritative but only as complete as the
// cataloguing. For a CURATED set of concrete, visually-groundable TGM subject
// terms, add SUGGESTED tags to images that lack them — same method as
// embed-compositions.js (CLIP text→image blended with the e5 caption, z-norm
// 0.7/0.3, min-max per term, keep ≥ CONF). Suggested tags are only added where
// the record isn't already catalogued with that term, and are stored separately
// (`tgc`) so the UI can label them "suggested" and never pass them off as
// cataloguing.
//
//   in:  public/data/index.json (with `tg` from build-tgm-data.js), clip/text emb
//   out: patches index.json with `tgc` (suggested TGM numeric ids per record)
//
// Run (after build-tgm-data.js):  node build/embed-tgm.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, CLIPTextModelWithProjection, pipeline, env } from '@huggingface/transformers';
import { matchTGM } from './crosswalk-tgm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data');
env.cacheDir = path.join(__dirname, '.hf-cache');
const CLIP_DIM = 512, TEXT_DIM = 384, CONF = 0.82, W_CLIP = 0.7, W_TEXT = 0.3;
const num = (id) => parseInt(id.replace(/\D/g, ''), 10);

// Concrete, depictable TGM subjects suited to a historical NZ photo collection.
// Each is an exact TGM preferred label; the prompt is auto-built unless overridden.
const CURATED = [
  'Mountains', 'Lakes', 'Rivers', 'Waterfalls', 'Beaches', 'Coasts', 'Cliffs', 'Glaciers',
  'Volcanoes', 'Snow', 'Forests', 'Trees', 'Gardens', 'Flowers', 'Caves', 'Islands', 'Valleys',
  'Geysers', 'Hot springs', 'Deserts', 'Rocks', 'Clouds',
  'Harbors', 'Wharves', 'Ships', 'Sailing ships', 'Steamships', 'Boats', 'Canoes', 'Shipwrecks',
  'Lighthouses', 'Fishing', 'Piers & wharves',
  'Railroads', 'Railroad stations', 'Locomotives', 'Bridges', 'Roads', 'Streets', 'Automobiles',
  'Carriages & coaches', 'Wagons', 'Bicycles', 'Airplanes', 'Aircraft',
  'Buildings', 'Houses', 'Churches', 'Cathedrals', 'Castles & palaces', 'Towers', 'Monuments',
  'Ruins', 'Hotels', 'Stores & shops', 'Factories', 'Mills', 'Mines', 'Barns', 'Fences', 'Dams',
  'Windmills', 'Statues', 'Lighthouses', 'Tents', 'Bandstands',
  'Cities & towns', 'Villages', 'Marketplaces', 'Parks', 'Cemeteries', 'Farms',
  'Children', 'Families', 'Weddings', 'Soldiers', 'Sailors', 'Crowds', 'Parades & processions',
  'Sports', 'Swimming', 'Picnics', 'Musicians', 'Dance', 'Nurses', 'Miners',
  'Horses', 'Cattle', 'Sheep', 'Dogs', 'Cats', 'Birds', 'Poultry', 'Deer',
  'Sheep ranching', 'Mining', 'Logging', 'Sawmills', 'Orchards', 'Plowing', 'Harvesting',
  'Military camps', 'Cannons', 'Battlefields', 'Warships', 'Weapons',
  'Costume', 'Flags', 'Furniture', 'Musical instruments', 'Bridges',
];
const PROMPT = { // a few where a bare label reads oddly to CLIP
  'Costume': 'a photograph of people in costume or period clothing',
  'Sports': 'a photograph of people playing sport',
  'Fishing': 'a photograph of people fishing',
  'Mining': 'a photograph of a mine or miners at work',
  'Dance': 'a photograph of people dancing',
  'Flags': 'a photograph showing flags',
};
const promptFor = (label) => PROMPT[label] || `a photograph of ${label.toLowerCase()}`;

// resolve labels → TGM ids (dedupe, drop any that don't resolve)
const seenId = new Set();
const items = [];
for (const label of CURATED) {
  const m = matchTGM(label);
  if (!m) { console.warn(`  ! no TGM match for "${label}" — skipped`); continue; }
  const id = num(m.id);
  if (seenId.has(id)) continue;
  seenId.add(id);
  items.push({ id, label: m.label, prompt: promptFor(label) });
}

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const N = index.length;
const clip = new Int8Array(fs.readFileSync(path.join(DATA, 'clip-emb.i8')).buffer);
const text = new Int8Array(fs.readFileSync(path.join(DATA, 'text-emb.i8')).buffer);
console.log(`CLIP supplement: ${items.length} curated TGM subjects × ${N} records (keep ≥ ${CONF}, suggest-only where not catalogued)…`);

const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); };
const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
const clipText = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { dtype: 'q8' });
const e5 = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });
async function clipPrompt(t) { const inputs = await tokenizer([t], { padding: true, truncation: true }); const { text_embeds } = await clipText(inputs); return norm(Array.from(text_embeds.data)); }
const e5Prompt = async (t) => Array.from((await e5(['query: ' + t], { pooling: 'mean', normalize: true })).data);
const dot = (q, arr, dim, i) => { let s = 0; const o = i * dim; for (let k = 0; k < dim; k++) s += q[k] * arr[o + k]; return s / 127; };
function zstats(a) { let m = 0; for (const x of a) m += x; m /= a.length; let v = 0; for (const x of a) v += (x - m) ** 2; return { m, sd: Math.sqrt(v / a.length) || 1 }; }

for (const e of index) e._sug = new Set();
let added = 0;
for (const it of items) {
  const qc = await clipPrompt(it.prompt), qt = await e5Prompt(it.prompt);
  const cs = new Float64Array(N), ts = new Float64Array(N);
  for (let i = 0; i < N; i++) { cs[i] = dot(qc, clip, CLIP_DIM, i); ts[i] = dot(qt, text, TEXT_DIM, i); }
  const zc = zstats(cs), zt = zstats(ts);
  let bmin = Infinity, bmax = -Infinity; const bl = new Float64Array(N);
  for (let i = 0; i < N; i++) { const b = W_CLIP * ((cs[i] - zc.m) / zc.sd) + W_TEXT * ((ts[i] - zt.m) / zt.sd); bl[i] = b; if (b < bmin) bmin = b; if (b > bmax) bmax = b; }
  const range = (bmax - bmin) || 1;
  let kept = 0;
  for (let i = 0; i < N; i++) {
    const conf = (bl[i] - bmin) / range;
    if (conf < CONF) continue;
    const e = index[i];
    if ((e.tg || []).includes(it.id)) continue;   // already catalogued → not a suggestion
    e._sug.add(it.id); kept++; added++;
  }
  process.stdout.write(`\r  ${it.label}: +${kept}   `);
}

for (const e of index) { e.tgc = [...e._sug].sort((a, b) => a - b); delete e._sug; }
fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify(index));
const recWithSug = index.filter((e) => e.tgc.length).length;
console.log(`\n\nAdded ${added} suggested tags across ${items.length} terms · ${recWithSug} records got ≥1 suggestion (${(recWithSug / N * 100).toFixed(1)}%)`);
console.log(`index.json now ${Math.round(fs.statSync(path.join(DATA, 'index.json')).size / 1024 / 1024 * 10) / 10} MB`);

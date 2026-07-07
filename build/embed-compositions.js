// build/embed-compositions.js — categorise the collection by photographic
// composition & technique, using the baked embeddings.  Same method as
// embed-emotions.js: for each term, CLIP text→image blended with the e5 caption
// signal (z-normalised per modality, 0.7/0.3), then min-max normalised to 0–1
// per term. "Confidence" = that normalised strength; keep every photo ≥ CONF
// (multi-label — a photo can belong to several composition terms).
//
//   in:  ../public/data/index.json, clip-emb.i8 (512), text-emb.i8 (384), compositions.js
//   out: ../public/data/compositions.json  { compositions:[{key,label,count,ids}], photos:{id:{…}} }
//        ../public/data/compositions-index.json  (labels + counts + defs, for the marquee)
//
// Run:  node build/embed-compositions.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, CLIPTextModelWithProjection, pipeline, env } from '@huggingface/transformers';
import { COMPOSITIONS } from './compositions.js';
import { checkStamp, assertSameHarvest } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data');
env.cacheDir = path.join(__dirname, '.hf-cache');

const CLIP_DIM = 512, TEXT_DIM = 384, CONF = 0.75, W_CLIP = 0.7, W_TEXT = 0.3;

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const STAMP = checkStamp(index.map((e) => e.id), 'public/data/index.json');
const N = index.length;
const clip = new Int8Array(fs.readFileSync(path.join(DATA, 'clip-emb.i8')).buffer);
const text = new Int8Array(fs.readFileSync(path.join(DATA, 'text-emb.i8')).buffer);
// Row-alignment invariant: the .i8 matrices are row-aligned to index.json. A
// re-harvest that changes the record set silently misaligns every score — fail
// loudly instead (re-run embed-clip.js / embed-text.js after any harvest).
// Byte length catches a changed COUNT; the recorded stamps catch a same-count
// re-harvest whose membership shifted.
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };
assertSameHarvest(readJson(path.join(__dirname, 'clip-progress.json')).stamp, STAMP, 'clip-emb.i8', 're-run embed-clip.js');
assertSameHarvest(readJson(path.join(DATA, 'meta.json')).stamp, STAMP, 'text-emb.i8', 're-run embed-text.js');
if (clip.length !== N * CLIP_DIM) throw new Error(`clip-emb.i8 misaligned: ${clip.length} bytes for ${N} records x ${CLIP_DIM}`);
if (text.length !== N * TEXT_DIM) throw new Error(`text-emb.i8 misaligned: ${text.length} bytes for ${N} records x ${TEXT_DIM}`);
console.log(`Categorising ${N} records against ${COMPOSITIONS.length} composition terms (keep confidence ≥ ${CONF})…`);

const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); };
const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
const clipText = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { dtype: 'q8' });
const e5 = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });

async function clipPrompt(t) {
  const inputs = await tokenizer([t], { padding: true, truncation: true });
  const { text_embeds } = await clipText(inputs);
  return norm(Array.from(text_embeds.data));
}
const e5Prompt = async (t) => Array.from((await e5(['query: ' + t], { pooling: 'mean', normalize: true })).data);
const dot = (q, arr, dim, i) => { let s = 0; const o = i * dim; for (let k = 0; k < dim; k++) s += q[k] * arr[o + k]; return s / 127; };
function zstats(a) { let m = 0; for (const x of a) m += x; m /= a.length; let v = 0; for (const x of a) v += (x - m) ** 2; return { m, sd: Math.sqrt(v / a.length) || 1 }; }

const compsOut = [];
const usedIds = new Set();
const t0 = Date.now();

for (const comp of COMPOSITIONS) {
  const qc = await clipPrompt(comp.prompt);
  const qt = await e5Prompt(comp.prompt);
  const cs = new Float64Array(N), ts = new Float64Array(N);
  for (let i = 0; i < N; i++) { cs[i] = dot(qc, clip, CLIP_DIM, i); ts[i] = dot(qt, text, TEXT_DIM, i); }
  const zc = zstats(cs), zt = zstats(ts);
  let bmin = Infinity, bmax = -Infinity;
  const bl = new Float64Array(N);
  for (let i = 0; i < N; i++) { const b = W_CLIP * ((cs[i] - zc.m) / zc.sd) + W_TEXT * ((ts[i] - zt.m) / zt.sd); bl[i] = b; if (b < bmin) bmin = b; if (b > bmax) bmax = b; }
  const range = (bmax - bmin) || 1;
  const hits = [];
  for (let i = 0; i < N; i++) { const conf = (bl[i] - bmin) / range; if (conf >= CONF) hits.push([i, conf]); }
  hits.sort((a, b) => b[1] - a[1]);
  const ids = hits.map(([i]) => { usedIds.add(i); return index[i].id; });
  compsOut.push({ key: comp.key, label: comp.label, count: ids.length, ids });
}

// summary
compsOut.slice().sort((a, b) => b.count - a.count).forEach((c) => console.log(`  ${String(c.count).padStart(5)}  ${c.label}`));
const withHits = compsOut.filter((c) => c.count > 0).length;
console.log(`\nComposition terms with ≥1 match: ${withHits}/${COMPOSITIONS.length} · distinct photos used: ${usedIds.size} (${(usedIds.size / N * 100).toFixed(1)}%)`);

// union metadata (only matched records)
const photos = {};
for (const i of usedIds) { const e = index[i]; photos[e.id] = { t: e.t, m: e.m, d: e.d, p: e.p, c: e.c, mid: e.mid, w: e.w, h: e.h, r: e.r }; }

fs.writeFileSync(path.join(DATA, 'compositions.json'), JSON.stringify({
  source: 'Photographic composition & technique vocabulary',
  method: `${W_CLIP}·CLIP(text→image) + ${W_TEXT}·e5(caption), z-normalised then min-max per term; kept ≥ ${CONF}`,
  compositions: compsOut,
  photos,
}));
fs.writeFileSync(path.join(DATA, 'compositions-index.json'), JSON.stringify({
  source: 'Photographic composition & technique vocabulary',
  compositions: compsOut.map((c) => {
    const src = COMPOSITIONS.find((x) => x.key === c.key);
    return { key: c.key, label: c.label, count: c.count, def: (src && src.def) || '' };
  }),
}));
const kb = Math.round(fs.statSync(path.join(DATA, 'compositions.json')).size / 1024);
console.log(`Wrote public/data/compositions.json (${kb} KB) + compositions-index.json in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

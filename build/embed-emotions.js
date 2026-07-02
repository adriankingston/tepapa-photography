// build/embed-emotions.js — categorise the collection against the 154 emotions
// from "The Book of Human Emotions" using the baked embeddings.
//
// For each emotion: CLIP text→image blended with the e5 caption signal
// (z-normalised per modality, 0.7/0.3), then min-max normalised to 0–1 per
// emotion. "Confidence" = that normalised strength; we keep every photo ≥0.75
// (multi-label — a photo can belong to several emotions).
//
//   in:  ../public/data/index.json, clip-emb.i8 (512), text-emb.i8 (384), emotions.js
//   out: ../public/data/emotions.json  { emotions:[{key,label,count,ids}], photos:{id:{…}} }
//        (union format: photos carries metadata only for matched records)
//
// Run:  node build/embed-emotions.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, CLIPTextModelWithProjection, pipeline, env } from '@huggingface/transformers';
import { EMOTIONS } from './emotions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data');
env.cacheDir = path.join(__dirname, '.hf-cache');

const CLIP_DIM = 512, TEXT_DIM = 384, CONF = 0.75, W_CLIP = 0.7, W_TEXT = 0.3;

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const N = index.length;
const clip = new Int8Array(fs.readFileSync(path.join(DATA, 'clip-emb.i8')).buffer);
const text = new Int8Array(fs.readFileSync(path.join(DATA, 'text-emb.i8')).buffer);
console.log(`Categorising ${N} records against ${EMOTIONS.length} emotions (keep confidence ≥ ${CONF})…`);

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

const emotionsOut = [];
const usedIds = new Set();
const t0 = Date.now();

for (const emo of EMOTIONS) {
  const qc = await clipPrompt(emo.prompt);
  const qt = await e5Prompt(emo.prompt);
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
  emotionsOut.push({ key: emo.key, label: emo.label, count: ids.length, ids });
}

// summary
emotionsOut.slice().sort((a, b) => b.count - a.count).forEach((e) => console.log(`  ${String(e.count).padStart(5)}  ${e.label}`));
const withHits = emotionsOut.filter((e) => e.count > 0).length;
console.log(`\nEmotions with ≥1 match: ${withHits}/${EMOTIONS.length} · distinct photos used: ${usedIds.size} (${(usedIds.size / N * 100).toFixed(1)}%)`);

// union metadata (only matched records)
const photos = {};
for (const i of usedIds) { const e = index[i]; photos[e.id] = { t: e.t, m: e.m, d: e.d, p: e.p, c: e.c, mid: e.mid, w: e.w, h: e.h, r: e.r }; }

fs.writeFileSync(path.join(DATA, 'emotions.json'), JSON.stringify({
  source: 'The Book of Human Emotions — Tiffany Watt Smith (154 entries)',
  method: `${W_CLIP}·CLIP(text→image) + ${W_TEXT}·e5(caption), z-normalised then min-max per emotion; kept ≥ ${CONF}`,
  emotions: emotionsOut,
  photos,
}));
const kb = Math.round(fs.statSync(path.join(DATA, 'emotions.json')).size / 1024);
console.log(`Wrote public/data/emotions.json (${kb} KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

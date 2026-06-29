// build/embed-moods.js — precompute "emotional" subject sets from the embeddings.
//
// Emotional concepts barely appear in museum captions, so free-text search fails.
// Instead we use the baked embeddings: CLIP text→image (the shared space) finds
// images that *look* like a feeling, blended with the e5 caption signal. Scores
// are z-normalised per modality (CLIP cosines ~0.2, e5 ~0.8) before blending.
//
//   in:  ../public/data/index.json, clip-emb.i8 (512), text-emb.i8 (384)
//   out: ../public/data/moods.json  { moods:[{key,label,prompt,ids:[topN]}] }
//
// Run:  node build/embed-moods.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, CLIPTextModelWithProjection, pipeline, env } from '@huggingface/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data');
env.cacheDir = path.join(__dirname, '.hf-cache');

const CLIP_DIM = 512, TEXT_DIM = 384, TOP_N = 240;
const W_CLIP = 0.7, W_TEXT = 0.3;   // CLIP (visual) leads; captions assist

// A feeling → a CLIP prompt (a scene phrase reads better than a bare word).
const MOODS = [
  { key: 'love',          label: 'love',          prompt: 'two people in love, a tender embrace, romance' },
  { key: 'joy',           label: 'joy',           prompt: 'people laughing and smiling with pure joy' },
  { key: 'grief',         label: 'grief',         prompt: 'grief and mourning, a funeral, sorrow' },
  { key: 'solitude',      label: 'solitude',      prompt: 'a lone solitary figure alone in a vast empty landscape' },
  { key: 'childhood',     label: 'childhood',     prompt: 'the innocence of childhood, young children playing' },
  { key: 'adventure',     label: 'adventure',     prompt: 'a daring adventurous expedition into rugged wilderness' },
  { key: 'celebration',   label: 'celebration',   prompt: 'a jubilant crowd at a festive celebration' },
  { key: 'wonder',        label: 'wonder',        prompt: 'awe and wonder before a sublime majestic landscape' },
  { key: 'home',          label: 'home',          prompt: 'a cosy intimate domestic scene inside a home' },
  { key: 'faith',         label: 'faith',         prompt: 'a quiet moment of prayer, faith and devotion' },
  { key: 'labour',        label: 'labour',        prompt: 'workers doing hard physical labour and toil' },
  { key: 'togetherness',  label: 'togetherness',  prompt: 'a warm gathering of family and friends together' },
  { key: 'melancholy',    label: 'melancholy',    prompt: 'a melancholy moody desolate lonely scene' },
  { key: 'freedom',       label: 'freedom',       prompt: 'a feeling of freedom, the open sea and open road' },
];

// ---- load data ----
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const N = index.length;
const clip = new Int8Array(fs.readFileSync(path.join(DATA, 'clip-emb.i8')).buffer);
const text = new Int8Array(fs.readFileSync(path.join(DATA, 'text-emb.i8')).buffer);
console.log(`Scoring ${N} records across ${MOODS.length} moods…`);

const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); };

// ---- models ----
const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
const clipText = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { dtype: 'q8' });
const e5 = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });

async function clipPrompt(t) {
  const inputs = await tokenizer([t], { padding: true, truncation: true });
  const { text_embeds } = await clipText(inputs);
  return norm(Array.from(text_embeds.data));
}
async function e5Prompt(t) {
  const out = await e5(['query: ' + t], { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

// dot of a normalised query against an int8 row (÷127 ≈ dequantise)
function dotClip(q, i) { let s = 0; const o = i * CLIP_DIM; for (let k = 0; k < CLIP_DIM; k++) s += q[k] * clip[o + k]; return s / 127; }
function dotText(q, i) { let s = 0; const o = i * TEXT_DIM; for (let k = 0; k < TEXT_DIM; k++) s += q[k] * text[o + k]; return s / 127; }
function zstats(a) { let m = 0; for (const x of a) m += x; m /= a.length; let v = 0; for (const x of a) v += (x - m) ** 2; return { m, sd: Math.sqrt(v / a.length) || 1 }; }

const out = [];
for (const mood of MOODS) {
  const qc = await clipPrompt(mood.prompt);
  const qt = await e5Prompt(mood.prompt);
  const cs = new Float64Array(N), ts = new Float64Array(N);
  for (let i = 0; i < N; i++) { cs[i] = dotClip(qc, i); ts[i] = dotText(qt, i); }
  const zc = zstats(cs), zt = zstats(ts);
  const combined = new Float64Array(N);
  for (let i = 0; i < N; i++) combined[i] = W_CLIP * ((cs[i] - zc.m) / zc.sd) + W_TEXT * ((ts[i] - zt.m) / zt.sd);
  const order = Array.from(combined.keys()).sort((a, b) => combined[b] - combined[a]);
  const top = order.slice(0, TOP_N);
  out.push({ key: mood.key, label: mood.label, prompt: mood.prompt, ids: top.map((i) => index[i].id) });
  console.log(`\n${mood.key}:`);
  top.slice(0, 6).forEach((i) => console.log('   ' + (index[i].t || '').slice(0, 56)));
}

fs.writeFileSync(path.join(DATA, 'moods.json'), JSON.stringify({
  method: `${W_CLIP}·CLIP(text→image) + ${W_TEXT}·e5(caption), z-normalised`,
  topN: TOP_N,
  moods: out,
}));
console.log(`\nWrote public/data/moods.json (${MOODS.length} moods × ${TOP_N})`);

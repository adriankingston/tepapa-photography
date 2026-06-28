// build/embed-clip.js — CLIP image embeddings for every thumbnail.
//
// Model: Xenova/clip-vit-base-patch32 (512-dim shared image/text space), q8.
// Image vectors are L2-normalised then int8-quantised (×127). The matching CLIP
// *text* encoder can be run client-side at query time for natural-language→image
// search; these image vectors also power image-to-image "more like this".
//
//   in:  build/records.json, build/thumbs/<id>.jpg
//   out: ../public/data/clip-emb.i8   Int8Array, N × 512, row-aligned to index.json
//        build/clip-progress.json     resume marker
//
// Resumable: re-run after an interruption and it continues. Run:
//   node build/embed-clip.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const THUMBS = path.join(__dirname, 'thumbs');
env.cacheDir = path.join(__dirname, '.hf-cache');

const MODEL = 'Xenova/clip-vit-base-patch32';
const DIM = 512;
const BATCH = 32;
const FLUSH_EVERY = 2000;
const EMB_PATH = path.join(DATA, 'clip-emb.i8');
const PROG_PATH = path.join(__dirname, 'clip-progress.json');

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const N = records.length;
const file = (id) => path.join(THUMBS, `${id}.jpg`);

// resume if a partial run exists and the buffer is the right size
let out = new Int8Array(N * DIM);
let start = 0;
if (fs.existsSync(EMB_PATH) && fs.existsSync(PROG_PATH)) {
  const buf = fs.readFileSync(EMB_PATH);
  if (buf.length === N * DIM) {
    out = new Int8Array(buf.buffer, buf.byteOffset, buf.length).slice();
    start = JSON.parse(fs.readFileSync(PROG_PATH, 'utf8')).done || 0;
    console.log(`Resuming from ${start}/${N}`);
  }
}

const missing = [];
function flush(done) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(EMB_PATH, Buffer.from(out.buffer));
  fs.writeFileSync(PROG_PATH, JSON.stringify({ done }));
}

console.log(`Embedding ${N} images with ${MODEL} (q8)…`);
const t0 = Date.now();
const processor = await AutoProcessor.from_pretrained(MODEL);
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' });

for (let i = start; i < N; i += BATCH) {
  const slice = records.slice(i, i + BATCH);
  const imgs = [];
  const at = [];
  for (let j = 0; j < slice.length; j++) {
    try { imgs.push(await RawImage.read(file(slice[j].id))); at.push(j); }
    catch { missing.push(slice[j].id); }   // leaves a zero vector at that row
  }
  if (imgs.length) {
    const inputs = await processor(imgs);
    const { image_embeds } = await vision(inputs);
    const data = image_embeds.data;
    for (let k = 0; k < imgs.length; k++) {
      const v = data.subarray(k * DIM, (k + 1) * DIM);
      let s = 0; for (let z = 0; z < DIM; z++) s += v[z] * v[z];
      const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
      const off = (i + at[k]) * DIM;
      for (let z = 0; z < DIM; z++) { const q = Math.round(v[z] * inv * 127); out[off + z] = q > 127 ? 127 : q < -127 ? -127 : q; }
    }
  }
  const done = Math.min(i + BATCH, N);
  if (i % (BATCH * 20) === 0 || done === N) {
    const rate = (done - start) / ((Date.now() - t0) / 1000);
    process.stdout.write(`\r  ${done}/${N}  missing ${missing.length}  (${rate.toFixed(1)}/s)   `);
  }
  if (done % FLUSH_EVERY < BATCH) flush(done);
}

flush(N);
fs.writeFileSync(path.join(__dirname, 'clip-missing.json'), JSON.stringify(missing));
const metaPath = path.join(DATA, 'meta.json');
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { count: N, quant: 127 };
meta.clip = { model: MODEL, dim: DIM, file: 'clip-emb.i8', missing: missing.length };
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
console.log(`\nWrote public/data/clip-emb.i8 (${(out.length / 1e6).toFixed(1)} MB), ${missing.length} missing, in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

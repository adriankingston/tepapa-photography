// build/embed-siglip2.js — SigLIP 2 image embeddings for every thumbnail.
//
// The tag layer scores a curated vocabulary against these vectors. SigLIP's
// sigmoid loss gives each image–label pair an INDEPENDENT probability (unlike
// CLIP's competing softmax scores) — the fix for the calibration wall we hit
// scoring open vocabularies with clip-vit-base-patch32.
//
// Vectors are L2-normalised then int8-quantised (×127), row-aligned to
// build/records.json (same convention as clip-emb.i8).
//
//   in:  build/records.json, build/thumbs/<id>.jpg
//   out: build/siglip2-emb.i8            (build-only, gitignored)
//        build/siglip2-progress.json     resume marker
//        build/siglip2-missing.json      ids with no readable thumb
//
// Resumable: re-run after an interruption and it continues. Run:
//   node build/embed-siglip2.js
//
// Model choice (probed 2026-07-05): so400m-patch14-384 q8 is BROKEN in the
// onnx-community export — it misranks unambiguous images (attention collapses
// under naive int8; SigLIP-1 base q8 ranks the same images fine). base-256 q8
// ranks correctly with well-separated probabilities at ~20 img/s CPU.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, SiglipVisionModel, RawImage, env } from '@huggingface/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.join(__dirname, '.hf-cache');

const MODEL = process.env.MODEL || 'onnx-community/siglip2-base-patch16-256-ONNX';
const DTYPE = process.env.DTYPE || 'q8';
const BATCH = Number(process.env.BATCH || 16);
const FLUSH_EVERY = 1000;
const EMB_PATH = path.join(__dirname, 'siglip2-emb.i8');
const PROG_PATH = path.join(__dirname, 'siglip2-progress.json');

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const N = records.length;
const file = (id) => path.join(__dirname, 'thumbs', `${id}.jpg`);

console.log(`Embedding ${N} images with ${MODEL} (${DTYPE})…`);
const processor = await AutoProcessor.from_pretrained(MODEL);
const vision = await SiglipVisionModel.from_pretrained(MODEL, { dtype: DTYPE });

// probe one image for the embedding dimension
const probeOut = await vision(await processor([await RawImage.read(file(records[0].id))]));
const DIM = probeOut.pooler_output.dims[1];
console.log(`Embedding dim: ${DIM}`);

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
  fs.writeFileSync(EMB_PATH, Buffer.from(out.buffer));
  fs.writeFileSync(PROG_PATH, JSON.stringify({ done, model: MODEL, dim: DIM }));
}

const t0 = Date.now();
for (let i = start; i < N; i += BATCH) {
  const slice = records.slice(i, i + BATCH);
  const images = [];
  const rows = [];
  for (let j = 0; j < slice.length; j++) {
    try {
      images.push(await RawImage.read(file(slice[j].id)));
      rows.push(i + j);
    } catch { missing.push(slice[j].id); }
  }
  if (images.length) {
    const inputs = await processor(images);
    const { pooler_output } = await vision(inputs);
    const data = pooler_output.data;
    for (let r = 0; r < rows.length; r++) {
      let norm = 0;
      for (let d = 0; d < DIM; d++) norm += data[r * DIM + d] ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < DIM; d++) {
        out[rows[r] * DIM + d] = Math.max(-127, Math.min(127, Math.round((data[r * DIM + d] / norm) * 127)));
      }
    }
  }
  const done = Math.min(i + BATCH, N);
  if (done % FLUSH_EVERY < BATCH) flush(done);
  const rate = (done - start) / ((Date.now() - t0) / 1000);
  const eta = (N - done) / rate;
  process.stdout.write(`\r  ${done}/${N}  (${rate.toFixed(1)} img/s · eta ${(eta / 60).toFixed(0)}m)   `);
}
flush(N);
fs.writeFileSync(path.join(__dirname, 'siglip2-missing.json'), JSON.stringify(missing));
console.log(`\nDone: ${N - missing.length} embedded, ${missing.length} missing, in ${((Date.now() - t0) / 60000).toFixed(0)}m`);

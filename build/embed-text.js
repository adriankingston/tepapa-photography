// build/embed-text.js — text/metadata embeddings for every harvested record.
//
// Model: Xenova/multilingual-e5-small (384-dim, multilingual incl. te reo), q8.
// e5 needs a "passage: " prefix; vectors are mean-pooled + L2-normalised, then
// quantised to int8 (×127) so cosine ≈ dot product on the client.
//
//   in:  build/records.json            (ordered by id; the `.text` field)
//   out: ../public/data/text-emb.i8    Int8Array, N × 384, row-aligned to index.json
//        ../public/data/meta.json      dims / model / quant / counts
//
// Run:  node build/embed-text.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { checkStamp } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
env.cacheDir = path.join(__dirname, '.hf-cache');

const MODEL = 'Xenova/multilingual-e5-small';
const DIM = 384;
const BATCH = 64;

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const STAMP = checkStamp(records.map((r) => r.id), 'build/records.json');
console.log(`Embedding ${records.length} records with ${MODEL} (q8)…`);

const t0 = Date.now();
const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });

const out = new Int8Array(records.length * DIM);
function quantInto(float32, offset) {
  for (let i = 0; i < DIM; i++) {
    const q = Math.round(float32[i] * 127);
    out[offset + i] = q > 127 ? 127 : q < -127 ? -127 : q;
  }
}

for (let i = 0; i < records.length; i += BATCH) {
  const slice = records.slice(i, i + BATCH);
  const inputs = slice.map((r) => 'passage: ' + (r.text || ''));
  const res = await extractor(inputs, { pooling: 'mean', normalize: true });
  const data = res.data; // Float32Array, slice.length × DIM
  for (let j = 0; j < slice.length; j++) quantInto(data.subarray(j * DIM, (j + 1) * DIM), (i + j) * DIM);
  if (i % (BATCH * 20) === 0 || i + BATCH >= records.length) {
    const done = Math.min(i + BATCH, records.length);
    const rate = done / ((Date.now() - t0) / 1000);
    process.stdout.write(`\r  ${done}/${records.length}  (${rate.toFixed(0)}/s)   `);
  }
}

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'text-emb.i8'), Buffer.from(out.buffer));

const metaPath = path.join(DATA, 'meta.json');
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
meta.count = records.length;
meta.quant = 127;
meta.stamp = STAMP || undefined;
meta.text = { model: MODEL, dim: DIM, file: 'text-emb.i8' };
meta.generatedAt = new Date().toISOString();
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

console.log(`\nWrote public/data/text-emb.i8 (${(out.length / 1e6).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

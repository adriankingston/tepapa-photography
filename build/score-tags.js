// build/score-tags.js — score every candidate tag against every image.
//
// Text side of the SigLIP 2 pipeline: embed each candidate prompt, recover the
// model's learned logit scale/bias (they live in the weights, not the config —
// solved from two known logits), then sigmoid(scale·cos + bias) against the
// int8 image matrix. Keeps the top-K images per term + the per-term score
// distribution — everything the calibration sheet needs.
//
//   in:  build/tag-candidates.json, build/siglip2-emb.i8 (+ records.json)
//   out: build/tag-scores.json  { model, scale, bias, terms: [{ key, top: [[row, p]…], hist }] }
//
// Run (after embed-siglip2.js completes):  node build/score-tags.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, AutoTokenizer, SiglipModel, SiglipTextModel, RawImage, env } from '@huggingface/transformers';
import { checkStamp, assertSameHarvest } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.join(__dirname, '.hf-cache');

const MODEL = process.env.MODEL || 'onnx-community/siglip2-base-patch16-256-ONNX';
const DTYPE = process.env.DTYPE || 'q8';
const TOPK = Number(process.env.TOPK || 60);
const BAND_K = Number(process.env.BAND_K || 24);   // sample size per 5% probability band
const TEMPLATE = (p) => `a black and white photograph of ${p}.`;

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-candidates.json'), 'utf8'));
const prog = JSON.parse(fs.readFileSync(path.join(__dirname, 'siglip2-progress.json'), 'utf8'));
if (prog.done !== records.length) throw new Error(`embeddings incomplete: ${prog.done}/${records.length}`);
const STAMP = checkStamp(records.map((r) => r.id), 'build/records.json');
assertSameHarvest(prog.stamp, STAMP, 'siglip2-emb.i8', 're-run embed-siglip2.js');
const DIM = prog.dim;
const N = records.length;
const embBuf = fs.readFileSync(path.join(__dirname, 'siglip2-emb.i8'));
const emb = new Int8Array(embBuf.buffer, embBuf.byteOffset, embBuf.length);

console.log(`Scoring ${candidates.length} terms × ${N} images (dim ${DIM})…`);
const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const textModel = await SiglipTextModel.from_pretrained(MODEL, { dtype: DTYPE });

// ---- recover logit scale & bias --------------------------------------------
// Run the full model once on one image + two texts, compute the same cosines
// from the towers, then solve  logit_i = scale·cos_i + bias.
const processor = await AutoProcessor.from_pretrained(MODEL);
const fullModel = await SiglipModel.from_pretrained(MODEL, { dtype: DTYPE });
const calibTexts = ['a black and white photograph of a ship.', 'a black and white photograph of a mountain.'];
const calibTok = tokenizer(calibTexts, { padding: 'max_length', max_length: 64, truncation: true });
const calibImg = await processor([await RawImage.read(path.join(__dirname, 'thumbs', `${records[0].id}.jpg`))]);
const fullOut = await fullModel({ ...calibTok, ...calibImg });
const tOut = await textModel(calibTok);
const l2 = (v, off, dim) => { let n = 0; for (let d = 0; d < dim; d++) n += v[off + d] ** 2; return Math.sqrt(n) || 1; };
const cosOf = (tvec, toff) => {
  const iv = fullOut.image_embeds ? fullOut.image_embeds.data : null;
  const idim = DIM;
  let ivec, inorm;
  if (iv) { ivec = iv; inorm = l2(iv, 0, idim); }
  else throw new Error('no image_embeds on SiglipModel output');
  const tnorm = l2(tvec, toff, idim);
  let dot = 0;
  for (let d = 0; d < idim; d++) dot += ivec[d] * tvec[toff + d];
  return dot / (inorm * tnorm);
};
const tData = (fullOut.text_embeds ? fullOut.text_embeds : tOut.pooler_output).data;
const cos0 = cosOf(tData, 0), cos1 = cosOf(tData, DIM);
const logits = fullOut.logits_per_text.data;  // [2 texts × 1 image]
const scale = (logits[0] - logits[1]) / (cos0 - cos1);
const bias = logits[0] - scale * cos0;
console.log(`logit scale ${scale.toFixed(3)} · bias ${bias.toFixed(3)} (cos ${cos0.toFixed(3)}/${cos1.toFixed(3)})`);

// ---- embed all prompts, score against the image matrix ---------------------
const sig = (x) => 1 / (1 + Math.exp(-x));
const results = [];
const BATCH = 64;
const t0 = Date.now();
for (let c = 0; c < candidates.length; c += BATCH) {
  const slice = candidates.slice(c, c + BATCH);
  const tok = tokenizer(slice.map((t) => TEMPLATE(t.prompt)), { padding: 'max_length', max_length: 64, truncation: true });
  const { pooler_output } = await textModel(tok);
  const td = pooler_output.data;
  for (let s = 0; s < slice.length; s++) {
    // normalise the text vector once
    const tv = new Float32Array(DIM);
    const tnorm = l2(td, s * DIM, DIM);
    for (let d = 0; d < DIM; d++) tv[d] = td[s * DIM + d] / tnorm;
    // cos against every image (image rows are ×127 of unit vectors)
    const top = [];       // min-heap-ish: keep TOPK best [row, p]
    const hist = new Array(20).fill(0);   // p in 5% buckets
    // evenly-spaced sample per band (p ≥ 0.15) so the review sheet can show
    // the DECISION BOUNDARY, not just the easy top hits: when the buffer
    // overfills, drop every other kept row and double the stride.
    const bands = Array.from({ length: 20 }, () => ({ stride: 1, seen: 0, keep: [] }));
    for (let r = 0; r < N; r++) {
      let dot = 0;
      const off = r * DIM;
      for (let d = 0; d < DIM; d++) dot += emb[off + d] * tv[d];
      const p = sig(scale * (dot / 127) + bias);
      const bi = Math.min(19, Math.floor(p * 20));
      hist[bi]++;
      if (bi >= 3) {   // don't sample the sub-15% junk region
        const b = bands[bi];
        if (b.seen % b.stride === 0) {
          b.keep.push(r);
          if (b.keep.length > BAND_K * 2) { b.keep = b.keep.filter((_, i) => i % 2 === 0); b.stride *= 2; }
        }
        b.seen++;
      }
      if (top.length < TOPK) { top.push([r, p]); if (top.length === TOPK) top.sort((a, b) => a[1] - b[1]); }
      else if (p > top[0][1]) { top[0] = [r, p]; top.sort((a, b) => a[1] - b[1]); }
    }
    top.sort((a, b) => b[1] - a[1]);
    results.push({
      key: slice[s].key,
      top: top.map(([r, p]) => [r, Math.round(p * 1000) / 1000]),
      hist,
      // sample EVENLY from the kept rows (a plain prefix slice would bias the
      // review sheet toward low record ids, since rows scan in id order)
      bands: bands.map((b) => {
        const k = b.keep;
        if (k.length <= BAND_K) return k;
        const stepN = k.length / BAND_K;
        return Array.from({ length: BAND_K }, (_, i) => k[Math.floor(i * stepN)]);
      }),
    });
  }
  process.stdout.write(`\r  ${Math.min(c + BATCH, candidates.length)}/${candidates.length} terms  (${(((Date.now() - t0)) / 1000).toFixed(0)}s)   `);
}

fs.writeFileSync(path.join(__dirname, 'tag-scores.json'), JSON.stringify({
  model: MODEL, scale: Math.round(scale * 1000) / 1000, bias: Math.round(bias * 1000) / 1000,
  template: TEMPLATE('{prompt}'), topk: TOPK, stamp: STAMP || undefined, terms: results,
}));
console.log(`\nWrote build/tag-scores.json (${results.length} terms, top ${TOPK} each)`);

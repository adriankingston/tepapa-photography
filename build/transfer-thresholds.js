// build/transfer-thresholds.js — carry the human-calibrated thresholds
// across a model change.
//
// Thresholds are model-specific: the verdicts in tag-verdicts.json were set
// by eye on base-256 probabilities and mean nothing to a different encoder.
// Two transfer modes (MODE env):
//   size (default) — keep each term's SET SIZE: the calibration decision was
//     "how deep into the ranking is still good", and with a better ranker a
//     same-size set is strictly better (measured 2026-07-08: at equal sizes,
//     so400m sets hit 677 catalogued positives vs base-256's 483 — the old
//     MEMBERSHIP was the noisy part, so don't chase it).
//   jaccard — best-match the old membership instead. Kept for models close
//     enough to the old one that membership is worth preserving.
// Low-Jaccard terms are reported either way — they're where the models
// disagree most, i.e. the priority spot-checks in the review sheet.
// Dropped terms stay dropped; unreviewed stay out. tag-verdicts.json itself
// is never written.
//
//   in:  public/data/tags.json         current shipped membership (old model)
//        build/tag-verdicts.json       the verdicts (drops pass through)
//        build/tag-candidates.json     prompts
//        build/<TAG>-emb.i8/-progress  NEW image matrix
//        build/<SCORES>                NEW model's recovered scale/bias
//   out: build/tag-verdicts-transferred.json   { key: {thr} | {drop:true} }
//        → review flagged terms, then:
//          TAG=… SCORES=… VERDICTS=tag-verdicts-transferred.json node build/build-tags.js
//
// Run:  TAG=so400m SCORES=so400m-tag-scores.json node build/transfer-thresholds.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, SiglipTextModel, env } from '@huggingface/transformers';
import { checkStamp, assertSameHarvest } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data');
env.cacheDir = path.join(__dirname, '.hf-cache');

const TAG = process.env.TAG || 'so400m';
const SCORES = process.env.SCORES || 'so400m-tag-scores.json';
const TDTYPE = process.env.TDTYPE || 'q8';
const MODE = process.env.MODE || 'size';   // size | jaccard
const TEMPLATE = (p) => `a black and white photograph of ${p}.`;
// Candidate thresholds in 0.1% steps: the strong model SATURATES — many
// images land above p=0.99 (and its p<0.2 tail is thin), so a percent grid
// capped at 0.99 clamps ~20% of terms far from their calibrated size.
const GRID_LO = 50, GRID_HI = 999;       // 0.050 … 0.999
const FLAG_BELOW = 0.6;                  // Jaccard under this → re-review by eye

const shipped = JSON.parse(fs.readFileSync(path.join(DATA, 'tags.json'), 'utf8'));
const verdicts = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-verdicts.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-candidates.json'), 'utf8'));
const scoresMeta = JSON.parse(fs.readFileSync(path.join(__dirname, SCORES), 'utf8'));
const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const prog = JSON.parse(fs.readFileSync(path.join(__dirname, `${TAG}-progress.json`), 'utf8'));
if (prog.done !== records.length) throw new Error(`embeddings incomplete: ${prog.done}/${records.length}`);
// The reference must be the OLD model's membership — running this after
// build-tags has already rewritten tags.json with the new model would just
// match the new model against itself. Restore it first:
//   git checkout main -- public/data/tags.json
if (shipped.model === scoresMeta.model) {
  throw new Error(`public/data/tags.json was already built with ${shipped.model} — restore the previous model's tags.json first`);
}
const STAMP = checkStamp(records.map((r) => r.id), 'build/records.json');
assertSameHarvest(prog.stamp, STAMP, `${TAG}-emb.i8`, 're-run the embed pass');
assertSameHarvest(scoresMeta.stamp, STAMP, SCORES, 're-run score-tags.js');

const MODEL = scoresMeta.model;
const { scale, bias } = scoresMeta;
const DIM = prog.dim;
const N = records.length;
const embBuf = fs.readFileSync(path.join(__dirname, `${TAG}-emb.i8`));
const emb = new Int8Array(embBuf.buffer, embBuf.byteOffset, embBuf.length);
if (emb.length !== N * DIM) throw new Error(`${TAG}-emb.i8 misaligned: ${emb.length} for ${N}×${DIM}`);

const rowOf = new Map(records.map((r, i) => [r.id, i]));
const byKey = new Map(candidates.map((c) => [c.key, c]));
console.log(`Transferring ${shipped.terms.length} shipped thresholds onto ${MODEL} (scale ${scale} · bias ${bias})…`);

const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const textModel = await SiglipTextModel.from_pretrained(MODEL, { dtype: TDTYPE });
const sig = (x) => 1 / (1 + Math.exp(-x));
const l2 = (v, off, dim) => { let n = 0; for (let d = 0; d < dim; d++) n += v[off + d] ** 2; return Math.sqrt(n) || 1; };

const out = {};
const report = [];
const BATCH = 32;
for (let c = 0; c < shipped.terms.length; c += BATCH) {
  const slice = shipped.terms.slice(c, c + BATCH);
  const tok = tokenizer(slice.map((t) => TEMPLATE((byKey.get(t.key) || {}).prompt || t.label)),
    { padding: 'max_length', max_length: 64, truncation: true });
  const { pooler_output } = await textModel(tok);
  const td = pooler_output.data;
  for (let s = 0; s < slice.length; s++) {
    const term = slice[s];
    const tv = new Float32Array(DIM);
    const tnorm = l2(td, s * DIM, DIM);
    for (let d = 0; d < DIM; d++) tv[d] = td[s * DIM + d] / tnorm;
    const oldRows = new Set(term.ids.map((id) => rowOf.get(id)).filter((r) => r !== undefined));
    // bucket every image's new probability in 0.1% steps, tracking old members
    const bucketAll = new Array(1001).fill(0), bucketOld = new Array(1001).fill(0);
    for (let r = 0; r < N; r++) {
      let dot = 0;
      const off = r * DIM;
      for (let d = 0; d < DIM; d++) dot += emb[off + d] * tv[d];
      const pm = Math.min(1000, Math.max(0, Math.floor(sig(scale * (dot / 127) + bias) * 1000)));
      bucketAll[pm]++;
      if (oldRows.has(r)) bucketOld[pm]++;
    }
    // walk the threshold grid tracking both objectives
    let best = { thr: 0.5, jaccard: -1, kept: 0 };
    let bestSize = { thr: 0.5, jaccard: 0, kept: 0, diff: Infinity };
    let newN = 0, inter = 0;
    for (let t = 1000; t >= GRID_LO; t--) {
      newN += bucketAll[t]; inter += bucketOld[t];
      if (t > GRID_HI) continue;
      const j = inter / (oldRows.size + newN - inter || 1);
      if (j > best.jaccard) best = { thr: t / 1000, jaccard: j, kept: newN };
      const diff = Math.abs(newN - oldRows.size);
      if (diff < bestSize.diff || (diff === bestSize.diff && j > bestSize.jaccard)) {
        bestSize = { thr: t / 1000, jaccard: j, kept: newN, diff };
      }
    }
    if (MODE === 'size') best = bestSize;
    out[term.key] = { thr: best.thr };
    report.push({ key: term.key, oldN: oldRows.size, thr: best.thr, newN: best.kept,
      jaccard: Math.round(best.jaccard * 100) / 100 });
  }
  process.stdout.write(`\r  ${Math.min(c + BATCH, shipped.terms.length)}/${shipped.terms.length} terms   `);
}

// dropped terms stay dropped, so a future full rebuild keeps honouring them
for (const [key, v] of Object.entries(verdicts)) if (v.drop) out[key] = { drop: true };

fs.writeFileSync(path.join(__dirname, 'tag-verdicts-transferred.json'), JSON.stringify(out, null, 1));

report.sort((a, b) => a.jaccard - b.jaccard);
const flagged = report.filter((r) => r.jaccard < FLAG_BELOW);
console.log(`\n\nWorst matches (Jaccard vs currently shipped membership):`);
for (const r of report.slice(0, 15)) {
  console.log(`  ${r.jaccard.toFixed(2)}  ${r.key.padEnd(24)} thr ${r.thr}  ${r.oldN} → ${r.newN}${r.jaccard < FLAG_BELOW ? '   ⚠ RE-REVIEW' : ''}`);
}
const meanJ = report.reduce((s, r) => s + r.jaccard, 0) / report.length;
console.log(`\n${report.length} terms transferred · mean Jaccard ${meanJ.toFixed(2)} · ${flagged.length} flagged (<${FLAG_BELOW}) for re-review`);
console.log(`Wrote build/tag-verdicts-transferred.json`);
console.log(`Next: TAG=${TAG} SCORES=${SCORES} VERDICTS=tag-verdicts-transferred.json node build/build-tags.js`);

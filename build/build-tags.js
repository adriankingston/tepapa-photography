// build/build-tags.js — turn calibrated verdicts into the shipped tag data.
//
// Reads Adrian's per-term verdicts from the review sheet (build/tag-verdicts.json:
// { key: { thr } | { drop: true } }), rescores each KEPT term against the full
// SigLIP 2 image matrix, and keeps every record at or above that term's
// threshold. Unreviewed terms simply don't ship — calibration is the gate.
//
//   in:  build/tag-verdicts.json, build/tag-candidates.json,
//        build/tag-scores.json (for the recovered logit scale/bias),
//        build/siglip2-emb.i8 (+ progress), build/records.json
//   out: public/data/tags.json  { model, terms: [{ key, label, group, thr, ids }] }
//        ids are sorted best-score-first so browsing a tag shows the
//        strongest matches at the top.
//
// Run:  node build/build-tags.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, SiglipTextModel, env } from '@huggingface/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data');
env.cacheDir = path.join(__dirname, '.hf-cache');

const verdicts = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-verdicts.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-candidates.json'), 'utf8'));
const scoresMeta = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-scores.json'), 'utf8'));
const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const prog = JSON.parse(fs.readFileSync(path.join(__dirname, 'siglip2-progress.json'), 'utf8'));
if (prog.done !== records.length) throw new Error(`embeddings incomplete: ${prog.done}/${records.length}`);

const MODEL = scoresMeta.model;
const { scale, bias } = scoresMeta;
const DIM = prog.dim;
const N = records.length;
const TEMPLATE = (p) => `a black and white photograph of ${p}.`;
const embBuf = fs.readFileSync(path.join(__dirname, 'siglip2-emb.i8'));
const emb = new Int8Array(embBuf.buffer, embBuf.byteOffset, embBuf.length);

const byKey = new Map(candidates.map((c) => [c.key, c]));
const kept = Object.entries(verdicts)
  .filter(([, v]) => !v.drop)
  .map(([key, v]) => ({ ...byKey.get(key), thr: v.thr }))
  .filter((t) => t.key);
const dropped = Object.values(verdicts).filter((v) => v.drop).length;
console.log(`Verdicts: ${kept.length} kept · ${dropped} dropped · ${candidates.length - kept.length - dropped} unreviewed (not shipped)`);
console.log(`Scoring ${kept.length} terms with ${MODEL} (scale ${scale} · bias ${bias})…`);

const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const textModel = await SiglipTextModel.from_pretrained(MODEL, { dtype: 'q8' });
const sig = (x) => 1 / (1 + Math.exp(-x));
const l2 = (v, off, dim) => { let n = 0; for (let d = 0; d < dim; d++) n += v[off + d] ** 2; return Math.sqrt(n) || 1; };

const terms = [];
const BATCH = 64;
for (let c = 0; c < kept.length; c += BATCH) {
  const slice = kept.slice(c, c + BATCH);
  const tok = tokenizer(slice.map((t) => TEMPLATE(t.prompt)), { padding: 'max_length', max_length: 64, truncation: true });
  const { pooler_output } = await textModel(tok);
  const td = pooler_output.data;
  for (let s = 0; s < slice.length; s++) {
    const t = slice[s];
    const tv = new Float32Array(DIM);
    const tnorm = l2(td, s * DIM, DIM);
    for (let d = 0; d < DIM; d++) tv[d] = td[s * DIM + d] / tnorm;
    const hits = [];
    for (let r = 0; r < N; r++) {
      let dot = 0;
      const off = r * DIM;
      for (let d = 0; d < DIM; d++) dot += emb[off + d] * tv[d];
      const p = sig(scale * (dot / 127) + bias);
      if (p >= t.thr) hits.push([r, p]);
    }
    hits.sort((a, b) => b[1] - a[1]);   // best-first, so browse leads with the strongest
    terms.push({ key: t.key, label: t.label, group: t.group, thr: t.thr, ids: hits.map(([r]) => records[r].id) });
  }
  process.stdout.write(`\r  ${Math.min(c + BATCH, kept.length)}/${kept.length} terms   `);
}

terms.sort((a, b) => b.ids.length - a.ids.length);
fs.writeFileSync(path.join(DATA, 'tags.json'), JSON.stringify({
  model: MODEL, template: TEMPLATE('{prompt}'), terms,
}));

const total = terms.reduce((s, t) => s + t.ids.length, 0);
const distinct = new Set(terms.flatMap((t) => t.ids)).size;
console.log(`\n${terms.length} tags · ${total.toLocaleString()} tag-assignments · ${distinct.toLocaleString()} distinct photographs (${(distinct / N * 100).toFixed(1)}%)`);
console.log(`Top 10: ${terms.slice(0, 10).map((t) => `${t.label} ${t.ids.length}`).join(' · ')}`);
console.log(`tags.json: ${(fs.statSync(path.join(DATA, 'tags.json')).size / 1048576).toFixed(2)} MB`);

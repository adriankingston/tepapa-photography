// build/benchmark-models.js — compare SigLIP 2 variants / dtypes / input
// sizes against Te Papa's own cataloguing BEFORE committing to a full
// re-embed of 54k images.
//
// Ground truth: photos whose catalogued `depicts` (subjects.json) carry one
// of 13 visually-unambiguous Category terms. For each candidate config we
// embed ~1,000 sampled images (≤40 positives per term + a 500-photo random
// pool that excludes all benchmark terms), score the production prompts, and
// report per-term AUC (positives vs pool) + the church↔wharenui argmax
// accuracy — the known confusion no threshold could cut. The pool surely
// hides a few uncatalogued positives; that noise is identical for every
// config, so comparisons stay fair even though absolute AUCs read low.
//
// Context (probed 2026-07-05): so400m-patch14-384 at dtype q8 is BROKEN
// (misranks unambiguous images). This benchmark exists to find which bigger
// export/dtype is sound, and what preview-resolution inputs buy.
//
//   in:  build/records.json, build/subjects.json, build/thumbs/, build/previews/
//   out: build/benchmark-sample.json   fixed sample (created once, seeded)
//        build/benchmark-results.json  per-config metrics, resumable
//
// Run:  node build/benchmark-models.js           (all configs, cheap first)
//       ONLY=so400m-p16-384:fp16 node build/benchmark-models.js
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, AutoTokenizer, SiglipVisionModel, SiglipTextModel, RawImage, env } from '@huggingface/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.join(__dirname, '.hf-cache');

const TEMPLATE = (p) => `a black and white photograph of ${p}.`;   // = production
const POS_PER_TERM = 40, POOL_N = 500;

// Benchmark terms: catalogued Category → the production candidate prompt.
const TERMS = [
  { key: 'geyser', cat: 'Geysers', prompt: 'a geyser erupting steam and water' },
  { key: 'waterfall', cat: 'Waterfalls', prompt: 'a waterfall dropping over rocks' },
  { key: 'church', cat: 'Churches', prompt: 'a church with steeple or bell tower' },
  { key: 'wharenui', cat: 'wharenui', prompt: 'a Māori meeting house with carved gable and bargeboards' },
  { key: 'dog', cat: 'Dogs', prompt: 'a dog' },
  { key: 'sheep', cat: 'Sheep', prompt: 'a flock of sheep' },
  { key: 'sailing-ship', cat: 'Sailing ships', prompt: 'a sailing ship with masts and rigging' },
  { key: 'glacier', cat: 'Glaciers', prompt: 'a glacier with crevassed ice' },
  { key: 'windmill', cat: 'Windmills', prompt: 'a windmill with sails or wind pump' },
  { key: 'lighthouse', cat: 'Lighthouses', prompt: 'a lighthouse on the coast' },
  { key: 'wedding', cat: 'Weddings', prompt: 'a bride in a wedding dress with a groom' },
  { key: 'motorcar', cat: 'Automobiles', prompt: 'an early motorcar' },
  { key: 'bridge', cat: 'Bridges', prompt: 'a road or foot bridge over a river' },
];

// vdtype/tdtype: candidates use q8 TEXT (fp16 text towers hit a broken
// SimplifiedLayerNormFusion at load in onnxruntime-node — seen on large-384,
// 2026-07-07), with ONE fp32-text validation config: if q8-text and fp32-text
// produce the same AUCs on identical vision embeddings, q8 text is sound.
// tdtype is a fallback list — first dtype that loads wins.
const CONFIGS = [
  { name: 'base-256:q8:thumb', model: 'onnx-community/siglip2-base-patch16-256-ONNX', vdtype: 'q8', tdtype: ['q8'], src: 'thumbs', batch: 16 },
  { name: 'base-256:q8', model: 'onnx-community/siglip2-base-patch16-256-ONNX', vdtype: 'q8', tdtype: ['q8'], src: 'previews', batch: 16 },
  { name: 'base-384:q8', model: 'onnx-community/siglip2-base-patch16-384-ONNX', vdtype: 'q8', tdtype: ['q8'], src: 'previews', batch: 16 },
  { name: 'large-384:q8', model: 'onnx-community/siglip2-large-patch16-384-ONNX', vdtype: 'q8', tdtype: ['q8'], src: 'previews', batch: 8 },
  { name: 'so400m-p16-384:q8', model: 'onnx-community/siglip2-so400m-patch16-384-ONNX', vdtype: 'q8', tdtype: ['q8'], src: 'previews', batch: 8 },
  { name: 'so400m-p16-384:int8', model: 'onnx-community/siglip2-so400m-patch16-384-ONNX', vdtype: 'int8', tdtype: ['q8'], src: 'previews', batch: 8 },
  { name: 'so400m-p16-384:q4f16', model: 'onnx-community/siglip2-so400m-patch16-384-ONNX', vdtype: 'q4f16', tdtype: ['q8'], src: 'previews', batch: 8 },
  { name: 'so400m-p16-384:fp16', model: 'onnx-community/siglip2-so400m-patch16-384-ONNX', vdtype: 'fp16', tdtype: ['q8'], src: 'previews', batch: 8 },
  { name: 'so400m-p16-384:fp16:tfp32', model: 'onnx-community/siglip2-so400m-patch16-384-ONNX', vdtype: 'fp16', tdtype: ['fp32'], src: 'previews', batch: 8 },
  { name: 'so400m-p14-384:fp16', model: 'onnx-community/siglip2-so400m-patch14-384-ONNX', vdtype: 'fp16', tdtype: ['q8'], src: 'previews', batch: 8 },
  // ceiling check: does int8 leave anything on the table vs full precision?
  { name: 'so400m-p16-384:fp32', model: 'onnx-community/siglip2-so400m-patch16-384-ONNX', vdtype: 'fp32', tdtype: ['q8'], src: 'previews', batch: 8 },
  // resolution check: previews are 1000px — does a 512px input buy more?
  { name: 'so400m-p16-512:int8', model: 'onnx-community/siglip2-so400m-patch16-512-ONNX', vdtype: 'int8', tdtype: ['q8'], src: 'previews', batch: 4 },
];

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const subjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'subjects.json'), 'utf8'));
const file = (src, id) => path.join(__dirname, src, `${id}.jpg`);
const onDisk = (id) => fs.existsSync(file('thumbs', id)) && fs.existsSync(file('previews', id));

/* ---- fixed sample (seeded — same photos for every config) ---------------- */
const SAMPLE_PATH = path.join(__dirname, 'benchmark-sample.json');
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function shuffled(a, rnd) { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }
function buildSample() {
  const catsOf = (id) => new Set(((subjects[id] || {}).d || []).filter(([t]) => t === 'c').map(([, x]) => x));
  const benchCats = new Set(TERMS.map((t) => t.cat));
  const rnd = lcg(20260707);
  const terms = {};
  for (const t of TERMS) {
    const pos = records.map((r) => r.id).filter((id) => catsOf(id).has(t.cat) && onDisk(id));
    terms[t.key] = shuffled(pos, rnd).slice(0, POS_PER_TERM);
    if (terms[t.key].length < 15) console.warn(`  ! only ${terms[t.key].length} usable positives for ${t.key}`);
  }
  const pool = shuffled(records.map((r) => r.id).filter((id) => {
    const c = catsOf(id);
    return onDisk(id) && ![...c].some((x) => benchCats.has(x));
  }), rnd).slice(0, POOL_N);
  const sample = { terms, pool };
  fs.writeFileSync(SAMPLE_PATH, JSON.stringify(sample));
  return sample;
}
const sample = fs.existsSync(SAMPLE_PATH) ? JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8')) : buildSample();
const allIds = [...new Set([...Object.values(sample.terms).flat(), ...sample.pool])];
console.log(`Sample: ${allIds.length} images (${Object.values(sample.terms).flat().length} positives over ${TERMS.length} terms + pool ${sample.pool.length})`);

/* ---- metrics -------------------------------------------------------------- */
function auc(pos, neg) {
  const all = pos.map((v) => [v, 1]).concat(neg.map((v) => [v, 0])).sort((a, b) => a[0] - b[0]);
  let sumPos = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j < all.length && all[j][0] === all[i][0]) j++;
    const mid = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (all[k][1]) sumPos += mid;
    i = j;
  }
  const nP = pos.length, nN = neg.length;
  return (sumPos - nP * (nP + 1) / 2) / (nP * nN);
}

/* ---- run configs ----------------------------------------------------------- */
const RESULTS_PATH = path.join(__dirname, 'benchmark-results.json');
const results = fs.existsSync(RESULTS_PATH) ? JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')) : {};
const only = process.env.ONLY;

const CACHE_DIR = path.join(__dirname, 'benchmark-embcache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

for (const cfg of CONFIGS) {
  if (only && cfg.name !== only) continue;
  if (results[cfg.name] && !results[cfg.name].error) { console.log(`✓ ${cfg.name} (cached)`); continue; }
  console.log(`\n=== ${cfg.name} — ${cfg.model} vision:${cfg.vdtype} text:${cfg.tdtype} src:${cfg.src}`);
  try {

  const processor = await AutoProcessor.from_pretrained(cfg.model);
  const tokenizer = await AutoTokenizer.from_pretrained(cfg.model);
  let text = null, usedTdtype = null;
  for (const td of cfg.tdtype) {
    try { text = await SiglipTextModel.from_pretrained(cfg.model, { dtype: td }); usedTdtype = td; break; }
    catch (e) { console.warn(`  ! text dtype ${td} failed to load: ${String(e).slice(0, 120)}`); }
  }
  if (!text) throw new Error('no text dtype loaded');

  // image embeddings — cached per (model, vdtype, src) so text-dtype variants
  // and re-runs skip the expensive vision pass
  const cachePath = path.join(CACHE_DIR, `${cfg.model.split('/')[1]}-${cfg.vdtype}-${cfg.src}.bin`);
  const emb = new Map();   // id → Float32Array (L2-normed)
  let dim = 0, imgPerSec = 0;
  if (fs.existsSync(cachePath)) {
    const buf = fs.readFileSync(cachePath);
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    dim = all.length / allIds.length;
    for (let k = 0; k < allIds.length; k++) emb.set(allIds[k], all.subarray(k * dim, (k + 1) * dim));
    imgPerSec = (results[cfg.name.split(':t')[0]] || {}).imgPerSec || 0;   // rate from the vision run
    console.log(`  vision embeddings from cache (dim ${dim})`);
  } else {
    const vision = await SiglipVisionModel.from_pretrained(cfg.model, { dtype: cfg.vdtype });
    const t0 = Date.now();
    for (let i = 0; i < allIds.length; i += cfg.batch) {
      const ids = allIds.slice(i, i + cfg.batch);
      const images = await Promise.all(ids.map((id) => RawImage.read(file(cfg.src, id))));
      const { pooler_output } = await vision(await processor(images));
      dim = pooler_output.dims[1];
      const d = pooler_output.data;
      for (let k = 0; k < ids.length; k++) {
        const v = new Float32Array(dim);
        let n = 0;
        for (let z = 0; z < dim; z++) n += d[k * dim + z] ** 2;
        n = Math.sqrt(n) || 1;
        for (let z = 0; z < dim; z++) v[z] = d[k * dim + z] / n;
        emb.set(ids[k], v);
      }
      process.stdout.write(`\r  ${Math.min(i + cfg.batch, allIds.length)}/${allIds.length}  (${((i + cfg.batch) / ((Date.now() - t0) / 1000)).toFixed(1)} img/s)   `);
    }
    imgPerSec = allIds.length / ((Date.now() - t0) / 1000);
    const all = new Float32Array(allIds.length * dim);
    allIds.forEach((id, k) => all.set(emb.get(id), k * dim));
    fs.writeFileSync(cachePath, Buffer.from(all.buffer));
  }

  // prompt embeddings
  const tok = tokenizer(TERMS.map((t) => TEMPLATE(t.prompt)), { padding: 'max_length', max_length: 64, truncation: true });
  const { pooler_output } = await text(tok);
  const td = pooler_output.data;
  const pvec = TERMS.map((_, s) => {
    const v = new Float32Array(dim);
    let n = 0;
    for (let z = 0; z < dim; z++) n += td[s * dim + z] ** 2;
    n = Math.sqrt(n) || 1;
    for (let z = 0; z < dim; z++) v[z] = td[s * dim + z] / n;
    return v;
  });
  const cos = (a, b) => { let s = 0; for (let z = 0; z < dim; z++) s += a[z] * b[z]; return s; };

  // per-term AUC vs the pool
  const perTerm = {};
  for (let ti = 0; ti < TERMS.length; ti++) {
    const t = TERMS[ti];
    const pos = sample.terms[t.key].map((id) => cos(emb.get(id), pvec[ti]));
    const neg = sample.pool.map((id) => cos(emb.get(id), pvec[ti]));
    perTerm[t.key] = Math.round(auc(pos, neg) * 1000) / 1000;
  }
  const meanAuc = Math.round(Object.values(perTerm).reduce((s, x) => s + x, 0) / TERMS.length * 1000) / 1000;

  // church ↔ wharenui argmax accuracy (the confusion test)
  const ci = TERMS.findIndex((t) => t.key === 'church'), wi = TERMS.findIndex((t) => t.key === 'wharenui');
  const acc = (ids, ownIdx, otherIdx) =>
    ids.filter((id) => cos(emb.get(id), pvec[ownIdx]) > cos(emb.get(id), pvec[otherIdx])).length / ids.length;
  const whVsChurch = {
    wharenuiCorrect: Math.round(acc(sample.terms.wharenui, wi, ci) * 100),
    churchCorrect: Math.round(acc(sample.terms.church, ci, wi) * 100),
  };

  results[cfg.name] = { model: cfg.model, vdtype: cfg.vdtype, tdtype: usedTdtype, src: cfg.src, dim,
    imgPerSec: Math.round(imgPerSec * 10) / 10, meanAuc, perTerm, whVsChurch };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 1));
  console.log(`\n  mean AUC ${meanAuc} · ${imgPerSec.toFixed(1)} img/s · wharenui→wharenui ${whVsChurch.wharenuiCorrect}% · church→church ${whVsChurch.churchCorrect}%`);
  // full 54k ETA at this rate
  console.log(`  full re-embed ETA at this rate: ${(54172 / imgPerSec / 3600).toFixed(1)} h`);

  } catch (e) {
    // record the failure and keep sweeping — a broken export must not kill the run
    console.error(`  ✗ ${cfg.name}: ${String(e).slice(0, 200)}`);
    results[cfg.name] = { error: String(e).slice(0, 300) };
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 1));
  }
}

/* ---- comparison table ------------------------------------------------------ */
console.log('\n== Comparison ==');
console.log(['config'.padEnd(22), 'AUC', 'img/s', 'wh%', 'ch%', 'worst terms'].join('  '));
for (const [name, r] of Object.entries(results)) {
  if (r.error) { console.log(`${name.padEnd(22)} FAILED: ${r.error.slice(0, 80)}`); continue; }
  const worst = Object.entries(r.perTerm).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log([name.padEnd(22), r.meanAuc.toFixed(3), String(r.imgPerSec).padStart(5), String(r.whVsChurch.wharenuiCorrect).padStart(3), String(r.whVsChurch.churchCorrect).padStart(3), worst].join('  '));
}

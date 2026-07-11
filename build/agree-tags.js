// build/agree-tags.js — Stage 3: score every candidate term by AGREEMENT
// between three independent signals, so vocabulary can ship without a human
// reviewing all 1,039 terms slider-by-slider:
//
//   A. SigLIP probability      (so400m-emb.i8 — how image-like the term is)
//   B. VLM mention             (captions.jsonl — does the 8b's caption/objects
//                               text contain the term's content words)
//   C. catalogue corroboration (subjects.json — is the photo catalogued with
//                               the same Category, for tepapa-sourced terms)
//
// For each term we sweep a SigLIP threshold grid and measure the VLM-mention
// rate INSIDE the kept set vs the base rate over all captioned photos: high
// lift = the two models agree what the term looks like. Terms are tiered:
//   corroborated — a threshold exists where VLM-mention rate ≥ MIN_RATE with
//                  lift ≥ MIN_LIFT and a usable set size → auto-shippable
//   weak         — some lift but never clears the bar → review sheet
//   no-support   — VLM never sees it where SigLIP does → likely not visual
//
// Runs on however much of captions.jsonl exists (the caption queue is
// shuffled, so a partial file is a fair sample); rerun as captions grow.
//
//   in:  build/records.json, build/so400m-emb.i8(+progress), build/tag-candidates.json,
//        build/so400m-tag-scores.json (scale/bias), build/captions.jsonl,
//        build/subjects.json, build/tag-verdicts.json
//   out: build/agreement-report.json
//
// Run:  node build/agree-tags.js
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, SiglipTextModel, pipeline, env } from '@huggingface/transformers';
import { checkStamp, assertSameHarvest } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.join(__dirname, '.hf-cache');

const TAG = process.env.TAG || 'so400m';
const SCORES = process.env.SCORES || 'so400m-tag-scores.json';
const MIN_RATE = Number(process.env.MIN_RATE || 0.5);   // VLM-mention rate inside the kept set
const MIN_LIFT = Number(process.env.MIN_LIFT || 4);     // vs the base rate over all photos
const MIN_N = Number(process.env.MIN_N || 10);          // usable set size (scaled to the sample)
const GRID = [0.5, 0.7, 0.9, 0.95, 0.99, 0.995, 0.999];

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const STAMP = checkStamp(records.map((r) => r.id), 'build/records.json');
const prog = JSON.parse(fs.readFileSync(path.join(__dirname, `${TAG}-progress.json`), 'utf8'));
assertSameHarvest(prog.stamp, STAMP, `${TAG}-emb.i8`, 're-run embed-siglip2.js');
const scoresMeta = JSON.parse(fs.readFileSync(path.join(__dirname, SCORES), 'utf8'));
assertSameHarvest(scoresMeta.stamp, STAMP, SCORES, 're-run score-tags.js');
const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-candidates.json'), 'utf8'));
const subjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'subjects.json'), 'utf8'));
const verdicts = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-verdicts.json'), 'utf8'));

const DIM = prog.dim, N = records.length;
const { scale, bias } = scoresMeta;
const embBuf = fs.readFileSync(path.join(__dirname, `${TAG}-emb.i8`));
const emb = new Int8Array(embBuf.buffer, embBuf.byteOffset, embBuf.length);
const rowOf = new Map(records.map((r, i) => [r.id, i]));

/* ---- captions: fold each photo's VLM text into a token set ----------------- */
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'with', 'in', 'on', 'at', 'by', 'to', 'photograph', 'black', 'white', 'sepia', 'image', 'view', 'showing']);
// Both sides (term labels AND caption text) fold through this — the plural
// rules only need to be consistent, not linguistically complete, but the
// common museum-vocabulary plurals must land on the caption's singular:
// churches→church (not 'churche'), women→woman, cemeteries→cemetery.
// The VLM writes AMERICAN English — the vocabulary is NZ/British — so the
// register map folds both to one side (measured: 'harbour' base rate was 0.000
// against captions full of harbors).
const IRREGULAR = {
  women: 'woman', men: 'man', children: 'child', wharve: 'wharf', people: 'person',
  harbour: 'harbor', colour: 'color', grey: 'gray', theatre: 'theater', centre: 'center',
  aeroplane: 'airplane', motorcar: 'automobile', moustache: 'mustache', waggon: 'wagon', plough: 'plow',
};
const foldWord = (w) => {
  let x = w.toLowerCase().replace(/[^a-zā-ū]/g, '');
  if (/(ches|shes|sses|xes)$/.test(x)) x = x.slice(0, -2);
  else if (/ies$/.test(x)) x = x.slice(0, -3) + 'y';
  else if (/s$/.test(x) && !/ss$/.test(x)) x = x.slice(0, -1);
  return IRREGULAR[x] || x;
};
const tokensOf = (s) => String(s || '').split(/[\s,;.·-]+/).map(foldWord).filter((w) => w.length > 2 && !STOP.has(w));

const photoTokens = new Map();   // id → Set of folded tokens from caption+objects+scene+building
for (const line of fs.readFileSync(path.join(__dirname, 'captions.jsonl'), 'utf8').split('\n')) {
  if (!line) continue;
  let j; try { j = JSON.parse(line); } catch { continue; }
  if (j.error || !rowOf.has(j.id)) continue;
  photoTokens.set(j.id, new Set([
    ...tokensOf(j.caption), ...(j.objects || []).flatMap(tokensOf),
    ...tokensOf(j.scene), ...tokensOf(j.building_type),
  ]));
}
const capIds = [...photoTokens.keys()];
const capRows = capIds.map((id) => rowOf.get(id));
console.log(`Captioned so far: ${capIds.length}/${N} (${(capIds.length / N * 100).toFixed(1)}%) — agreement is computed on this sample`);

/* ---- semantic mention signal: e5 caption ↔ label similarity ----------------- */
// Token matching alone misses register and phrasing (the VLM says 'pier',
// the vocabulary says 'wharf'); e5 cosine catches those. A photo "mentions"
// a term if EITHER the strict token match hits (high precision) OR the e5
// similarity clears SIM (recall for synonyms/register).
const SIM = Number(process.env.SIM || 0.86);
const E5_DIM = 384;
console.log('Embedding captions + labels with e5…');
const e5 = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });
const capText = new Map();   // id → raw caption+objects text (for e5)
for (const line of fs.readFileSync(path.join(__dirname, 'captions.jsonl'), 'utf8').split('\n')) {
  if (!line) continue;
  let j; try { j = JSON.parse(line); } catch { continue; }
  if (j.error || !rowOf.has(j.id)) continue;
  capText.set(j.id, `${j.caption || ''} ${(j.objects || []).join(', ')} ${j.building_type && j.building_type !== 'none' ? j.building_type : ''}`);
}
const capE5 = new Float32Array(capIds.length * E5_DIM);
for (let i = 0; i < capIds.length; i += 64) {
  const batch = capIds.slice(i, i + 64).map((id) => 'passage: ' + capText.get(id));
  const res = await e5(batch, { pooling: 'mean', normalize: true });
  capE5.set(res.data, i * E5_DIM);
  if (i % 1024 === 0) process.stdout.write(`\r  captions ${i}/${capIds.length}   `);
}
const labelE5 = new Float32Array(candidates.length * E5_DIM);
for (let i = 0; i < candidates.length; i += 64) {
  const batch = candidates.slice(i, i + 64).map((c) => 'query: a photograph of ' + c.label.toLowerCase());
  const res = await e5(batch, { pooling: 'mean', normalize: true });
  labelE5.set(res.data, i * E5_DIM);
}
console.log(`\r  e5 embedded ${capIds.length} captions + ${candidates.length} labels (SIM ≥ ${SIM})`);

/* ---- catalogue signal -------------------------------------------------------- */
const catsOf = (id) => new Set(((subjects[id] || {}).d || []).filter(([t]) => t === 'c').map(([, x]) => foldWord(x)));

/* ---- term matchers ------------------------------------------------------------ */
// content words from the label (the human-facing name is the best matcher;
// prompts carry scene dressing that would over-match)
const termTokens = (c) => [...new Set(tokensOf(c.label))];

/* ---- embed all candidate prompts (same tower + template as scoring) ---------- */
const MODEL = scoresMeta.model;
const TEMPLATE = (p) => `a black and white photograph of ${p}.`;
console.log(`Embedding ${candidates.length} prompts with ${MODEL}…`);
const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const textModel = await SiglipTextModel.from_pretrained(MODEL, { dtype: 'q8' });
const l2 = (v, off, dim) => { let n = 0; for (let d = 0; d < dim; d++) n += v[off + d] ** 2; return Math.sqrt(n) || 1; };
const sig = (x) => 1 / (1 + Math.exp(-x));
const termVecs = [];
for (let c = 0; c < candidates.length; c += 64) {
  const slice = candidates.slice(c, c + 64);
  const tok = tokenizer(slice.map((t) => TEMPLATE(t.prompt)), { padding: 'max_length', max_length: 64, truncation: true });
  const { pooler_output } = await textModel(tok);
  const td = pooler_output.data;
  for (let s = 0; s < slice.length; s++) {
    const tv = new Float32Array(DIM);
    const tnorm = l2(td, s * DIM, DIM);
    for (let d = 0; d < DIM; d++) tv[d] = td[s * DIM + d] / tnorm;
    termVecs.push(tv);
  }
  process.stdout.write(`\r  ${Math.min(c + 64, candidates.length)}/${candidates.length}   `);
}

/* ---- per-term agreement -------------------------------------------------------- */
console.log('\nScoring agreement…');
const report = [];
for (let ti = 0; ti < candidates.length; ti++) {
  const c = candidates[ti];
  const toks = termTokens(c);
  const labelFold = foldWord(c.label);
  // per captioned photo: SigLIP p, VLM mention, catalogue mention
  const ps = new Float32Array(capIds.length);
  const lex = new Uint8Array(capIds.length), sem = new Uint8Array(capIds.length), inCat = new Uint8Array(capIds.length);
  let lexBase = 0, semBase = 0;
  for (let k = 0; k < capIds.length; k++) {
    const off = capRows[k] * DIM;
    let dot = 0;
    const tv = termVecs[ti];
    for (let d = 0; d < DIM; d++) dot += emb[off + d] * tv[d];
    ps[k] = sig(scale * (dot / 127) + bias);
    const set = photoTokens.get(capIds[k]);
    lex[k] = toks.length && toks.every((t) => set.has(t)) ? 1 : 0;
    let e5dot = 0;
    for (let d = 0; d < E5_DIM; d++) e5dot += capE5[k * E5_DIM + d] * labelE5[ti * E5_DIM + d];
    sem[k] = (lex[k] || e5dot >= SIM) ? 1 : 0;
    lexBase += lex[k]; semBase += sem[k];
    inCat[k] = catsOf(capIds[k]).has(labelFold) ? 1 : 0;
  }
  // An undiscriminating semantic matcher (fires on >MAX_BASE of ALL captions —
  // real specific terms sit at 0.001–0.02) says nothing about THIS term; fall
  // back to the strict lexical signal for it.
  const MAX_BASE = 0.05;
  const useSem = semBase / capIds.length <= MAX_BASE;
  const mention = useSem ? sem : lex;
  const baseRate = (useSem ? semBase : lexBase) / capIds.length;
  // sweep the grid
  const curve = GRID.map((t) => {
    let n = 0, m = 0, cat = 0;
    for (let k = 0; k < capIds.length; k++) if (ps[k] >= t) { n++; m += mention[k]; cat += inCat[k]; }
    return { t, n, vlmRate: n ? Math.round(m / n * 100) / 100 : 0, catN: cat };
  });
  // best corroborated grid point (prefer the largest corroborated set).
  // Hard floor of MIN_N photos IN THE SAMPLE — auto-shipping needs real
  // evidence; rare terms simply wait until more captions exist.
  const minN = MIN_N;
  const okPoints = curve.filter((p) => p.n >= minN && p.vlmRate >= MIN_RATE && (baseRate === 0 ? p.vlmRate > 0 : p.vlmRate / baseRate >= MIN_LIFT));
  const best = okPoints.sort((a, b) => b.n - a.n)[0] || null;
  const anyLift = curve.some((p) => p.n >= minN && baseRate > 0 && p.vlmRate / baseRate >= 2 && p.vlmRate >= 0.2);
  report.push({
    key: c.key, label: c.label, src: c.src || '?', group: c.group,
    reviewed: verdicts[c.key] ? (verdicts[c.key].drop ? 'dropped' : 'shipped') : 'unreviewed',
    matchTokens: toks, matcher: useSem ? 'lexical+e5' : 'lexical-only', baseRate: Math.round(baseRate * 1000) / 1000,
    // no-vlm-signal ≠ drop-evidence: it can mean the VLM phrases the concept
    // differently (lake → 'body of water') — it only blocks AUTO-shipping.
    // generic-corroborated = the signals agree but the concept is so common
    // (Houses, Streets, men…) that whether it makes a good BROWSE tag is an
    // editorial call, not a statistical one.
    tier: best ? (baseRate > 0.05 ? 'generic-corroborated' : 'corroborated')
      : (anyLift || toks.length === 0 ? 'weak' : 'no-vlm-signal'),
    proposal: best ? { thr: best.t, sampleN: best.n, vlmRate: best.vlmRate, projectedN: Math.round(best.n * N / capIds.length) } : null,
    curve,
  });
  if (ti % 50 === 49) process.stdout.write(`\r  ${ti + 1}/${candidates.length}   `);
}

fs.writeFileSync(path.join(__dirname, 'agreement-report.json'), JSON.stringify({
  stamp: STAMP || undefined, model: MODEL, captioned: capIds.length, of: N,
  params: { MIN_RATE, MIN_LIFT, MIN_N }, terms: report,
}, null, 1));

/* ---- summary -------------------------------------------------------------------- */
const by = (f) => report.filter(f).length;
console.log(`\n\n== Agreement summary (on ${capIds.length} captioned photos) ==`);
for (const rev of ['shipped', 'unreviewed', 'dropped']) {
  const g = report.filter((r) => r.reviewed === rev);
  console.log(`${rev.padEnd(11)} ${String(g.length).padStart(4)} terms → corroborated ${g.filter((r) => r.tier === 'corroborated').length} · generic ${g.filter((r) => r.tier === 'generic-corroborated').length} · weak ${g.filter((r) => r.tier === 'weak').length} · no-vlm-signal ${g.filter((r) => r.tier === 'no-vlm-signal').length}`);
}
const auto = report.filter((r) => r.reviewed === 'unreviewed' && r.tier === 'corroborated');
console.log(`\nAuto-shippable NEW vocabulary (projected): ${auto.length} terms, ~${auto.reduce((s, r) => s + (r.proposal ? r.proposal.projectedN : 0), 0).toLocaleString()} assignments`);
console.log('Sample:', auto.slice(0, 15).map((r) => `${r.label} (${r.proposal.projectedN})`).join(' · '));

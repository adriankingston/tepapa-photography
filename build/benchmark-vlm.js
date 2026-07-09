// build/benchmark-vlm.js — bake off local VLMs (via Ollama) for the caption/
// tag pass, BEFORE committing ~2 days of compute to 54k images.
//
// The sample is hallucination BAIT, drawn from catalogued ground truth:
// carved wharenui vs ornate churches (the known confusion), ships, studio
// portraits (names bait), iconic places (Rotorua/Milford bait), Māori
// subjects (cultural-specificity bait — misattribution here is worse than
// silence), plus a random pool. Prompts forbid naming places/people/dates;
// leakage is measured, not trusted.
//
// Metrics per model: JSON-parse rate, sec/image, place-name + year leakage,
// wharenui↔church discrimination (a forced building_type choice), and
// object grounding (overlap with the photo's catalogued depicts terms).
// Raw outputs are kept for judging by eye/agent.
//
//   in:  build/records.json, build/subjects.json, build/previews/
//   out: build/vlm-sample.json      fixed sample (created once, seeded)
//        build/vlm-bakeoff.json     per-model metrics + raw outputs, resumable
//
// Run:  node build/benchmark-vlm.js                (all models)
//       MODELS=qwen3-vl:4b node build/benchmark-vlm.js
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT, SCHEMA } from './vlm-prompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OLLAMA = process.env.OLLAMA || 'http://localhost:11434';
// INSTRUCT variants only: the bare qwen3-vl tags alias the THINKING builds,
// which ignore think:false and burn ~2.5k hidden reasoning tokens per image
// (measured 2026-07-08: 31s/img of which vision prefill was 52ms).
const MODELS = (process.env.MODELS || 'qwen3-vl:2b-instruct,qwen3-vl:4b-instruct,qwen3-vl:8b-instruct,qwen3.6:35b-a3b').split(',');

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const subjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'subjects.json'), 'utf8'));
const preview = (id) => path.join(__dirname, 'previews', `${id}.jpg`);
const catsOf = (id) => new Set(((subjects[id] || {}).d || []).filter(([t]) => t === 'c').map(([, x]) => x));

/* ---- the bait sample (seeded, fixed) --------------------------------------- */
const SAMPLE_PATH = path.join(__dirname, 'vlm-sample.json');
const GROUPS = [
  { key: 'wharenui', cats: ['wharenui'], n: 8 },
  { key: 'church', cats: ['Churches'], n: 8 },
  { key: 'ship', cats: ['Sailing ships', 'Ships'], n: 6 },
  { key: 'portrait', cats: ['Portraits'], n: 6 },
  { key: 'place-bait', cats: ['Geysers', 'Glaciers', 'Mountains'], n: 6 },
  { key: 'maori-subject', cats: ['Indigenous peoples', 'Māori'], n: 6 },
  { key: 'pool', cats: null, n: 10 },
];
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function shuffled(a, rnd) { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }
function buildSample() {
  const rnd = lcg(20260708);
  const taken = new Set();
  const sample = [];
  for (const g of GROUPS) {
    const ids = records.map((r) => r.id).filter((id) => {
      if (taken.has(id) || !fs.existsSync(preview(id))) return false;
      if (!g.cats) return true;
      const c = catsOf(id);
      return g.cats.some((x) => c.has(x));
    });
    for (const id of shuffled(ids, rnd).slice(0, g.n)) { taken.add(id); sample.push({ id, group: g.key }); }
  }
  fs.writeFileSync(SAMPLE_PATH, JSON.stringify(sample, null, 1));
  return sample;
}
const sample = fs.existsSync(SAMPLE_PATH) ? JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8')) : buildSample();
console.log(`Sample: ${sample.length} photos (${GROUPS.map((g) => `${g.key} ${sample.filter((s) => s.group === g.key).length}`).join(' · ')})`);

/* ---- the ask ---------------------------------------------------------------- */

async function askOne(model, id, tries = 3) {
  const img = fs.readFileSync(preview(id)).toString('base64');
  for (let attempt = 1; ; attempt++) {
    try {
      const t0 = Date.now();
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: PROMPT, images: [img] }],
          format: SCHEMA,
          stream: false,
          think: false,   // hybrid-thinking models: reasoning tokens are pure latency here
          options: { temperature: 0 },
        }),
      });
      if (!r.ok) throw new Error(`ollama HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      const secs = (Date.now() - t0) / 1000;
      let parsed = null;
      try { parsed = JSON.parse(j.message.content); } catch { /* parse failure is a metric */ }
      return { secs, parsed, raw: parsed ? undefined : j.message.content.slice(0, 400) };
    } catch (e) {
      if (attempt >= tries) throw e;
      await new Promise((res) => setTimeout(res, attempt * 3000));
    }
  }
}

/* ---- leakage checks --------------------------------------------------------- */
// NZ place names + thermal-area names the models love to volunteer.
const PLACES = ['rotorua', 'whakarewarewa', 'pohutu', 'waimangu', 'wairakei', 'tarawera', 'milford', 'mitre peak', 'sutherland', 'aoraki', 'mount cook', 'mt cook', 'taranaki', 'egmont', 'tongariro', 'ruapehu', 'ngauruhoe', 'wellington', 'auckland', 'christchurch', 'dunedin', 'napier', 'nelson', 'queenstown', 'wanganui', 'whanganui', 'waikato', 'rotomahana', 'te papa', 'new zealand', 'zealand', 'maoriland', 'franz josef', 'fox glacier', 'wanaka', 'wakatipu', 'taupo', 'fiordland', 'mount egmont'];
const textOf = (p) => `${p.caption || ''} ${(p.objects || []).join(' ')}`.toLowerCase();
const placeLeaks = (p) => PLACES.filter((x) => textOf(p).includes(x));
const yearLeaks = (p) => (textOf(p).match(/\b1[89]\d\d\b|\b19th centur|\b18\d\ds\b|\b19\d\ds\b|victorian|edwardian/g) || []);

/* ---- grounding: objects vs catalogued depicts -------------------------------- */
const fold = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/s\b/g, '').trim();
function grounding(id, p) {
  const cats = [...catsOf(id)].map(fold);
  if (!cats.length) return null;
  const objs = (p.objects || []).map(fold);
  if (!objs.length) return 0;
  const hit = cats.filter((c) => objs.some((o) => o.includes(c) || c.includes(o))).length;
  return hit / cats.length;
}

/* ---- run --------------------------------------------------------------------- */
const OUT_PATH = path.join(__dirname, 'vlm-bakeoff.json');
const out = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : {};

for (const model of MODELS) {
  const clean = (r) => r && !Object.values(r.results).some((x) => x.error);
  if (out[model] && out[model].done && clean(out[model])) { console.log(`✓ ${model} (cached)`); continue; }
  console.log(`\n=== ${model}`);
  const m = out[model] = out[model] || { results: {} };
  for (const { id, group } of sample) {
    if (m.results[id] && !m.results[id].error) continue;   // errors retry on re-run
    try {
      const res = await askOne(model, id);
      m.results[id] = { group, ...res };
      process.stdout.write(`\r  ${Object.keys(m.results).length}/${sample.length}  (last ${res.secs.toFixed(1)}s)   `);
    } catch (e) {
      m.results[id] = { group, error: String(e).slice(0, 200) };
      process.stdout.write(`\n  ! ${id}: ${String(e).slice(0, 120)}\n`);
    }
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1));
  }
  m.done = true;
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1));
}

/* ---- scorecard ---------------------------------------------------------------- */
console.log('\n\n== Scorecard ==');
console.log(['model'.padEnd(18), 'ok', 's/img', 'leak', 'yr', 'wh✓', 'ch✓', 'ground'].join('  '));
for (const model of MODELS) {
  const rs = Object.entries(out[model].results);
  const ok = rs.filter(([, r]) => r.parsed);
  const secs = ok.reduce((s, [, r]) => s + r.secs, 0) / (ok.length || 1);
  const leaks = ok.filter(([, r]) => placeLeaks(r.parsed).length).length;
  const years = ok.filter(([, r]) => yearLeaks(r.parsed).length).length;
  const bt = (grp, want) => {
    const g = ok.filter(([, r]) => r.group === grp);
    return g.length ? Math.round(g.filter(([, r]) => (r.parsed.building_type || '').includes(want)).length / g.length * 100) : '-';
  };
  const gr = ok.map(([id, r]) => grounding(Number(id), r.parsed)).filter((x) => x !== null);
  const gmean = gr.reduce((s, x) => s + x, 0) / (gr.length || 1);
  console.log([model.padEnd(18), `${ok.length}/${rs.length}`, secs.toFixed(1).padStart(5),
    String(leaks).padStart(4), String(years).padStart(2),
    String(bt('wharenui', 'wharenui')).padStart(3), String(bt('church', 'church')).padStart(3),
    gmean.toFixed(2).padStart(6)].join('  '));
}
console.log('\nleak = photos whose caption/objects name a place · yr = date/era guesses');
console.log('wh✓/ch✓ = building_type correct on catalogued wharenui/church photos (%)');

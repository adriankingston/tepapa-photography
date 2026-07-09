// build/caption-previews.js — the full VLM caption/attribute pass over every
// downloaded preview, using the prompt + schema the bake-off validated
// (vlm-prompt.js) and the model the paired judge pass chose:
// qwen3-vl:8b-instruct (won 36–14 vs 4b, mean grounded 4.18/5, zero
// place/date leakage on the bait sample — see vlm-bakeoff.json and
// vlm-judge-verdicts.json for the receipts).
//
// Two concurrent requests (Ollama's parallel cap; measured 1.5× throughput).
// ~8.7 s/image effective → ~5.5 days for 54k. Fully resumable: results
// append to captions.jsonl as they land; on re-run, ids already captioned
// are skipped and errored ids retry. Safe to stop any time the machine is
// needed (Ctrl-C or kill), restart with the same command.
//
// visible_text is transcription of printed/written text and is LOW TRUST —
// both models garble old inscriptions (~30% of transcriptions had errors in
// judging). Cross-validate against title/place metadata before surfacing.
//
//   in:  build/records.json, build/previews/<id>.jpg
//   out: build/captions.jsonl       one JSON object per line, last entry per id wins
//        build/captions-meta.json   model + harvest stamp + prompt provenance
//
// Run:  caffeinate -i node build/caption-previews.js
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT, SCHEMA } from './vlm-prompt.js';
import { checkStamp } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OLLAMA = process.env.OLLAMA || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3-vl:8b-instruct';
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
const OUT_PATH = path.join(__dirname, 'captions.jsonl');
const META_PATH = path.join(__dirname, 'captions-meta.json');

const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const STAMP = checkStamp(records.map((r) => r.id), 'build/records.json');
const preview = (id) => path.join(__dirname, 'previews', `${id}.jpg`);

// resume: last entry per id wins (an errored line may be followed by a retry)
const done = new Map();
if (fs.existsSync(OUT_PATH)) {
  for (const line of fs.readFileSync(OUT_PATH, 'utf8').split('\n')) {
    if (!line) continue;
    try { const j = JSON.parse(line); done.set(j.id, j); } catch { /* torn tail line — redo */ }
  }
}
const meta = fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, 'utf8')) : { model: MODEL, stamp: STAMP, prompt: 'vlm-prompt.js v2', startedAt: new Date().toISOString() };
if (meta.model !== MODEL) throw new Error(`captions.jsonl was started with ${meta.model} — don't mix models in one file`);
if (STAMP && meta.stamp && meta.stamp !== STAMP) throw new Error(`captions.jsonl is for a different harvest (${meta.stamp} ≠ ${STAMP})`);
fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));

const pending = records.map((r) => r.id).filter((id) => {
  const d = done.get(id);
  return !d || d.error;
});
console.log(`Captioning with ${MODEL}: ${done.size} done, ${pending.length} to go (concurrency ${CONCURRENCY})`);

const out = fs.createWriteStream(OUT_PATH, { flags: 'a' });
async function askOne(id, tries = 3) {
  if (!fs.existsSync(preview(id))) return { id, error: 'no preview on disk' };
  const img = fs.readFileSync(preview(id)).toString('base64');
  for (let attempt = 1; ; attempt++) {
    try {
      const t0 = Date.now();
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: PROMPT, images: [img] }],
          format: SCHEMA, stream: false, think: false,
          options: { temperature: 0 },
        }),
      });
      if (!r.ok) throw new Error(`ollama HTTP ${r.status}`);
      const j = await r.json();
      const parsed = JSON.parse(j.message.content);   // schema-constrained; a parse throw retries
      return { id, ...parsed, secs: Math.round((Date.now() - t0) / 100) / 10 };
    } catch (e) {
      if (attempt >= tries) return { id, error: String(e).slice(0, 200) };
      await new Promise((res) => setTimeout(res, attempt * 5000));
    }
  }
}

const t0 = Date.now();
let cursor = 0, completed = 0, errors = 0;
async function worker() {
  while (cursor < pending.length) {
    const id = pending[cursor++];
    const res = await askOne(id);
    if (res.error) errors++;
    out.write(JSON.stringify(res) + '\n');
    completed++;
    if (completed % 25 === 0) {
      const rate = completed / ((Date.now() - t0) / 1000);
      const etaH = (pending.length - completed) / rate / 3600;
      process.stdout.write(`\r  ${completed}/${pending.length}  (${rate.toFixed(2)} img/s · ${errors} errors · eta ${etaH.toFixed(1)}h)   `);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
out.end();
console.log(`\nDone: ${completed} captioned this run, ${errors} errors (re-run to retry them).`);

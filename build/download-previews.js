// build/download-previews.js — fetch every record's 1000px preview derivative.
//
// The 480px thumbs are plenty for encoder models (they resize to ≤384px), but
// the VLM captioning pass reads real detail — signage, faces, midground
// activity — so it wants the 1000px preview (~130KB each, ~7GB total).
// Pre-rendered on Te Papa's side, so this is the gentlest bulk route.
//
// Resumable (skips files already on disk) and gentle on the media host:
// small concurrency pool + retry/backoff, same shape as download-thumbs.js.
//
//   in:  build/records.json
//   out: build/previews/<id>.jpg          (gitignored)
//        build/previews-failed.json       ids that never came back
//
// Run:  node build/download-previews.js            (all)
//       LIMIT=200 node build/download-previews.js  (first 200 — for a rate test)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEWS = path.join(__dirname, 'previews');
fs.mkdirSync(PREVIEWS, { recursive: true });

const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const LIMIT = Number(process.env.LIMIT || 0);

let records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
if (LIMIT) records = records.slice(0, LIMIT);

const url = (mid) => `https://media.tepapa.govt.nz/collection/${mid}/preview`;
const file = (id) => path.join(PREVIEWS, `${id}.jpg`);

async function getOne(rec, tries = 6) {
  const f = file(rec.id);
  try { if (fs.statSync(f).size > 0) return 'skip'; } catch { /* not present */ }
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url(rec.mid), { redirect: 'follow' });
      if (r.status === 404) return 'fail:404';   // permanent — retrying won't help
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100) throw new Error('tiny ' + buf.length);
      // write-then-rename so a mid-write kill can't leave a truncated file
      // that the resume skip-check (size > 0) would then trust forever
      fs.writeFileSync(f + '.part', buf);
      fs.renameSync(f + '.part', f);
      return 'ok';
    } catch (e) {
      if (attempt >= tries) return 'fail:' + e.message;
      await new Promise((res) => setTimeout(res, Math.min(700 * 2 ** attempt, 15000) + Math.random() * 500));
    }
  }
}

const t0 = Date.now();
let done = 0, ok = 0, skip = 0;
const failed = [];

async function worker(queue) {
  while (queue.length) {
    const rec = queue.pop();
    const res = await getOne(rec);
    done++;
    if (res === 'ok') ok++; else if (res === 'skip') skip++; else failed.push(rec.id);
    if (done % 100 === 0 || done === records.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r  ${done}/${records.length}  ok ${ok} · skip ${skip} · fail ${failed.length}  (${rate.toFixed(1)}/s)   `);
    }
  }
}

const queue = records.slice().reverse();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

fs.writeFileSync(path.join(__dirname, 'previews-failed.json'), JSON.stringify(failed));
console.log(`\nDownloaded ${ok}, skipped ${skip}, failed ${failed.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// build/validate-transcripts.js — cross-check the VLM's visible_text
// transcriptions against what the catalogue already knows.
//
// The 8b garbles old inscriptions often enough (~30% in judging: OKARO→
// OKAHO, BURTON BROS→'HUNTER CROSS') that raw transcripts can't ship. But
// most inscriptions repeat catalogue facts — the title, the photographer's
// imprint, the place — so token overlap with the record text separates
// faithful transcription from invention without any human review:
//   corroborated  ≥50% of content tokens appear in the record's own text
//   partial       ≥25% (typically the place matches, the plate number doesn't)
//   uncorroborated <25% — quarantine (could be genuine NEW info, could be
//                  garble; never surfaced without eyes)
//
//   in:  build/captions.jsonl, build/records.json
//   out: build/transcript-validation.json
//
// Run:  node build/validate-transcripts.js
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const byId = new Map(records.map((r) => [r.id, r]));

const SKIP = new Set(['photo', 'photograph', 'photographer', 'the', 'and', 'series', 'copyright', 'ltd', 'reg']);
const ABBREV = { bros: 'brother', co: 'company', mt: 'mount', sd: 'sound', nz: 'zealand' };
const fold = (w) => {
  let x = w.toLowerCase().replace(/[^a-z0-9ā-ū]/g, '');
  x = ABBREV[x] || x;
  return x.replace(/s$/, '');
};
const tokens = (s) => [...new Set(String(s || '').split(/[\s,.;:·&/-]+/).map(fold).filter((w) => w.length >= 3 && !SKIP.has(w)))];

const out = {};
const tiers = { corroborated: 0, partial: 0, uncorroborated: 0 };
let checked = 0;
for (const line of fs.readFileSync(path.join(__dirname, 'captions.jsonl'), 'utf8').split('\n')) {
  if (!line) continue;
  let j; try { j = JSON.parse(line); } catch { continue; }
  if (j.error || !j.visible_text || !j.visible_text.trim()) continue;
  const rec = byId.get(j.id);
  if (!rec) continue;
  const t = tokens(j.visible_text);
  if (!t.length) continue;
  // the record's own words: title, maker, place, date, plus the id digits
  const recTok = new Set([...tokens(`${rec.t} ${rec.m} ${rec.p} ${rec.d}`), String(rec.id)]);
  const hits = t.filter((x) => recTok.has(x) || (x.length >= 4 && [...recTok].some((r) => r.length >= 4 && (r.includes(x) || x.includes(r)))));
  const score = hits.length / t.length;
  const tier = score >= 0.5 ? 'corroborated' : score >= 0.25 ? 'partial' : 'uncorroborated';
  tiers[tier]++;
  checked++;
  out[j.id] = { text: j.visible_text.slice(0, 300), score: Math.round(score * 100) / 100, tier };
}

fs.writeFileSync(path.join(__dirname, 'transcript-validation.json'), JSON.stringify({
  checked, tiers, transcripts: out,
}, null, 1));

console.log(`Validated ${checked} transcripts against catalogue metadata:`);
for (const [k, n] of Object.entries(tiers)) console.log(`  ${k.padEnd(15)} ${n} (${(n / checked * 100).toFixed(1)}%)`);
const ex = (tier) => Object.entries(out).filter(([, v]) => v.tier === tier).slice(0, 3)
  .map(([id, v]) => `    ${id}: "${v.text.slice(0, 70)}" (${v.score})`).join('\n');
console.log('corroborated examples:\n' + ex('corroborated'));
console.log('uncorroborated examples:\n' + ex('uncorroborated'));

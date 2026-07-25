// build/build-v4-inputs.js — the v4 bulk-load policy (Adrian, 2026-07-17):
// every remaining ENGLISH candidate ships at the review sheet's 15% match
// floor as an honest, uncalibrated 'auto' tier; te reo / te ao Māori terms —
// and ALL ethnicity/people-classifier terms (auto-tagging ethnicity at 15%
// confidence is exactly what needs human judgement) — are reserved for his
// review in the sheet.
//
// Existing decisions are never overridden: the 104 calibrated thresholds,
// the 87 audited terms, and the 7 July drops all pass through from v3.
//
//   out: build/tag-verdicts-v4.json   v3 verdicts + {thr:0.15, mode:'auto'} English remainder
//        build/tag-reserved.json      what was held back, and why (for the report + sheet)
//
// Run:  node build/build-v4-inputs.js
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-candidates.json'), 'utf8'));
const v3 = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-verdicts-v3.json'), 'utf8'));

// te reo / te ao Māori subjects: kupu with word boundaries (the loose match
// caught 'hangi' inside 'hanging'), macrons in the KEY/LABEL (not prompts —
// botanical prompts mention raupō incidentally), and Māori-subject content.
const KUPU = /\b(māori|maori|whare|wharenui|marae|pā|waka|moko|kete|korowai|piupiu|poi|hāngī|hangi|tangi|haka|tiki|patu|taiaha|tukutuku|kōwhaiwhai|poupou|pātaka|pataka|hīnaki|hinaki|kapa|iwi|hapū|whānau|kāinga|kainga|waharoa|hui|whakairo|kākahu|huia)\b/i;
const ETHNICITY_KEYS = new Set(['tp-maori', 'tp-samoan', 'tp-cook-islands-maori', 'tp-tongan', 'tp-fijian', 'tp-chinese', 'tp-indian', 'tp-indigenous-peoples', 'tp-ethnic-groups']);
// botanical/landscape terms whose labels carry te reo plant names — English tier
const ENGLISH_OVERRIDE = new Set(['cabbage-trees', 'nikau-palms', 'swamps', 'mist', 'butchers-shops']);

const isReserved = (c) => {
  if (ENGLISH_OVERRIDE.has(c.key)) return false;
  if (ETHNICITY_KEYS.has(c.key)) return 'ethnicity classifier — human judgement required';
  if (KUPU.test(c.key + ' ' + c.label)) return 'te reo / te ao Māori subject';
  if (/[āēīōū]/.test(c.key + ' ' + c.label)) return 'te reo / te ao Māori subject';
  return false;
};

const verdicts = { ...v3 };
const reserved = [];
let added = 0;
for (const c of candidates) {
  if (verdicts[c.key]) continue;   // calibrated / audited / dropped — untouched
  const why = isReserved(c);
  if (why) { reserved.push({ key: c.key, label: c.label, why }); continue; }
  verdicts[c.key] = { thr: 0.15, mode: 'auto' };
  added++;
}

fs.writeFileSync(path.join(__dirname, 'tag-verdicts-v4.json'), JSON.stringify(verdicts, null, 1));
fs.writeFileSync(path.join(__dirname, 'tag-reserved.json'), JSON.stringify(reserved, null, 1));
console.log(`v4 verdicts: ${Object.keys(verdicts).length} entries (+${added} auto @ 0.15)`);
console.log(`reserved for Adrian: ${reserved.length}`);
for (const r of reserved) console.log('  ', r.key.padEnd(24), r.why);

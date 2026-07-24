// build/build-v3-inputs.js — assemble the v3 shipping inputs from the Stage 3
// evidence (2026-07: full-caption agreement pass + vision-agent audit).
//
// Produces:
//   build/tag-verdicts-v3.json    verdicts for build-tags: the 104 calibrated
//                                 terms (thresholds transferred by size onto
//                                 so400m) + the 87 agreement-corroborated
//                                 terms whose 4-photo boundary audit scored
//                                 ≥0.75 — each marked mode:'audited' so the
//                                 UI can label them honestly.
//   build/tag-prefill-v3.json     review-sheet prefill for everything routed
//                                 to Adrian's eyes: the 150 unaudited
//                                 corroborated terms, the 14 audit-flagged
//                                 ones, the 17 generic-corroborated, and
//                                 whaling (dropped in v1; the new model finds
//                                 a coherent set — his call).
//   public/data/transcripts.json  the CORROBORATED tier only (≥50% token
//                                 match with the record's own title/maker/
//                                 place): id → transcribed text, for search
//                                 and the labelled detail-view section.
//
// Run:  node build/build-v3-inputs.js
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStamp } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data');

const rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'agreement-report.json'), 'utf8'));
const audit = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-results.json'), 'utf8'));
const transferred = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-verdicts-transferred.json'), 'utf8'));
const tval = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcript-validation.json'), 'utf8'));

const auditP = new Map(audit.perTerm.map((t) => [t.key, t.precision]));
const auto = rep.terms.filter((t) => t.reviewed === 'unreviewed' && t.tier === 'corroborated');

// ---- verdicts: 104 transferred (calibrated) + 87 audited ---------------------
const verdicts = {};
for (const [key, v] of Object.entries(transferred)) verdicts[key] = { ...v, mode: 'calibrated' };
const shipped87 = auto.filter((t) => (auditP.get(t.key) ?? -1) >= 0.75);
for (const t of shipped87) verdicts[t.key] = { thr: t.proposal.thr, mode: 'audited' };
fs.writeFileSync(path.join(__dirname, 'tag-verdicts-v3.json'), JSON.stringify(verdicts, null, 1));

// ---- prefill: everything routed to the sheet ---------------------------------
const prefill = {};
for (const t of auto.filter((x) => (auditP.get(x.key) ?? -1) < 0.75)) prefill[t.key] = { thr: t.proposal.thr };
for (const t of rep.terms.filter((x) => x.reviewed === 'unreviewed' && x.tier === 'generic-corroborated')) {
  if (t.proposal) prefill[t.key] = { thr: t.proposal.thr };
}
prefill.whaling = { thr: 0.9 };   // dropped in v1; so400m finds a coherent 168-photo set
fs.writeFileSync(path.join(__dirname, 'tag-prefill-v3.json'), JSON.stringify(prefill, null, 1));

// ---- transcripts: corroborated tier only --------------------------------------
const transcripts = {};
let n = 0;
for (const [id, v] of Object.entries(tval.transcripts)) {
  if (v.tier === 'corroborated') { transcripts[id] = v.text; n++; }
}
const stamp = readStamp();
fs.writeFileSync(path.join(DATA, 'transcripts.json'), JSON.stringify({
  stamp: stamp ? stamp.stamp : undefined,
  note: 'AI transcriptions of text visible in the photographs (qwen3-vl:8b), shipped only where ≥50% of content tokens corroborate against the record’s own title/maker/place. See build/validate-transcripts.js.',
  transcripts,
}));

console.log(`verdicts: ${Object.keys(verdicts).length} terms (${Object.keys(transferred).length} calibrated + ${shipped87.length} audited)`);
console.log(`prefill for the sheet: ${Object.keys(prefill).length} terms`);
console.log(`transcripts shipped: ${n} (${(fs.statSync(path.join(DATA, 'transcripts.json')).size / 1048576).toFixed(2)} MB)`);

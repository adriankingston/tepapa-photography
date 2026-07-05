// build/tag-review-sheet.js — generate the human calibration sheet.
//
// A single self-contained HTML page (build/tag-review.html) showing, per
// candidate term, its top-scored images with scores. You set a per-term
// threshold (or drop the term) by eye; verdicts persist in localStorage and
// export as JSON for build-tags.js. Open directly (file://) — thumbs load
// relatively from build/thumbs/.
//
//   in:  build/tag-candidates.json, build/tag-scores.json, build/records.json
//   out: build/tag-review.html
//
// Run:  node build/tag-review-sheet.js && open build/tag-review.html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './tag-vocab.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-candidates.json'), 'utf8'));
const scores = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-scores.json'), 'utf8'));

const byKey = new Map(candidates.map((c) => [c.key, c]));
const groups = { ...GROUPS, tepapa: 'Te Papa catalogued terms' };
const data = scores.terms.map((t) => {
  const c = byKey.get(t.key) || {};
  return {
    key: t.key, label: c.label || t.key, prompt: c.prompt || '', group: c.group || 'tepapa',
    src: c.src || '?', n: c.n || 0, hist: t.hist,
    top: t.top.map(([row, p]) => [records[row].id, p]),
  };
});

const html = `<!doctype html>
<meta charset="utf-8">
<title>Tag calibration — ${data.length} candidate terms</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.45 -apple-system, sans-serif; margin: 0; display: flex; height: 100vh; }
  #side { width: 340px; flex: none; overflow-y: auto; border-right: 1px solid #8884; padding: 10px; }
  #main { flex: 1; overflow-y: auto; padding: 16px 20px; }
  h1 { font-size: 15px; margin: 4px 0 10px; }
  .g { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .6; margin: 14px 0 4px; }
  .t { display: flex; gap: 8px; align-items: baseline; padding: 2px 6px; border-radius: 5px; cursor: pointer; }
  .t:hover { background: #8882; }
  .t.on { background: #4a90d922; outline: 1px solid #4a90d9; }
  .t .k { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t .v { font-size: 11px; opacity: .55; }
  .t.done-keep .k::before { content: "✓ "; color: #2a9d4a; }
  .t.done-drop .k { text-decoration: line-through; opacity: .5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 14px; }
  .cell { position: relative; }
  .cell img { width: 100%; aspect-ratio: 3/4; object-fit: contain; background: #8881; border-radius: 4px; }
  .cell .p { position: absolute; top: 4px; left: 4px; font-size: 11px; padding: 1px 5px; border-radius: 3px; background: #000c; color: #fff; }
  .cell.below { opacity: .32; }
  .cell.below .p { background: #a00c; }
  #bar { position: sticky; top: 0; background: Canvas; padding: 10px 0; border-bottom: 1px solid #8884; z-index: 2; }
  #bar .row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  #thr { width: 260px; }
  button { font: inherit; padding: 4px 12px; border-radius: 6px; border: 1px solid #8886; background: none; cursor: pointer; }
  button:hover { border-color: #4a90d9; color: #4a90d9; }
  .meta { opacity: .65; font-size: 12px; }
  #export { margin-left: auto; }
  .hist { display: flex; align-items: flex-end; gap: 1px; height: 26px; margin: 8px 0; }
  .hist i { width: 10px; background: #4a90d9aa; display: block; }
</style>
<div id="side"></div>
<div id="main"><p style="opacity:.6">Pick a term on the left. Set its threshold with the slider (images dim below it), then Keep / Drop. Verdicts save locally; Export when done.</p></div>
<script>
const DATA = ${JSON.stringify(data)};
const GROUPS = ${JSON.stringify(groups)};
const LS = 'tepapa.tagreview.v1';
const verdicts = JSON.parse(localStorage.getItem(LS) || '{}');
const save = () => localStorage.setItem(LS, JSON.stringify(verdicts));
const side = document.getElementById('side');
const main = document.getElementById('main');
let current = null;

function renderSide() {
  const byG = {};
  for (const t of DATA) (byG[t.group] = byG[t.group] || []).push(t);
  let h = '<h1>' + DATA.length + ' candidate terms</h1>' +
    '<button id="export">Export verdicts JSON</button>';
  for (const g in byG) {
    const done = byG[g].filter((t) => verdicts[t.key]).length;
    h += '<div class="g">' + (GROUPS[g] || g) + ' · ' + done + '/' + byG[g].length + '</div>';
    for (const t of byG[g]) {
      const v = verdicts[t.key];
      const cls = 't' + (current === t.key ? ' on' : '') + (v ? (v.drop ? ' done-drop' : ' done-keep') : '');
      const info = v && !v.drop ? '≥' + v.thr : (t.src === 'tepapa' ? t.n + '×' : t.src);
      h += '<div class="' + cls + '" data-k="' + t.key + '"><span class="k">' + t.label + '</span><span class="v">' + info + '</span></div>';
    }
  }
  side.innerHTML = h;
}
function renderTerm(key) {
  current = key;
  const t = DATA.find((x) => x.key === key);
  const v = verdicts[key] || { thr: 0.5 };
  const maxH = Math.max.apply(null, t.hist.slice(1)) || 1;
  main.innerHTML =
    '<div id="bar"><div class="row"><b>' + t.label + '</b>' +
    '<span class="meta">' + t.prompt + ' · ' + (GROUPS[t.group] || t.group) + ' · source: ' + t.src + (t.n ? ' (' + t.n + ' catalogued)' : '') + '</span></div>' +
    '<div class="hist">' + t.hist.map((n, i) => '<i style="height:' + (i === 0 ? 2 : Math.max(2, n / maxH * 26)) + 'px" title="' + (i * 5) + '–' + (i * 5 + 5) + '%: ' + n + '"></i>').join('') + '</div>' +
    '<div class="row"><input type="range" id="thr" min="0.2" max="0.99" step="0.01" value="' + (v.thr || 0.5) + '">' +
    '<span id="thrv">≥ ' + (v.thr || 0.5) + '</span>' +
    '<button id="keep">Keep at threshold</button><button id="drop">Drop term</button></div></div>' +
    '<div class="grid">' + t.top.map(([id, p]) =>
      '<div class="cell" data-p="' + p + '"><img loading="lazy" src="thumbs/' + id + '.jpg"><span class="p">' + (p * 100).toFixed(0) + '%</span></div>'
    ).join('') + '</div>';
  const sync = () => {
    const thr = Number(document.getElementById('thr').value);
    document.getElementById('thrv').textContent = '≥ ' + thr;
    document.querySelectorAll('.cell').forEach((c) => c.classList.toggle('below', Number(c.dataset.p) < thr));
  };
  document.getElementById('thr').addEventListener('input', sync);
  document.getElementById('keep').addEventListener('click', () => {
    verdicts[key] = { thr: Number(document.getElementById('thr').value) }; save(); renderSide();
  });
  document.getElementById('drop').addEventListener('click', () => {
    verdicts[key] = { drop: true }; save(); renderSide();
  });
  sync();
  renderSide();
}
side.addEventListener('click', (e) => {
  if (e.target.id === 'export' || e.target.closest('#export')) {
    const out = JSON.stringify(verdicts, null, 1);
    navigator.clipboard && navigator.clipboard.writeText(out);
    const w = window.open(''); w.document.write('<pre>' + out.replace(/</g, '&lt;') + '</pre>');
    return;
  }
  const el = e.target.closest('.t');
  if (el) renderTerm(el.dataset.k);
});
renderSide();
</script>`;

fs.writeFileSync(path.join(__dirname, 'tag-review.html'), html);
console.log(`Wrote build/tag-review.html — ${data.length} terms. Open it, calibrate, Export → save as build/tag-verdicts.json`);

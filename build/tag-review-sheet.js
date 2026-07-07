// build/tag-review-sheet.js — generate the human calibration sheet.
//
// A single self-contained HTML page (build/tag-review.html) showing, per
// candidate term, its top-scored images with scores — AND, because the top
// hits are the easy wins, a sample of every 5% probability band (click a
// histogram bar) so the threshold can be set by looking at the DECISION
// BOUNDARY, where correct fades into wrong. A live readout shows how many
// photographs the current threshold would admit. You set a per-term
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
    bands: (t.bands || []).map((rows) => rows.map((row) => records[row].id)),
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
  button.is-on { border-color: #4a90d9; color: #4a90d9; }
  .meta { opacity: .65; font-size: 12px; }
  #export { margin-left: auto; }
  .hist { display: flex; align-items: flex-end; gap: 1px; height: 68px; margin: 8px 0 2px; }
  .hist i { width: 24px; background: #4a90d9aa; display: block; }
  .hist i.click { cursor: pointer; }
  .hist i.click:hover { background: #4a90d9; }
  .hist i.sel { background: #d97a4a; }
  .hist-cap { font-size: 11px; opacity: .55; margin: 0 0 6px; }
  #kept { font-variant-numeric: tabular-nums; }
  .view-note { font-size: 12px; opacity: .7; margin: 12px 0 -6px; }
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
let band = null;   // selected 5% band index, or null = top-hits view
function renderTerm(key, keepBand) {
  current = key;
  if (!keepBand) band = null;
  const t = DATA.find((x) => x.key === key);
  const v = verdicts[key] || { thr: 0.5 };
  const maxH = Math.max.apply(null, t.hist.slice(1)) || 1;
  const clickable = (i) => i >= 3 && t.bands[i] && t.bands[i].length;
  // the grid: either the top hits (with exact scores) or one band's sample
  let grid, note;
  if (band == null) {
    note = 'Top ' + t.top.length + ' hits — the easy wins. Click a histogram bar to inspect a probability band (that\\u2019s where the threshold lives).';
    grid = t.top.map(([id, p]) =>
      '<div class="cell" data-p="' + p + '"><img loading="lazy" src="thumbs/' + id + '.jpg"><span class="p">' + (p * 100).toFixed(0) + '%</span></div>').join('');
  } else {
    const lo = band * 5, hi = lo + 5, mid = (lo + hi) / 200;
    note = lo + '\\u2013' + hi + '% band \\u00b7 ' + t.hist[band].toLocaleString() + ' photograph' + (t.hist[band] === 1 ? '' : 's') +
      ' \\u00b7 showing an evenly-spaced sample of ' + t.bands[band].length + ' \\u00b7 <a href="#" id="back-top">back to top hits</a>';
    grid = t.bands[band].map((id) =>
      '<div class="cell" data-p="' + mid + '"><img loading="lazy" src="thumbs/' + id + '.jpg"><span class="p">' + lo + '\\u2013' + hi + '%</span></div>').join('');
  }
  main.innerHTML =
    '<div id="bar"><div class="row"><b>' + t.label + '</b>' +
    '<span class="meta">' + t.prompt + ' · ' + (GROUPS[t.group] || t.group) + ' · source: ' + t.src + (t.n ? ' (' + t.n + ' catalogued)' : '') + '</span></div>' +
    '<div class="hist">' + t.hist.map((n, i) =>
      '<i class="' + (clickable(i) ? 'click' : '') + (band === i ? ' sel' : '') + '" data-b="' + i + '" style="height:' + (i === 0 ? 2 : Math.max(3, n / maxH * 68)) + 'px" title="' + (i * 5) + '–' + (i * 5 + 5) + '%: ' + n + (clickable(i) ? ' — click to view a sample' : '') + '"></i>').join('') + '</div>' +
    '<p class="hist-cap">Score distribution, 5% bands. Click a bar (15%+) to see what that confidence level actually looks like.</p>' +
    '<div class="row"><input type="range" id="thr" min="0.2" max="0.99" step="0.01" value="' + (v.thr || 0.5) + '">' +
    '<span id="thrv">≥ ' + (v.thr || 0.5) + '</span>' +
    '<span class="meta" id="kept"></span>' +
    '<button id="keep">Keep at threshold</button><button id="drop">Drop term</button></div></div>' +
    '<p class="view-note">' + note + '</p>' +
    '<div class="grid">' + grid + '</div>';
  const sync = () => {
    const thr = Number(document.getElementById('thr').value);
    document.getElementById('thrv').textContent = '≥ ' + thr;
    // count admitted photographs from the histogram (partial first band pro-rated)
    let kept = 0;
    for (let i = 0; i < 20; i++) {
      const lo = i / 20, hi = (i + 1) / 20;
      if (thr <= lo) kept += t.hist[i];
      else if (thr < hi) kept += Math.round(t.hist[i] * (hi - thr) / 0.05);
    }
    document.getElementById('kept').textContent = '≈ ' + kept.toLocaleString() + ' photographs at this threshold';
    document.querySelectorAll('.cell').forEach((c) => c.classList.toggle('below', Number(c.dataset.p) < thr));
  };
  document.getElementById('thr').addEventListener('input', sync);
  document.getElementById('keep').addEventListener('click', () => {
    verdicts[key] = { thr: Number(document.getElementById('thr').value) }; save(); renderSide();
  });
  document.getElementById('drop').addEventListener('click', () => {
    verdicts[key] = { drop: true }; save(); renderSide();
  });
  main.querySelectorAll('.hist i.click').forEach((el) => el.addEventListener('click', () => {
    band = Number(el.dataset.b); renderTerm(key, true);
  }));
  const back = document.getElementById('back-top');
  if (back) back.addEventListener('click', (e) => { e.preventDefault(); band = null; renderTerm(key, true); });
  sync();
  renderSide();
}
side.addEventListener('click', (e) => {
  if (e.target.id === 'export' || e.target.closest('#export')) {
    // download directly — popups can be blocked on file:// pages
    const out = JSON.stringify(verdicts, null, 1);
    if (navigator.clipboard) navigator.clipboard.writeText(out).catch(() => {});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'application/json' }));
    a.download = 'tag-verdicts.json';
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  const el = e.target.closest('.t');
  if (el) renderTerm(el.dataset.k);
});
renderSide();
</script>`;

fs.writeFileSync(path.join(__dirname, 'tag-review.html'), html);
console.log(`Wrote build/tag-review.html — ${data.length} terms. Open it, calibrate, Export → save as build/tag-verdicts.json`);

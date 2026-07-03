/* ============================================================================
   Photographs — client for the editorial photography browser.

   Data: the openly-licensed photographs in Te Papa's collection, pulled live
   through the project's /api/search proxy. The pool is:

       collection:"Photography"
       AND hasRepresentation.rights.allowsDownload:true   (i.e. NOT All Rights Reserved)
       filtered to type:Object

   ~54k records. A free-text search ANDs the user's terms onto that base.

   Rights trap (see project memory): the rights filter matches at the RECORD
   level, so a qualifying record can still carry an All-Rights-Reserved image
   alongside the downloadable one. We therefore only ever render the image whose
   rights.allowsDownload === true, and skip records where none is downloadable.
   ============================================================================ */

'use strict';

const BASE = 'collection:"Photography" AND hasRepresentation.rights.allowsDownload:true';
const PAGE = 36;

const state = {
  query: '',        // user free-text (may be empty)
  mode: 'query',    // 'query' = live API search; 'mood' = a baked embedding set
  setName: null,    // active baked set ('emotion' | 'composition'), else null
  setKey: null,     // active term key within that set
  tgm: null,        // active TGM term id being browsed, else null
  decade: null,     // active decade FILTER, e.g. '1920s' — composes with any mode
  moodItems: [],    // prebuilt items for the current mood (mode === 'mood')
  from: 0,
  total: null,
  loading: false,
  done: false,
  seen: new Set(),  // dedupe by type:id across pages (scored result sets shift)
  items: [],        // flat list of rendered { ...record-ish } for the lightbox
  rendered: 0,      // running plate index for the wall labels
  scrollPending: false, // scroll to results after the first page of a new search/filter
};

const els = {
  plates: document.getElementById('plates'),
  state: document.getElementById('state'),
  sentinel: document.getElementById('sentinel'),
  endNote: document.getElementById('end-note'),
  emoNote: document.getElementById('emotion-note'),
  count: document.getElementById('count'),
  form: document.getElementById('search-form'),
  q: document.getElementById('q'),
  themes: document.getElementById('themes'),
};
const _emoDef = new Map();   // key → { label, def }

const SUGGESTIONS = [
  'Wellington', 'portrait', 'Burton Brothers', 'mountains', 'ships',
  'street', 'Māori', 'garden', 'children', 'snow', 'beach', 'crowd',
];

// Curated subsets that scroll as a full-width marquee. Each is a coherent
// *subject* (not a generic keyword), probed for solid, on-topic results; the
// query is ANDed onto the open-set BASE and the label shows in the search box.
const WAYS = [
  { term: 'portraits', q: 'portrait OR portraits' },
  { term: 'industry', q: 'industry OR industrial OR factory OR sawmilling' },
  { term: 'shipping', q: 'ship OR ships OR shipping OR steamer OR schooner' },
  { term: 'the war', label: 'war & soldiers', q: 'war OR soldiers OR military OR regiment OR troops' },
  { term: 'street life', label: 'streets', q: 'street OR township OR streetscape' },
  { term: 'tourism', q: 'tourist OR scenic OR resort OR "hot springs" OR sightseeing' },
  { term: 'mountains', q: 'mountains OR alps OR peak OR snow' },
  { term: 'the coast', label: 'coast', q: 'coast OR beach OR seaside OR surf' },
  { term: 'harbours', q: 'harbour OR wharf OR port OR jetty' },
  { term: 'rivers & lakes', q: 'river OR lake OR falls OR waterfall' },
  { term: 'railways', q: 'railway OR train OR locomotive' },
  { term: 'aviation', q: 'aviation OR aircraft OR aeroplane OR flying' },
  { term: 'gardens', q: 'garden OR flowers OR botanical' },
  { term: 'children', q: 'children OR child OR family' },
  { term: 'weddings', q: 'wedding OR bride OR "wedding party"' },
  { term: 'sport', q: 'sport OR rugby OR cricket OR athletics' },
  { term: 'farming', q: 'farming OR agriculture OR farm OR sheep' },
  { term: 'mining', q: 'mining OR "gold mine" OR goldfield OR quarry' },
  { term: 'Māori life', label: 'Māori', q: 'Māori OR pā OR marae OR whare' },
  { term: 'expeditions', q: 'expedition OR Antarctic OR Antarctica OR exploration' },
];

/* ---- Cultural sensitivity: mirror the main browser's check, and keep any
   potentially-sensitive imagery (human remains / deceased persons) out. ----- */
const SENSITIVE_TERMS = [
  'mummif', 'mummy', 'mummies', 'sarcophag',
  'mokomokai', 'toi moko', 'kōiwi', 'koiwi', 'tūpāpaku', 'tupapaku',
  'human remains', 'human skull', 'human skeleton', 'human bone',
  'human hair', 'human teeth', 'human skin',
  'shrunken head', 'preserved head', 'dried head', 'trophy head', 'severed head',
  'post-mortem', 'postmortem', 'post mortem', 'deathbed', 'death bed', 'tangihanga',
];
const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
function isSensitive(rec) {
  const materials = [rec.isMadeOfSummary, ...asArray(rec.isMadeOf).map((c) => c && c.title)]
    .filter(Boolean).join(' ').toLowerCase();
  if (materials.includes('human')) return true;
  const text = [rec.title, rec.caption, ...asArray(rec.isTypeOf).map((c) => c && c.title)]
    .filter(Boolean).join(' · ').toLowerCase();
  return SENSITIVE_TERMS.some((t) => text.includes(t));
}

/* ---- Helpers ------------------------------------------------------------- */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtInt = (n) => (n == null ? '—' : n.toLocaleString('en-NZ'));

// Only ever return an openly-licensed (downloadable) image; null = skip record.
function pickImage(rec) {
  const imgs = asArray(rec.hasRepresentation)
    .filter((r) => r && r.type === 'ImageObject' && r.thumbnailUrl);
  return imgs.find((r) => r.rights && r.rights.allowsDownload === true) || null;
}

function makerOf(rec) {
  for (const p of asArray(rec.production)) {
    if (p && p.contributor && p.contributor.title) return p.contributor.title;
  }
  return '';
}
function dateOf(rec) {
  for (const p of asArray(rec.production)) {
    if (!p) continue;
    const f = p.facetCreatedDate;
    // prefer a human-readable range, then the structured year, then raw fields
    if (p.verbatimCreatedDate) return p.verbatimCreatedDate;
    if (f && (f.verbatim || f.year)) return f.verbatim || f.year;
    if (p.createdDate) return p.createdDate;
  }
  return '';
}
function placeOf(rec) {
  for (const p of asArray(rec.production)) {
    if (p && p.spatial && p.spatial.title) return p.spatial.title;
  }
  return '';
}
function categoriesOf(rec) {
  return asArray(rec.isTypeOf).map((c) => c && c.title).filter(Boolean);
}
// Album records lead with a cover image (a leather book), not a photograph — skip
// them. (The API can't filter isTypeOf, so this is client-side.)
const isAlbum = (cats) => (cats || []).some((c) => /photograph album/i.test(c));
function recordUrl(rec) {
  return `https://collections.tepapa.govt.nz/object/${rec.id}`;
}

// CC deed link when the licence is a canonical Creative Commons one.
function rightsHtml(img) {
  const r = img && img.rights;
  if (!r || !r.title) return '';
  const cc = r.type === 'Licence' && typeof r.iri === 'string'
    && /^https?:\/\/creativecommons\.org\//.test(r.iri);
  return cc
    ? `<a href="${esc(r.iri)}" target="_blank" rel="license noopener">${esc(r.title)} ↗</a>`
    : esc(r.title);
}

/* ---- Fetching ------------------------------------------------------------ */
function buildQuery() {
  const q = state.query.trim();
  return q ? `(${q}) AND ${BASE}` : BASE;
}

async function fetchPage() {
  if (state.loading || state.done) return;
  state.loading = true;
  setState(state.rendered === 0 ? 'Developing the first plates…' : '');

  if (state.mode === 'mood') { renderMoodPage(); return; }

  const body = {
    query: buildQuery(),
    size: PAGE,
    from: state.from,
    filters: [{ field: 'type', keyword: 'Object' }],
    // Rank by Te Papa's own record quality score (best first) — applies to the
    // default browse, the curated subsets and searches. Also stabilises deep
    // paging (an explicit sort avoids the flaky scored-query ordering).
    sort: [{ field: '_meta.qualityScore', order: 'desc' }],
  };

  let json;
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    state.loading = false;
    setState(`Couldn’t reach the collection (${e.message}). Scroll to retry.`, true);
    return;
  }

  const results = Array.isArray(json.results) ? json.results : [];
  const count = json && json._metadata && json._metadata.resultset
    ? json._metadata.resultset.count : null;
  if (count != null && state.total !== count) {
    state.total = count;
    // With a decade filter on, the API total is the unfiltered count — show the
    // running matched count instead (updated after each page renders).
    if (!state.decade) els.count.textContent = fmtInt(count);
  }

  // Empty page → either truly done, or a flaky scored page. We retried via the
  // observer; treat a genuinely empty first page as "no results".
  if (!results.length) {
    state.done = true;
    state.loading = false;
    setState('');
    if (state.rendered === 0) showNoResults();
    else els.endNote.hidden = false;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const rec of results) {
    const key = `${rec.type}:${rec.id}`;
    if (state.seen.has(key)) continue;
    if (isSensitive(rec)) continue;
    if (isAlbum(categoriesOf(rec))) { state.seen.add(key); continue; }
    if (state.decade && !inDecade(yearOfRec(rec), state.decade)) { state.seen.add(key); continue; }
    const img = pickImage(rec);
    if (!img) continue;
    state.seen.add(key);

    const item = {
      id: rec.id,
      title: rec.title || '(untitled)',
      maker: makerOf(rec),
      date: dateOf(rec),
      place: placeOf(rec),
      category: categoriesOf(rec),
      caption: rec.caption || '',
      url: recordUrl(rec),
      img,
    };
    const idx = state.items.length;
    state.items.push(item);
    frag.appendChild(buildPlate(item, idx));
    state.rendered++;
  }

  els.plates.appendChild(frag);
  state.from += PAGE;
  state.loading = false;
  setState('');
  scrollToResultsIfPending();

  // With a decade filter, show the running matched count and keep filling (a
  // page can be mostly filtered out, leaving the sentinel unreached).
  if (state.decade) {
    els.count.textContent = fmtInt(state.rendered);
    if (!state.done) setTimeout(maybeLoadMore, 0);
  }

  // Stop when we've paged past the resultset — nothing rendered means the
  // decade filter (if on) dropped everything the search returned.
  if (state.total != null && state.from >= state.total) {
    state.done = true;
    if (state.rendered === 0) showNoResults();
    else els.endNote.hidden = false;
  }

  // Keep filling while the sentinel is still near the viewport — covers tall
  // screens and any case where the IntersectionObserver doesn't re-fire.
  if (!state.done) setTimeout(maybeLoadMore, 0);
}

/* ---- Rendering ----------------------------------------------------------- */
function buildPlate(item, idx) {
  const fig = document.createElement('figure');
  fig.className = 'plate' + (idx === 0 ? ' is-hero' : '');
  fig.dataset.idx = idx;

  const img = item.img;
  // Aspect ratio from rep metadata keeps the masonry from reflowing as images load.
  const ar = (img.width > 0 && img.height > 0)
    ? Math.min(3, Math.max(0.4, img.width / img.height)) : 1;
  // Hero gets the larger preview; grid plates use the lighter thumb-or-preview.
  const src = idx === 0 ? (img.previewUrl || img.thumbnailUrl)
                        : (img.previewUrl || img.thumbnailUrl);

  const number = String(idx + 1).padStart(3, '0');
  fig.innerHTML =
    `<div class="plate-img-wrap" style="aspect-ratio:${ar.toFixed(3)}">` +
      `<img class="plate-img" loading="lazy" decoding="async" ` +
        `src="${esc(src)}" alt="${esc(item.title)}">` +
    `</div>` +
    `<figcaption class="plate-label">` +
      `<span class="plate-index">${number}</span>` +
      `<h2 class="plate-title">${esc(item.title)}</h2>` +
      (item.maker ? `<p class="plate-maker">${esc(item.maker)}</p>` : '<span></span>') +
      (item.date ? `<p class="plate-date">${esc(item.date)}</p>` : '') +
    `</figcaption>`;

  fig.addEventListener('click', () => openLightbox(idx));
  return fig;
}

function setState(msg, isError) {
  if (!msg) { els.state.hidden = true; els.state.textContent = ''; els.state.classList.remove('is-error'); return; }
  els.state.hidden = false;
  els.state.classList.toggle('is-error', !!isError);
  els.state.innerHTML = (!isError && state.loading) ? `<span class="spinner"></span>${esc(msg)}` : esc(msg);
}

// Nothing to show. When a decade filter is on it's the likeliest culprit — a
// search can have plenty of matches that simply fall outside the chosen decade —
// so point the user at it.
function showNoResults() {
  setState(state.decade
    ? `No photographs match with the ${state.decade} decade filter on — try clearing it.`
    : 'No openly-licensed photographs match that search.', true);
}

/* ---- Reset on new search ------------------------------------------------- */
function resetState() {
  state.from = 0;
  state.total = null;
  state.loading = false;
  state.done = false;
  state.seen = new Set();
  state.items = [];
  state.rendered = 0;
  els.plates.innerHTML = '';
  els.endNote.hidden = true;
  if (els.emoNote) els.emoNote.hidden = true;
  els.count.textContent = '—';
  // Bring the results into view once the first page has rendered (scrolling now,
  // with the grid empty, would clamp short of the target as the page is tiny).
  state.scrollPending = true;
}
function scrollToResultsIfPending() {
  if (!state.scrollPending) return;
  state.scrollPending = false;
  const main = document.getElementById('main');
  if (!main) return;
  const y = main.getBoundingClientRect().top + window.scrollY - 12;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}
function resetAndLoad(query) {
  state.query = query || '';
  state.setName = null;
  state.setKey = null;
  state.tgm = null;
  // No text query but a decade is filtering → browse it from the baked index
  // rather than paging the whole API and dropping non-matches.
  if (!state.query && state.decade) { loadDecade(state.decade); return; }
  state.mode = 'query';
  resetState();
  fetchPage();
}

/* ---- Baked embedding sets: browse a category without a live query -------- */
// Two categories share one shape — an index (labels + one-line defs) and a data
// file { <listKey>:[{key,label,ids}], photos:{id:{…}} }: the 154 emotions from
// "The Book of Human Emotions" (build/embed-emotions.js) and the photographic
// composition & technique terms (build/embed-compositions.js).
const SETS = {
  emotion: {
    data: '/data/emotions.json', listKey: 'emotions',
    attribution: 'from <a href="https://en.wikipedia.org/wiki/Emotion_classification" target="_blank" rel="noopener"><em>The Book of Human Emotions</em></a>',
    loadingMsg: 'Gathering the feeling…', errorMsg: 'Couldn’t load that feeling.',
    cache: null,
  },
  composition: {
    data: '/data/compositions.json', listKey: 'compositions',
    attribution: 'a way of composing the frame',
    loadingMsg: 'Reading the frame…', errorMsg: 'Couldn’t load that composition.',
    cache: null,
  },
};
function itemFromIndex(id, e) {
  const base = `https://media.tepapa.govt.nz/collection/${e.mid}`;
  return {
    id, title: e.t || '(untitled)', maker: e.m || '', date: e.d || '',
    place: e.p || '', category: e.c || [], caption: '',
    url: `https://collections.tepapa.govt.nz/object/${id}`,
    img: {
      thumbnailUrl: `${base}/thumb`, previewUrl: `${base}/preview`, contentUrl: `${base}/full`,
      width: e.w || 0, height: e.h || 0, rights: { title: e.r || '', allowsDownload: true },
    },
  };
}
async function loadSet(setName, key) {
  const S = SETS[setName];
  if (!S) return;
  state.mode = 'mood';
  state.setName = setName;
  state.setKey = key;
  state.tgm = null;
  resetState();
  state.loading = true;   // block the scroll/observer from paging an empty list mid-fetch
  setState(S.loadingMsg);
  try {
    if (!S.cache) S.cache = await fetch(S.data).then((r) => r.json());
  } catch (e) {
    state.loading = false;
    setState(S.errorMsg, true);
    return;
  }
  const rec = (S.cache[S.listKey] || []).find((m) => m.key === key);
  const photos = S.cache.photos || {};
  const full = rec
    ? rec.ids.map((id) => ({ id, e: photos[id] }))
        .filter((x) => x.e && !isAlbum(x.e.c))
        .map((x) => itemFromIndex(x.id, x.e))
    : [];
  state.moodItems = state.decade ? full.filter((it) => itemInDecade(it, state.decade)) : full;
  state.total = state.moodItems.length;
  els.count.textContent = fmtInt(state.total);
  // head the results with the term's definition (and the decade, when filtered)
  if (els.emoNote) {
    const info = _emoDef.get(key) || {};
    const meta = `${fmtInt(state.total)} photographs · ${S.attribution}` +
      (state.decade ? ` · <span class="note-decade">${esc(state.decade)}</span>` : '');
    els.emoNote.innerHTML =
      `<h2 class="emotion-note-word">${esc(info.label || key)}</h2>` +
      (info.def ? `<p class="emotion-note-def">${esc(info.def)}</p>` : '') +
      `<p class="emotion-note-meta">${meta}</p>`;
    els.emoNote.hidden = false;
  }
  state.loading = false;
  fetchPage();
}

/* ---- Decade filter ------------------------------------------------------- */
// The decade a photo was taken can't be queried server-side (nested production.*
// fields return 0), so it's a client-side filter. It composes with any mode:
//   • emotion / composition sets — filter the baked items (in loadSet)
//   • free-text / subject searches — skip non-matching records as they page
//   • no other filter — browse that decade straight from the baked index
// index.json carries `y` (year taken) and `q` (quality score) per record.
let _indexCache = null;
const decadeOfYear = (y) => (y ? `${Math.floor(y / 10) * 10}s` : null);
const inDecade = (y, key) => y != null && decadeOfYear(y) === key;
const itemInDecade = (it, key) => inDecade(parseInt(it.date, 10) || null, key);
// A live record's year, from the same fields build-decades.js reads.
function yearOfRec(rec) {
  for (const p of asArray(rec.production)) {
    const f = p && p.facetCreatedDate;
    if (f) { const y = parseInt(f.year || f.temporal, 10); if (y >= 1800 && y <= 2035) return y; }
  }
  for (const p of asArray(rec.production)) {
    const c = p && (p.createdDate || p.verbatimCreatedDate);
    if (c) { const m = String(c).match(/\b(1[89]\d\d|20[0-3]\d)\b/); if (m) return parseInt(m[1], 10); }
  }
  return null;
}

// Browse a decade straight from the baked index (used when no other filter is
// active — far cheaper than paging the whole API and dropping non-matches).
async function loadDecade(key) {
  state.mode = 'mood';
  state.setName = null;
  state.setKey = null;
  state.tgm = null;
  resetState();
  state.loading = true;
  setState(`Winding back to the ${key}…`);
  try {
    if (!_indexCache) _indexCache = await fetch('/data/index.json').then((r) => r.json());
  } catch (e) {
    state.loading = false;
    setState('Couldn’t load the decades.', true);
    return;
  }
  state.moodItems = _indexCache
    .filter((e) => decadeOfYear(e.y) === key && !isAlbum(e.c))
    .sort((a, b) => (b.q || 0) - (a.q || 0))   // best first, like the rest of the app
    .map((e) => itemFromIndex(e.id, e));
  state.total = state.moodItems.length;
  els.count.textContent = fmtInt(state.total);
  if (els.emoNote) {
    els.emoNote.innerHTML =
      `<h2 class="emotion-note-word">The ${esc(key)}</h2>` +
      `<p class="emotion-note-meta">${fmtInt(state.total)} photographs · by year taken</p>`;
    els.emoNote.hidden = false;
  }
  state.loading = false;
  fetchPage();
}

/* ---- TGM: browse a Thesaurus for Graphic Materials term ------------------ */
// Controlled vocabulary from the LC crosswalk. index.json carries `tg`
// (catalogued TGM ids) and `tgc` (CLIP-suggested). Browse filters the baked
// index, like a decade. tgm-index (labels/scope/counts) + crosswalk (raw Te Papa
// term → TGM, for the detail view) load on demand.
const _tgm = new Map();          // id → { label, scope, count, sug, kind, bt }
const _tgmLookup = new Map();    // normalised label → id (searchable)
let _tgmArr = [];                // terms sorted by frequency (for the browse panel)
let _tgmXwalk = null;            // raw Te Papa term → { id, label }
let _tgmIndexP = null, _tgmXwalkP = null;
function loadTgmIndex() {
  if (!_tgmIndexP) _tgmIndexP = fetch('/data/tgm-index.json').then((r) => r.json()).then((idx) => {
    _tgmArr = idx.terms || [];
    for (const t of _tgmArr) { _tgm.set(t.id, t); _tgmLookup.set(normEmo(t.label), t.id); }
    const c = document.getElementById('tgm-count'); if (c) c.textContent = fmtInt(_tgmArr.length);
  }).catch(() => {});
  return _tgmIndexP;
}
function loadTgmXwalk() {
  if (!_tgmXwalkP) _tgmXwalkP = fetch('/data/tgm-crosswalk.json').then((r) => r.json()).then((x) => { _tgmXwalk = x; }).catch(() => {});
  return _tgmXwalkP;
}

async function loadTgm(id) {
  state.mode = 'mood';
  state.setName = null;
  state.setKey = null;
  state.tgm = id;
  resetState();
  state.loading = true;
  await loadTgmIndex();
  const term = _tgm.get(id);
  setState('Gathering the subject…');
  try {
    if (!_indexCache) _indexCache = await fetch('/data/index.json').then((r) => r.json());
  } catch (e) { state.loading = false; setState('Couldn’t load the collection index.', true); return; }
  const dec = state.decade;
  const cat = [], sug = [];
  for (const e of _indexCache) {
    if (isAlbum(e.c)) continue;
    if (dec && decadeOfYear(e.y) !== dec) continue;
    if ((e.tg || []).includes(id)) cat.push(e);
    else if ((e.tgc || []).includes(id)) sug.push(e);
  }
  cat.sort((a, b) => (b.q || 0) - (a.q || 0));
  sug.sort((a, b) => (b.q || 0) - (a.q || 0));
  state.moodItems = [...cat, ...sug].map((e) => itemFromIndex(e.id, e));
  state.total = state.moodItems.length;
  els.count.textContent = fmtInt(state.total);
  if (els.emoNote) {
    const label = term ? term.label : `TGM ${id}`;
    const meta = `${fmtInt(cat.length)} catalogued` + (sug.length ? ` · ${fmtInt(sug.length)} suggested` : '') +
      ` · <em>Thesaurus for Graphic Materials</em>` + (dec ? ` · <span class="note-decade">${esc(dec)}</span>` : '');
    els.emoNote.innerHTML =
      `<h2 class="emotion-note-word">${esc(label)}</h2>` +
      (term && term.scope ? `<p class="emotion-note-def">${esc(term.scope)}</p>` : '') +
      `<p class="emotion-note-meta">${meta}</p>`;
    els.emoNote.hidden = false;
  }
  state.loading = false;
  fetchPage();
}

// Re-run whatever is currently showing (respecting state.decade). Called when the
// decade filter is toggled so it composes with the active browse.
function runView() {
  if (state.tgm) loadTgm(state.tgm);                         // a TGM subject/genre
  else if (state.setName) loadSet(state.setName, state.setKey); // emotion / composition
  else if (state.query) resetAndLoad(state.query);           // free-text / subject
  else if (state.decade) loadDecade(state.decade);           // decade on its own
  else resetAndLoad('');                                     // default browse
}

function renderMoodPage() {
  const slice = state.moodItems.slice(state.from, state.from + PAGE);
  const frag = document.createDocumentFragment();
  for (const item of slice) {
    const idx = state.items.length;
    state.items.push(item);
    frag.appendChild(buildPlate(item, idx));
    state.rendered++;
  }
  els.plates.appendChild(frag);
  state.from += PAGE;
  state.loading = false;
  setState('');
  scrollToResultsIfPending();
  if (state.from >= state.moodItems.length) {
    state.done = true;
    if (state.rendered === 0) showNoResults();
    else els.endNote.hidden = false;
  }
  if (!state.done) setTimeout(maybeLoadMore, 0);
}

/* ---- Lightbox ------------------------------------------------------------ */
const lb = {
  el: document.getElementById('lightbox'),
  scroll: document.getElementById('lb-scroll'),
  viewer: document.getElementById('lb-viewer'),
  meta: document.getElementById('lb-caption'),
  close: document.getElementById('lb-close'),
  prev: document.getElementById('lb-prev'),
  next: document.getElementById('lb-next'),
  zoomIn: document.getElementById('lb-zoom-in'),
  zoomOut: document.getElementById('lb-zoom-out'),
  idx: -1,
  _token: 0,   // bumped each render so a slow record fetch can't overwrite a newer view
};

/* ---- IIIF deep-zoom viewer (OpenSeadragon) ------------------------------- */
// Te Papa serves a IIIF Image API 2.0 keyed by the media id we already store
// (mid): https://iiif.tepapa.govt.nz/iiif/2/<mid>. OpenSeadragon gives smooth,
// tiled zoom from fit all the way to native resolution — scroll / pinch /
// double-click to zoom, drag to pan.
const IIIF_BASE = 'https://iiif.tepapa.govt.nz/iiif/2/';
const midOf = (img) => (String((img && (img.thumbnailUrl || img.contentUrl)) || '').match(/\/collection\/(\d+)\//) || [])[1] || '';
let osd = null;
function getViewer() {
  if (osd) return osd;
  osd = OpenSeadragon({
    element: lb.viewer,
    prefixUrl: '',                 // no default control sprites — we hide them
    showNavigationControl: false,
    showNavigator: false,
    crossOriginPolicy: 'Anonymous',
    immediateRender: true,
    visibilityRatio: 1,
    minZoomImageRatio: 0.8,
    maxZoomPixelRatio: 2.5,        // allow a little past 1:1 native pixels
    animationTime: 0.5,
    springStiffness: 8,
    gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true, flickEnabled: true },
    gestureSettingsTouch: { dblClickToZoom: true, pinchToZoom: true, flickEnabled: true },
  });
  // If the IIIF endpoint fails, fall back to the plain full-size derivative.
  osd.addHandler('open-failed', () => {
    const item = state.items[lb.idx];
    const url = item && item.img && (item.img.contentUrl || item.img.previewUrl);
    if (url && !osd._fellBack) { osd._fellBack = true; osd.open({ type: 'image', url }); }
  });
  return osd;
}
function showInViewer(item) {
  const v = getViewer();
  v._fellBack = false;
  const mid = midOf(item.img);
  if (mid) v.open(`${IIIF_BASE}${mid}/info.json`);
  else v.open({ type: 'image', url: item.img.contentUrl || item.img.previewUrl });
}

function openLightbox(idx) {
  lb.idx = idx;
  lb.el.hidden = false;            // reveal first so the viewer element has a size
  document.body.classList.add('lb-open');
  renderLightbox();
}
function closeLightbox() {
  lb.el.hidden = true;
  document.body.classList.remove('lb-open');
  if (osd) osd.close();            // unload tiles / stop fetching
  lb.idx = -1;
}
function step(d) {
  const n = lb.idx + d;
  if (n < 0 || n >= state.items.length) return;
  lb.idx = n;
  renderLightbox();
  // Prefetch more if nearing the end while paging through the lightbox.
  if (n > state.items.length - 6) fetchPage();
}
// The grid item is lean; fetch the full record on demand for the detail panel
// so the rich fields (description, subjects, credit…) show in EVERY browse mode,
// not just live search. Promise-cached by id to dedupe concurrent opens.
const _recCache = new Map();
function fetchRecord(id) {
  if (_recCache.has(id)) return _recCache.get(id);
  const p = fetch('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `id:${id}`, size: 1, filters: [{ field: 'type', keyword: 'Object' }] }),
  }).then((r) => r.json()).then((j) => (j.results && j.results[0]) || null).catch(() => null);
  _recCache.set(id, p);
  return p;
}

// Descriptions are museum-authored HTML — keep a safe subset (paragraphs, bold,
// emphasis, lists, http links) and drop everything else.
const _DESC_TAGS = { A: 'a', P: 'p', BR: 'br', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', UL: 'ul', OL: 'ol', LI: 'li' };
function sanitizeDesc(html) {
  const walk = (node) => {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      const tag = _DESC_TAGS[n.tagName];
      const inner = walk(n);
      if (!tag) { out += inner; return; }
      if (tag === 'br') { out += '<br>'; return; }
      if (tag === 'a') {
        const href = n.getAttribute('href') || '';
        out += /^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : inner;
        return;
      }
      out += `<${tag}>${inner}</${tag}>`;
    });
    return out;
  };
  return walk(new DOMParser().parseFromString(String(html || ''), 'text/html').body).trim();
}

// depicts / refersTo → clickable chips that search the term (deduped by title).
function subjectChips(list) {
  const seen = new Set();
  return (list || []).map((x) => x && x.title).filter((t) => t && !seen.has(t) && seen.add(t))
    .map((t) => `<button type="button" class="lb-subject" data-q="${esc(t)}">${esc(t)}</button>`).join('');
}
// Prefer the image extent; render as "301 × 212 mm".
function physicalSize(dims) {
  const a = (dims || []).filter((d) => d && (d.title || (d.width && d.height)));
  if (!a.length) return '';
  const d = a.find((x) => x.extentType === 'Image') || a[0];
  return (d.width && d.height) ? `${d.width} × ${d.height} ${d.sizeUnitText || 'mm'}` : (d.title || '');
}
const isAlbumRec = (rec) => isAlbum((rec.isTypeOf || []).map((c) => c && c.title));

function metaHtml(item, rec) {
  const img = item.img;
  const dl = img.rights && img.rights.allowsDownload && img.contentUrl;
  const fact = (label, val) => (val ? `<div><dt>${label}</dt><dd>${val}</dd></div>` : '');
  const j = (list) => (list || []).map((x) => x && x.title).filter(Boolean).join(', ');
  const desc = rec && rec.description ? sanitizeDesc(rec.description) : '';
  const depicts = rec ? subjectChips(rec.depicts) : '';
  const refers = rec ? subjectChips(rec.refersTo) : '';
  const classification = (rec && rec.isTypeOf && rec.isTypeOf.length) ? j(rec.isTypeOf)
    : (item.category && item.category.length ? item.category.join(', ') : '');
  const albumParts = rec && isAlbumRec(rec) && Array.isArray(rec.hasPart) ? rec.hasPart.length : 0;

  // TGM controlled-vocabulary classification: crosswalk this record's own genre
  // and subject terms onto TGM. Chips browse the whole collection by that term.
  let tgm = '';
  if (_tgmXwalk && rec) {
    const seen = new Set();
    const chip = (title) => { const x = _tgmXwalk[title]; if (x && !seen.has(x.id)) { seen.add(x.id); return `<button type="button" class="lb-tgm" data-tgm="${x.id}">${esc(x.label)}</button>`; } return ''; };
    const chips = (rec.isTypeOf || []).map((c) => c && c.title).filter(Boolean).map(chip).join('') +
      (rec.depicts || []).filter((d) => d && d.type === 'Category').map((d) => d.title).map(chip).join('');
    if (chips) tgm = `<div class="lb-subjects lb-tgm-group"><span class="lb-subjects-label">AI-catalogued against the Library of Congress <a href="https://id.loc.gov/vocabulary/graphicMaterials.html" target="_blank" rel="noopener">Thesaurus for Graphic Materials</a></span><div class="lb-chips">${chips}</div></div>`;
  }
  // the maker links to their other works (phrase search of the name)
  const maker = item.maker ? `<button type="button" class="lb-maker" data-q="${esc(item.maker)}">${esc(item.maker)}</button>` : '';
  return (
    `<h2 class="lb-title">${esc((rec && rec.title) || item.title)}</h2>` +
    ((item.maker || item.date || item.place)
      ? `<p class="lb-byline">${[maker, esc(item.date), esc(item.place)].filter(Boolean).join(' · ')}</p>` : '') +
    (desc ? `<div class="lb-desc">${desc}</div>`
          : (item.caption ? `<p class="lb-caption-text">${esc(item.caption)}</p>` : '')) +
    (albumParts ? `<p class="lb-album">An album of ${albumParts} photographs.</p>` : '') +
    (depicts ? `<div class="lb-subjects"><span class="lb-subjects-label">In this photograph (Te Papa cataloguing)</span><div class="lb-chips">${depicts}</div></div>` : '') +
    (refers ? `<div class="lb-subjects"><span class="lb-subjects-label">References</span><div class="lb-chips">${refers}</div></div>` : '') +
    tgm +
    `<dl class="lb-facts">` +
      fact('Maker', maker) +
      fact('Date', esc(item.date)) +
      fact('Place', esc(item.place)) +
      fact('Classification', esc(classification)) +
      fact('Medium', esc(rec && rec.isMadeOfSummary)) +
      fact('Technique', esc(rec && j(rec.productionUsedTechnique))) +
      fact('Measurements', esc(rec && physicalSize(rec.observedDimension))) +
      fact('Image', (img.width && img.height) ? `${img.width} × ${img.height} px` : '') +
      fact('Credit line', esc(rec && rec.creditLine)) +
      fact('Registration', esc(rec && rec.identifier)) +
      fact('Licence', rightsHtml(img) || 'Downloadable') +
    `</dl>` +
    `<p class="lb-links">` +
      (dl ? `<a href="${esc(img.contentUrl)}" target="_blank" rel="noopener" download>Download full image ↓</a><span class="sep">·</span>` : '') +
      `<a href="${esc(item.url)}" target="_blank" rel="noopener">View on Te Papa ↗</a>` +
    `</p>`
  );
}

function renderLightbox() {
  const item = state.items[lb.idx];
  if (!item) return;
  showInViewer(item);        // IIIF deep-zoom via OpenSeadragon
  lb.scroll.scrollTop = 0;   // start each photo at the fold
  lb.el.classList.remove('lb-scrolled');
  lb.meta.innerHTML = metaHtml(item, null);   // lean immediately…
  lb.prev.disabled = lb.idx <= 0;
  lb.next.disabled = lb.idx >= state.items.length - 1;
  const token = ++lb._token;                  // …then enrich, guarding against navigation
  Promise.all([fetchRecord(item.id), loadTgmXwalk()]).then(([rec]) => {
    if (rec && token === lb._token) lb.meta.innerHTML = metaHtml(item, rec);
  });
}


// Step the deep-zoom viewer in/out around its centre (animates via OSD springs).
function zoomStep(factor) {
  if (!osd || !osd.viewport) return;
  osd.viewport.zoomBy(factor);
  osd.viewport.applyConstraints();
}
lb.close.addEventListener('click', closeLightbox);
lb.prev.addEventListener('click', () => step(-1));
lb.next.addEventListener('click', () => step(1));
lb.zoomIn.addEventListener('click', () => zoomStep(1.5));
lb.zoomOut.addEventListener('click', () => zoomStep(1 / 1.5));
// A subject / person / place chip searches that term (phrase match) — leaving
// any decade filter in place, since it composes.
lb.meta.addEventListener('click', (e) => {
  const tg = e.target.closest('.lb-tgm');
  if (tg) { closeLightbox(); clearActives(); els.q.value = ''; loadTgm(Number(tg.dataset.tgm)); return; }
  // a subject chip or the maker → phrase-search that term / name
  const b = e.target.closest('.lb-subject, .lb-maker');
  if (!b) return;
  const t = b.dataset.q;
  closeLightbox();
  clearActives();
  els.q.value = t;
  resetAndLoad(`"${t}"`);
});
// The prev/next arrows belong to the image; fade them out once you scroll to the
// metadata so they don't float over the text.
lb.scroll.addEventListener('scroll', () => {
  // fade once the metadata panel has risen into the lower part of the viewport
  const top = lb.meta.getBoundingClientRect().top;
  lb.el.classList.toggle('lb-scrolled', top < window.innerHeight * 0.65);
}, { passive: true });
// Click the dimmed margin around the image to close.
lb.viewer.addEventListener('click', (e) => { if (e.target === lb.viewer) closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (lb.el.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
});

/* ---- Theme toggle (shares localStorage with the main browser) ------------ */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('tepapa.theme', t); } catch (e) { /* ignore */ }
  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.val === t));
  });
}
document.querySelectorAll('.theme-opt').forEach((b) => {
  b.addEventListener('click', () => applyTheme(b.dataset.val));
});
applyTheme(document.documentElement.dataset.theme || 'light');

/* ---- Search + suggestions ------------------------------------------------ */
// Clear the pressed state on the primary selectors (chips / curated ways). The
// decade filter is orthogonal, so it is NOT cleared here — it persists and
// composes as you change what you're browsing.
function clearActives() {
  document.querySelectorAll('.theme-chip, .way').forEach((c) => c.setAttribute('aria-pressed', 'false'));
}

// Typing an emotion / composition name loads its baked set; anything else is a
// live search. _setLookup is populated as each index loads (below).
const _setLookup = new Map();   // normalised term → { set, key }
const normEmo = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[-\s]+/g, ' ').trim();
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearActives();
  const q = els.q.value.trim();
  const hit = _setLookup.get(normEmo(q));
  const tgmId = _tgmLookup.get(normEmo(q));
  if (hit) loadSet(hit.set, hit.key);
  else if (tgmId != null) loadTgm(tgmId);        // a TGM controlled term
  else resetAndLoad(q);
});

// "[Open]" is the home button — clear every filter and show the whole collection.
function goHome() {
  clearActives();
  document.querySelectorAll('.decade').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  state.decade = null;
  els.q.value = '';
  resetAndLoad('');
  state.scrollPending = false;   // scroll to the very top instead of the results
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.getElementById('home-btn').addEventListener('click', goHome);

SUGGESTIONS.forEach((term) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'theme-chip';
  b.textContent = term;
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    const active = b.getAttribute('aria-pressed') === 'true';
    clearActives();
    if (active) { els.q.value = ''; resetAndLoad(''); return; }
    b.setAttribute('aria-pressed', 'true');
    els.q.value = term;
    resetAndLoad(term);
  });
  els.themes.appendChild(b);
});

/* ---- Ways in: two full-width marquees you can grab and drag -------------- */
const MARQUEE_SPEED = 70;   // px/sec — shared by both rows
const _reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const _marquees = [];

// Fill a track with one run + its duplicate (seamless loop), each item a `.way`.
function fillMarquee(trackId, items, attr) {
  const track = document.getElementById(trackId);
  if (!track) return null;
  const run = items.map((it) =>
    `<button type="button" class="way" ${attr(it)}>${esc(it.term)}</button>` +
    `<span class="ways-sep" aria-hidden="true">·</span>`
  ).join('');
  track.innerHTML = run + run;
  return track;
}

// Auto-scroll (rAF-driven transform) + grab-to-drag scrub. onWord(button) fires
// on a genuine click, not a drag. reverse = drift the other way.
function makeDraggableMarquee(track, reverse, onWord) {
  if (!track) return;
  const marquee = track.parentElement;
  const dir = reverse ? 1 : -1;
  let runWidth = track.scrollWidth / 2 || 1;
  let tx = 0, paused = false, pressed = false, dragging = false, startX = 0, startTx = 0, downX = 0, moved = false, last = 0;

  const render = () => { track.style.transform = `translateX(${tx}px)`; };
  const wrap = () => { if (tx <= -runWidth) tx += runWidth; else if (tx > 0) tx -= runWidth; };
  function frame(t) {
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0; last = t;
    if (!paused && !pressed && !_reduceMotion) { tx += dir * MARQUEE_SPEED * dt; wrap(); render(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  render();

  // hover steadies the drift so you can read / aim
  marquee.addEventListener('mouseenter', () => { paused = true; });
  marquee.addEventListener('mouseleave', () => { paused = false; });

  // Press pauses the drift; a genuine drag starts only past a small threshold —
  // and only THEN do we capture the pointer. (Capturing on pointerdown would
  // retarget the click to the track and swallow word clicks.)
  track.addEventListener('pointerdown', (e) => {
    pressed = true; dragging = false; moved = false; startX = e.clientX; downX = e.clientX; startTx = tx;
  });
  track.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    const dx = e.clientX - startX;
    if (!dragging && Math.abs(dx) > 4) {
      dragging = true; moved = true;
      track.classList.add('is-grabbing');
      try { track.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    }
    if (dragging) { let v = (startTx + dx) % runWidth; if (v > 0) v -= runWidth; tx = v; render(); }
  });
  const endPress = () => { pressed = false; if (dragging) { dragging = false; track.classList.remove('is-grabbing'); } };
  track.addEventListener('pointerup', endPress);
  track.addEventListener('pointercancel', endPress);

  // a click selects a word unless the pointer moved (i.e. it was a drag)
  track.addEventListener('click', (e) => {
    const b = e.target.closest('.way'); if (!b) return;
    if (moved || Math.abs(e.clientX - downX) > 4) { e.preventDefault(); return; }
    b.blur();
    onWord(b);
  });

  _marquees.push({ retune() { runWidth = track.scrollWidth / 2 || 1; wrap(); render(); } });
}
function retuneMarquees() { _marquees.forEach((m) => m.retune()); }
if (document.fonts && document.fonts.ready) document.fonts.ready.then(retuneMarquees);
let _mqResize;
window.addEventListener('resize', () => { clearTimeout(_mqResize); _mqResize = setTimeout(retuneMarquees, 150); });

// Subjects → live query
makeDraggableMarquee(
  fillMarquee('ways-track', WAYS, (w) => `data-q="${esc(w.q)}" data-label="${esc(w.label || w.term)}"`),
  false,
  (b) => { clearActives(); els.q.value = b.dataset.label; resetAndLoad(b.dataset.q); }
);

// Wire a baked set's index into a marquee row and make its terms searchable.
function wireSet(setName, indexFile, listKey, trackId, reverse) {
  fetch(indexFile)
    .then((r) => r.json())
    .then((idx) => {
      const list = idx[listKey] || [];
      const items = list.map((m) => ({ term: m.label, key: m.key }));
      list.forEach((m) => {
        // searchable by label, slug, or slug-with-spaces
        [m.label, m.key, m.key.replace(/-/g, ' ')].forEach((f) => _setLookup.set(normEmo(f), { set: setName, key: m.key }));
        _emoDef.set(m.key, { label: m.label, def: m.def || '' });
      });
      makeDraggableMarquee(
        fillMarquee(trackId, items, (m) => `data-key="${esc(m.key)}"`),
        reverse,
        (b) => { clearActives(); els.q.value = b.textContent; loadSet(setName, b.dataset.key); }
      );
    })
    .catch(() => { /* leave the row empty if the index can't load */ });
}

// TGM controlled vocabulary — load the term index so terms are searchable.
loadTgmIndex();

/* ---- Subject index (TGM) browse panel ------------------------------------ */
const tgmPanel = {
  el: document.getElementById('tgm-panel'),
  list: document.getElementById('tgm-list'),
  search: document.getElementById('tgm-search'),
  foot: document.getElementById('tgm-panel-foot'),
  tabs: document.getElementById('tgm-tabs'),
  kind: 'all',
};
const TGM_ROW_CAP = 400;
function renderTgmList() {
  const q = normEmo(tgmPanel.search.value);
  let rows = _tgmArr;
  if (tgmPanel.kind === 's') rows = rows.filter((t) => t.kind !== 'g');       // subjects + both
  else if (tgmPanel.kind === 'g') rows = rows.filter((t) => t.kind !== 's');  // genre + both
  if (q) rows = rows.filter((t) => normEmo(t.label).includes(q));
  const total = rows.length;
  tgmPanel.list.innerHTML = rows.slice(0, TGM_ROW_CAP).map((t) => {
    const form = (t.kind === 'g' || t.kind === 'b') ? '<span class="tgm-row-form">form</span>' : '';
    const cnt = t.sug ? `${fmtInt(t.count)}<span class="tgm-sug"> +${fmtInt(t.sug)}</span>` : fmtInt(t.count + (t.sug || 0));
    return `<button type="button" class="tgm-row" data-id="${t.id}"><span class="tgm-row-label">${esc(t.label)}${form}</span><span class="tgm-row-count">${cnt}</span></button>`;
  }).join('');
  tgmPanel.foot.textContent = total > TGM_ROW_CAP
    ? `Showing ${TGM_ROW_CAP} of ${fmtInt(total)} — refine your search`
    : `${fmtInt(total)} term${total === 1 ? '' : 's'}`;
}
function openTgmPanel() {
  tgmPanel.el.hidden = false;
  document.body.classList.add('lb-open');
  loadTgmIndex().then(renderTgmList);
  tgmPanel.search.focus();
}
function closeTgmPanel() { tgmPanel.el.hidden = true; document.body.classList.remove('lb-open'); }
document.getElementById('tgm-open').addEventListener('click', openTgmPanel);
document.getElementById('tgm-close').addEventListener('click', closeTgmPanel);
tgmPanel.el.addEventListener('click', (e) => { if (e.target === tgmPanel.el) closeTgmPanel(); });
tgmPanel.search.addEventListener('input', renderTgmList);
tgmPanel.tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tgmPanel.kind = b.dataset.kind;
  [...tgmPanel.tabs.children].forEach((c) => c.classList.toggle('is-on', c === b));
  renderTgmList();
});
tgmPanel.list.addEventListener('click', (e) => {
  const b = e.target.closest('.tgm-row'); if (!b) return;
  closeTgmPanel();
  clearActives();
  els.q.value = '';
  loadTgm(Number(b.dataset.id));
});
document.addEventListener('keydown', (e) => { if (!tgmPanel.el.hidden && e.key === 'Escape') closeTgmPanel(); });

// Feelings → 154 emotions from The Book of Human Emotions (drifts right).
wireSet('emotion', '/data/emotions-index.json', 'emotions', 'moods-track', true);
// Composition & technique → the photographic vocabulary (drifts left).
wireSet('composition', '/data/compositions-index.json', 'compositions', 'comp-track', false);

// Decades → a finite, ordered row of toggle FILTERS. Selecting one narrows
// whatever is currently showing to that decade; clicking it again clears it.
// The filter persists as you change search / feeling / composition.
fetch('/data/decades-index.json')
  .then((r) => r.json())
  .then((idx) => {
    const host = document.getElementById('decades');
    if (!host) return;
    (idx.decades || []).forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'decade';
      b.textContent = d.label;
      b.title = `Filter to the ${d.label} — ${fmtInt(d.count)} photographs`;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        const active = b.getAttribute('aria-pressed') === 'true';
        // single-select among decades; leave the primary selection untouched
        host.querySelectorAll('.decade').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        state.decade = active ? null : d.key;
        if (!active) b.setAttribute('aria-pressed', 'true');
        runView();
      });
      host.appendChild(b);
    });
  })
  .catch(() => { /* leave the decade row empty if the index can't load */ });

/* ---- Infinite scroll ----------------------------------------------------- */
// Load the next page when the sentinel is within ~900px of the viewport.
function nearViewportBottom() {
  const rect = els.sentinel.getBoundingClientRect();
  return rect.top <= window.innerHeight + 900;
}
function maybeLoadMore() {
  if (state.loading || state.done) return;
  if (nearViewportBottom()) fetchPage();
}

// Primary trigger: an IntersectionObserver on the sentinel.
const io = new IntersectionObserver((entries) => {
  if (entries.some((en) => en.isIntersecting)) fetchPage();
}, { rootMargin: '900px 0px' });
io.observe(els.sentinel);

// Fallback triggers: scroll + resize. The observer alone can miss pages (it only
// fires on intersection transitions, and not reliably in every engine), which
// would freeze the gallery on the first 36 of ~54k. A setTimeout throttle (not
// requestAnimationFrame, which is throttled in background/hidden tabs) guarantees
// paging keeps up.
let scrollPending = false;
function onScrollOrResize() {
  if (scrollPending) return;
  scrollPending = true;
  setTimeout(() => { scrollPending = false; maybeLoadMore(); }, 120);
}
window.addEventListener('scroll', onScrollOrResize, { passive: true });
window.addEventListener('resize', onScrollOrResize);

/* ---- Go ------------------------------------------------------------------ */
fetchPage();

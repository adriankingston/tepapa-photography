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
    if (p && (p.displayDate || p.date)) return p.displayDate || p.date;
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
    els.count.textContent = fmtInt(count);
  }

  // Empty page → either truly done, or a flaky scored page. We retried via the
  // observer; treat a genuinely empty first page as "no results".
  if (!results.length) {
    state.done = true;
    state.loading = false;
    setState('');
    if (state.rendered === 0) {
      setState('No openly-licensed photographs match that search.', true);
    } else {
      els.endNote.hidden = false;
    }
    return;
  }

  const frag = document.createDocumentFragment();
  for (const rec of results) {
    const key = `${rec.type}:${rec.id}`;
    if (state.seen.has(key)) continue;
    if (isSensitive(rec)) continue;
    if (isAlbum(categoriesOf(rec))) { state.seen.add(key); continue; }
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

  // Stop when we've paged past the resultset.
  if (state.total != null && state.from >= state.total) {
    state.done = true;
    els.endNote.hidden = false;
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
  state.mode = 'query';
  state.query = query || '';
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
    attribution: 'from <em>The Book of Human Emotions</em>',
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
  state.moodItems = rec
    ? rec.ids.map((id) => ({ id, e: photos[id] }))
        .filter((x) => x.e && !isAlbum(x.e.c))
        .map((x) => itemFromIndex(x.id, x.e))
    : [];
  state.total = state.moodItems.length;
  els.count.textContent = fmtInt(state.total);
  // head the results with the term's definition
  if (els.emoNote) {
    const info = _emoDef.get(key) || {};
    els.emoNote.innerHTML =
      `<h2 class="emotion-note-word">${esc(info.label || key)}</h2>` +
      (info.def ? `<p class="emotion-note-def">${esc(info.def)}</p>` : '') +
      `<p class="emotion-note-meta">${fmtInt(state.total)} photographs · ${S.attribution}</p>`;
    els.emoNote.hidden = false;
  }
  state.loading = false;
  fetchPage();
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
  if (state.from >= state.moodItems.length) { state.done = true; els.endNote.hidden = false; }
  if (!state.done) setTimeout(maybeLoadMore, 0);
}

/* ---- Lightbox ------------------------------------------------------------ */
const lb = {
  el: document.getElementById('lightbox'),
  scroll: document.getElementById('lb-scroll'),
  viewer: document.getElementById('lb-viewer'),
  img: document.getElementById('lb-img'),
  meta: document.getElementById('lb-caption'),
  close: document.getElementById('lb-close'),
  prev: document.getElementById('lb-prev'),
  next: document.getElementById('lb-next'),
  idx: -1,
};

/* ---- Click-to-zoom + drag-to-pan on the detail image --------------------- */
const zoom = { on: false, scale: 2.6, tx: 0, ty: 0, dragging: false, startTx: 0, startTy: 0, sx: 0, sy: 0, downX: 0, downY: 0 };

function resetZoom() {
  zoom.on = false; zoom.tx = 0; zoom.ty = 0; zoom.dragging = false;
  lb.img.classList.remove('is-zoomed', 'is-panning');
  lb.viewer.classList.remove('zoom-on');
  lb.img.style.transform = '';
}
function applyZoom() {
  lb.img.style.transform = zoom.on ? `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` : '';
}
function clampPan() {
  const vr = lb.viewer.getBoundingClientRect();
  const overX = Math.max(0, (lb.img.clientWidth * zoom.scale - vr.width) / 2);
  const overY = Math.max(0, (lb.img.clientHeight * zoom.scale - vr.height) / 2);
  zoom.tx = Math.max(-overX, Math.min(overX, zoom.tx));
  zoom.ty = Math.max(-overY, Math.min(overY, zoom.ty));
}
function toggleZoom(clientX, clientY) {
  if (zoom.on) { resetZoom(); return; }
  zoom.on = true;
  lb.img.classList.add('is-zoomed');
  lb.viewer.classList.add('zoom-on');
  // Keep the clicked point under the cursor as it scales up.
  const r = lb.img.getBoundingClientRect();
  zoom.tx = -(clientX - (r.left + r.width / 2)) * (zoom.scale - 1);
  zoom.ty = -(clientY - (r.top + r.height / 2)) * (zoom.scale - 1);
  clampPan();
  applyZoom();
}
lb.img.addEventListener('pointerdown', (e) => {
  zoom.downX = e.clientX; zoom.downY = e.clientY;
  if (zoom.on) {
    zoom.dragging = true; zoom.startTx = zoom.tx; zoom.startTy = zoom.ty; zoom.sx = e.clientX; zoom.sy = e.clientY;
    lb.img.classList.add('is-panning');
    lb.img.setPointerCapture(e.pointerId);
  }
});
lb.img.addEventListener('pointermove', (e) => {
  if (!zoom.dragging) return;
  zoom.tx = zoom.startTx + (e.clientX - zoom.sx);
  zoom.ty = zoom.startTy + (e.clientY - zoom.sy);
  clampPan(); applyZoom();
});
lb.img.addEventListener('pointerup', (e) => {
  if (zoom.dragging) { zoom.dragging = false; lb.img.classList.remove('is-panning'); }
  const moved = Math.abs(e.clientX - zoom.downX) + Math.abs(e.clientY - zoom.downY) > 4;
  if (!moved) toggleZoom(e.clientX, e.clientY);   // a click (not a drag) toggles zoom
});

function openLightbox(idx) {
  lb.idx = idx;
  renderLightbox();
  lb.el.hidden = false;
  document.body.classList.add('lb-open');
}
function closeLightbox() {
  lb.el.hidden = true;
  document.body.classList.remove('lb-open');
  resetZoom();
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
function renderLightbox() {
  const item = state.items[lb.idx];
  if (!item) return;
  const img = item.img;
  // Downloadable images can be shown full; we only ever keep downloadable ones.
  const big = img.contentUrl || img.previewUrl || img.thumbnailUrl;
  resetZoom();
  lb.img.src = big;
  lb.img.alt = item.title;
  lb.scroll.scrollTop = 0;   // start each photo at the fold
  lb.el.classList.remove('lb-scrolled');

  const dl = img.rights && img.rights.allowsDownload && img.contentUrl;
  const fact = (label, val) => (val ? `<div><dt>${label}</dt><dd>${val}</dd></div>` : '');
  lb.meta.innerHTML =
    `<h2 class="lb-title">${esc(item.title)}</h2>` +
    ((item.maker || item.date)
      ? `<p class="lb-byline">${[esc(item.maker), esc(item.date)].filter(Boolean).join(' · ')}</p>` : '') +
    (item.caption ? `<p class="lb-caption-text">${esc(item.caption)}</p>` : '') +
    `<dl class="lb-facts">` +
      fact('Maker', esc(item.maker)) +
      fact('Date', esc(item.date)) +
      fact('Place', esc(item.place)) +
      fact('Classification', item.category && item.category.length ? esc(item.category.join(', ')) : '') +
      fact('Dimensions', (img.width && img.height) ? `${img.width} × ${img.height} px` : '') +
      fact('Licence', rightsHtml(img) || 'Downloadable') +
    `</dl>` +
    `<p class="lb-links">` +
      (dl ? `<a href="${esc(img.contentUrl)}" target="_blank" rel="noopener" download>Download full image ↓</a><span class="sep">·</span>` : '') +
      `<a href="${esc(item.url)}" target="_blank" rel="noopener">View on Te Papa ↗</a>` +
    `</p>`;

  lb.prev.disabled = lb.idx <= 0;
  lb.next.disabled = lb.idx >= state.items.length - 1;
}

lb.close.addEventListener('click', closeLightbox);
lb.prev.addEventListener('click', () => step(-1));
lb.next.addEventListener('click', () => step(1));
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
// Clear the pressed state on every chip and curated way.
function clearActives() {
  document.querySelectorAll('.theme-chip, .way').forEach((c) => c.setAttribute('aria-pressed', 'false'));
}

// Typing an emotion or composition name loads its baked embedding set; anything
// else is a live search. _setLookup is populated as each index loads (below).
const _setLookup = new Map();   // normalised term → { set, key }
const normEmo = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[-\s]+/g, ' ').trim();
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearActives();
  const q = els.q.value.trim();
  const hit = _setLookup.get(normEmo(q));
  if (hit) loadSet(hit.set, hit.key); else resetAndLoad(q);
});

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

// Feelings → 154 emotions from The Book of Human Emotions (drifts right).
wireSet('emotion', '/data/emotions-index.json', 'emotions', 'moods-track', true);
// Composition & technique → the photographic vocabulary (drifts left).
wireSet('composition', '/data/compositions-index.json', 'compositions', 'comp-track', false);

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

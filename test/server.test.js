// Integration tests for the local dev server (which mirrors the Vercel
// deployment: static public/ + the /api/search handler + security headers).
// Spawns server.js on a throwaway port with a dummy API key — every path
// tested here answers before any upstream request would be made.
// Run:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

let ORIGIN;
let child;

before(async () => {
  // Random ports can collide (with another test run, or anything in the
  // 40–60k range), so: fail fast if the child dies (EADDRINUSE), confirm the
  // responder is OUR server (a foreign process won't send our X-Frame-Options),
  // and retry on a fresh port rather than asserting against a stranger.
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const c = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(port), TEPAPA_API_KEY: 'test-key-not-real' },
      stdio: 'ignore',
    });
    let exited = false;
    c.on('exit', () => { exited = true; });
    for (let i = 0; i < 50 && !exited; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/favicon.svg`);
        if (r.headers.get('x-frame-options') === 'DENY') {   // it's ours
          child = c;
          ORIGIN = `http://127.0.0.1:${port}`;
          return;
        }
        break;   // someone else owns this port — try another
      } catch { await new Promise((res) => setTimeout(res, 100)); }
    }
    c.kill();
  }
  throw new Error('could not start the dev server on a free port');
});
after(() => child && child.kill());

test('serves the page with the security headers from vercel.json', async () => {
  const r = await fetch(ORIGIN + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  // the local server mirrors the "/(.*)"  block (it requires vercel.json, so
  // this loop proves the wiring, not the values — those are pinned below)
  const block = require('../vercel.json').headers.find((h) => h.source === '/(.*)').headers;
  assert.ok(block.length >= 5, 'vercel.json security block exists');
  for (const { key, value } of block) {
    assert.equal(r.headers.get(key), value, `${key} matches vercel.json`);
  }
  // pin the load-bearing values as literals, so a bad vercel.json edit fails
  // here instead of shipping (img-src https: is REQUIRED — media.tepapa
  // 303-redirects every image to an S3 bucket, and CSP checks the target)
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /img-src 'self' data: https:/);
  assert.match(csp, /connect-src 'self' https:\/\/iiif\.tepapa\.govt\.nz/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/.test(csp), 'inline theme script is hash-allowed');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('non-GET /api/search → 405 with Allow: GET (as deployed)', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const r = await fetch(ORIGIN + '/api/search', { method });
    assert.equal(r.status, 405, `${method} is rejected`);
    assert.equal(r.headers.get('allow'), 'GET');
  }
});

test('GET /api/search without id/q → 400', async () => {
  const r = await fetch(ORIGIN + '/api/search');
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /id= or \?q=/);
});

test('GET /api/search with a non-numeric id → 400', async () => {
  const r = await fetch(ORIGIN + '/api/search?id=abc');
  assert.equal(r.status, 400);
});

test('path traversal cannot read files outside public/', async () => {
  // Property test of the whole pipeline (URL parse → decode → normalize →
  // join → containment guard), not of any single layer: the URL parser and
  // path.normalize clamp most of these before the startsWith guard is even
  // reached, so removing ONE layer stays invisible here — removing enough to
  // actually escape would serve the project .env and fail the body check.
  for (const p of ['/%2e%2e/.env', '/..%2f..%2f.env', '/%2e%2e%2f%2e%2e%2fpackage.json', '/..%2f.env']) {
    const r = await fetch(ORIGIN + p);
    assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status} (expected 400/403/404)`);
    const body = await r.text();
    assert.ok(!body.includes('TEPAPA_API_KEY'), 'no secret leaked');
  }
});

test('invalid percent-escapes → 400, not a crash', async () => {
  const r = await fetch(ORIGIN + '/%ZZ');
  assert.equal(r.status, 400);
});

test('static assets get the right MIME type', async () => {
  const r = await fetch(ORIGIN + '/style.css');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/css/);
});

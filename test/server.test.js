// Integration tests for the local dev server (which mirrors the Vercel
// deployment: static public/ + the /api/search handler + security headers).
// Spawns server.js on a throwaway port with a dummy API key — every path
// tested here answers before any upstream request would be made.
// Run:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 40000 + Math.floor(Math.random() * 20000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), TEPAPA_API_KEY: 'test-key-not-real' },
    stdio: 'ignore',
  });
  // wait for the server to accept connections
  for (let i = 0; i < 50; i++) {
    try { await fetch(ORIGIN + '/favicon.svg'); return; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => child && child.kill());

test('serves the page with the security headers from vercel.json', async () => {
  const r = await fetch(ORIGIN + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  // the local server mirrors the "/(.*)"  block — assert they can't drift
  const block = require('../vercel.json').headers.find((h) => h.source === '/(.*)').headers;
  assert.ok(block.length >= 5, 'vercel.json security block exists');
  for (const { key, value } of block) {
    assert.equal(r.headers.get(key), value, `${key} matches vercel.json`);
  }
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

test('path traversal cannot leave public/', async () => {
  for (const p of ['/%2e%2e/.env', '/..%2f..%2f.env', '/%2e%2e%2f%2e%2e%2fpackage.json']) {
    const r = await fetch(ORIGIN + p);
    assert.notEqual(r.status, 200, `${p} is not served`);
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

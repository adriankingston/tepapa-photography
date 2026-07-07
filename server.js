// Local development server for the Te Papa Photographs browser.
//
// In production (Vercel) each file under ./api runs as its own serverless
// function and ./public is served as static assets. This server reproduces that
// locally: it serves ./public and routes /api/* to those SAME handler files, so
// there is one source of truth and `node server.js` behaves like the deployment.
//
// Run with:  npm start   (needs TEPAPA_API_KEY — from .env locally, or the
//            Vercel dashboard in production).

const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Load .env (tiny parser, no dependency; local only) ----------------------
// On Vercel there is no .env file — environment variables come from the
// project's dashboard settings, so this simply no-ops there.
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* no .env file — fall back to real environment */ }

const PORT = process.env.PORT || 4500;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// The same serverless handler Vercel runs, keyed by path — like Vercel, the
// handler sees every method and answers 405 itself for the ones it rejects.
const routes = {
  '/api/search': require('./api/search'),
};

// Security headers — mirror of the "/(.*)"  block in vercel.json so CSP
// violations surface locally, not first in production. Keep the two in sync
// (test/server.test.js asserts they match); the script-src hash covers the
// inline theme-boot script in index.html — recompute it if that script changes.
const SECURITY_HEADERS = require('./vercel.json').headers
  .find((h) => h.source === '/(.*)').headers;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  for (const { key, value } of SECURITY_HEADERS) res.setHeader(key, value);

  // --- API routes → the shared serverless handler ---
  const handler = routes[url.pathname];
  if (handler) {
    req.query = Object.fromEntries(url.searchParams);
    Promise.resolve(handler(req, res)).catch((e) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Handler failed', detail: String(e) }));
      }
    });
    return;
  }

  // --- Static files from ./public ---
  // Percent-decode like production static hosting does (else /some%20file 404s
  // locally but works deployed); invalid escapes → 400.
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      // Local dev tool whose files change often — never serve a stale UI from cache.
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

// Loopback only: this dev server proxies with the API key attached, so don't
// expose it to the LAN by default (HOST=0.0.0.0 opts back in for device testing).
server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`\n  Te Papa Photographs → http://localhost:${PORT}\n`);
  if (!process.env.TEPAPA_API_KEY) {
    console.log('  ⚠  No TEPAPA_API_KEY found — add it to .env or searches will fail.\n');
  }
});

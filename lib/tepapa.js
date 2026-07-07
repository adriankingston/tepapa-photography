// Shared server logic for the Te Papa Photographs browser.
//
// Transport-agnostic: it knows how to POST a search to the Te Papa Collections
// API (injecting the API key server-side, since the API has no CORS), but nothing
// about HTTP routing. Imported by:
//   - ../api/search.js   (run as a Vercel serverless function in production)
//   - ../server.js       (local dev server routing /api/* to that same handler)
//
// TEPAPA_API_KEY is read at call time, so it works from a local .env or from
// Vercel's dashboard env vars.

const https = require('https');

const TEPAPA_HOST = 'data.tepapa.govt.nz';
const apiKey = () => process.env.TEPAPA_API_KEY;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Forward a search to the Te Papa API (always a POST upstream — that's the
// only search transport the API offers; our own route is GET). Returns the raw body so
// the proxy can stream it through verbatim. Bounded: a hung upstream must not
// pin the connection (or a serverless invocation) open indefinitely.
const UPSTREAM_TIMEOUT_MS = 20000;
function tepapaSearch(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        host: TEPAPA_HOST,
        path: '/collection/search',
        method: 'POST',
        timeout: UPSTREAM_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json;profile=full',
          'x-api-key': apiKey(),
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (r) => {
        let chunks = '';
        r.on('data', (d) => (chunks += d));
        r.on('end', () => resolve({ status: r.statusCode, body: chunks }));
        r.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Upstream timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = { apiKey, sendJson, tepapaSearch };

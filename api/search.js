// GET /api/search — proxy a search to the Te Papa API.
//
// GET only, shaped so Vercel's edge network can cache both reads (shared
// across all visitors, keyed by URL) and Te Papa's API is spared:
//   • a record lookup   — /api/search?id=123            (immutable → cache a day)
//   • a standard search — /api/search?q=…&from=0&size=36 (cache minutes + SWR)
// The old POST pass-through (arbitrary bodies, never cacheable) had no callers
// left and was pure attack surface — retired.
//
// Errors and non-200 upstream responses are never cached.
const { tepapaSearch, sendJson, apiKey } = require('../lib/tepapa');

const OBJECT = [{ field: 'type', keyword: 'Object' }];
const QSCORE = [{ field: '_meta.qualityScore', order: 'desc' }];

// Build the upstream payload + a Cache-Control value from GET query params.
function fromQuery(q) {
  if (q.id != null && /^\d+$/.test(String(q.id))) {
    return { payload: { query: `id:${q.id}`, size: 1, filters: OBJECT },
      cache: 'public, s-maxage=86400, stale-while-revalidate=604800' };
  }
  if (typeof q.q === 'string' && q.q) {
    const size = Math.min(100, Math.max(1, parseInt(q.size, 10) || 36));
    const from = Math.max(0, parseInt(q.from, 10) || 0);
    return { payload: { query: q.q, size, from, filters: OBJECT, sort: QSCORE },
      cache: 'public, s-maxage=600, stale-while-revalidate=3600' };
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  if (!apiKey()) return sendJson(res, 500, { error: 'No API key configured. Set TEPAPA_API_KEY.' });

  const built = fromQuery(req.query || {});
  if (!built) return sendJson(res, 400, { error: 'GET needs ?id= or ?q=' });
  const { payload, cache } = built;

  try {
    const result = await tepapaSearch(payload);
    res.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': result.status === 200 ? cache : 'no-store',
    });
    res.end(result.body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: String(e) }));
  }
};
module.exports.fromQuery = fromQuery;   // exported for the unit tests

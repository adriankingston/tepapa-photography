// POST /api/search — proxy an advanced search to the Te Papa API.
const { tepapaSearch, readJson, sendJson, apiKey } = require('../lib/tepapa');

module.exports = async (req, res) => {
  if (!apiKey()) return sendJson(res, 500, { error: 'No API key configured. Set TEPAPA_API_KEY.' });
  const payload = await readJson(req);
  if (payload === null) return sendJson(res, 400, { error: 'Invalid JSON body' });
  try {
    const result = await tepapaSearch(payload || {});
    res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(result.body);
  } catch (e) {
    sendJson(res, 502, { error: 'Upstream request failed', detail: String(e) });
  }
};

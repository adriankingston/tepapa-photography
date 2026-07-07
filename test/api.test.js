// Unit tests for the /api/search GET query builder.
// Run:  npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fromQuery } = require('../api/search.js');

test('id lookup → exact-id payload, day-long edge cache', () => {
  const b = fromQuery({ id: '123' });
  assert.equal(b.payload.query, 'id:123');
  assert.equal(b.payload.size, 1);
  assert.deepEqual(b.payload.filters, [{ field: 'type', keyword: 'Object' }]);
  assert.match(b.cache, /s-maxage=86400/);
});

test('non-numeric id is not an id lookup', () => {
  assert.equal(fromQuery({ id: 'abc' }), null);
  assert.equal(fromQuery({ id: '12; DROP' }), null);
});

test('id wins over q when both are present', () => {
  const b = fromQuery({ id: '5', q: 'ships' });
  assert.equal(b.payload.query, 'id:5');
});

test('free-text search → paged, sorted, minutes-long cache', () => {
  const b = fromQuery({ q: 'ships', from: '36', size: '36' });
  assert.equal(b.payload.query, 'ships');
  assert.equal(b.payload.from, 36);
  assert.equal(b.payload.size, 36);
  assert.deepEqual(b.payload.sort, [{ field: '_meta.qualityScore', order: 'desc' }]);
  assert.match(b.cache, /s-maxage=600/);
});

test('size and from are clamped, defaults applied', () => {
  assert.equal(fromQuery({ q: 'x' }).payload.size, 36);
  assert.equal(fromQuery({ q: 'x' }).payload.from, 0);
  assert.equal(fromQuery({ q: 'x', size: '999' }).payload.size, 100);
  assert.equal(fromQuery({ q: 'x', size: '-5' }).payload.size, 1);
  assert.equal(fromQuery({ q: 'x', from: '-3' }).payload.from, 0);
});

test('nothing usable → null (handler answers 400)', () => {
  assert.equal(fromQuery({}), null);
  assert.equal(fromQuery({ q: '' }), null);
  assert.equal(fromQuery({ size: '10' }), null);
});

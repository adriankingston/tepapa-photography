// Unit tests for the pure helpers in build/lib.js (the pipeline's shared
// extraction, stamp, and shard logic). No network, no model downloads.
// Run:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arr, yearOf, qualityOf, decadeOf, isAlbumEntry,
  stampOf, checkStamp, shardDecades, shardTagPhotos,
} from '../build/lib.js';

test('arr normalises scalars, nulls, and arrays', () => {
  assert.deepEqual(arr(null), []);
  assert.deepEqual(arr(undefined), []);
  assert.deepEqual(arr('x'), ['x']);
  assert.deepEqual(arr(['x']), ['x']);
});

test('yearOf prefers the structured facet, falls back to date strings', () => {
  assert.equal(yearOf({ production: [{ facetCreatedDate: { year: '1887' } }] }), 1887);
  assert.equal(yearOf({ production: [{ facetCreatedDate: { temporal: '1923' } }] }), 1923);
  assert.equal(yearOf({ production: [{ createdDate: 'circa 1905, Wellington' }] }), 1905);
  assert.equal(yearOf({ production: [{ verbatimCreatedDate: 'May 1961' }] }), 1961);
  // out-of-range facet years are rejected, not clamped
  assert.equal(yearOf({ production: [{ facetCreatedDate: { year: '1750' } }] }), null);
  assert.equal(yearOf({ production: [{ facetCreatedDate: { year: '2101' } }] }), null);
  assert.equal(yearOf({}), null);
});

test('qualityOf reads _meta.qualityScore, defaults 0', () => {
  assert.equal(qualityOf({ _meta: { qualityScore: 5.04 } }), 5.04);
  assert.equal(qualityOf({}), 0);
});

test('decadeOf buckets years; 0/null (undated) → null', () => {
  assert.equal(decadeOf(1887), '1880s');
  assert.equal(decadeOf(1990), '1990s');
  assert.equal(decadeOf(0), null);
  assert.equal(decadeOf(null), null);
});

test('isAlbumEntry matches the photograph-album genre', () => {
  assert.equal(isAlbumEntry({ c: ['photograph albums', 'silver prints'] }), true);
  assert.equal(isAlbumEntry({ c: ['gelatin dry plate negatives'] }), false);
  assert.equal(isAlbumEntry({}), false);
});

test('stampOf is deterministic and order-sensitive', () => {
  assert.equal(stampOf([1, 2, 3]), stampOf([1, 2, 3]));
  assert.notEqual(stampOf([1, 2, 3]), stampOf([3, 2, 1]));
  assert.notEqual(stampOf([1, 2, 3]), stampOf([1, 2]));
  assert.match(stampOf([1]), /^[0-9a-f]{16}$/);
});

test('checkStamp throws on a record set that does not match the harvest', () => {
  // build/set-stamp.json is committed — any made-up id list must be rejected
  assert.throws(() => checkStamp([1, 2, 3], 'test fixture'), /out of step with the harvest/);
});

const INDEX = [
  { id: 1, c: ['negatives'], y: 1887, q: 5 },
  { id: 2, c: ['negatives'], y: 1889, q: 7 },
  { id: 3, c: ['photograph albums'], y: 1888, q: 9 },  // album — never shipped
  { id: 4, c: ['negatives'], y: 0, q: 4 },             // undated
  { id: 5, c: ['negatives'], y: 1923, q: 1 },
];

test('shardDecades groups by decade, best quality first, albums/undated out', () => {
  const s = shardDecades(INDEX);
  assert.deepEqual([...s.keys()].sort(), ['1880s', '1920s']);
  assert.deepEqual(s.get('1880s').map((e) => e.id), [2, 1]);   // q 7 before q 5
  assert.deepEqual(s.get('1920s').map((e) => e.id), [5]);
});

test('shardTagPhotos keeps only resolvable, non-album photo metadata', () => {
  const terms = [{ key: 'boats', ids: [2, 3, 99, 5] }];
  const s = shardTagPhotos(INDEX, terms);
  assert.deepEqual(Object.keys(s.get('boats').photos).sort(), ['2', '5']);
  assert.equal(s.get('boats').photos[2].y, 1889);
});

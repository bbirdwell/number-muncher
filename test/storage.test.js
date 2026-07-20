'use strict';
// Tests for the pure storage half (design doc decision 3b, targets 6, 8, 9, 11).
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/storage.js');

function attempt(over) {
  return Object.assign({ tables: [7], mode: 'classic', correct: true, n: 42 }, over);
}

function record(data, n, opts) {
  for (let i = 0; i < n; i++) S.recordAttempt(data, attempt(opts));
}

// ---- (8) round-trip serialization ----

test('serialize/deserialize round-trips the schema', () => {
  const data = S.defaultData();
  data.name = 'Zoe';
  S.recordAttempt(data, attempt({ correct: false, n: 56 }));
  S.updateHighScore(data, [7, 8], 'blitz', 120);
  const back = S.deserialize(S.serialize(data));
  assert.deepStrictEqual(back, data);
});

// ---- (9) corrupt / foreign JSON -> defaults ----

test('corrupt JSON deserializes to null; migrate falls back to defaults', () => {
  assert.strictEqual(S.deserialize('{not json'), null);
  assert.deepStrictEqual(S.migrate(null), S.defaultData());
  assert.deepStrictEqual(S.migrate({ v: 999, junk: true }), S.defaultData());
  const partial = S.migrate({ v: 1, name: 'Zoe' });
  assert.strictEqual(partial.name, 'Zoe');
  assert.deepStrictEqual(partial.tables, {});
});

// ---- (6) rolling-window star math (OV-6A/8A) ----

test('star thresholds are on attempt counts: 20@80, 35@90, full-50@95', () => {
  assert.strictEqual(S.computeStarLevel([]), 0);
  assert.strictEqual(S.computeStarLevel(new Array(19).fill(1)), 0, 'not enough attempts');
  assert.strictEqual(S.computeStarLevel(new Array(20).fill(1)), 1);
  // 20 attempts at exactly 80%
  assert.strictEqual(S.computeStarLevel(new Array(16).fill(1).concat(new Array(4).fill(0))), 1);
  assert.strictEqual(S.computeStarLevel(new Array(35).fill(1)), 2);
  // full window at 96% (48/50) -> 3 stars WITHOUT demanding perfection
  assert.strictEqual(S.computeStarLevel(new Array(48).fill(1).concat([0, 0])), 3);
  // full window at 94% -> only 2 stars
  assert.strictEqual(S.computeStarLevel(new Array(47).fill(1).concat([0, 0, 0])), 2);
});

test('window is a ring of the last 50: early misses age out', () => {
  const data = S.defaultData();
  record(data, 10, { correct: false, n: 45 }); // 10 early misses while learning
  record(data, 50, { correct: true });          // then 50 straight correct
  const entry = data.tables['7'];
  assert.strictEqual(entry.attempts.length, 50, 'ring keeps last 50 only');
  assert.strictEqual(S.windowAccuracy(entry.attempts), 1, 'early misses aged out');
  assert.strictEqual(entry.stars, 3);
});

test('stars are a high-water mark: a bad session never revokes them (OV-8A)', () => {
  const data = S.defaultData();
  record(data, 50, { correct: true });
  assert.strictEqual(data.tables['7'].stars, 3);
  record(data, 30, { correct: false, n: 45 }); // terrible session
  assert.strictEqual(data.tables['7'].stars, 3, 'earned means earned');
  const progress = S.starProgress(data.tables['7']);
  assert.strictEqual(progress.earned, 3);
  assert.ok(progress.windowLevel < 3, 'window level reflects current form');
});

test('star accrual: single-table classic only (OV-7A)', () => {
  const data = S.defaultData();
  record(data, 50, { tables: [7, 8] });           // multi-select: no accrual
  record(data, 50, { mode: 'blitz' });            // blitz: no accrual
  assert.deepStrictEqual(data.tables, {}, 'no star data from multi/blitz sessions');
  record(data, 20, {});                           // single-table classic accrues
  assert.strictEqual(data.tables['7'].attempts.length, 20);
  assert.strictEqual(data.tables['7'].stars, 1);
});

// ---- (11) fact-keyed misses; non-products count nothing (decision 17) ----

test('wrong munch of a product records canonical fact keys', () => {
  const data = S.defaultData();
  S.recordAttempt(data, attempt({ correct: false, n: 56, mode: 'blitz' }));
  assert.strictEqual(data.factMisses['7x8'], 1);
  S.recordAttempt(data, attempt({ correct: false, n: 56, mode: 'blitz' }));
  assert.strictEqual(data.factMisses['7x8'], 2);
});

test('wrong munch of a non-product (44 has 4x11) vs a true non-product (43)', () => {
  assert.deepStrictEqual(S.factKeysFor(44), ['4x11']);
  assert.deepStrictEqual(S.factKeysFor(43), [], 'prime beyond tables records nothing');
  assert.deepStrictEqual(S.factKeysFor(36), ['3x12', '4x9', '6x6']); // all pairs, canonical a<=b
  assert.deepStrictEqual(S.factKeysFor(12), ['1x12', '2x6', '3x4']);
});

// ---- high scores keyed by sorted selection set ----

test('listHighScores: singles numeric first, combos after, empty rows dropped', () => {
  const data = S.defaultData();
  S.updateHighScore(data, [12], 'classic', 50);
  S.updateHighScore(data, [3], 'blitz', 80);
  S.updateHighScore(data, [7, 8], 'classic', 120);
  S.updateHighScore(data, [9], 'classic', 0); // zero score never persists a row
  const rows = S.listHighScores(data);
  assert.deepStrictEqual(rows.map((r) => r.key), ['3', '12', '7+8']);
  assert.deepStrictEqual(rows[0], { key: '3', classic: 0, blitz: 80 });
  assert.deepStrictEqual(S.listHighScores(S.defaultData()), [], 'empty store lists nothing');
});

test('high scores: selection-set keys, per mode, only improvements persist', () => {
  const data = S.defaultData();
  assert.strictEqual(S.selectionKey([8, 7]), '7+8');
  assert.ok(S.updateHighScore(data, [8, 7], 'blitz', 100));
  assert.ok(!S.updateHighScore(data, [7, 8], 'blitz', 90), 'lower score is not a high score');
  assert.ok(S.updateHighScore(data, [7, 8], 'blitz', 130));
  assert.strictEqual(S.highScoreFor(data, [8, 7], 'blitz'), 130);
  assert.strictEqual(S.highScoreFor(data, [7], 'blitz'), 0, 'different selection, different key');
  assert.ok(S.updateHighScore(data, [7, 8], 'classic', 50), 'modes tracked separately');
});

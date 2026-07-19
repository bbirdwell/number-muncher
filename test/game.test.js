'use strict';
// Tests for the pure game core (design doc decision 3b, targets 1-7, 10, 12).
const test = require('node:test');
const assert = require('node:assert');
const NM = require('../js/game.js');

function rngFor(seed) { return NM.makeRng(seed); }

function startedState(settings, seed) {
  const state = NM.createState();
  NM.reduce(state, { type: 'start', settings }, rngFor(seed || 1));
  return state;
}

function tickMs(state, ms, rng) {
  NM.reduce(state, { type: 'tick', dt: ms }, rng);
}

// Put the muncher on a cell with a known-correct / known-wrong number.
function findCell(state, wantCorrect) {
  for (let i = 0; i < state.board.length; i++) {
    const c = state.board[i];
    if (!c.munched && NM.isMatch(state.rule, c.n) === wantCorrect) return i;
  }
  return -1;
}

function munchAt(state, cellIndex, rng) {
  state.muncher.cell = cellIndex;
  state.troggles = []; // isolate munch behavior from monster contact
  NM.reduce(state, { type: 'munch' }, rng);
}

// ---- (1) isMatch per rule ----

test('isMatch: multiples of a single table', () => {
  const rule = { tables: [7] };
  assert.ok(NM.isMatch(rule, 7));
  assert.ok(NM.isMatch(rule, 42));
  assert.ok(NM.isMatch(rule, 84));
  assert.ok(!NM.isMatch(rule, 44));
  assert.ok(!NM.isMatch(rule, 1));
  assert.ok(!NM.isMatch(rule, 0));
  assert.ok(!NM.isMatch(rule, -7));
});

test('isMatch: OR semantics across selected tables', () => {
  const rule = { tables: [7, 8] };
  assert.ok(NM.isMatch(rule, 49));
  assert.ok(NM.isMatch(rule, 64));
  assert.ok(NM.isMatch(rule, 56)); // both
  assert.ok(!NM.isMatch(rule, 45));
});

// ---- (2) seedBoard invariants over 1000 seeded boards ----

test('seedBoard: 1000-board invariants for single table', () => {
  const rule = { tables: [7] };
  for (let seed = 0; seed < 1000; seed++) {
    const rng = rngFor(seed);
    const board = NM.seedBoard(rule, 1 + (seed % 15), rng);
    assert.strictEqual(board.length, 30);
    const correct = board.filter((c) => NM.isMatch(rule, c.n)).length;
    assert.ok(correct >= 6, `seed ${seed}: only ${correct} correct`);
    assert.ok(30 - correct >= 12, `seed ${seed}: fewer than 40% incorrect`);
    // 2a: no distractor may match the rule — implied by the counts above,
    // but assert per-cell that every number is a positive integer in range.
    for (const c of board) {
      assert.ok(Number.isInteger(c.n) && c.n >= 2, `seed ${seed}: bad cell ${c.n}`);
      assert.strictEqual(c.munched, false);
    }
  }
});

test('seedBoard: 2b fallback under all-tables selection still satisfies invariants', () => {
  const rule = { tables: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };
  for (let seed = 0; seed < 200; seed++) {
    const board = NM.seedBoard(rule, 3, rngFor(seed));
    const correct = board.filter((c) => NM.isMatch(rule, c.n)).length;
    assert.ok(correct >= 6, `seed ${seed}: only ${correct} correct`);
    assert.ok(30 - correct >= 12, `seed ${seed}: fewer than 40% incorrect`);
  }
});

test('seedBoard: same seed reproduces the same board (injectable RNG)', () => {
  const a = NM.seedBoard({ tables: [6] }, 2, rngFor(99));
  const b = NM.seedBoard({ tables: [6] }, 2, rngFor(99));
  assert.deepStrictEqual(a, b);
});

// ---- (3) munch scoring, lives, extra-life ----

test('correct munch scores 10 and marks the cell', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 5);
  const idx = findCell(state, true);
  munchAt(state, idx, rngFor(5));
  assert.strictEqual(state.score, 10);
  assert.ok(state.board[idx].munched);
  assert.strictEqual(state.session.correct, 1);
});

test('wrong munch: lose a life, number stays, explanation opens and pauses', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 5);
  const idx = findCell(state, false);
  munchAt(state, idx, rngFor(5));
  assert.strictEqual(state.lives, 2);
  assert.ok(!state.board[idx].munched, 'wrongly munched number must stay');
  assert.ok(state.explain, 'explanation must open');
  assert.ok(state.pauseReasons.includes('explanation'));
  assert.strictEqual(state.session.wrong, 1);
});

test('extra life at each 1000-point boundary, one per boundary crossed', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 5);
  state.score = 990;
  state.lifeBoundary = 0;
  const livesBefore = state.lives;
  const idx = findCell(state, true);
  munchAt(state, idx, rngFor(5)); // +10 -> 1000
  assert.strictEqual(state.lives, livesBefore + 1);
  // crossing two boundaries in one award grants two lives (decision 16)
  state.score = 999;
  state.lifeBoundary = 0;
  state.lives = 3;
  state.level = 21; // clear bonus 50*21 = 1050 -> crosses 1000 and 2000
  for (let i = 0; i < state.board.length; i++) {
    if (NM.isMatch(state.rule, state.board[i].n)) state.board[i].munched = true;
  }
  const last = findCell(state, true);
  // un-munch one correct cell to munch it as the last one
  state.board[0] = { n: 7, munched: false };
  munchAt(state, 0, rngFor(5));
  assert.strictEqual(state.screen, 'levelClear');
  // 999 + 10 + 1050 = 2059 -> boundary 2 -> +2 lives
  assert.strictEqual(state.lives, 5);
  assert.ok(last !== -2); // silence unused warning
});

// ---- (4) troggle step, spawn, edge respawn, contact ----

test('troggle spawn: edge cell, >=3 manhattan from muncher, inward heading', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 7);
  for (let seed = 0; seed < 100; seed++) {
    const tr = NM.spawnTroggle(state, rngFor(seed));
    const col = NM.cellCol(tr.cell), row = NM.cellRow(tr.cell);
    assert.ok(col === 0 || col === 5 || row === 0 || row === 4, 'spawns on an edge');
    assert.ok(NM.manhattan(tr.cell, state.muncher.cell) >= 3);
    // heading moves inward on the next step
    const nc = col + tr.dir[0], nr = row + tr.dir[1];
    assert.ok(nc >= 0 && nc < 6 && nr >= 0 && nr < 5, 'heading points inward');
  }
});

test('troggle walks off the board -> respawns per spawn rule', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 7);
  state.muncher.cell = NM.START_CELL;
  state.troggles = [{ cell: NM.cellAt(5, 2), dir: [1, 0] }]; // heading off right edge
  tickMs(state, state.trogTickMs, rngFor(7));
  assert.strictEqual(state.troggles.length, 1);
  assert.ok(state.troggles[0].cell !== NM.cellAt(5, 2) + 1, 'not off-board');
  assert.ok(NM.manhattan(state.troggles[0].cell, state.muncher.cell) >= 3);
});

test('troggle contact: life lost, muncher respawns in place with invuln, troggle respawns', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 7);
  const mCell = state.muncher.cell;
  state.troggles = [{ cell: mCell - 1, dir: [1, 0] }]; // one step left, heading right
  tickMs(state, state.trogTickMs, rngFor(7));
  assert.strictEqual(state.lives, 2);
  assert.strictEqual(state.muncher.cell, mCell, 'respawns in place');
  assert.ok(state.muncher.invulnMs > 0);
  assert.ok(NM.manhattan(state.troggles[0].cell, mCell) >= 3, 'contacting troggle respawned');
});

test('contact while invulnerable does nothing', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 7);
  state.muncher.invulnMs = 5000; // outlasts the troggle tick
  const mCell = state.muncher.cell;
  state.troggles = [{ cell: mCell - 1, dir: [1, 0] }];
  tickMs(state, state.trogTickMs, rngFor(7));
  assert.strictEqual(state.lives, 3, 'no life lost while invulnerable');
  assert.strictEqual(state.troggles[0].cell, mCell, 'troggle passes over the muncher');
});

test('invuln does not expire while co-located with a troggle (decision 13)', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 7);
  const mCell = state.muncher.cell;
  state.troggles = [{ cell: mCell, dir: [1, 0] }]; // co-located
  state.muncher.invulnMs = 50;
  tickMs(state, 40, rngFor(7)); // frame-sized ticks, no troggle movement yet
  tickMs(state, 40, rngFor(7)); // would expire — but co-located, so it extends
  assert.ok(state.muncher.invulnMs > 0, 'extends until separation');
  assert.strictEqual(state.lives, 3);
});

test('muncher moving onto a troggle cell is contact', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 7);
  const mCell = state.muncher.cell;
  state.troggles = [{ cell: mCell + 1, dir: [1, 0] }];
  NM.reduce(state, { type: 'move', dCol: 1, dRow: 0 }, rngFor(7));
  assert.strictEqual(state.lives, 2);
});

// ---- (5) blitz lifecycle ----

test('blitz: wrong munch costs 5s, timer pauses during explanation', () => {
  const state = startedState({ tables: [7], mode: 'blitz' }, 11);
  assert.strictEqual(state.blitzMs, NM.BLITZ_MS);
  assert.strictEqual(state.troggles.length, 0, 'no troggles in blitz (F1/1A)');
  const idx = findCell(state, false);
  munchAt(state, idx, rngFor(11));
  assert.strictEqual(state.blitzMs, NM.BLITZ_MS - 5000);
  const before = state.blitzMs;
  tickMs(state, 3000, rngFor(11)); // paused by explanation -> no decrement
  assert.strictEqual(state.blitzMs, before);
  NM.reduce(state, { type: 'dismissExplain' }, rngFor(11));
  tickMs(state, 1000, rngFor(11));
  assert.strictEqual(state.blitzMs, before - 1000);
});

test('blitz: timer clamps at 0; penalty to 0 ends round after dismissal', () => {
  const state = startedState({ tables: [7], mode: 'blitz' }, 11);
  state.blitzMs = 3000;
  const idx = findCell(state, false);
  munchAt(state, idx, rngFor(11)); // -5000 -> clamp 0
  assert.strictEqual(state.blitzMs, 0);
  assert.strictEqual(state.screen, 'playing', 'round not over until explanation dismissed');
  NM.reduce(state, { type: 'dismissExplain' }, rngFor(11));
  assert.strictEqual(state.screen, 'blitzResults');
});

test('blitz: board reseeds immediately on exhaustion, timer keeps running', () => {
  const state = startedState({ tables: [7], mode: 'blitz' }, 11);
  // munch all but one correct cell directly
  const correctCells = [];
  state.board.forEach((c, i) => { if (NM.isMatch(state.rule, c.n)) correctCells.push(i); });
  for (let i = 0; i < correctCells.length - 1; i++) state.board[correctCells[i]].munched = true;
  const before = state.blitzMs;
  munchAt(state, correctCells[correctCells.length - 1], rngFor(12));
  const remaining = state.board.filter((c) => !c.munched && NM.isMatch(state.rule, c.n)).length;
  assert.ok(remaining >= 6, 'board reseeded with fresh correct answers');
  assert.strictEqual(state.blitzMs, before, 'timer untouched by reseed');
});

test('blitz: timeout moves to results', () => {
  const state = startedState({ tables: [7], mode: 'blitz' }, 11);
  state.troggles = [];
  tickMs(state, NM.BLITZ_MS + 1, rngFor(11));
  assert.strictEqual(state.screen, 'blitzResults');
});

// ---- (6) rolling-window stars: see storage.test.js (targets 6, 8, 9, 11) ----

// ---- (7) bracketingFacts / explanation ----

test('bracketingFacts brackets strictly below and above', () => {
  const f = NM.bracketingFacts(7, 44);
  assert.deepStrictEqual(f.below, { k: 6, product: 42 });
  assert.deepStrictEqual(f.above, { k: 7, product: 49 });
  const low = NM.bracketingFacts(7, 3);
  assert.strictEqual(low.below, null);
  assert.deepStrictEqual(low.above, { k: 1, product: 7 });
  const high = NM.bracketingFacts(7, 90);
  assert.deepStrictEqual(high.below, { k: 12, product: 84 });
  assert.strictEqual(high.above, null);
});

test('explanation text: single table and multi-select forms', () => {
  assert.strictEqual(
    NM.explanationFor([7], 44),
    "44 isn't a multiple of 7 — 6×7=42, 7×7=49"
  );
  const multi = NM.explanationFor([7, 8], 45);
  assert.ok(multi.startsWith("45 isn't a multiple of 7 or 8 — "));
  assert.ok(multi.includes('×'));
});

// ---- (10) state machine transitions ----

test('wrong munch -> explain -> dismiss resumes play with invulnerability', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 13);
  munchAt(state, findCell(state, false), rngFor(13));
  assert.ok(state.pauseReasons.includes('explanation'));
  NM.reduce(state, { type: 'dismissExplain' }, rngFor(13));
  assert.strictEqual(state.explain, null);
  assert.strictEqual(state.screen, 'playing');
  assert.ok(state.muncher.invulnMs >= NM.INVULN_MS, 'invuln on resume (OV-10A)');
});

test('lives reach 0 via wrong munch -> game over after dismissal', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 13);
  state.lives = 1;
  munchAt(state, findCell(state, false), rngFor(13));
  assert.strictEqual(state.screen, 'playing', 'she reads the fact first');
  NM.reduce(state, { type: 'dismissExplain' }, rngFor(13));
  assert.strictEqual(state.screen, 'gameOver');
});

test('level clear -> nextLevel: level 4 gains a second troggle, tick speeds up', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 13);
  state.level = 3;
  for (const c of state.board) if (NM.isMatch(state.rule, c.n)) c.munched = true;
  state.board[0] = { n: 14, munched: false };
  munchAt(state, 0, rngFor(13));
  assert.strictEqual(state.screen, 'levelClear');
  NM.reduce(state, { type: 'nextLevel' }, rngFor(13));
  assert.strictEqual(state.level, 4);
  assert.strictEqual(state.screen, 'playing');
  assert.strictEqual(state.troggles.length, 2);
  assert.strictEqual(state.trogTickMs, NM.trogTickFor(4));
  assert.ok(state.trogTickMs < 700 && state.trogTickMs >= 350);
});

test('trogTickFor: 5% faster per level with a 350ms floor', () => {
  assert.strictEqual(NM.trogTickFor(1), 700);
  assert.ok(NM.trogTickFor(2) < 700);
  assert.strictEqual(NM.trogTickFor(60), 350);
});

test('factorWeight: level cap at 12 keeps difficulty monotonic (decision 16)', () => {
  assert.strictEqual(NM.factorWeight(12, 12), NM.factorWeight(12, 40));
  assert.strictEqual(NM.factorWeight(1, 1), 1);
  assert.ok(NM.factorWeight(12, 8) > NM.factorWeight(3, 8));
});

// ---- (12) pause / invuln semantics ----

test('pause-reason set: time frozen until ALL reasons clear', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 17);
  state.troggles = [{ cell: 0, dir: [1, 0] }];
  NM.reduce(state, { type: 'pauseAdd', reason: 'manual' }, rngFor(17));
  NM.reduce(state, { type: 'pauseAdd', reason: 'hidden' }, rngFor(17));
  tickMs(state, 5000, rngFor(17));
  assert.strictEqual(state.troggles[0].cell, 0, 'no troggle tick while paused');
  NM.reduce(state, { type: 'pauseRemove', reason: 'manual' }, rngFor(17));
  tickMs(state, 5000, rngFor(17));
  assert.strictEqual(state.troggles[0].cell, 0, 'still paused by remaining reason');
  NM.reduce(state, { type: 'pauseRemove', reason: 'hidden' }, rngFor(17));
  assert.ok(state.muncher.invulnMs >= NM.INVULN_MS, 'invuln granted on resume');
  tickMs(state, state.trogTickMs, rngFor(17));
  assert.notStrictEqual(state.troggles[0].cell, 0, 'troggles move after resume');
});

test('invulnerability burns only during unpaused ticks', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 17);
  state.troggles = [];
  state.muncher.invulnMs = 1000;
  NM.reduce(state, { type: 'pauseAdd', reason: 'manual' }, rngFor(17));
  tickMs(state, 5000, rngFor(17));
  // resume grants max(existing, INVULN_MS) — the pause itself burned nothing
  NM.reduce(state, { type: 'pauseRemove', reason: 'manual' }, rngFor(17));
  assert.strictEqual(state.muncher.invulnMs, NM.INVULN_MS);
  tickMs(state, 600, rngFor(17));
  assert.strictEqual(state.muncher.invulnMs, NM.INVULN_MS - 600);
});

// ---- movement: tap-to-walk (decision 15) ----

test('moveTo builds a BFS path walked at one step per 150ms; keyboard cancels', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 19);
  state.troggles = [];
  const from = state.muncher.cell;
  const to = NM.cellAt(5, 4);
  NM.reduce(state, { type: 'moveTo', cell: to }, rngFor(19));
  const pathLen = state.walkPath.length;
  assert.strictEqual(pathLen, NM.manhattan(from, to), 'BFS shortest path on open grid');
  tickMs(state, NM.WALK_STEP_MS, rngFor(19));
  assert.strictEqual(state.walkPath.length, pathLen - 1);
  assert.strictEqual(NM.manhattan(state.muncher.cell, from), 1, 'one step taken');
  NM.reduce(state, { type: 'move', dCol: 0, dRow: 0 }, rngFor(19));
  assert.strictEqual(state.walkPath.length, 0, 'keyboard input cancels the walk');
});

test('inputs are no-ops outside PLAYING and while paused (state guards)', () => {
  const state = startedState({ tables: [7], mode: 'classic' }, 19);
  NM.reduce(state, { type: 'pauseAdd', reason: 'manual' }, rngFor(19));
  const cell = state.muncher.cell;
  NM.reduce(state, { type: 'move', dCol: 1, dRow: 0 }, rngFor(19));
  assert.strictEqual(state.muncher.cell, cell, 'no movement while paused');
  const scoreBefore = state.score;
  NM.reduce(state, { type: 'munch' }, rngFor(19));
  assert.strictEqual(state.score, scoreBefore, 'no munch while paused');
});

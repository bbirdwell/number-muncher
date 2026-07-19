/* game.js — pure game core: rules, seeding, reducer. Zero DOM access.
 *
 * Architecture (design doc decisions 13-16):
 *
 *   input/main.js ── events ──▶ reduce(state, event, rng) ──▶ new state
 *        ▲                                                      │
 *        └─────────────── state.events (audio/stats cues) ◀─────┘
 *
 *   main.js owns the only clock and feeds {type:'tick', dt} events.
 *   Pause is a SET of reasons; time advances only when the set is empty.
 *   Invulnerability and the blitz clock are remaining-ms fields.
 *
 * Loadable two ways (decision 3): as a plain browser script (attaches to
 * globalThis.NM) and under node --test via the guarded CommonJS export shim.
 */
(function () {
  'use strict';

  var COLS = 6;
  var ROWS = 5;
  var CELLS = COLS * ROWS;
  var START_CELL = 2 * COLS + 2; // col 2, row 2 (decision 16)
  var INVULN_MS = 1500;
  var WALK_STEP_MS = 150; // decision 15
  var BLITZ_MS = 60000;
  var BLITZ_PENALTY_MS = 5000;
  var BASE_TROG_TICK_MS = 700;
  var MIN_TROG_TICK_MS = 350;
  var LIFE_POINTS = 1000;

  // ---------- rules ----------

  function isMatch(rule, n) {
    if (!Number.isInteger(n) || n <= 0) return false;
    for (var i = 0; i < rule.tables.length; i++) {
      if (n % rule.tables[i] === 0) return true;
    }
    return false;
  }

  // Shared by explanations AND distractor generation (decision 2c).
  // Returns nearest products of `table` strictly below/above n, k clamped 1..12.
  function bracketingFacts(table, n) {
    var below = null;
    var above = null;
    for (var k = 1; k <= 12; k++) {
      var p = k * table;
      if (p < n) below = { k: k, product: p };
      if (p > n && !above) above = { k: k, product: p };
    }
    return { below: below, above: above };
  }

  // The selected table whose nearest product is closest to n.
  function closestTable(tables, n) {
    var best = tables[0];
    var bestDist = Infinity;
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var dist = Infinity;
      for (var k = 1; k <= 12; k++) {
        var d = Math.abs(k * t - n);
        if (d < dist) dist = d;
      }
      if (dist < bestDist) { bestDist = dist; best = t; }
    }
    return best;
  }

  function explanationFor(tables, n) {
    var t = closestTable(tables, n);
    var f = bracketingFacts(t, n);
    var facts = [];
    if (f.below) facts.push(f.below.k + '×' + t + '=' + f.below.product);
    if (f.above) facts.push(f.above.k + '×' + t + '=' + f.above.product);
    var label = tables.length === 1 ? String(tables[0]) : tables.join(' or ');
    return n + " isn't a multiple of " + label + ' — ' + facts.join(', ');
  }

  // ---------- rng ----------

  // mulberry32 — deterministic, seedable (decision 14: injectable RNG).
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, lo, hi) { // inclusive
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  // ---------- board seeding (decisions 1, 2, 2a, 2b) ----------

  // Factor weight at level n (capped at 12 — decision 16):
  // w(k) = 1 + max(0, k - (13 - n))
  function factorWeight(k, level) {
    var n = Math.min(level, 12);
    return 1 + Math.max(0, k - (13 - n));
  }

  function weightedFactor(rng, level) {
    var total = 0;
    var k;
    for (k = 1; k <= 12; k++) total += factorWeight(k, level);
    var r = rng() * total;
    for (k = 1; k <= 12; k++) {
      r -= factorWeight(k, level);
      if (r < 0) return k;
    }
    return 12;
  }

  function seedBoard(rule, level, rng) {
    var tables = rule.tables;
    var maxTable = Math.max.apply(null, tables);
    var maxVal = 12 * maxTable + 1;

    // 6..12 correct of 30 cells => always >=6 correct, >=40% incorrect (decision 1)
    var correctCount = randInt(rng, 6, 12);
    var values = [];
    var i, k, t;

    for (i = 0; i < correctCount; i++) {
      t = pick(rng, tables);
      k = weightedFactor(rng, level);
      values.push(k * t);
    }

    // Near-miss distractor pool (decision 2), filtered by the rule (2a).
    var pool = [];
    for (i = 0; i < tables.length; i++) {
      t = tables[i];
      var neighbors = [t - 1, t + 1];
      for (var j = 0; j < neighbors.length; j++) {
        var nt = neighbors[j];
        if (nt < 2 || nt > 12) continue;
        for (k = 1; k <= 12; k++) pool.push(k * nt);
      }
      for (k = 1; k <= 12; k++) {
        pool.push(k * t - 1);
        pool.push(k * t + 1);
      }
    }
    pool = pool.filter(function (n) {
      return n >= 2 && n <= maxVal && !isMatch(rule, n);
    });

    var distractorCount = CELLS - correctCount;
    for (i = 0; i < distractorCount; i++) {
      if (pool.length > 0 && rng() < 0.8) {
        values.push(pick(rng, pool));
      } else {
        // 2b fallback: random non-matching in range (always exists: primes > 12)
        var v;
        do { v = randInt(rng, 2, Math.max(maxVal, 149)); } while (isMatch(rule, v));
        values.push(v);
      }
    }

    // Fisher-Yates shuffle
    for (i = values.length - 1; i > 0; i--) {
      var s = Math.floor(rng() * (i + 1));
      var tmp = values[i]; values[i] = values[s]; values[s] = tmp;
    }

    return values.map(function (n) { return { n: n, munched: false }; });
  }

  function remainingMatches(state) {
    var count = 0;
    for (var i = 0; i < state.board.length; i++) {
      var c = state.board[i];
      if (!c.munched && isMatch(state.rule, c.n)) count++;
    }
    return count;
  }

  // ---------- troggles (decisions 15, 16) ----------

  function cellCol(i) { return i % COLS; }
  function cellRow(i) { return Math.floor(i / COLS); }
  function cellAt(col, row) { return row * COLS + col; }
  function manhattan(a, b) {
    return Math.abs(cellCol(a) - cellCol(b)) + Math.abs(cellRow(a) - cellRow(b));
  }

  function inwardDirs(cell) {
    var dirs = [];
    if (cellRow(cell) === 0) dirs.push([0, 1]);
    if (cellRow(cell) === ROWS - 1) dirs.push([0, -1]);
    if (cellCol(cell) === 0) dirs.push([1, 0]);
    if (cellCol(cell) === COLS - 1) dirs.push([-1, 0]);
    return dirs;
  }

  function spawnTroggle(state, rng) {
    var edges = [];
    for (var i = 0; i < CELLS; i++) {
      var isEdge = cellRow(i) === 0 || cellRow(i) === ROWS - 1 ||
                   cellCol(i) === 0 || cellCol(i) === COLS - 1;
      if (!isEdge) continue;
      if (manhattan(i, state.muncher.cell) < 3) continue; // decision: >=3 away
      var occupied = state.troggles.some(function (tr) { return tr.cell === i; });
      if (occupied) continue; // never co-occupy (decision 16)
      edges.push(i);
    }
    var cell = edges.length ? pick(rng, edges) : 0;
    var dir = pick(rng, inwardDirs(cell)); // perpendicular-inward heading
    return { cell: cell, dir: dir };
  }

  function troggleCountFor(level) {
    return level >= 4 ? 2 : 1;
  }

  function trogTickFor(level) {
    var ms = BASE_TROG_TICK_MS * Math.pow(0.95, level - 1);
    return Math.max(MIN_TROG_TICK_MS, Math.round(ms));
  }

  // ---------- state ----------

  function initialStats() {
    return { correct: 0, wrong: 0 };
  }

  function createState(settings) {
    return {
      screen: 'title', // title | playing | levelClear | gameOver | blitzResults
      mode: 'classic',
      rule: { type: 'multiples', tables: [7] },
      level: 1,
      score: 0,
      lives: 3,
      lifeBoundary: 0,
      board: [],
      muncher: { cell: START_CELL, invulnMs: 0 },
      troggles: [],
      trogTickMs: BASE_TROG_TICK_MS,
      trogAccMs: 0,
      pauseReasons: [], // decision 13: set of 'explanation' | 'manual' | 'hidden'
      explain: null,    // { text }
      blitzMs: 0,
      walkPath: [],
      walkAccMs: 0,
      session: initialStats(),
      settings: settings || {},
      events: [] // consumed by main.js each dispatch: audio + stats cues
    };
  }

  function paused(state) {
    return state.pauseReasons.length > 0;
  }

  function addPause(state, reason) {
    if (state.pauseReasons.indexOf(reason) === -1) state.pauseReasons.push(reason);
    state.walkPath = []; // decision 15: path clears on pause
  }

  function removePause(state, reason) {
    var i = state.pauseReasons.indexOf(reason);
    if (i !== -1) {
      state.pauseReasons.splice(i, 1);
      if (state.pauseReasons.length === 0 && state.screen === 'playing') {
        // decision 13/OV-10A: invulnerability on EVERY resume
        state.muncher.invulnMs = Math.max(state.muncher.invulnMs, INVULN_MS);
      }
    }
  }

  function troggleAt(state, cell) {
    for (var i = 0; i < state.troggles.length; i++) {
      if (state.troggles[i].cell === cell) return state.troggles[i];
    }
    return null;
  }

  function addScore(state, points) {
    state.score += points;
    if (state.mode !== 'classic') return;
    var boundary = Math.floor(state.score / LIFE_POINTS);
    if (boundary > state.lifeBoundary) {
      // one life per boundary crossed (decision 16)
      state.lives += boundary - state.lifeBoundary;
      state.lifeBoundary = boundary;
      state.events.push({ type: 'extraLife' });
    }
  }

  function loseLife(state, rng, contactTroggle) {
    state.lives -= 1;
    state.events.push({ type: 'hit' });
    if (contactTroggle) {
      var idx = state.troggles.indexOf(contactTroggle);
      if (idx !== -1) {
        state.troggles.splice(idx, 1);
        state.troggles.push(spawnTroggle(state, rng));
      }
    }
    state.walkPath = [];
    if (state.lives <= 0) {
      state.screen = 'gameOver';
      state.events.push({ type: 'gameOver' });
    } else {
      // Muncher respawns IN PLACE with invulnerability
      state.muncher.invulnMs = INVULN_MS;
    }
  }

  function startLevel(state, rng) {
    state.board = seedBoard(state.rule, state.level, rng);
    state.muncher.cell = START_CELL;
    state.trogTickMs = trogTickFor(state.level);
    state.trogAccMs = 0;
    state.walkPath = [];
    state.troggles = [];
    if (state.mode === 'classic') {
      var count = troggleCountFor(state.level);
      for (var i = 0; i < count; i++) {
        state.troggles.push(spawnTroggle(state, rng));
      }
    }
  }

  // Muncher enters a cell: contact if a troggle is there (decision 15).
  function enterCell(state, dest, rng) {
    var trog = troggleAt(state, dest);
    state.muncher.cell = dest;
    if (trog && state.muncher.invulnMs <= 0) {
      loseLife(state, rng, trog);
    }
  }

  function tryMove(state, dCol, dRow, rng) {
    var col = cellCol(state.muncher.cell) + dCol;
    var row = cellRow(state.muncher.cell) + dRow;
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    enterCell(state, cellAt(col, row), rng);
    state.events.push({ type: 'step' });
  }

  // BFS orthogonal path, not troggle-aware (decision 15).
  function bfsPath(from, to) {
    if (from === to) return [];
    var prev = new Array(CELLS).fill(-1);
    var queue = [from];
    prev[from] = from;
    while (queue.length) {
      var cur = queue.shift();
      if (cur === to) break;
      var col = cellCol(cur), row = cellRow(cur);
      var next = [];
      if (col > 0) next.push(cur - 1);
      if (col < COLS - 1) next.push(cur + 1);
      if (row > 0) next.push(cur - COLS);
      if (row < ROWS - 1) next.push(cur + COLS);
      for (var i = 0; i < next.length; i++) {
        if (prev[next[i]] === -1) { prev[next[i]] = cur; queue.push(next[i]); }
      }
    }
    if (prev[to] === -1) return [];
    var path = [];
    for (var c = to; c !== from; c = prev[c]) path.unshift(c);
    return path;
  }

  function doMunch(state, rng) {
    var cell = state.board[state.muncher.cell];
    if (!cell || cell.munched) {
      state.events.push({ type: 'click' }); // empty-cell no-op
      return;
    }
    var correct = isMatch(state.rule, cell.n);
    state.events.push({
      type: 'attempt', correct: correct, n: cell.n,
      tables: state.rule.tables.slice(), mode: state.mode
    });
    if (correct) {
      cell.munched = true;
      state.session.correct += 1;
      state.events.push({ type: 'munch', cell: state.muncher.cell });
      addScore(state, 10);
      if (remainingMatches(state) === 0) {
        if (state.mode === 'blitz') {
          // decision: board reseeds immediately, timer keeps running
          state.board = seedBoard(state.rule, state.level, rng);
          state.events.push({ type: 'reseed' });
        } else {
          addScore(state, 50 * state.level);
          state.screen = 'levelClear';
          state.events.push({ type: 'levelClear' });
        }
      }
    } else {
      state.session.wrong += 1;
      state.events.push({ type: 'wrong', cell: state.muncher.cell });
      // number STAYS on the board (board minutiae)
      state.explain = { text: explanationFor(state.rule.tables, cell.n) };
      addPause(state, 'explanation');
      if (state.mode === 'classic') {
        state.lives -= 1;
        // game-over resolution happens on dismiss so she can read the fact
      } else {
        state.blitzMs = Math.max(0, state.blitzMs - BLITZ_PENALTY_MS);
      }
    }
  }

  function dismissExplain(state) {
    if (!state.explain) return;
    state.explain = null;
    removePause(state, 'explanation');
    if (state.mode === 'classic' && state.lives <= 0) {
      state.screen = 'gameOver';
      state.events.push({ type: 'gameOver' });
    } else if (state.mode === 'blitz' && state.blitzMs <= 0) {
      state.screen = 'blitzResults';
      state.events.push({ type: 'timeUp' });
    }
  }

  function tick(state, dt, rng) {
    if (state.screen !== 'playing' || paused(state)) return;

    // invulnerability: remaining-ms; never expires while co-located (decision 13)
    if (state.muncher.invulnMs > 0) {
      state.muncher.invulnMs -= dt;
      if (state.muncher.invulnMs <= 0) {
        state.muncher.invulnMs = troggleAt(state, state.muncher.cell) ? 1 : 0;
      }
    }

    // blitz clock
    if (state.mode === 'blitz') {
      state.blitzMs -= dt;
      if (state.blitzMs <= 0) {
        state.blitzMs = 0;
        state.screen = 'blitzResults';
        state.events.push({ type: 'timeUp' });
        return;
      }
    }

    // tap-to-walk: one step per WALK_STEP_MS (decision 15)
    if (state.walkPath.length > 0) {
      state.walkAccMs += dt;
      while (state.walkAccMs >= WALK_STEP_MS && state.walkPath.length > 0) {
        state.walkAccMs -= WALK_STEP_MS;
        var dest = state.walkPath.shift();
        enterCell(state, dest, rng);
        state.events.push({ type: 'step' });
        if (state.screen !== 'playing') { state.walkPath = []; break; }
      }
    } else {
      state.walkAccMs = 0;
    }

    // troggle ticks
    state.trogAccMs += dt;
    while (state.trogAccMs >= state.trogTickMs) {
      state.trogAccMs -= state.trogTickMs;
      for (var i = 0; i < state.troggles.length; i++) {
        var tr = state.troggles[i];
        var col = cellCol(tr.cell) + tr.dir[0];
        var row = cellRow(tr.cell) + tr.dir[1];
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
          // walked off the board: respawn per spawn rule
          state.troggles[i] = spawnTroggle(state, rng);
          continue;
        }
        var destCell = cellAt(col, row);
        if (troggleAt(state, destCell)) continue; // never co-occupy: wait
        tr.cell = destCell;
        if (tr.cell === state.muncher.cell && state.muncher.invulnMs <= 0) {
          loseLife(state, rng, tr);
          if (state.screen !== 'playing') return;
        }
      }
    }
  }

  // ---------- reducer ----------

  function reduce(state, event, rng) {
    state.events = [];
    switch (event.type) {
      case 'start': // {settings: {tables, mode}}
        state.rule = { type: 'multiples', tables: event.settings.tables.slice().sort(function (a, b) { return a - b; }) };
        state.mode = event.settings.mode;
        state.level = 1;
        state.score = 0;
        state.lives = state.mode === 'classic' ? 3 : 0;
        state.lifeBoundary = 0;
        state.session = initialStats();
        state.pauseReasons = [];
        state.explain = null;
        state.blitzMs = state.mode === 'blitz' ? BLITZ_MS : 0;
        state.muncher = { cell: START_CELL, invulnMs: 0 };
        startLevel(state, rng);
        state.screen = 'playing';
        state.events.push({ type: 'started' });
        break;

      case 'tick':
        tick(state, event.dt, rng);
        break;

      case 'move': // {dCol, dRow} — one step per keypress (decision 10)
        if (state.screen !== 'playing' || paused(state)) break;
        state.walkPath = []; // keyboard cancels the walk (decision 15)
        tryMove(state, event.dCol, event.dRow, rng);
        break;

      case 'moveTo': // {cell} — tap-to-walk; a new tap reroutes
        if (state.screen !== 'playing' || paused(state)) break;
        state.walkPath = bfsPath(state.muncher.cell, event.cell);
        state.walkAccMs = 0;
        break;

      case 'munch':
        if (state.screen !== 'playing' || paused(state)) break;
        state.walkPath = [];
        doMunch(state, rng);
        break;

      case 'dismissExplain': // the dismissing keypress is swallowed by input.js
        dismissExplain(state);
        break;

      case 'pauseAdd':
        if (state.screen === 'playing') addPause(state, event.reason);
        break;

      case 'pauseRemove':
        removePause(state, event.reason);
        break;

      case 'nextLevel':
        if (state.screen !== 'levelClear') break;
        state.level += 1;
        startLevel(state, rng);
        state.screen = 'playing';
        break;

      case 'playAgain': // same settings
        reduce(state, { type: 'start', settings: { tables: state.rule.tables, mode: state.mode } }, rng);
        break;

      case 'toTitle':
        state.screen = 'title';
        state.pauseReasons = [];
        state.explain = null;
        break;
    }
    return state;
  }

  var api = {
    COLS: COLS, ROWS: ROWS, CELLS: CELLS,
    START_CELL: START_CELL,
    INVULN_MS: INVULN_MS,
    WALK_STEP_MS: WALK_STEP_MS,
    BLITZ_MS: BLITZ_MS,
    isMatch: isMatch,
    bracketingFacts: bracketingFacts,
    closestTable: closestTable,
    explanationFor: explanationFor,
    makeRng: makeRng,
    factorWeight: factorWeight,
    seedBoard: seedBoard,
    remainingMatches: remainingMatches,
    trogTickFor: trogTickFor,
    troggleCountFor: troggleCountFor,
    spawnTroggle: spawnTroggle,
    bfsPath: bfsPath,
    createState: createState,
    reduce: reduce,
    cellCol: cellCol,
    cellRow: cellRow,
    cellAt: cellAt,
    manhattan: manhattan
  };

  globalThis.NM = api;
  if (typeof module !== 'undefined') module.exports = api; // node --test shim
})();

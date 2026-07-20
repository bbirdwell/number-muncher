/* storage.js — progress persistence, split per decision 14:
 *   PURE half: schema, migration, attempt recording, rolling-window star
 *   math, high scores. Fully node-testable.
 *   ADAPTER half: thin localStorage load/save with silent degradation
 *   (decision 7) — no-ops under Node where localStorage doesn't exist.
 *
 * Schema v1 (decision 17):
 *   { v: 1,
 *     name, color, muted,
 *     tables:   { "7": { attempts: [1,0,1,...(ring, last 50)], stars: 0-3 } },
 *     factMisses: { "7x8": n },
 *     highScores: { "7": {classic: n, blitz: n}, "7+8": {...} } }
 *
 * Stars (OV-6A/7A/8A): earned from single-table Classic play only, over a
 * rolling window of the last 50 attempts; displayed star count is a
 * HIGH-WATER MARK (never revoked). Blitz/multi-select update factMisses and
 * high scores only.
 */
(function () {
  'use strict';

  var VERSION = 1;
  var WINDOW = 50;
  var KEY = 'numberMuncher';

  function defaultData() {
    return {
      v: VERSION,
      name: '',
      color: 'green',
      muted: false,
      tables: {},
      factMisses: {},
      highScores: {}
    };
  }

  function migrate(data) {
    if (!data || typeof data !== 'object' || data.v !== VERSION) return defaultData();
    var d = defaultData();
    d.name = typeof data.name === 'string' ? data.name : '';
    d.color = typeof data.color === 'string' ? data.color : 'green';
    d.muted = !!data.muted;
    d.tables = data.tables && typeof data.tables === 'object' ? data.tables : {};
    d.factMisses = data.factMisses && typeof data.factMisses === 'object' ? data.factMisses : {};
    d.highScores = data.highScores && typeof data.highScores === 'object' ? data.highScores : {};
    return d;
  }

  function serialize(data) {
    return JSON.stringify(data);
  }

  function deserialize(json) {
    try {
      return migrate(JSON.parse(json));
    } catch (e) {
      return null; // corrupt JSON → caller falls back to defaults (decision 7)
    }
  }

  // ---------- stars (rolling window) ----------

  function windowAccuracy(attempts) {
    if (!attempts.length) return 0;
    var correct = 0;
    for (var i = 0; i < attempts.length; i++) correct += attempts[i];
    return correct / attempts.length;
  }

  // Thresholds on ATTEMPT counts in the window (design doc):
  // 1★ >=20 attempts @ >=80%, 2★ >=35 @ >=90%, 3★ full 50 @ >=95%
  function computeStarLevel(attempts) {
    var a = attempts.length;
    var acc = windowAccuracy(attempts);
    if (a >= WINDOW && acc >= 0.95) return 3;
    if (a >= 35 && acc >= 0.90) return 2;
    if (a >= 20 && acc >= 0.80) return 1;
    return 0;
  }

  // Progress toward the NEXT star (for the display bar under the stars).
  function starProgress(entry) {
    var attempts = entry.attempts;
    var current = computeStarLevel(attempts);
    var next = Math.min(entry.stars + 1, 3);
    var needAttempts = next === 3 ? WINDOW : next === 2 ? 35 : 20;
    var needAcc = next === 3 ? 0.95 : next === 2 ? 0.90 : 0.80;
    return {
      earned: entry.stars, // high-water mark
      windowLevel: current,
      accuracy: windowAccuracy(attempts),
      attempts: attempts.length,
      nextStar: entry.stars >= 3 ? null : { star: next, needAttempts: needAttempts, needAccuracy: needAcc }
    };
  }

  function tableEntry(data, table) {
    var key = String(table);
    if (!data.tables[key]) data.tables[key] = { attempts: [], stars: 0 };
    return data.tables[key];
  }

  // Fact key for a wrong munch: every factor pair of n within 1..12,
  // canonical "axb" with a<=b. 44 (no pair) records nothing (decision 17).
  function factKeysFor(n) {
    var keys = [];
    for (var a = 1; a <= 12; a++) {
      if (n % a !== 0) continue;
      var b = n / a;
      if (b < a || b > 12) continue;
      keys.push(a + 'x' + b);
    }
    return keys;
  }

  // attempt: {tables: [..], mode: 'classic'|'blitz', correct: bool, n}
  function recordAttempt(data, attempt) {
    if (!attempt.correct) {
      var keys = factKeysFor(attempt.n);
      for (var i = 0; i < keys.length; i++) {
        data.factMisses[keys[i]] = (data.factMisses[keys[i]] || 0) + 1;
      }
    }
    // Star accrual: single-table Classic only (OV-7A)
    if (attempt.mode === 'classic' && attempt.tables.length === 1) {
      var entry = tableEntry(data, attempt.tables[0]);
      entry.attempts.push(attempt.correct ? 1 : 0);
      if (entry.attempts.length > WINDOW) {
        entry.attempts.splice(0, entry.attempts.length - WINDOW); // ring: keep last 50
      }
      var level = computeStarLevel(entry.attempts);
      if (level > entry.stars) entry.stars = level; // high-water mark (OV-8A)
    }
    return data;
  }

  // ---------- high scores ----------

  function selectionKey(tables) {
    return tables.slice().sort(function (a, b) { return a - b; }).join('+');
  }

  // Returns true when this is a new high score.
  function updateHighScore(data, tables, mode, score) {
    var key = selectionKey(tables);
    if (!data.highScores[key]) data.highScores[key] = {};
    var prev = data.highScores[key][mode] || 0;
    if (score > prev) {
      data.highScores[key][mode] = score;
      return true;
    }
    return false;
  }

  function highScoreFor(data, tables, mode) {
    var entry = data.highScores[selectionKey(tables)];
    return (entry && entry[mode]) || 0;
  }

  // For the high-scores overlay: single tables in numeric order first, then
  // multi-table combos alphabetically. Capped at 20 rows.
  function listHighScores(data) {
    var keys = Object.keys(data.highScores);
    var singles = keys.filter(function (k) { return k.indexOf('+') === -1; })
      .sort(function (a, b) { return Number(a) - Number(b); });
    var combos = keys.filter(function (k) { return k.indexOf('+') !== -1; }).sort();
    return singles.concat(combos).slice(0, 20).map(function (k) {
      return {
        key: k,
        classic: data.highScores[k].classic || 0,
        blitz: data.highScores[k].blitz || 0
      };
    }).filter(function (row) { return row.classic > 0 || row.blitz > 0; });
  }

  // ---------- localStorage adapter (browser only) ----------

  function load() {
    try {
      var json = localStorage.getItem(KEY);
      var data = json ? deserialize(json) : null;
      return data || defaultData();
    } catch (e) {
      return defaultData(); // private mode / blocked storage (decision 7)
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, serialize(data));
    } catch (e) {
      /* quota / private mode: keep playing on in-memory state (decision 7) */
    }
  }

  var api = {
    VERSION: VERSION,
    WINDOW: WINDOW,
    defaultData: defaultData,
    migrate: migrate,
    serialize: serialize,
    deserialize: deserialize,
    computeStarLevel: computeStarLevel,
    windowAccuracy: windowAccuracy,
    starProgress: starProgress,
    factKeysFor: factKeysFor,
    recordAttempt: recordAttempt,
    selectionKey: selectionKey,
    updateHighScore: updateHighScore,
    highScoreFor: highScoreFor,
    listHighScores: listHighScores,
    load: load,
    save: save
  };

  globalThis.NMStorage = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

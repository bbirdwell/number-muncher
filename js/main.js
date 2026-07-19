/* main.js — the only clock, and the glue (decision 13):
 *
 *   requestAnimationFrame ──▶ dispatch({tick, dt}) ──▶ NM.reduce ──▶ render
 *                                                          │
 *                            state.events ────────────────▶ audio + storage
 *
 * main.js contains no game rules. It translates time and UI callbacks into
 * events, forwards result events to audio/stats, and persists.
 */
(function () {
  'use strict';

  var NM = globalThis.NM;
  var S = globalThis.NMStorage;
  var R = globalThis.NMRender;
  var A = globalThis.NMAudio;

  var data = S.load();
  var state = NM.createState();
  var rng = NM.makeRng(Date.now() >>> 0);

  // view: render-only concerns that aren't game state
  var view = {
    isTouch: globalThis.matchMedia ? matchMedia('(hover: none)').matches : false,
    tables: [7],
    mode: 'classic',
    newHighScore: false,
    chomp: 0
  };

  function persist() { S.save(data); }

  function processEvents(events) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.type) {
        case 'attempt':
          S.recordAttempt(data, e);
          persist();
          break;
        case 'munch':
          view.chomp++;
          A.crunch();
          break;
        case 'wrong':
          view.chomp++;
          A.buzz();
          break;
        case 'click':
          A.click();
          break;
        case 'hit':
          A.hit();
          break;
        case 'extraLife':
          A.extraLife();
          break;
        case 'levelClear':
          A.fanfare();
          R.confetti();
          break;
        case 'gameOver':
          view.newHighScore = S.updateHighScore(data, state.rule.tables, 'classic', state.score);
          if (view.newHighScore) { persist(); A.fanfare(); R.confetti(); }
          break;
        case 'timeUp':
          view.newHighScore = S.updateHighScore(data, state.rule.tables, 'blitz', state.score);
          persist();
          if (view.newHighScore) { A.fanfare(); R.confetti(); } else { A.timeUp(); }
          break;
      }
    }
  }

  function dispatch(event) {
    NM.reduce(state, event, rng);
    processEvents(state.events);
    R.render(state, data, view);
  }

  var handlers = {
    getState: function () { return state; },
    dispatch: dispatch,
    togglePause: function () {
      if (state.screen !== 'playing') return;
      var manual = state.pauseReasons.indexOf('manual') !== -1;
      dispatch({ type: manual ? 'pauseRemove' : 'pauseAdd', reason: 'manual' });
    },
    toggleMute: function () {
      data.muted = !data.muted;
      A.setMuted(data.muted);
      persist();
      R.render(state, data, view);
    },
    onToggleTable: function (t) {
      var i = view.tables.indexOf(t);
      if (i === -1) view.tables.push(t); else view.tables.splice(i, 1);
      view.tables.sort(function (a, b) { return a - b; });
      R.render(state, data, view);
    },
    onMode: function (m) {
      view.mode = m;
      R.render(state, data, view);
    },
    onName: function (name) {
      data.name = name.slice(0, 20);
      persist();
      // heading updates on next render; avoid re-rendering while she types
    },
    onColor: function (c) {
      data.color = c;
      persist();
      R.render(state, data, view);
    },
    onStart: function () {
      if (view.tables.length === 0) return;
      A.unlock(); // decision 9: create/resume AudioContext inside the gesture
      A.setMuted(data.muted);
      view.newHighScore = false;
      dispatch({ type: 'start', settings: { tables: view.tables.slice(), mode: view.mode } });
    }
  };

  R.init(document.getElementById('app'), view);
  globalThis.NMInput.init(handlers);
  R.render(state, data, view);

  // The clock. dt is clamped so a throttled/hidden frame can't teleport
  // anything (visibilitychange already pauses; this is belt-and-braces).
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(100, now - last);
    last = now;
    if (state.screen === 'playing') dispatch({ type: 'tick', dt: dt });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

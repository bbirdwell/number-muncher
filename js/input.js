/* input.js — translates DOM events into game events. Rules it owns:
 *   - preventDefault on arrows/space during play so the page never scrolls
 *     and ignore key auto-repeat: one step per keypress (decision 10)
 *   - the keypress/tap that dismisses an explanation is SWALLOWED — it never
 *     falls through to munch or move (decision 15)
 *   - tap a cell to walk there, MUNCH button to munch (OV-9A)
 */
(function () {
  'use strict';

  var KEY_DIRS = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
  };

  // handlers: {getState, dispatch, togglePause, toggleMute, ui: {...render els}}
  function init(h) {
    var els = globalThis.NMRender.els;

    var MODIFIER_KEYS = { Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1 };

    document.addEventListener('keydown', function (e) {
      // browser shortcuts (Cmd+R, Cmd+Arrow back-nav...) stay the browser's
      if (e.metaKey || e.ctrlKey || e.altKey || MODIFIER_KEYS[e.key]) return;

      var state = h.getState();
      var gameKeys = e.key === ' ' || KEY_DIRS[e.key];

      // high-scores popup: Escape or Enter closes it
      if (h.isScoresOpen() && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault();
        h.onShowScores(false);
        return;
      }

      if (state.explain) {
        // any explicit keypress dismisses; swallow it completely
        e.preventDefault();
        if (!e.repeat) h.dispatch({ type: 'dismissExplain' });
        return;
      }

      if (state.screen === 'levelClear' && !e.repeat && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        h.dispatch({ type: 'nextLevel' });
        return;
      }

      if (state.screen !== 'playing') return;

      if (e.key === 'p' || e.key === 'P') {
        if (!e.repeat) h.togglePause();
        return;
      }

      if (!gameKeys) return;
      e.preventDefault(); // space/arrows must never scroll the page
      if (e.repeat) return; // one step per keypress

      if (e.key === ' ') {
        h.dispatch({ type: 'munch' });
      } else {
        var d = KEY_DIRS[e.key];
        h.dispatch({ type: 'move', dCol: d[0], dRow: d[1] });
      }
    });

    // Tap a cell -> walk there (OV-9A). Click delegation on the board.
    els.board.addEventListener('click', function (e) {
      var state = h.getState();
      if (state.explain) { h.dispatch({ type: 'dismissExplain' }); return; }
      var cellNode = e.target.closest('[data-cell]');
      if (!cellNode) return;
      h.dispatch({ type: 'moveTo', cell: Number(cellNode.dataset.cell) });
    });

    els.munchBtn.addEventListener('click', function () {
      var state = h.getState();
      if (state.explain) { h.dispatch({ type: 'dismissExplain' }); return; }
      h.dispatch({ type: 'munch' });
    });

    els.explainGo.addEventListener('click', function () {
      h.dispatch({ type: 'dismissExplain' });
    });
    els.card_explain.addEventListener('click', function (e) {
      if (e.target === els.card_explain) h.dispatch({ type: 'dismissExplain' });
    });

    els.pauseBtn.addEventListener('click', h.togglePause);
    els.homeBtn.addEventListener('click', h.onHome); // opens the pause card (D2-A)
    els.resumeBtn.addEventListener('click', h.togglePause);
    els.pausedHomeBtn.addEventListener('click', function () { h.dispatch({ type: 'toTitle' }); });
    els.muteBtn.addEventListener('click', h.toggleMute);
    els.nextBtn.addEventListener('click', function () { h.dispatch({ type: 'nextLevel' }); });
    els.againBtn.addEventListener('click', function () { h.dispatch({ type: 'playAgain' }); });
    els.blitzAgainBtn.addEventListener('click', function () { h.dispatch({ type: 'playAgain' }); });
    els.sessionAgainBtn.addEventListener('click', function () { h.dispatch({ type: 'playAgain' }); });
    els.titleBtn.addEventListener('click', function () { h.dispatch({ type: 'toTitle' }); });
    els.blitzTitleBtn.addEventListener('click', function () { h.dispatch({ type: 'toTitle' }); });
    els.sessionHomeBtn.addEventListener('click', function () { h.dispatch({ type: 'toTitle' }); });
    els.scoresBtn.addEventListener('click', function () { h.onShowScores(true); });
    els.scoresCloseBtn.addEventListener('click', function () { h.onShowScores(false); });

    // Title screen controls
    els.tableGrid.addEventListener('click', function (e) {
      var tb = e.target.closest('[data-table]');
      if (tb) h.onToggleTable(Number(tb.dataset.table));
    });
    els.modeClassic.addEventListener('click', function () { h.onMode('classic'); });
    els.modeBlitz.addEventListener('click', function () { h.onMode('blitz'); });
    els.nameInput.addEventListener('input', function () { h.onName(els.nameInput.value); });
    Object.keys(els.swatches).forEach(function (c) {
      els.swatches[c].addEventListener('click', function () { h.onColor(c); });
    });
    els.startBtn.addEventListener('click', h.onStart);

    // Tab hidden: freeze everything (decision 11)
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) h.dispatch({ type: 'pauseAdd', reason: 'hidden' });
      else h.dispatch({ type: 'pauseRemove', reason: 'hidden' });
    });
  }

  var api = { init: init };
  globalThis.NMInput = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

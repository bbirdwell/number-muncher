/* render.js — DOM rendering. Builds the page ONCE (30 stable cell nodes,
 * one muncher sprite, troggle sprites — decision 4 revised: renders mutate
 * classes/text/transforms only, so CSS animations survive).
 * All user-supplied strings go through textContent (decision 8).
 */
(function () {
  'use strict';

  var NM = globalThis.NM;
  var els = {};
  var cellEls = [];
  var trogEls = {}; // keyed by troggle id — NEVER by array index: respawns
                    // replace/reorder the array, and index-keyed sprites
                    // glide across the board on their CSS transition
  var lastChomp = 0;
  var lastMuncherCell = -1;

  function el(tag, className, parent, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  function button(className, parent, text) {
    var b = el('button', className, parent, text);
    b.type = 'button';
    return b;
  }

  // ---------- one-time build ----------

  function init(root, ui) {
    els.root = root;

    // HUD
    var hud = el('div', 'hud', root);
    els.rule = el('div', 'rule-banner', hud, '');
    var stats = el('div', 'hud-stats', hud);
    var scoreBox = el('div', 'stat', stats);
    el('span', 'stat-label', scoreBox, 'Score');
    els.score = el('span', 'stat-value', scoreBox, '0');
    var livesBox = el('div', 'stat', stats);
    el('span', 'stat-label', livesBox, 'Lives');
    els.lives = el('span', 'stat-value lives', livesBox, '');
    var timerBox = el('div', 'stat stat-timer', stats);
    el('span', 'stat-label', timerBox, 'Time');
    els.timer = el('span', 'stat-value', timerBox, '');
    var roundBox = el('div', 'stat stat-round', stats);
    el('span', 'stat-label', roundBox, 'Round');
    els.round = el('span', 'stat-value', roundBox, '');
    var hudButtons = el('div', 'hud-buttons', hud);
    els.homeBtn = button('icon-btn', hudButtons, '🏠');
    els.homeBtn.setAttribute('aria-label', 'Home');
    els.pauseBtn = button('icon-btn', hudButtons, '⏸');
    els.pauseBtn.setAttribute('aria-label', 'Pause');
    els.muteBtn = button('icon-btn', hudButtons, '🔊');
    els.muteBtn.setAttribute('aria-label', 'Sound on or off');

    // Board
    els.boardWrap = el('div', 'board-wrap', root);
    els.board = el('div', 'board', els.boardWrap);
    for (var i = 0; i < NM.CELLS; i++) {
      var cell = el('button', 'cell', els.board);
      cell.type = 'button';
      cell.dataset.cell = String(i);
      cellEls.push(cell);
    }
    els.muncher = el('div', 'muncher', els.board);
    el('div', 'muncher-eyes', els.muncher);
    el('div', 'muncher-mouth', els.muncher);
    // the number the muncher is standing on — otherwise the sprite hides it
    els.muncherNumber = el('div', 'muncher-number', els.muncher);

    // Touch munch button
    els.munchBtn = button('munch-btn', root, 'MUNCH!');

    // Overlays
    els.overlay = el('div', 'overlay', root);
    buildTitle(ui);
    buildCard('explain', 'Oops!', function (card) {
      els.explainText = el('p', 'explain-text', card, '');
      els.explainGo = button('primary', card, 'Keep going');
    });
    buildCard('levelClear', 'Level clear!', function (card) {
      els.clearText = el('p', '', card, '');
      els.nextBtn = button('primary', card, 'Next level');
    });
    buildCard('gameOver', 'Game over', function (card) {
      els.overText = el('p', '', card, '');
      els.overHigh = el('p', 'highscore-line', card, '');
      els.againBtn = button('primary', card, 'Play again');
      els.titleBtn = button('ghost', card, 'Back to start');
    });
    buildCard('blitzResults', 'Time!', function (card) {
      els.blitzText = el('p', '', card, '');
      els.blitzHigh = el('p', 'highscore-line', card, '');
      els.blitzAgainBtn = button('primary', card, 'Play again');
      els.blitzTitleBtn = button('ghost', card, 'Back to start');
    });
    buildCard('paused', 'Paused', function (card) {
      el('p', '', card, 'Take your time.');
      els.resumeBtn = button('primary', card, 'Keep playing');
      els.pausedHomeBtn = button('ghost', card, 'Back to start');
    });
    buildCard('sessionComplete', 'You did it!', function (card) {
      els.sessionText = el('p', '', card, '');
      els.sessionHigh = el('p', 'highscore-line', card, '');
      els.sessionAgainBtn = button('primary', card, 'Play again');
      els.sessionHomeBtn = button('ghost', card, 'Back to start');
    });
    buildCard('scores', 'High scores', function (card) {
      els.scoresList = el('div', 'scores-list', card);
      els.scoresCloseBtn = button('primary', card, 'Close');
    });

    els.confetti = el('div', 'confetti-layer', root);
  }

  function buildCard(name, title, fill) {
    var card = el('div', 'card card-' + name, els.overlay);
    card.dataset.card = name;
    el('h2', '', card, title);
    fill(card);
    els['card_' + name] = card;
  }

  function buildTitle(ui) {
    var card = el('div', 'card card-title', els.overlay);
    card.dataset.card = 'title';
    els.card_title = card;
    els.titleHeading = el('h1', 'game-title', card, 'Number Muncher');
    el('p', 'tagline', card, 'Munch the multiples. Dodge the Troggle.');

    var tablesLabel = el('p', 'field-label', card, 'Pick your times tables');
    tablesLabel.id = 'tables-label';
    els.tableGrid = el('div', 'table-grid', card);
    els.tableGrid.setAttribute('role', 'group');
    els.tableGrid.setAttribute('aria-labelledby', 'tables-label');
    els.tableBtns = {};
    for (var t = 2; t <= 12; t++) {
      var tb = button('table-btn', els.tableGrid, String(t));
      tb.dataset.table = String(t);
      var star = el('span', 'table-stars', tb, '');
      star.dataset.starsFor = String(t);
      els.tableBtns[t] = tb;
    }
    els.starNote = el('p', 'hint', card, 'Stars are earned in single-table games.');

    el('p', 'field-label', card, 'Game');
    var modeRow = el('div', 'mode-row', card);
    els.modeClassic = button('mode-btn selected', modeRow, 'Classic');
    els.modeClassic.dataset.mode = 'classic';
    el('span', 'mode-hint', els.modeClassic, 'Clear the board, dodge the Troggle');
    els.modeBlitz = button('mode-btn', modeRow, 'Blitz');
    els.modeBlitz.dataset.mode = 'blitz';
    el('span', 'mode-hint', els.modeBlitz, '60 seconds, munch fast!');
    els.highScoreLine = el('p', 'hint highscore-hint', card, '');

    var settingsRow = el('div', 'settings-row', card);
    var nameWrap = el('label', 'name-wrap', settingsRow);
    el('span', 'field-label', nameWrap, 'Your name');
    els.nameInput = el('input', 'name-input', nameWrap);
    els.nameInput.maxLength = 20;
    els.nameInput.placeholder = 'Muncher';
    var colorWrap = el('div', 'color-wrap', settingsRow);
    var colorLabel = el('span', 'field-label', colorWrap, 'Muncher color');
    colorLabel.id = 'color-label';
    var swatches = el('div', 'swatches', colorWrap);
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-labelledby', 'color-label');
    els.swatches = {};
    ['green', 'yellow', 'pink', 'blue'].forEach(function (c) {
      var s = button('swatch swatch-' + c, swatches, '');
      s.dataset.color = c;
      s.setAttribute('aria-label', c + ' muncher');
      els.swatches[c] = s;
    });

    els.startBtn = button('primary start-btn', card, 'Play!');
    els.startHint = el('p', 'hint start-hint', card, '');
    els.scoresBtn = button('ghost scores-btn', card, '🏆 High scores');
    if (ui && ui.isTouch) {
      el('p', 'hint', card, 'Tap a square to walk there. Tap MUNCH! to eat.');
    } else {
      el('p', 'hint', card, 'Arrow keys to move · Space to munch · P to pause');
    }
  }

  // ---------- per-frame render ----------

  function positionSprite(node, cell) {
    var col = NM.cellCol(cell);
    var row = NM.cellRow(cell);
    node.style.transform = 'translate(' + (col * 100) + '%, ' + (row * 100) + '%)';
  }

  function syncTroggleEls(troggles) {
    var seen = {};
    for (var i = 0; i < troggles.length; i++) {
      var tr = troggles[i];
      seen[tr.id] = true;
      var node = trogEls[tr.id];
      if (!node) {
        // new troggle: create and position with the transition suppressed,
        // so a (re)spawn appears in place instead of gliding diagonally
        node = el('div', 'troggle teleport', els.board);
        el('div', 'troggle-eyes', node);
        trogEls[tr.id] = node;
        positionSprite(node, tr.cell);
        void node.offsetWidth; // commit the untransitioned position
        node.classList.remove('teleport');
      } else {
        positionSprite(node, tr.cell);
      }
    }
    Object.keys(trogEls).forEach(function (id) {
      if (!seen[id]) {
        trogEls[id].remove();
        delete trogEls[id];
      }
    });
  }

  function starString(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '★';
    return s;
  }

  function render(state, data, view) {
    // HUD
    els.rule.textContent = 'Multiples of ' + state.rule.tables.join(' or ');
    els.score.textContent = String(state.score);
    els.lives.textContent = state.mode === 'classic' ? '♥'.repeat(Math.max(0, state.lives)) : '';
    els.timer.textContent = state.mode === 'blitz' ? Math.ceil(state.blitzMs / 1000) + 's' : '';
    els.timer.parentElement.classList.toggle('hidden', state.mode !== 'blitz');
    els.timer.parentElement.classList.toggle('timer-low', state.mode === 'blitz' && state.blitzMs < 10000);
    els.lives.parentElement.classList.toggle('hidden', state.mode !== 'classic');
    els.round.textContent = state.level + '/' + NM.SESSION_LEVELS;
    els.round.parentElement.classList.toggle('hidden', state.mode !== 'classic');
    els.muteBtn.textContent = data.muted ? '🔇' : '🔊';
    var inPlay = state.screen === 'playing';
    els.pauseBtn.classList.toggle('hidden', !inPlay);
    els.homeBtn.classList.toggle('hidden', !inPlay);

    // Board cells
    for (var i = 0; i < cellEls.length; i++) {
      var cellState = state.board[i];
      var node = cellEls[i];
      if (!cellState) {
        node.textContent = '';
        continue;
      }
      node.textContent = cellState.munched ? '' : String(cellState.n);
      node.classList.toggle('munched', cellState.munched);
      node.classList.toggle('here', inPlay && i === state.muncher.cell);
    }

    // Sprites
    els.muncher.classList.toggle('hidden', !inPlay && !state.explain);
    els.muncher.className = els.muncher.className.replace(/color-\w+/g, '').trim();
    els.muncher.classList.add('color-' + (data.color || 'green'));
    // a jump of more than one cell is a board reset (new level / restart) —
    // suppress the transition so the muncher doesn't glide diagonally
    if (lastMuncherCell !== -1 &&
        NM.manhattan(lastMuncherCell, state.muncher.cell) > 1) {
      els.muncher.classList.add('teleport');
      positionSprite(els.muncher, state.muncher.cell);
      void els.muncher.offsetWidth;
      els.muncher.classList.remove('teleport');
    } else {
      positionSprite(els.muncher, state.muncher.cell);
    }
    lastMuncherCell = state.muncher.cell;
    els.muncher.classList.toggle('invuln', state.muncher.invulnMs > 0);
    var underMuncher = state.board[state.muncher.cell];
    els.muncherNumber.textContent =
      inPlay && underMuncher && !underMuncher.munched ? String(underMuncher.n) : '';
    if (view.chomp !== lastChomp) {
      lastChomp = view.chomp;
      els.muncher.classList.remove('chomp');
      void els.muncher.offsetWidth; // restart CSS animation
      els.muncher.classList.add('chomp');
    }
    syncTroggleEls(inPlay ? state.troggles : []);

    // Touch munch button
    els.munchBtn.classList.toggle('hidden', !(view.isTouch && inPlay));

    // Overlays
    var activeCard = null;
    if (state.screen === 'title') activeCard = view.showScores ? 'scores' : 'title';
    else if (state.explain) activeCard = 'explain';
    else if (state.screen === 'levelClear') activeCard = 'levelClear';
    else if (state.screen === 'sessionComplete') activeCard = 'sessionComplete';
    else if (state.screen === 'gameOver') activeCard = 'gameOver';
    else if (state.screen === 'blitzResults') activeCard = 'blitzResults';
    else if (state.pauseReasons.indexOf('manual') !== -1) activeCard = 'paused';
    els.overlay.classList.toggle('hidden', !activeCard);
    ['title', 'explain', 'levelClear', 'gameOver', 'blitzResults', 'paused',
     'sessionComplete', 'scores'].forEach(function (name) {
      els['card_' + name].classList.toggle('hidden', name !== activeCard);
    });

    if (activeCard === 'title') renderTitle(state, data, view);
    if (state.explain) els.explainText.textContent = state.explain.text;
    if (activeCard === 'levelClear') {
      els.clearText.textContent = 'Level ' + state.level + ' munched! Score: ' + state.score;
    }
    if (activeCard === 'gameOver') {
      els.overText.textContent = 'Score ' + state.score + ' · Level ' + state.level +
        ' · ' + sessionAccuracy(state) + '% right';
      els.overHigh.textContent = view.newHighScore ? 'New high score!' : '';
    }
    if (activeCard === 'blitzResults') {
      els.blitzText.textContent = (data.name ? data.name + ', you' : 'You') +
        ' munched ' + state.session.correct + ' in 60 seconds — score ' + state.score;
      els.blitzHigh.textContent = view.newHighScore ? 'New high score!' : '';
    }
    if (activeCard === 'sessionComplete') {
      var who = data.name ? data.name + ', you' : 'You';
      els.sessionText.textContent = who + ' finished all ' + NM.SESSION_LEVELS +
        ' rounds of the ' + state.rule.tables.join(' & ') + 's! Score ' +
        state.score + ' · ' + sessionAccuracy(state) + '% right';
      els.sessionHigh.textContent = view.newHighScore ? 'New high score!' : '';
    }
    if (activeCard === 'scores') renderScores(data);
  }

  function renderScores(data) {
    var rows = globalThis.NMStorage.listHighScores(data);
    els.scoresList.textContent = '';
    if (rows.length === 0) {
      el('p', 'hint', els.scoresList, 'No high scores yet — go munch!');
      return;
    }
    rows.forEach(function (row) {
      var line = el('div', 'score-row', els.scoresList);
      var label = row.key.indexOf('+') === -1
        ? 'Table ' + row.key
        : 'Tables ' + row.key.split('+').join(' & ');
      el('span', 'score-label', line, label);
      el('span', 'score-value', line, row.classic ? 'Classic ' + row.classic : '—');
      el('span', 'score-value', line, row.blitz ? 'Blitz ' + row.blitz : '—');
    });
  }

  function sessionAccuracy(state) {
    var total = state.session.correct + state.session.wrong;
    if (!total) return 100;
    return Math.round((state.session.correct / total) * 100);
  }

  function renderTitle(state, data, view) {
    var name = (data.name || '').trim();
    els.titleHeading.textContent = name ? name + "'s Number Muncher" : 'Number Muncher';
    if (document.activeElement !== els.nameInput) els.nameInput.value = data.name || '';
    for (var t = 2; t <= 12; t++) {
      var selected = view.tables.indexOf(t) !== -1;
      els.tableBtns[t].classList.toggle('selected', selected);
      els.tableBtns[t].setAttribute('aria-pressed', selected ? 'true' : 'false');
      var entry = data.tables[String(t)];
      var starsNode = els.tableBtns[t].querySelector('[data-stars-for]');
      starsNode.textContent = entry ? starString(entry.stars) : '';
    }
    els.modeClassic.classList.toggle('selected', view.mode === 'classic');
    els.modeBlitz.classList.toggle('selected', view.mode === 'blitz');
    Object.keys(els.swatches).forEach(function (c) {
      els.swatches[c].classList.toggle('selected', (data.color || 'green') === c);
    });
    var hs = globalThis.NMStorage.highScoreFor(data, view.tables.length ? view.tables : [7], view.mode);
    els.highScoreLine.textContent = hs ? 'High score: ' + hs : '';
    els.startBtn.disabled = view.tables.length === 0;
    els.startHint.textContent = view.tables.length === 0 ? 'Pick at least one table to play.' : '';
  }

  // Munch wisp (playtest change 5): the munched number floats up, grows,
  // and fades like dispersing smoke. Outer div carries the grid transform
  // (so the keyframe animation on the inner span composes cleanly);
  // removed on animationend.
  function wisp(cell, n) {
    if (globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var holder = el('div', 'wisp-holder', els.board);
    positionSprite(holder, cell);
    var span = el('span', 'wisp', holder, String(n));
    span.addEventListener('animationend', function () { holder.remove(); });
    setTimeout(function () { holder.remove(); }, 1500); // belt-and-braces cleanup
  }

  // Celebration confetti — capped particle count (perf review note).
  function confetti() {
    if (globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = ['#7CF29C', '#FFD34D', '#FF6B6B', '#7FB8FF', '#F2F1FF'];
    for (var i = 0; i < 36; i++) {
      var p = el('span', 'confetti', els.confetti);
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.4) + 's';
      p.style.setProperty('--drift', (Math.random() * 2 - 1).toFixed(2));
      (function (node) {
        node.addEventListener('animationend', function () { node.remove(); });
      })(p);
    }
  }

  var api = { init: init, render: render, confetti: confetti, wisp: wisp, els: els, cellEls: cellEls };
  globalThis.NMRender = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

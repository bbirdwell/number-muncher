# Number Muncher

A browser clone of MECC's *Number Munchers* (1986) for practicing times
tables. Move the muncher, eat the multiples, dodge the Troggle.

No build step, no dependencies, no accounts. Vanilla HTML/CSS/JS.

## Play

- **Easiest:** open `index.html` in any browser (double-click works).
- **On a tablet/phone on your network:**
  `python3 -m http.server` in this folder, then visit
  `http://<your-computer>:8000` from the device.

## How to play

- Pick the times table(s) to practice, then **Classic** or **Blitz**.
- **Classic** — munch every multiple on the board to clear the level.
  Wrong munch or Troggle contact costs a life; 3 lives. Extra life every
  1000 points. Levels get faster.
- **Blitz** — 60 seconds, munch as many multiples as you can. Wrong answers
  cost 5 seconds.
- **Keyboard:** arrow keys move, Space munches, P pauses.
- **Touch:** tap a square to walk there, tap **MUNCH!** to eat.
- Stars (per table, earned in single-table Classic games) track mastery —
  once earned they never go away.

Progress, high scores, name, and colors are saved in the browser
(localStorage) — nothing leaves the device.

## Development

- Design doc: `docs/designs/number-muncher.md` (the full spec — game rules,
  architecture decisions, review history).
- Tests: `npm test` (Node's built-in runner; covers the pure modules:
  `js/game.js` and `js/storage.js`).
- Architecture in one line: `js/game.js` is a pure `(state, event) → state`
  reducer with an injectable RNG; `js/main.js` owns the only clock;
  render/input/audio are thin DOM adapters. Keep game rules out of the DOM
  modules and `game.js` DOM-free.

## Backlog

See `TODOS.md` — more math modes (factors, primes), more Troggle types,
safety squares.

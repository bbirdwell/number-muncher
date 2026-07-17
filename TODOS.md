# TODOS

Deferred work from the 2026-07-15 CEO plan review. Full context in
`docs/designs/number-muncher.md`.

## Additional math modes (Factors, Primes, Equalities, Inequalities)

- **What:** The original's other four modes ("munch all factors of 24", primes, etc.).
- **Why:** The natural next chapter once multiplication fluency is solid.
- **Context:** A mode is a rule function (`isMatch(rule, n)`) plus a board-seeding
  strategy in `js/game.js` — the architecture was built for this. ~15 min each with CC.
- **Effort:** M → S with CC. **Priority:** P2 (when she outgrows multiples).
- **Decision trail:** Deferred in cherry-pick ceremony (D5.7).

## More Troggle types + safety squares

- **What:** Smartie (chases the Muncher), Bashful (wanders, flees when approached),
  and safety squares (temporary cells Troggles can't enter).
- **Why:** Difficulty headroom for when the straight-line Troggle gets easy.
- **Context:** v1 Troggle movement is a strategy function on the tick system in
  `js/game.js` — a new type is a new movement function. Safety squares are a cell
  flag the Troggle pathing respects.
- **Effort:** M → S with CC. **Priority:** P3.
- **Depends on:** v1 shipped; her actually finding v1 easy.

## Cross-device progress sync

- **What:** Stars/high scores follow her across devices (currently localStorage,
  one browser on one device).
- **Why:** Only matters given evidence of multi-device play — watch for "my stars
  are gone" confusion.
- **Context:** All persistence is isolated in `js/storage.js`. Cheapest honest
  version: an export code she types into the other device — no server needed.
- **Effort:** L → M with CC. **Priority:** P3.
- **Trigger:** She plays on a second device.

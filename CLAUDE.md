# Number Muncher

A browser clone of MECC's Number Munchers (1986) for practicing times tables.
Vanilla JS, no build step, no dependencies. Full spec: `docs/designs/number-muncher.md`.

- Run locally: open `index.html` (plain scripts, works over `file://`) or `python3 -m http.server`.
- Tests: `node --test` (pure modules only: game logic, seeding, storage serialization).
- Pure logic lives in `js/game.js` — keep it DOM-free so tests keep working.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

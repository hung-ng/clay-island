# Project Status

**Current goal:** Continue `docs/plans/1-tiny-god-game.md` from the reviewed and hardened Tasks 0–15 baseline.

**Last done:** Audited all Tasks 0–15 code and fixed consequence, targeting, villager, terrain, lifecycle, cleanup, edge-cast, camera, and WKWebView tray interactions; updated `docs/architecture.md`; 82 tests and the production build pass, with normal and low-FX browser verification clean.

**Next step:** Implement Task 16 with TDD: add the pure `src/powers/matrix.ts` table and completeness tests, then replace `applyMeteorOutcome` and the temporary Lightning/Rain target dispatch with declarative interaction handlers.

**Blockers:** None.

## Log

- 2026-07-13 — Completed the Tasks 0–15 hardening review: fixed persistent power consequences, invalid/stale targets and activities, terrain/resource cleanup, camera/input/core lifecycle defects, rim effects, and WKWebView cooldown/focus corruption; 82 tests, build, and normal/low-FX browser checks pass.
- 2026-07-13 — Completed Tasks 9–15: semantic tray/targeting, reusable FX, Meteor/Lightning/Rain timelines, deterministic fire spread, comic zap, and restorative ponds, flowers, fruit, graves, fishing, and villager reactions; 47 tests plus normal browser acceptance pass.
- 2026-07-12 — Completed Tasks 6–8: non-overlapping trees/huts/campfire and world queries, the pure eight-state FSM, then six active clay villagers with emotes, construction/chopping/campfire behaviors, and self-healing population.
- 2026-07-12 — Completed Tasks 0–5: scaffold, pure core systems, clay material/wobble, crater-aware procedural island and scene rig, then golden-hour lighting/post stack with normal and low-FX verification.

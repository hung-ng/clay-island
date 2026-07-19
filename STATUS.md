# Project Status

**Current goal:** The six-minute day/night cycle and night villager behavior are complete and ready to ship.

**Last done:** Implemented the Auto/Day/Night clock, phased lighting and sky, stars and fireflies, persisted Settings control, night roles and activities, and hut sleep presentation. Sleepers now reserve at most two slots per hut, use the next available home, disappear at the doorway, and show centred or separated roof-level `z` bubbles. All 590 tests, TypeScript, the production build, and diff hygiene passed; cmux visually confirmed two sleepers per occupied hut before its control socket stalled during the final spacing recapture.

**Next step:** Optionally recapture the final raised and widened sleep bubbles in cmux once its control socket is stable; otherwise begin the next feature or release task.

**Blockers:** cmux browser control became intermittently unresponsive after hot reload; automated coverage for the final bubble coordinates is passing.

## Log

- 2026-07-19 — Completed the day/night cycle, night atmosphere and villager roles, plus two-person hut sleep allocation and separated raised roof bubbles; 590 tests, TypeScript, build, and diff hygiene passed.
- 2026-07-17 — Upgraded the completion celebration to an escalating eighteen-launch storybook fireworks show with richer audio and villagers; 559 tests, TypeScript, build, and diff hygiene passed.
- 2026-07-17 — Added natural one-pioneer village growth, balanced smocks, persistent nap `z`, and a richer emote vocabulary; user live QA and 556-test/build verification passed.
- 2026-07-17 — Completed Living Island & Presentation with hidden-tab simulation, four new villager states and variety tuning, refreshed OG/favicon assets, documentation, and 543 passing tests plus a clean build.
- 2026-07-16 — Unified the title with the gameplay atmosphere, kept ambient motion and camera orbit live through Begin, and verified 515 tests, TypeScript, build, and diff hygiene.

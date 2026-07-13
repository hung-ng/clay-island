# Project Status

**Current goal:** Deploy and externally playtest the completed Tiny God Game finishing pass from `docs/plans/2-matrix-discovery-book-audio-ship.md`.

**Last done:** Reviewed plan 2 and fixed the clay book being cropped: the ortho camera framed a fixed world height, so a near-square dialog cut off the 7.2-wide book and pulled the invisible DOM tile buttons off their 3D slabs. The book viewport now holds a fixed book-shaped aspect (`7.9 / 5.75`, matching a new `BOOK_EXTENT`), so the frustum is constant and one set of grid insets is correct at any dialog size.

**Next step:** Baseline is committed; polish each area in its own follow-up plan. Nearest candidates: tighten book tile alignment (DOM buttons currently sit within ~10% of a tile's width, correct but not pixel-tight), reshoot the OG image as a meteor mid-fall, and do the plan's unrun "play it with your eyes closed" audio pass and five-second test.

**Blockers:** No deployment target or credentials are configured in the repository.

## Log

- 2026-07-13 — Reviewed plan 2 end-to-end and fixed the cropped clay book via a fixed-aspect book viewport; also dropped a stale mobile grid override. Two intentional behavior changes confirmed: lightning's zap no longer kills (villager returns to `wander`), and reduced-motion users get the flat DOM panel rather than the 3D book. 125 tests, `tsc`, and build pass.
- 2026-07-13 — Fixed the transparent journal overlay intercepting all clicks by disabling closed-state pointer input and honoring `[hidden]`; verified map, power, and journal interaction plus 125 tests and build.
- 2026-07-13 — Completed plan 2: matrix outcomes, 12 Moments, clay book, centralized foley, intro/performance poses, accessible low-FX fallback, real gameplay share assets, metadata, and documentation; 125 tests and build pass.
- 2026-07-13 — Completed the Tasks 0–15 hardening review: fixed persistent power consequences, invalid/stale targets and activities, terrain/resource cleanup, camera/input/core lifecycle defects, rim effects, and WKWebView cooldown/focus corruption; 82 tests, build, and normal/low-FX browser checks pass.
- 2026-07-13 — Completed Tasks 9–15: semantic tray/targeting, reusable FX, Meteor/Lightning/Rain timelines, deterministic fire spread, comic zap, and restorative ponds, flowers, fruit, graves, fishing, and villager reactions; 47 tests plus normal browser acceptance pass.

# Project Status

**Current goal:** Finish the intro time-lapse — a 17-second prologue where three days and nights pass while villagers build continuously.

**Last done:** Rebuilt the prologue as a time-lapse: three shaped day/night cycles driven through the pure `sampleAt()` so sky, clouds, sun position, shadows, stars, and fireflies all sweep together; varied cycle lengths so it reads as a progression rather than a loop; continuous hut growth and villager work circuits replacing the old stop-motion beats; trees growing across the full run with three felled for timber and regrown; campfire built during the first night with a live flickering flame. Fixed the Begin flash by starting and ending the sweep on `GOLDEN_T`, where the title already sits. Fixed reduced-motion islet bobbing and routed ambient fire ticks through the duckable ambient bus. 688 tests, TypeScript, production build, and browser smoke checks pass.

**Next step:** None for this review. The intro was checked in the browser after the prologue refactor; future visual tuning can revisit chop readability, `PROLOGUE_CLOUD_DRIFT = 14`, and dawn sky redraw cadence if playtesting calls for it.

**Blockers:** None.

## Log

- 2026-07-20 — Rebuilt the intro as a 17s three-cycle time-lapse with swept lighting/stars/shadows, varied cycles, continuous hut and tree growth, first-night campfire with animated flame, tree felling, and a seamless golden-hour start/end; 688 tests plus clean type/build/browser/diff checks.
- 2026-07-20 — Completed photo mode with editable postcard preview, opt-in save/discard flow, persisted day captions, responsive two-row phone controls, and 669 passing tests plus clean type/build/browser/diff checks.
- 2026-07-19 — Completed Wind with radius sway/fruit/tumble effects, directional fire embers, dropped-fruit gathering and corrected pickup presentation, tray polish, and 650 passing tests plus clean type/build/diff checks.
- 2026-07-19 — Added celebration night staging, pooled burst lighting, corrected 0/3.2/11 camera timing, and a startup Day glide that never crosses night; 604 tests, TypeScript, build, and diff hygiene passed.
- 2026-07-19 — Completed the day/night cycle, night atmosphere and villager roles, plus two-person hut sleep allocation and separated raised roof bubbles; 590 tests, TypeScript, build, and diff hygiene passed.

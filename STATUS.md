# Project Status

**Current goal:** A feature showcase video for X (16:9, with sound) of everything the island does.

**Last done:** Replaced the title plaque with 3D lettering rolled from clay coils (cream with an ink outline), plopping in at 12fps over a depth-of-field-blurred island that racks into focus on Begin. Burning trees and huts now show their flames (they sat inside the crown and dome). The capture harness records the game's audio through an offline AudioContext stepped with the video, and `tools/promo/showcase.mjs` renders a 98 s showcase: title and intro time-lapse, tray drags with a cursor (meteor, rain filling the crater, nudge to fishing, lightning, wildfire and firefighting, a wrecked hut, a rained-on villager, wind), the journal, a sunset time-lapse, night, fireworks.

**Next step:** Owner review of the showcase. The fireworks shot is the weakest: bursts read small over a thin strip of village.

**Blockers:** None.

## Log

- 2026-10-03 — Clay-coil title lettering with background blur and rack focus, visible fire on burning trees and huts, synced audio capture, and the 98 s feature showcase render; 682 tests, TypeScript and build pass.
- 2026-10-03 — Visual pass for screen capture (anti-aliasing, bloom, tone mapping, clay noise, faces, coil huts, night lamps, strata underside, glowing fire and power effects) plus a dev-only capture handle; 679 tests, TypeScript and build pass; verified in headless Chromium.
- 2026-07-20 — Rebuilt the intro as a 17s three-cycle time-lapse with swept lighting/stars/shadows, varied cycles, continuous hut and tree growth, first-night campfire with animated flame, tree felling, and a seamless golden-hour start/end; 680 tests plus clean type/build checks. Not yet verified in a browser.
- 2026-07-20 — Completed photo mode with editable postcard preview, opt-in save/discard flow, persisted day captions, responsive two-row phone controls, and 669 passing tests plus clean type/build/browser/diff checks.
- 2026-07-19 — Completed Wind with radius sway/fruit/tumble effects, directional fire embers, dropped-fruit gathering and corrected pickup presentation, tray polish, and 650 passing tests plus clean type/build/diff checks.
- 2026-07-19 — Added celebration night staging, pooled burst lighting, corrected 0/3.2/11 camera timing, and a startup Day glide that never crosses night; 604 tests, TypeScript, build, and diff hygiene passed.
- 2026-07-19 — Completed the day/night cycle, night atmosphere and villager roles, plus two-person hut sleep allocation and separated raised roof bubbles; 590 tests, TypeScript, build, and diff hygiene passed.

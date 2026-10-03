# Project Status

**Current goal:** Make the island look good on camera for a short promo clip on X (16:9).

**Last done:** Visual pass for screen capture. Rendering: multisampled half-float composer (the post stack had no anti-aliasing), bloom for things that glow, Neutral tone mapping on both quality paths, no film grain (video compression smears it), lighter vignette, up to 2x DPR. Clay: smooth three-channel value-noise thumbprints and tint (the per-cell hash read as speckle and a checkerboard), soft rim light off the terrain, brighter moonlight. Models: villager eyes, coil-built huts with arched doorways lamp-lit at night, smoother crowns, white chimney smoke, layered strata on the island underside, glowing clay flames with a stronger campfire light, a flame-lump meteor trail and stop-motion impact burst, a zigzag bolt, soft round fireflies and stars, glowing firework sparks. A dev-only `window.__clay` handle lets a headless browser script the camera, clock and powers for captures.

**Next step:** Review the rendered promo draft; tune any shot or effect the owner flags.

**Blockers:** None.

## Log

- 2026-10-03 — Visual pass for screen capture (anti-aliasing, bloom, tone mapping, clay noise, faces, coil huts, night lamps, strata underside, glowing fire and power effects) plus a dev-only capture handle; 679 tests, TypeScript and build pass; verified in headless Chromium.
- 2026-07-20 — Rebuilt the intro as a 17s three-cycle time-lapse with swept lighting/stars/shadows, varied cycles, continuous hut and tree growth, first-night campfire with animated flame, tree felling, and a seamless golden-hour start/end; 680 tests plus clean type/build checks. Not yet verified in a browser.
- 2026-07-20 — Completed photo mode with editable postcard preview, opt-in save/discard flow, persisted day captions, responsive two-row phone controls, and 669 passing tests plus clean type/build/browser/diff checks.
- 2026-07-19 — Completed Wind with radius sway/fruit/tumble effects, directional fire embers, dropped-fruit gathering and corrected pickup presentation, tray polish, and 650 passing tests plus clean type/build/diff checks.
- 2026-07-19 — Added celebration night staging, pooled burst lighting, corrected 0/3.2/11 camera timing, and a startup Day glide that never crosses night; 604 tests, TypeScript, build, and diff hygiene passed.
- 2026-07-19 — Completed the day/night cycle, night atmosphere and villager roles, plus two-person hut sleep allocation and separated raised roof bubbles; 590 tests, TypeScript, build, and diff hygiene passed.

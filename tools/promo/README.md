# Promo capture

Renders footage of the island frame by frame in headless Chromium, with sound.
Time is virtual: rAF, `performance.now`, timers and CSS/Web Animations only
advance when the script steps, so even slow software WebGL yields smooth 30 fps
footage. The game's `AudioContext` is swapped for an offline one whose clock is
stepped with the video, so every sound lands on its frame; slow-motion keeps
sounds at their real pitch, and skipped stretches are cut from the audio too.

The scripts drive the camera, clock and powers through the dev-only
`window.__clay` handle, so they need a development-mode build.

- `showcase.mjs`: the ~95 s feature showcase. The title and intro time-lapse,
  then powers dragged from the tray with a visible cursor (meteor, rain filling
  the crater, a nudge sending a villager fishing, lightning in the pond,
  wildfire, firefighting, a wrecked hut, a rained-on villager, wind), the
  journal, a sunset time-lapse, the village at night, and fireworks.
- `render.mjs`: the earlier 30 s promo cut (no audio).
- `harness.mjs`: the virtual-time and audio-capture harness both use.

```bash
# 1. a static dev-mode build (no HMR client to reload mid-render), served on :5174
NODE_ENV=development npx vite build --mode development --outDir tools/promo/out/site
npx http-server tools/promo/out/site -p 5174 -s &

# 2. framing check: stills at 960x540 into out/preview (optionally only some sections)
node tools/promo/showcase.mjs preview          # or: preview C,D

# 3. 1920x1080 frames + audio into out/frames. A part replays the sections
#    before it unrecorded, so two runs side by side is the sweet spot:
node tools/promo/showcase.mjs final A & node tools/promo/showcase.mjs final BCD; wait

# 4. stitch, loudness-normalise (-16 LUFS) and encode for X
tools/promo/encode-showcase.sh               # -> tools/promo/out/clay-island-showcase.mp4
```

Playwright isn't a dependency; set `PLAYWRIGHT=/path/to/playwright/index.mjs` if
`playwright` doesn't resolve. Targets that move (trees get chopped, villagers
wander) are picked live from the world when each shot starts.

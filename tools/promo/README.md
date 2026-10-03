# Promo capture

Renders the ~30 s promo clip frame by frame in headless Chromium. Time is
virtual (rAF, `performance.now`, timers and CSS/Web Animations only advance when
the script steps), so even slow software WebGL yields smooth 30 fps footage.
The script drives the camera, clock and powers through the dev-only
`window.__clay` handle, so it needs a development-mode build.

```bash
# 1. a static dev-mode build (no HMR client to reload mid-render), served on :5174
NODE_ENV=development npx vite build --mode development --outDir tools/promo/out/site
npx http-server tools/promo/out/site -p 5174 -s &

# 2. framing check: four stills per shot at 960x540 into out/preview
node tools/promo/render.mjs preview
#    or every 30 fps frame of one shot: node tools/promo/render.mjs check meteor

# 3. the real thing at 1920x1080 into out/frames (day and night halves can run in parallel)
node tools/promo/render.mjs final A
node tools/promo/render.mjs final B

# 4. encode for X
ffmpeg -framerate 30 -pattern_type glob -i 'tools/promo/out/frames/*.jpg' \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -movflags +faststart promo.mp4
```

Playwright isn't a dependency; set `PLAYWRIGHT=/path/to/playwright/index.mjs` if
`playwright` doesn't resolve. Shots, camera paths and timings live in the
`shots` array in `render.mjs`.

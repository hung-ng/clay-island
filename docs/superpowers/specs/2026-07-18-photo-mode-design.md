# Photo Mode — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Build order:** 4 of 4 (day/night → celebration upgrade → wind power → photo mode)
**Depends on:** Day/night cycle spec — the postcard caption reads the day count and
time-of-day label from the day clock.

## Overview

A one-click photo mode that captures the current view as a **postcard**: the rendered
scene composited with a soft clay-paper border and a pressed caption such as
"Clay Island — Day 12, dusk". Entirely local; the file downloads as a PNG. Built
last so it can capture night skies, upgraded celebrations, and wind gusts.

## Entry points

- A small camera button in the tray, plus keyboard shortcut `P`.
- Available only in the `gameplay` phase with no modal owner (same armability
  condition powers use). Disabled, not hidden, otherwise.

## Capture flow

1. On trigger, temporarily resize the renderer and post-processing composer to a
   capped high resolution (~2560 px wide, preserving aspect).
2. Render one frame and read the canvas synchronously (render-then-capture in the
   same task, so `preserveDrawingBuffer` stays off and normal play pays no cost).
3. Restore the previous renderer/composer size immediately.
4. Composite onto a 2D canvas: the capture, a soft clay-paper border, and the
   caption. Caption text derives from the day clock: day count (number of completed
   day cycles this island has lived, persisted alongside the clock) and the current
   phase kind (`dawn`/`day`/`dusk`/`night`).
5. Export via `toBlob` and download through a temporary anchor as
   `clay-island-day-<n>-<phase>.png`. No external services.

## Day counter

- The day clock (spec 1) gains a persisted day counter: increments each time the
  phase wraps, stored with the same safe-storage semantics as other
  `clayisland.*` keys (blocked storage → session-local, counter restarts at 1).
- Photo mode is its only consumer in this spec; it is cheap to add to the clock and
  the postcard is more charming for it.

## Feedback

- A brief white DOM overlay flash and a synthesized shutter click through `Sfx`.
- An `aria-live` polite announcement: "Photo saved".
- Reduced motion: no flash; the announcement and click remain.
- `?lowfx=1` / reduced quality: capture works and shows whatever the reduced
  renderer shows (no shadows/post) — humbler but honest. The capped capture
  resolution still applies.

## Error handling

- If the high-resolution render or `toBlob` fails (memory pressure, blocked
  download), restore the renderer size, skip the download, and announce
  "Photo failed" via the same `aria-live` region. Never leave the renderer at the
  capture size.
- Capture is synchronous and short; input during the single capture frame is
  ignored rather than queued.

## Testing

- Postcard composition tests (2D canvas layout, caption text derivation from day
  count + phase kind, filename derivation) in the Node test environment with a
  stubbed canvas.
- Day-counter tests in `dayClock.test.ts`: wrap increments, persistence semantics.
- Armability tests: gameplay-only, no-modal condition, disabled state.
- Renderer resize/restore covered by an integration-style test around the capture
  controller with a stubbed renderer/composer (verify restore on success and on
  failure).

## Files touched

- New: `src/ui/photo.ts` (+ test) owning the button, capture orchestration, and
  postcard composition.
- Modified: `src/core/dayClock.ts` (day counter), `src/core/preferences.ts`
  (counter storage), `src/ui/tray.ts`, `src/audio/sfx.ts` (shutter voice),
  `src/main.ts`, `docs/architecture.md`.

## Out of scope

Plain full-bleed export option, share targets, camera filters or depth-of-field
presets, auto-photos during the celebration finale, gallery of past photos.

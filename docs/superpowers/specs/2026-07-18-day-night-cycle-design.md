# Day/Night Cycle — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Build order:** 1 of 4 (day/night → celebration upgrade → wind power → photo mode)

## Overview

A ~6-minute automatic day/night cycle that runs only during gameplay. Lighting, sky,
stars, and fireflies all derive from a single simulation-driven clock; villagers gather
at the campfire at dusk and sleep at night while one or two night owls keep the island
alive. Settings gains a **Time of day: Auto / Day / Night** control. The title screen,
prologue, and replay keep their canonical golden hour untouched.

Scope level: **ambient + behavior**. No gameplay rule changes, no new Moments, no
power behavior differences at night (deferred; see Out of scope).

## The day clock (pure module)

New `src/core/dayClock.ts`, Three.js-free in the style of `camera/policy.ts` and
`core/appFlow.ts`.

- Holds a phase in `[0, 1)` over a **360-second period**, advanced by the fixed 30 Hz
  simulation step. Because it ticks with the simulation, the hidden-tab background
  ticker advances it too (subject to the existing 30-simulated-second drain cap), so a
  returning player can find a different time of day.
- Phase allocation: dawn 25 s → day 200 s → dusk 25 s → night 110 s.
- A pure `sample(phase): DayParams` interpolates between keyframes with smooth
  (C1-continuous) easing across anchor boundaries and returns:
  - `kind: 'dawn' | 'day' | 'dusk' | 'night'` (discrete, for the villager scheduler)
  - sun arc angle (elevation/azimuth along a fixed great-circle arc)
  - key-light color and intensity
  - hemisphere-light sky color, ground color, and intensity
  - sky gradient stops (`skyHigh`, `skyLow`)
  - cloud tint
  - star opacity (0 during day)
  - firefly level (0 outside dusk/night)
- **The current golden-hour look becomes the late-day keyframe.** Entering gameplay
  starts the clock at that anchor, so there is no visual pop after the prologue.
- Night palette values join `ui/tokens.ts` alongside the existing `PALETTE`.

### Override mode

`setMode('auto' | 'day' | 'night')` lives on the clock:

- `auto` (default): phase ticks normally.
- `day` / `night`: the phase glides to the target anchor over a few seconds, then
  holds. The **full simulation follows** — villagers keep sleeping under a held night
  sky. Returning to `auto` resumes ticking from the held phase.
- Reduced motion snaps the phase directly instead of gliding.
- The clock also accepts a temporary programmatic override request (used by the
  celebration upgrade, spec 2 of 4) that composes with, and yields back to, the
  user-selected mode.

## Sky and lighting (`scene.ts`)

- The existing `key` `DirectionalLight` lerps color/intensity from `DayParams`. In
  **enhanced quality its position also travels the sun arc** — long dawn shadows, high
  noon, warm low dusk, then a held cool dim "moon" pose at night. Shadow maps already
  re-render every frame, so the moving light adds no meaningful cost. Reduced quality
  (which already bypasses shadows) skips the arc and lerps colors only.
- The `fill` `HemisphereLight` lerps sky/ground colors and intensity.
- The canvas gradient sky redraws from the sampled stops, throttled to ~4 Hz —
  imperceptible at this timescale and cheap because the canvas is tiny.
- **Stars:** one deterministic `THREE.Points` dome (~300 points; fewer on lowfx),
  faded by `starOpacity`. Subtle twinkle in enhanced mode; static under reduced
  motion.
- **Fireflies:** a small pooled particle group drifting near trees at dusk/night,
  through the existing `fx/particles.ts` pooling. Off on lowfx; fade-only (no darting)
  under reduced motion.
- Cloud materials tint from `DayParams.cloudTint`.

## Villager schedule (`villagers/fsm.ts`)

- `FsmCtx` gains `dayKind` and a per-villager `nightRole: 'sleeper' | 'owl'`.
- **Owls:** 1–2 villagers chosen deterministically each night, rotating so it is not
  always the same villagers.
- **Dusk:** weight boost for `sitAtFire`, `dance`, and `chat` — a fireside gathering
  using existing states.
- **Night, sleepers:** one new state `sleep` — walk to a hut, lie down at its doorway,
  persistent `z` particles (reusing the nap machinery, with a destination).
  Overwhelming weight so sleepers reliably head home.
- **Night, owls:** existing states with night weights — `sitAtFire` (fire-tender),
  `fish`, `watchSea` (reads as stargazing).
- **Powers still wake everyone:** the existing startle/interrupt paths (meteor sprint,
  lightning flinch, rain grump) already override states; no special wake logic.
- **Dawn:** the normal weight table resumes.

## Settings and preferences

- New "Time of day" fieldset in `ui/settings.ts` with **Auto / Day / Night** radios,
  mirroring the Quality group's markup and focus behavior.
- Persisted as `clayisland.timeOfDay` in `core/preferences.ts` with the same
  safe-storage semantics (blocked storage → session-local; invalid stored value →
  default `auto`).

## App-flow interplay

- The clock ticks only in the `gameplay` phase. Title, prologue, and replay never
  touch it, consistent with "only gameplay mutates the island".
- Settings intro replay pauses the clock with everything else and restores exactly,
  since all visuals derive from the clock value.
- The completion celebration runs under whatever sky is current in this spec; the
  celebration-driven night override is spec 2's concern.
- Phase-kind transitions emit one event on the existing bus (`day:phase`) to leave the
  door open for night Moments later. No Moment consumes it yet.

## Reduced motion / lowfx summary

| Path | Behavior |
| --- | --- |
| Enhanced | Full arc, moving shadows, twinkling stars, drifting fireflies, glide overrides |
| Reduced quality / `?lowfx=1` | Color-only lerp (no arc; shadows already bypassed), fewer stars, no fireflies |
| Reduced motion | Cycle still runs (slow crossfade, not vestibular motion); static stars; fade-only fireflies; overrides snap instead of glide |

## Testing

- `dayClock.test.ts`: phase math, keyframe interpolation continuity across anchors,
  override glide/snap/resume, temporary-override composition, determinism,
  background-tick advancement under the drain cap.
- FSM tests: dusk/night weight shifts, sleeper `sleep` behavior, owl selection and
  rotation, startle interrupts unaffected at night.
- Preferences test for `clayisland.timeOfDay` storage semantics.
- Settings test for the new radio group.

## Files touched

- New: `src/core/dayClock.ts` (+ test), star/firefly additions in `src/fx/`.
- Modified: `src/scene.ts`, `src/main.ts`, `src/villagers/fsm.ts`,
  `src/villagers/villager.ts`, `src/core/preferences.ts`, `src/ui/settings.ts`,
  `src/ui/tokens.ts`, `src/core/events.ts`, `docs/architecture.md`.

## Out of scope

Night-only Moments, power behavior changes at night, visible sun/moon bodies,
weather systems. These layer on later if wanted.

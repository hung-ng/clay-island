# Intro Time-Lapse — Design

**Date:** 2026-07-20
**Status:** Approved for planning

## Overview

Recast the prologue from an 11-second linear build into a **17-second time-lapse**
in which **3 days and 3 nights** pass while villagers build the village without
pause. The current intro reads as bad stop motion; this design fixes that cause
directly and uses the recently-added day/night cycle to convey that the village
was earned over time.

Timing is deliberately unrealistic. Cycles run ~63x gameplay speed and a hut
completes over roughly two days and two nights. Matching real gameplay timing is
an explicit non-goal.

## Problem: why the current intro reads as stop motion

Three stacked causes in `src/prologue/choreography.ts`, only one intentional:

1. **`FPS = 12`** (line 7) quantizes pose sampling. This is the claymation charm
   and is **not** the problem. Keep it.
2. **Villagers are stationary for most of the intro.** Actors travel only during
   `1.2 -> 3.2`. Across `3.2 -> 6.8` — the whole hut-building stretch, over half
   the runtime — `progressBetween` has saturated at 1, so `position` is constant.
   Actors sit parked at `work`, flipping to `hammer` for 0.4 s windows at
   3.2/4.8/6.4 and resting on `idle` between. This is the real cause.
3. **Hut construction is discrete.** `hutStages` is
   `HUT_BEATS.filter(at => at <= clamped).length` (lines 248-250), an integer
   0-3, so huts snap between three states.

Root cause: the intro is a **cue list of discrete beats** rather than continuous
curves.

## 1. Time-lapse lighting

`sampleAt(t)` in `src/core/dayClock.ts` is a **pure function** from a time value
to full `DayParams`. The prologue drives a virtual clock through it, leaving the
live `DayClock` and its 360 s period untouched.

```
prologueDayParams(elapsed) =
  sampleAt((DAWN_OFFSET + elapsed * CYCLES_PER_SECOND * DAY_PERIOD) % DAY_PERIOD)
```

- 3 cycles over 17 s: one full day+night is ~5.7 s (~63x gameplay speed).
- Reuses `sampleAt` verbatim, so sky, key light, stars, fireflies, and cloud tint
  sweep continuously and stay consistent with the gameplay look.
- `PrologueDirector` calls `scene.applyDay(params, dt)` each frame instead of the
  scene's normal clock path.

**Open at dawn** rather than the current golden `t = GOLDEN_T`, so the intro
begins with a sunrise.

**Land the final frame exactly on `GOLDEN_T`.** This is a hard requirement, not a
preference: `src/main.ts` pins both the live clock (line 98) and `canonicalDay`
(line 104) to `GOLDEN_T`, and the handoff runs a framebuffer diff
(`compareFramebuffers`, line 563) asserting the final prologue frame matches the
settled scene within 0.1% of pixels. Ending anywhere else fails that audit.

## 2. Continuous motion — the core fix

**Huts grow continuously.** Replace the integer `hutStages: [0-3, 0-3, 0-3]` with
a float `0..1` per hut, each rising steadily across its own two-day/two-night
span, staggered so the three huts sit at different heights at any instant. The
existing `HUT_BEATS` timestamps survive as **cue triggers** for hammer SFX and a
small impact settle pulse — they punctuate growth rather than defining it. Huts
visibly rise while watched instead of snapping.

**Villagers never park.** Replace the saturated `3.2 -> 6.8` dead zone with a
continuous **work circuit**: each builder loops fetch-point -> hut -> fetch-point
on its own phase offset, so at any instant some haul, some hammer, some walk
back. `carry` toggles with the circuit leg rather than from hardcoded windows. No
villager is static for more than a beat.

**Night shifts work, does not stop it.** At night villagers cluster tighter
toward the campfire glow and move at a slower cadence. Building continues but
reads visibly different — this is what sells two days *and two nights* of labor
rather than a mere lighting change.

**Keep `FPS = 12`.** Positions stay smoothly lerped per frame; only pose sampling
quantizes.

## 3. Camera

Keep the **single continuous 180-degree orbit**, now stretched across 17 s, with
no cuts on day/night transitions. Because huts grow continuously there is nothing
to hide, and an unbroken orbit reinforces uninterrupted time passing. Add a
slight ease so the orbit lingers on the first night.

## 4. Reduced motion

The `reducedMotion` path collapses to near-static as it does today, held at a
**single daylight sample** rather than strobing through 3 cycles. Flashing
day/night is precisely what that setting exists to prevent.

## 5. Campfire

`campfireProgress` stays beat-driven. The campfire is a short late sequence and
reads fine as discrete.

## Decisions taken

- **17 s duration**, chosen over ~11 s (too compressed for days to read as days)
  and ~22 s+ (too long a first-launch gate).
- **Continuous orbit** over cutting between angles.
- **3 cycles.** Each night is ~2.8 s, which is brief. If nights feel too fleeting
  in review, reduce to 2 cycles rather than extending the runtime.

## Out of scope

- Changing `DAY_PERIOD`, `GOLDEN_T`, or any live `DayClock` behavior.
- Changes to `src/prologue/audit.ts` — it is a framebuffer-diff utility for
  handoff stability, not a choreography invariant, and needs no modification.
- Making Skip available on first launch. Skip remains replay-only via
  `canSkipPrologue`.

## Test impact

- `src/prologue/choreography.test.ts` — new duration, float hut stages, cycle
  count, work-circuit continuity.
- `src/prologue/prologue.test.ts` — director drives `applyDay`.
- New coverage: virtual clock lands on `GOLDEN_T` at `PROLOGUE_DURATION`;
  reduced-motion holds a single daylight sample; no actor position is constant
  across any window longer than one beat.

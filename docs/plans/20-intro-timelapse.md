# Intro Time-Lapse Implementation Plan

**Status:** Complete. This document was written as a forward-looking plan and has
been rewritten as an as-built record, because the implementation diverged from it
in several places that are worth keeping.

**Goal:** Recast the 11-second prologue into a 17-second time-lapse in which three
days and three nights pass while villagers build continuously, eliminating the
stop-motion feel.

**Architecture:** A virtual clock in `choreography.ts` maps prologue-elapsed time
through the existing pure `sampleAt(t)` from `src/core/dayClock.ts`, so lighting
sweeps at time-lapse speed without touching the live `DayClock`. Hut construction
is a continuous `0..1` float, and villagers ride phase-offset work circuits so no
actor is ever parked.

**Tech Stack:** TypeScript, Three.js, Vitest.

## Global Constraints

- `PROLOGUE_DURATION` is exactly `17`. `INITIAL_HANDOFF_FRAME` equals `17 * 12 = 204`; `FPS` stays `12`.
- The sweep MUST both **start and end** on `GOLDEN_T` (`225`). `src/main.ts` pins the live clock and `canonicalDay` to `GOLDEN_T`, the title screen holds that sample while only advancing its preview orbit, and the handoff runs a framebuffer diff (`compareFramebuffers`) requiring the final prologue frame to match the settled scene within 0.1% of pixels. Any other value flashes at Begin, at the handoff, or both.
- Exactly 3 day/night cycles across the 17 seconds.
- Under `reducedMotion`, hold a single daylight sample. Never strobe through cycles.
- Gameplay builds all twelve trees `normal`, and tree state is part of the handoff comparison, so **every tree must be full-grown at `PROLOGUE_DURATION`** however many are felled along the way.
- Do NOT modify `DAY_PERIOD`, `GOLDEN_T`, or any live `DayClock` behavior.
- Do NOT modify `src/prologue/audit.ts`. It is a framebuffer-diff utility, not a choreography invariant.
- Test command is `npx vitest run`. Typecheck/build is `npm run build`.

---

## What shipped

### 1. Timeline (was Tasks 1, 6)

`PROLOGUE_DURATION` 11 → 17, `INITIAL_HANDOFF_FRAME` → `17 * 12`. Hut beats,
cues, and campfire beats rescaled across the longer run.

### 2. Time-lapse lighting (was Tasks 2, 3)

`prologueDayParams(elapsed, reducedMotion)` maps elapsed seconds through
`sampleAt()`. Three cycles pass; the live `DayClock` is untouched.

**Deviated from plan.** The plan's Task 3 added an `applyDay` option to the
director. That alone is not sufficient: `src/main.ts` runs one shared render path
every frame (`applyDay`, `nightSky.setLevels`, `nightSky.update`, `updateSky`),
and it overwrote the director's swept lighting with the frozen `canonicalDay`
immediately after the director applied it. Stars and fireflies never saw the
sweep at all, so nights would have been dim rather than dark.

The fix is to change **where `dayParams` comes from**: `PrologueDirector.dayParams()`
exposes the current sample and the render loop sources it during the prologue.
Sky, clouds, key-light colour and position, the shadows that position swings,
hemisphere fill, stars, and fireflies then all sweep from one sample.

### 3. Continuous motion (was Tasks 4, 5)

Huts grow as a float `0..1` via `Hut.setProgress`; `HUT_BEATS` survive only as
sound/reveal cue triggers. Villagers ride phase-offset fetch-to-hut circuits and
are never static for more than a beat.

### 4. Camera (was Task 7)

Single continuous 180-degree orbit, eased slightly to linger on the first night.

---

## Added after the first playthrough

None of the following were in the original plan. They came out of watching the
result and measuring it.

### 5. Shaped day sweep

A linear sweep parks on the flat day and night keyframes and crosses dawn and
dusk in about a third of a second, which reads as snapping between two lighting
states. `DAY_SHAPE` redistributes progress within each cycle: roughly 10% dusk,
32% night, 18% dawn, hurrying past the long midday plateau.

**A first attempt at this broke the handoff** — it landed on `t=253` mid-night
with `starOpacity=1.0`, which would have flashed a starry sky into golden-hour
gameplay and failed the framebuffer audit. Any change to the shaping must be
re-checked against both edges.

### 6. Varied cycle lengths

Identical cycles read as a pulsing loop rather than time passing. `CYCLE_WEIGHTS`
gives each cycle its own duration, so nights run about 2.0s, 1.5s, 1.3s — an
accelerating progression: a relaxed establishing day, quickening as building
intensifies, then settling into golden hour.

### 7. Golden start (the flash fix)

The sweep originally opened at pre-dawn, then at the dawn keyframe. Both flashed
at Begin, because the title holds the canonical golden sample: first as a
half-lit starfield dumped in 0.2s, then as a golden-to-dawn-blue colour cut.

`PROLOGUE_START_T = GOLDEN_T` makes both boundaries continuous. It also removed
the partial-cycle tail and its inverse-shaping helper, since the sweep now covers
exactly three whole cycles.

### 8. Cloud drift

Gameplay cloud drift is imperceptible at time-lapse speed, leaving daylight
looking like a held frame. `updateSky(dt, driftScale)` takes a multiplier;
`PROLOGUE_CLOUD_DRIFT = 14` applies during the prologue only.

### 9. Trees grow for the whole intro

`TREE_FINISH` was 3.6s of 17, so the forest froze after the first fifth while
everything else kept moving. It now spans the full duration.

### 10. Campfire in the first night, with a live flame

Beats moved from 13.4-15.8s to 1.3-2.7s, so the village has firelight for the two
nights that follow instead of being lit in the final seconds.

**The flame was static for a separate reason:** `Campfire.update(dt, qt)` is
driven by the shared quantized clock, which does not run during the prologue, so
the flicker loop never executed. `applyCampfire` now drives it from the 12fps
prologue frame counter.

That fix broke the handoff audit — flames froze on a jittered frame and no longer
matched a freshly built gameplay campfire. `Campfire.settleFlames()` restores the
construction transforms, and `seekFinal` calls it.

### 11. Tree felling

Three trees are felled for timber (`TREE_CHOPS` at 6.7s, 9.9s, 12.6s), each
dropping to a stump and regrowing, so the hauled wood visibly comes from the
forest. A `chop` sound cue was added to `PrologueSoundCue` — deeper and longer
than the hammer. The chopper breaks off its circuit to swing at the trunk.

Growth is a pure function of elapsed time (`treeGrowthAt`), keeping the prologue
seekable and rewindable. Chops were retimed once after measurement: the first
pass felled trees at `0.13` growth, which is a sapling; they now fall at `0.34`,
`0.62`, and `0.83`.

---

## Verification

- 680 tests pass (`npx vitest run`).
- `npm run build` clean.
- Handoff lands on `t=225.00000` with sky, key intensity, `starOpacity`, and `fireflyLevel` all matching `sampleAt(GOLDEN_T)` exactly.
- All twelve trees end at growth `1.0`.

**Not verified in a browser.** No browser driver was available in the
implementation environment, so all of the above is measured numerically rather
than observed. Worth watching directly: whether the chop reads clearly at 12fps,
whether `PROLOGUE_CLOUD_DRIFT = 14` looks right, and whether the sky bands during
dawn (if it does, lower the `skyRedrawCooldown` throttle in `src/scene.ts`, which
limits gradient redraws to one per 0.25s and is unchanged from gameplay).

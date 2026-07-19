# Celebration Upgrade — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Build order:** 2 of 4 (day/night → celebration upgrade → wind power → photo mode)
**Depends on:** Day/night cycle spec (2026-07-18-day-night-cycle-design.md) — requires
the day clock's temporary override mechanism.

## Overview

Four targeted upgrades to the existing eighteen-launch fireworks celebration: the
world darkens for the show, bursts illuminate the island, the camera follows a
three-act choreography (with a short protective lock at the start), and framing is
biased toward the sky. No changes to shell count, patterns, audio, or villager
choreography — those shipped in plan 15 and stay as they are.

## 1. Night for the show

- When the celebration starts, the director requests a **temporary night override**
  from the day clock, gliding to the night anchor over ~2 seconds so the show runs
  against stars.
- When the celebration ends (including **Celebrate Again** replays), the override is
  released and the clock glides back to wherever the user's mode dictates: `auto`
  resumes from the pre-celebration phase; a user-held `day`/`night` returns to that
  hold. The user changing the Settings time-of-day control mid-show wins over the
  temporary override.
- Reduced motion snaps the override transition instead of gliding, matching the
  clock's general rule.
- Cancellation paths that already tear down the celebration (Settings intro replay
  cancelling queued/active celebration work) must also release the override.

## 2. Bursts light the island

- One pooled `PointLight` positioned above the island, tinted to each shell's color
  and pulsed on each burst, so huts, villagers, and terrain flash in the firework's
  color against the darkened scene. Reused across all launches; never more than one
  extra light in the scene.
- Intensity envelope: sharp attack on burst, ~0.5 s decay; overlapping bursts take
  the newer shell's color at combined-but-clamped intensity.
- Skipped entirely on reduced quality / `?lowfx=1` (that path already bypasses the
  fancy rendering stack).

## 3. Three-act camera choreography

Replaces the current single launcher-relative suggested pose.

- **Act 1 (first launches, ~4 s): protected close view.** The camera glides to a
  nearer pose framing the launcher and reacting villagers, under a new composable
  `celebration-intro` gesture-lock reason on the camera controller (same mechanism
  the prologue uses). The lock is bounded: it releases at the act boundary no matter
  what.
  - **Active-drag exception:** if the user is mid-orbit/pan/zoom at the moment the
    celebration starts, the lock is skipped entirely and all three acts fall back to
    interruptible suggestions — never hijack an in-progress gesture.
  - Reduced motion: the lock may hold the current view steady but the camera does
    not travel — no glide, no snap, matching the existing celebration camera rule.
- **Act 2 (mid-show): pull back and rise.** At the act boundary the director issues
  an interruptible, revision-gated suggested pose (the existing mechanism): wider and
  higher as bursts grow.
- **Act 3 (finale): widest pose.** The current maximum-distance launcher-relative
  pose, again as an interruptible revision-gated suggestion.
- Revision gating semantics are unchanged: any user orbit/pan/zoom or Reset Camera
  after the lock releases cancels remaining suggestions; modal locks skip them.

## 4. Sky-biased framing

- During the celebration, the camera *target* lifts a few metres above its normal
  point so bursts sit center-frame instead of crowding the top edge. Applied as part
  of each act's pose (and the Act 1 locked pose); released with the celebration so
  gameplay framing returns to normal.
- The camera policy module (`camera/policy.ts`) owns the lifted-target math so it
  stays Three.js-free and testable.

## Reduced motion / lowfx summary

| Path | Behavior |
| --- | --- |
| Enhanced | Night glide, burst light, locked Act 1 glide, interruptible Acts 2–3, lifted target |
| Reduced quality / `?lowfx=1` | Night colors still apply (color-only lerp); no burst point light; camera behavior as enhanced |
| Reduced motion | Night snap; burst light allowed (it is a flash of light, not motion — matches existing firework flashes); no camera travel in any act |

## Testing

- Day-clock tests (extended): temporary override request/release, composition with
  user mode, release on celebration cancellation.
- Camera policy tests: act poses, lifted target, bounded Act 1 duration.
- Controller tests: `celebration-intro` lock composability, active-drag exception,
  lock release at act boundary, revision gating unchanged for Acts 2–3.
- Celebration director tests: act timeline boundaries, override lifecycle across
  normal completion, replay, and cancellation.

## Files touched

- Modified: `src/celebration/` (director + show), `src/camera/policy.ts`,
  `src/camera/controller.ts`, `src/core/dayClock.ts` (override surface),
  `src/main.ts`, `docs/architecture.md`.

## Out of scope

New shell patterns, signature finale shell, water glints, smoke/ember fallout,
finale screen shake and bloom pulses, audio changes. All were considered and
deferred; they can layer on without structural change.

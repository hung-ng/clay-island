# Wind Power — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Build order:** 3 of 4 (day/night → celebration upgrade → wind power → photo mode)

## Overview

A fifth power, **Wind**: nonlethal and playful like Nudge, area-based like Rain.
Casting sends a gust sweeping through the target point. It extends the explicit
power × target interaction matrix from 28 to 35 cells. No new journal Moments in this
spec — the journal stays at exactly fifteen (see Out of scope).

## Form and timeline

- `PowerId` gains `'wind'`; keyboard key `5`; tray slot next to Nudge, same arming,
  reticle, and casting flow as the other powers.
- **Gust direction:** outward from the island center through the target point, so the
  gust always reads as weather passing over the island.
- **Timeline:** ~0.8 s anticipation (distant whoosh builds, nearby clouds lean toward
  the gust line) → ~2.5 s gust (leaf/dust streak particles along the gust direction,
  hard tree sway inside the radius) → settle.
- **Radius:** ~6 m around the target point.
- **Cooldown:** ~3 s (between Nudge's 2 s and the heavier powers).
- **Audio:** synthesized whoosh through the existing `Sfx` voice budget and ducking
  rules; no new asset types.

## Matrix cells (wind × 7 targets)

Every cell explicit and testable, as with the existing 28.

| Target | Interaction(s) | Outcome |
| --- | --- | --- |
| `tree` | `shakeLoose` (new) | Violent sway; a fruit tree drops its fruit to the ground for villagers to gather — a gentler harvest than Nudge's chop/harvest intents. A bare tree just sways. |
| `villager` | `tumble` (new) | Comic stumble/tumble with hat and smock flapping. Nonlethal, in the spirit of lightning's `zap`. Startled recovery, no harm. |
| `campfire` | `flare` + ember spread | Fanned flames: existing `flare`, plus a small chance that an ember ignites a very-close tree, feeding the existing `fire:ignited.bySpread` wildfire machinery. Recoverable stakes. |
| `pond` | ripple staging | Ripples race across the surface. Cosmetic; fish unaffected. |
| `hut` | `scatter` | Rattle plus a puff of loose clay bits. No damage. |
| `crater` | dust staging | A brief dust devil. Cosmetic. |
| `ground` | sweep staging | Leaves, dust, grass and flowers leaning. Pure spectacle. |

New `InteractionKind` values: `shakeLoose`, `tumble`. Cosmetic-only cells route
through the wind module's own staging (as Rain's shower staging does) while their
matrix cells stay explicit.

## Consequence details

- **Dropped fruit** behaves like harvested fruit already does (gatherable by
  villagers, feeds the existing food flow). One drop per fruiting tree per cast.
- **Ember ignition** applies only to lit campfires, only to trees within a small
  radius (tighter than the gust radius), with a low probability roll per cast — wind
  should feel mischievous, not destructive.
- **Tumbled villagers** interrupt their current state via the existing
  startle/interrupt machinery and recover on their own.
- Sleeping villagers (day/night spec) wake through the same interrupt paths — no
  special handling.

## Reduced motion / lowfx

- Reduced motion: shorter bounded gust, no streak travel (particles fade in place),
  same outcomes.
- `?lowfx=1` / reduced quality: fewer particles, same outcomes. Same pattern Rain
  already follows.

## Testing

- Matrix tests: all 7 new cells explicit, 35-cell completeness check updated.
- Wind module tests: timeline phases, gust direction derivation, radius membership,
  cooldown, one-drop-per-tree-per-cast, ember probability gating (deterministic RNG),
  cosmetic cells cause no world mutation.
- Outcome tests: `shakeLoose` fruit reaches the food flow; `tumble` interrupts and
  recovers; campfire flare + spread path emits `fire:ignited.bySpread`.
- Tray/keyboard tests: key `5`, arming rules identical to other powers.

## Files touched

- New: `src/powers/wind.ts` (+ test).
- Modified: `src/core/events.ts` (`PowerId`), `src/powers/matrix.ts`,
  `src/powers/outcomes.ts`, `src/powers/drag.ts` (labels), `src/ui/tray.ts`,
  `src/audio/sfx.ts`, `src/main.ts`, `docs/architecture.md`.

## Out of scope

New journal Moments (e.g. "Windfall", "Fanned Flames") — the journal is built around
exactly fifteen ids and growing the grid is its own project, to be considered
together with night Moments later. Wind affecting cloud positions or the day/night
sky, and wind interacting with celebration smoke, are also deferred.

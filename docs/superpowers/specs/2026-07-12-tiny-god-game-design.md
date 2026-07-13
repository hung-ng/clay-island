# Tiny God Game — Design Spec

**Date:** 2026-07-12
**Timebox:** 2–3 weeks
**Goals:** (1) portfolio-grade visual wow within 5 seconds of page load; (2) a toy strangers genuinely play for 10–15 minutes.
**Tone:** mischief & consequence — powers are mostly destructive spectacle, but villagers visibly cope: flee, mourn, rebuild.

## One-liner

A hand-molded clay island floats in a soft sky. Tiny villagers live on it. You are their (mostly mischievous) god — every power you drag onto the island plays out as a staged miniature film scene, and the villagers cope with the consequences.

## Design spine

**Reactions are the content.** The claymation look and power VFX are the 5-second hook; the villager reactions and the power × world **interaction matrix** are why people stay. Discovery-based unlocks ("Moments") gate nothing structural — they name and celebrate combinations the player finds.

---

## 1. Visual identity (the product)

- **Clay material (shader, not texture):** 3-step toon ramp with soft/blurred band transitions; subtle fingerprint/thumb-dent normal noise; slight per-object hue unevenness like hand-mixed clay. Every mesh gets one-time random vertex wobble at build so no two instances are identical.
- **Geometry:** smoothed low-poly, rounded everything, zero hard edges. Trees = squashed spheres on stubby cylinders; huts = lumpy domes; villagers = pill bodies with stubby limbs.
- **Stop-motion timing:** villager/object animation quantized to ~12fps while camera, particles, and post run at 60fps. This is the single strongest claymation cue and is nearly free.
- **Light & shadow:** one warm key light with large soft shadows (PCSS-style), cool sky ambient fill. Tabletop-under-softbox feel. Fallback for weak GPUs: blob shadows.
- **Post stack:** depth-based tilt-shift blur, gentle vignette, fine film grain, warm grade with lifted blacks. Tuned for one fixed golden-hour look (no day/night cycle).
- **Frame:** island drifts/slow-rotates in a gradient sky with a few clay clouds; underside is a rocky clay cone. Camera: orbit with zoom limits and subtle idle sway.
- **Page-load wow:** the idle scene alone — hut smoke curling, villagers waddling, clouds passing — must be screenshot-worthy before any interaction.

## 2. World

One sculpted clay disc (~30 scene-units across): grassy top, dirt cliff sides, rock cone below. The island keeps **persistent scars**: meteor craters are real vertex displacement; fire leaves scorch tint via vertex colors. Every played island ends up unique.

World objects (each a small state machine):

| Object | States / behavior |
|---|---|
| Tree | normal → chopped (villager work) / burning → burnt stump → regrows in ~2 min. Rained-on trees sprout fruit (decorative + Moment trigger; there is no food system) |
| Hut | site → under construction (villagers build) → built (smoke curl) → burning → ruin → rebuilt |
| Campfire | village center; villagers gather; fire hazard |
| Crater | from meteor; rain fills it → pond (fishable) |
| Gravestone | spawns where a villager dies; others visit and mourn |

## 3. Villagers

- **Count:** 6. Population self-heals: after a while a new villager waddles out of a hut. The toy must be unbreakable — population never permanently hits zero.
- **Movement:** no pathfinding. Steer-toward-target with simple obstacle repulsion on open ground.
- **State machine:** one flat FSM, hard-capped at 8 states: `Wander, ChopTree, BuildHut, SitAtFire, Flee, Mourn, Rebuild, Fish`. Selection = weighted random + simple triggers (fire near → Flee; new grave → someone Mourns). Theatrical, not systemic — **no** hunger/needs/economy.
- **Emotes:** clay speech bubbles (❗ ❓ 💧 zzz 🐟) above heads, rendered at 12fps. Primary comedy channel.

## 4. Powers & spectacle

Three powers, each staged in three beats: **anticipation → impact → aftermath**.

- **Meteor:** growing ground shadow, villagers look up (❗) and scatter, faint whistle → impact: screen shake, clay chunks, dust ring, real crater, scattered small fires → smoldering debris, panic, mourning.
- **Lightning:** small dark cloud gathers at drop point, rumbles a beat → jagged clay-white bolt, one-frame white flash → struck tree ignites; struck villager does the comic zap (charred pose, blink-blink, falls; little ghost floats up). Cute, never gory.
- **Rain:** puffy cloud drizzles blobby droplets over an area → douses fire, fills craters into ponds, pops flowers from grass, villagers hold leaves overhead. The "undo"/nurture power that makes destruction guilt-free.

**Fire is the fourth system:** spreads between nearby flammables (tree → tree → hut) until it burns out or rain stops it. All spread parameters live in one tunable config object.

### Interaction matrix

| | Tree | Hut | Villager | Crater/Pond | Campfire |
|---|---|---|---|---|---|
| **Meteor** | fire + crater | destroyed | ghost | pond emptied, steam | scattered |
| **Lightning** | ignites | ignites | comic zap | fish float up 🐟 | flares huge |
| **Rain** | grows fruit | douses | grumpy 💧 | fills → pond | douses, villagers annoyed |

## 5. Discovery ("Moments") & UI

- **Journal:** clay-book UI listing ~12 named Moments with silly titles (*Fishing Hole, Flash Fry, First Bloom, Ghost Story, Full Harvest*, …). Toast on unlock; persisted in `localStorage`. The discovery system just listens on the event bus for event combinations (e.g. `lightning-hit + target:pond` → *Fishing Hole*).
- **UI:** DOM/CSS overlay, nearly nothing: bottom tray with 3 clay power buttons (drag onto island), journal button, mute button.
- **Sound (in scope):** ambient loop, squishy clay foley, comedic pops/whistles. SFX from free packs (Kenney/freesound) or synthesized. Claymation without foley is half the effect.

## 6. Architecture

**Stack:** Vite + TypeScript + vanilla Three.js (no React/R3F — trivial UI, and vanilla keeps full render-loop control for 12fps quantization and the custom post stack). Post via `postprocessing` lib with custom tilt-shift/grain pass. Fully procedural: no modeled assets, no image textures, only generated noise. Static deploy (Vercel/Netlify/GitHub Pages).

Modules:

| Module | Responsibility |
|---|---|
| `core/` | renderer, camera rig, fixed-timestep sim loop, quantized animation clock |
| `world/` | island generation & deformation, world objects, fire-spread system |
| `villagers/` | entity, FSM, steering, emotes |
| `powers/` | `Power` base class (anticipation/impact/aftermath timeline); Meteor, Lightning, Rain; drag-targeting controller |
| `fx/` | clay-blob particles, screen shake, scorch/vertex-color painting |
| `ui/` | DOM overlay: tray, journal, toasts, localStorage save |
| `audio/` | small WebAudio SFX manager |

A tiny event bus connects modules; discovery listens to it. **Sim logic (FSMs, fire spread, discovery triggers) is pure TS with no Three.js imports** so it's unit-testable headlessly. Seedable RNG for reproducible debugging.

**Performance target:** 60fps on a mid-range laptop. Instancing for trees/particles; single shadow map.

## 7. Milestones

1. **Week 1:** island + clay shader + post stack + camera + 6 villagers living (wander/chop/build/campfire). *Exit test: would a stranger screenshot the idle scene?*
2. **Week 2:** all three powers fully staged, fire system, ground deformation, screen shake, first sound pass.
3. **Week 3:** full interaction matrix, discovery journal, emote polish, foley, performance pass, deploy + OG share image.

## 8. Deliberately cut (growth path, not v1)

Day/night cycle, resources/economy, villager dialogue, pathfinding, flood power (rain covers the nurture slot far cheaper), multiple islands, eras/ecosystems, mobile-first layout (desktop-first; drag works on touch as a bonus, not a target).

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Clay shader tuning is a taste rabbit-hole | Timebox to 2 days; pick reference stills before starting |
| Soft shadows too slow on weak GPUs | Auto-fallback to blob shadows |
| Fire spread too dull or too apocalyptic | One config object; playtest-tune |
| Villager states multiplying | Hard cap: 8 states; reactions are animation + emotes, not AI |

# Living Island & Presentation — Design

Date: 2026-07-17
Status: Approved and implemented

Four independent improvements: (1) the simulation keeps running while the tab
is hidden, (2) a staged og-image with title text, (3) a favicon, and
(4) villager FSM retuning plus four new states.

## 1. True background simulation

### Goal

Today `GameLoop` is driven by `requestAnimationFrame`, which browsers pause in
hidden tabs, and the 0.1s `dt` clamp discards any longer gap. The island
freezes the moment the tab loses visibility. After this change, simulation
time keeps passing while the tab is hidden: trees grow, villagers act, fires
burn, arrivals happen. Rendering stays paused.

### Mechanism

- A tiny inline **Web Worker** (created from a Blob, no separate file needed
  for bundling — a `src/core/backgroundTicker.ts` module wraps it) runs
  `setInterval(..., 500)` and posts a tick message on each fire. Worker timers
  are throttled far less than page timers in hidden tabs, and the design does
  not depend on tick cadence anyway (see below).
- `GameLoop` gains a hidden-tab mode, switched by `visibilitychange`:
  - **Visible:** current rAF drive, unchanged.
  - **Hidden:** ticks come from the worker. Each tick measures *real elapsed
    wall-clock time* since the last completed sim step and runs the fixed-step
    `onSim` (30 Hz steps) to catch up, subject to a per-tick budget of **30
    simulated seconds** (900 steps). Remainder carries forward to the next
    tick. This makes the design robust to any throttling: if the browser
    fires the timer once a minute, the sim simply advances in ≤30s batches.
  - **Return to visible:** run any remaining catch-up synchronously (same 30s
    budget applies; any deeper backlog is dropped — after a long absence the
    world has long since reached steady state, so dropping surplus time is
    invisible), then resume rAF.
- No rendering, camera, particles, or FX while hidden. Spawn-time effects
  invoked from sim code use the existing `lowFx` pathways during hidden ticks.
- Background mode is only armed when `simulatesGameplay(flow)` is true —
  never during title or prologue.
- Moment/journal notifications already queue; discoveries made while hidden
  present themselves normally on return.

### Required refactor: sim state out of the render callback

Several *state-bearing* updates currently run in the render callback in
`main.ts` and would silently stop advancing in background mode. Audit and move
the simulation half of each into `onSim`, keeping pure animation (quantized
bobbing, shader/material time) in render:

- `world.updateTrees` — sapling growth progression is sim state.
- `world.campfire.update` / hut updates — any fuel/lifecycle state is sim.
- `powers.update` — cooldown timers are sim state (a power should come off
  cooldown while you're away).

Where a single `update(dt, quantizedTime)` mixes both concerns, split it into
`advance(dt)` (sim) and the existing visual update (render). Only split what
the audit proves is stateful; visual-only updates stay untouched.

### Testing

- Unit tests for the hidden-tab accumulator: budget clamping, remainder
  carry-over, backlog dropping on return, no sim during title/prologue.
- Regression: existing loop tests keep passing; a hidden→visible round trip
  advances world state (tree growth, repopulation timers) by the elapsed time.

## 2. OG image — staged scene with title

Replace `public/og.png` (currently a soft, unfocused screenshot with no focal
point) with a composed 1200×630 card:

- **Scene:** a staged lively moment captured from the running game — lit
  campfire, villagers mid-activity (dance/fish/build), huts and forest
  visible, three-quarter camera angle, sharp focus on the fire circle, and
  enough ground to make the island the visual focus. UI chrome must not
  appear. The final direction intentionally has no composited cloud. If a
  sleeping villager is visible, it must use the approved authored curled pose
  rather than the rejected rotated-rig pose.
- **Typography:** "Clay Island" title plus the tagline "Make a mess. Watch
  the tiny clay villagers cope." composed over the scene in soft clay-toned
  type, with a gentle vignette/scrim behind the text for legibility at
  thumbnail size.
- **Pipeline:** capture a high-res render from the game, compose the overlay
  (HTML/canvas), export PNG. Same path and dimensions, so `index.html` meta
  tags need no changes.
- **Acceptance:** user visually approves the image before it lands.

## 3. Favicon — clay cloud

- `public/favicon.svg`: a transparent, low horizontal cluster of four
  asymmetrical clay puffs. Its uneven silhouette follows the wobbled,
  flattened spheres used by the ambient clouds in `src/scene.ts` instead of
  the regular circles of a generic weather icon.
- Directional shading echoes the game lighting: `#fffaf2` clay-white on the
  top-left faces, a softly blended cream midtone, and a warm peach underside.
  There is no sky badge, outline, cast shadow, sun, rain, island, tree, or
  detail that disappears at favicon size.
- Keep at least four SVG units of transparent breathing room around the cloud.
  It must retain its lumpy silhouette and modeled underside at 16px and 32px.
- `public/apple-touch-icon.png` (180×180) and a 32×32 PNG fallback generated
  from the same art.
- `<link rel="icon" ...>` and `<link rel="apple-touch-icon" ...>` tags added
  to `index.html`.
- **Acceptance:** generate the candidate outside `public/` and show it at
  180px, 32px, and 16px. Replace the shipped favicon files only after the user
  visually approves that candidate. The user selected **A · Ambient**: the
  merged four-puff silhouette with continuous cream-to-peach shading.

## 4. Villager FSM

All changes live in `src/villagers/fsm.ts` and `src/villagers/villager.ts`
(plus `world.ts` for repopulation), following the existing pattern: an entry
in the weighted `IDLE` table, an `enter` case, an `update` case, and tests.

### Retuning

| Knob | Current | New |
| --- | --- | --- |
| `wander` weight | 4 | 7 |
| `wander` duration | 3–6s | 4–9s, with a brief mid-wander stop-and-look-around pause |
| `fish` weight | 4 | 2 |
| `fish` duration | 5–9s | 4–6s |
| `harvest` weight | 5 | 3 |
| Repopulation interval | 20–30s | 10–18s |

### Variety rules in `decideNext`

- **No immediate repeat:** the villager's current state is excluded from the
  idle roll when at least one other option is available. A suggestion still
  wins normally (suggestions may re-pick the current state).
- **Crowd-spreading penalty:** each candidate's weight is scaled by
  `1 / (1 + n)` where `n` is the number of *other* villagers currently in
  that state. `FsmCtx` gains a state-count input supplied by the world. This
  keeps any given moment varied and stops pile-ons (e.g. everyone choosing
  `makeFire` when `needsFire` flips).
- **Personality jitter:** each villager rolls a persistent per-activity
  weight multiplier in [0.7, 1.3] at spawn (from the villager's RNG stream),
  applied in `decideNext`. Individuals develop visible habits.

### New states

| State | Weight | Precondition | Duration | Behavior |
| --- | --- | --- | --- | --- |
| `chat` | 3 | another villager in an interruptible state (`wander`, `sitAtFire`) within range | 4–7s | initiator walks to the partner; both face each other and bob/gesture. Partner is pulled into `chat` for the same duration; if the partner dies or flees, the initiator drops back to `wander`. |
| `watchSea` | 2 | always | 6–10s | walk to the nearest shoreline point, sit facing the water. |
| `dance` | 3 | `campfireLit` | 4–8s | walk near the fire, bounce/spin in place. |
| `nap` | 2 | always | 12–18s | keep the model root upright and arrange the individual body parts into an authored curled side-sleeping pose: horizontal torso near the ground, head resting on one bent arm, short legs tucked forward at different angles, and the other arm draped across the chest. Only the torso breathes subtly. |

`VillagerModel` owns the nap articulation. It exposes the body and both legs
alongside the existing head and arms, and provides `setNapPose(breathe)` so
`Villager` does not manipulate the pose part by part. `resetPose()` restores
the idle position, rotation, and scale for every articulated part as well as
the model root. The nap must never rotate the complete standing rig.

Priority interrupts (`flee`, `mourn`, `rebuild`) preempt all new states, as
they do existing ones. New states are suggestion-free (no new `SuggestionKind`).

### Testing

- FSM unit tests: availability gates, no-repeat rule, crowd penalty math,
  personality multiplier application, durations.
- Villager tests: chat pairing handshake (partner interruption, partner-loss
  fallback), watchSea shoreline targeting, dance requires lit fire, and nap
  torso/head/arm/leg articulation, torso-only breathing, 12–18 second
  duration, no complete-rig rotation, and clean pose recovery after waking or
  interruption.

## Out of scope

- Day/night cycle or schedule-driven behavior.
- New suggestion kinds / player powers for the new states.
- Persisting sim state across page reloads (background sim is within a live
  session only).

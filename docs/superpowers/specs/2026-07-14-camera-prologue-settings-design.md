# Camera, Prologue, and Settings Design

**Status:** Approved for implementation planning
**Date:** 2026-07-14
**Revised:** 2026-07-15

## Purpose

Clay Island should remain a small hand-molded diorama while becoming clearer to
read, easier to explore, and more memorable to enter. This design makes three
coordinated improvements:

1. preserve the golden-hour look while removing avoidable full-scene blur;
2. replace the centre-locked orbit with a constrained diorama camera; and
3. replace the current four-second cold open with a canonical construction
   prologue and a compact Settings surface.

The app continues to persist discovered Moments and preferences only. It does not
persist the simulated island across page loads, so every page load presents the
origin of a fresh island before handing off to the same deterministic gameplay
starting state.

## Experience summary

On every normal page load, the app presents the frozen opening frame of the
canonical prologue behind a hand-molded title plaque with **CLAY ISLAND** embossed
above a smaller pressable **BEGIN** seal. A light warm veil keeps the plaque
legible without replacing the island with an empty opaque background. Pressing
Begin unlocks browser audio, removes the overlay, and advances that same prologue
set into its eleven-second choreography without a scene swap.

The first-ever prologue is unskippable. After it completes, a persisted flag makes
the prologue skippable on later page loads. A player can also replay it from
Settings without resetting or mutating the current gameplay world.

The prologue shows the island being formed through visible causes: trees grow in
stepped claymation, villagers carry materials, three teams build three huts in
parallel stages, and villagers arrange and light the central campfire. When the
fire catches, the final prologue frame matches the frozen initial gameplay frame
with all three huts built. The swap is visually invisible and simulation begins on
the following frame.

After handoff, the player can orbit, zoom toward the pointer, and move the camera's
focus within safe bounds. The island remains the visual anchor and cannot be lost
off-screen or viewed from underneath.

## Architecture

### Composition root and app phases

`src/main.ts` remains the composition root but gains an explicit app-phase owner.
The allowed phases are:

- `title`: the title plaque and frozen opening prologue tableau are visible while
  gameplay is hidden and frozen;
- `prologue`: the canonical prologue is active and gameplay is hidden/frozen;
- `gameplay`: the real world is visible and its fixed-step simulation runs; and
- `replay-transition`: an opaque title-card transition hides the intentional
  mismatch between the canonical prologue and a potentially changed current world.

Only `gameplay` advances `World` simulation, villagers, fire, graves,
repopulation, forest reseeding, targeting, and powers. Ambient sky motion may
continue through every phase. Phase transitions are idempotent: repeated clicks or
callbacks cannot start parallel prologues or simulation chains.

Normal load lifecycle:

`loading -> title -> prologue -> gameplay`

Settings replay lifecycle:

`gameplay -> replay-transition -> prologue -> replay-transition -> gameplay`

Skipping is absent from the first-ever prologue and available during returning or
Settings-replay prologues. A returning skip transitions to the fresh frozen
gameplay composition. A Settings-replay skip returns to the preserved current
world behind the opaque title transition.

### Initial-world blueprint

Introduce a pure `InitialWorldBlueprint` value generated once from the existing
deterministic starting seed. It contains every value needed for initial visual
parity:

- island and placement seed values;
- tree, three built-hut, and campfire placements;
- villager spawn positions, facing, smock choice, and visual seed;
- final tree, hut, campfire, and villager state; and
- the canonical island transform and 12fps handoff frame.

Gameplay construction and prologue construction both consume this blueprint.
Neither independently rolls placement or presentation randomness. The prologue may
animate an entity through earlier construction states, but its final state must be
derived from the same blueprint field used to construct the frozen gameplay
entity.

The blueprint is pure data and imports no Three.js types. Determinism and final
state parity must be testable in Node.

### Shared stage root

Introduce a shared Three.js stage root below the scene and above the two island
groups. The existing ambient float applies to this root once. Prologue motion is
owned by the camera rather than rotating the island against its fixed sunlight.
The root contains exactly one visible child at a time:

- the temporary prologue set; or
- the real gameplay island.

The sky, clouds, camera, renderer, lighting, and post-processing remain shared.
This prevents float, rotation, light, or camera discrepancies at the handoff and
does not create a second renderer or WebGL context.

### CameraController

Move camera policy out of `createScene()` into a `CameraController` that wraps the
existing `OrbitControls`. It owns:

- the exact home camera position `(0, 14, 34)` and home focus `(0, 0, 0)`;
- orbit, pointer-centred dolly, and bounded focus movement;
- camera gesture locking by reason (`prologue`, `targeting`, `journal`, or
  `settings`);
- home reset animation;
- idle recentering and auto-rotation; and
- live effective reduced-motion and stored auto-rotation preferences.

Locks are reason-based rather than one boolean so closing one surface cannot
unlock the camera while another surface still owns a lock.

Initial tuning values are:

- focus movement clamped to a 7.5-metre horizontal radius around island centre;
- distance clamped to 15–55 metres;
- polar angle clamped to 0.6–1.35 radians;
- the maximum polar angle tightens linearly to 1.20 radians as distance approaches
  the 15-metre minimum;
- Reset Camera eases to the exact home state in 0.7 seconds; and
- after eight idle seconds, an off-centre focus eases home over 1.2 seconds before
  auto-rotation resumes.

These values are the acceptance defaults. If browser visual checks require a
stricter minimum distance, focus radius, or polar limit to prevent clipping, the
implementation may tighten that individual bound and must update its constant,
test expectation, and architecture documentation together. A bound cannot be
relaxed past the specified default without a design revision. In every case, the
island stays on-screen, solid objects are not crossed by the near plane in ordinary
use, and the underside cannot become the primary view.

Desktop controls are left-drag orbit, wheel zoom toward the pointer, and
right/middle-drag focus movement. Touch controls are one-finger orbit and
two-finger dolly/pan around the pinch midpoint. The browser context menu is
suppressed only for a right-drag that begins on the canvas.

Power raycasting continues to use the live camera and island world transform.
Keyboard reticle movement remains camera-relative. Arming a power locks camera
gestures until casting or cancellation completes, preventing OrbitControls from
competing with targeting.

Direct user input cancels a reset or idle-recenter animation immediately. Disabling
auto-rotation disables automatic recentering as well. Effective reduced motion
disables auto-rotation and animated idle recentering; direct camera input remains
available and Reset Camera applies its final state immediately.

### VisualQualityController

Keep the golden-hour key light, warm grade, and long shadows. The perceived blur is
addressed independently:

- Enhanced mode raises the device-pixel-ratio cap from 1.25 to 1.5.
- Tilt-shift opacity is zero at camera distances of 22 metres or less, increases
  smoothly with distance, and is capped at 0.45 at and beyond the home view. This
  restores a little more of the original miniature softness while keeping close
  inspection sharp.
- Film-grain opacity is reduced from the original 0.18 to 0.12.
- The directional shadow radius is reduced from the original 7 to 5 while
  retaining VSM soft shadows.
- Reduced mode keeps DPR 1, bypasses the post-processing composer and shadow map,
  and uses the existing blob-shadow presentation.

The controller owns live tilt-shift strength so the effect responds to camera
distance without recreating the composer. Golden-hour light color and direction do
not change with zoom.

The existing `?lowfx=1` query remains a forced diagnostic override. When present,
Settings displays `Reduced (forced by link)` and disables the quality selector for
that page load.

### Settings store and UI

Add a small clay gear in the upper-right during gameplay. It opens an accessible
modal clay panel directly below and right-aligned with the gear rather than at the
vertical centre of the viewport. Safe-area and viewport bounds keep the same panel
on-screen on narrow displays, where it may grow downward within the available
height. Opening Settings cancels active power targeting and adds the `settings`
camera lock. Closing removes only that lock and returns focus to the gear.

The panel contains:

**Preferences**

- Sound: On/Off. This replaces the current Sound button in the bottom tray.
- Visual quality: Enhanced/Reduced.
- Auto-rotate: On/Off.
- Reduced motion: On/Off.

**Actions**

- Reset camera.
- Replay intro.

The gameplay tray retains the four powers and Journal only.

Changing Reduced motion applies immediately and does not reload or reconstruct the
island. Its next prologue use, camera policy, effects, and UI transitions all read
the same live effective value.

The panel uses real buttons/controls, `role="dialog"`, `aria-modal="true"`, a
labelled heading, a focus trap, Escape-to-close, backdrop close, and focus return.
Opening it never pauses the gameplay simulation; it only prevents accidental
camera and power input while the panel is active.

Reset Camera closes the panel and invokes the camera controller. Replay Intro
closes the panel, freezes gameplay, raises the opaque title transition, and starts
the replay without requiring another Begin click because the replay button is
already an audio-unlocking gesture. The **CLAY ISLAND** title appears briefly before
the choreography begins.

Visual quality is a startup choice because Reduced mode changes how world objects
and shadows are constructed. Selecting a different quality presents this exact
confirmation before changing storage or reloading:

> Changing quality will remold the current island. Discovered Moments are kept.

Cancel leaves both the active and stored quality unchanged. Confirm saves the new
preference and reloads. The reload begins a fresh normal-load lifecycle.

### Persistence

Continue using guarded `localStorage` access through injected storage-shaped
interfaces. Persist these independent values:

- `clayisland.moments`: the existing validated Moment-id array;
- `clayisland.muted`: the existing sound boolean;
- `clayisland.visualQuality`: `enhanced` or `reduced`;
- `clayisland.autoRotate`: a boolean string;
- `clayisland.reducedMotion`: a boolean string; and
- `clayisland.introSeen`: a boolean string.

No island simulation state is persisted. Unknown or corrupt preference values fall
back to Enhanced quality, auto-rotation on, and intro unseen. When no explicit
reduced-motion value has ever been saved, its initial On/Off state is taken from
the current OS preference. Once the player changes it, the stored boolean is the
effective preference and may explicitly override the OS value. The same effective
value is injected into the prologue, camera, shake, animated grain, and DOM motion
so the setting cannot leave different subsystems in contradictory modes.

`introSeen` is written only after the mandatory first prologue reaches its handoff.
Closing the page before completion causes the next load to remain a mandatory first
viewing. Within the same loaded page, a successfully completed prologue is treated
as seen even if storage writes are unavailable. Across loads with unavailable
storage, the app conservatively presents an unskippable first viewing again.

## Prologue design

### Boundaries

`PrologueDirector` creates one temporary `PrologueSet` under the shared stage root
before the Begin title becomes interactive. That set is held at time zero as the
visible title background, then the same instance advances after Begin. Trees,
huts, and the campfire are instances of the existing visual entity classes,
constructed with the same blueprint-local seeds as their gameplay counterparts;
their existing sapling/building presentation APIs drive the timelapse. Villager
mesh construction and pose application are extracted into a side-effect-free
`VillagerModel` shared by the gameplay `Villager` and a new `PrologueActor`.
`PrologueActor` owns only an authored path, carried prop, pose, and action beat; it
has no `World`, FSM, needs, suggestion, or event-bus dependency. This targeted
extraction is required so final villager meshes and poses cannot drift between the
two sets.

The prologue does not create or register a gameplay `World`, emit on the gameplay
event bus, advance villager FSMs, unlock Journal Moments, run fire simulation, or
mutate the initial blueprint.

Prologue villagers are authored actors. The director assigns paths, carried props,
poses, and action beats directly. Visual changes occur only on the shared 12fps
quantized clock; camera and DOM transitions remain smooth unless reduced motion is
active.

The director owns all temporary geometry, material, listener, audio, and actor
references that are not shared caches. `finish()`, `skip()`, and `dispose()` are
idempotent. Disposal cannot release a shared cached material or geometry still used
by gameplay.

### Title

The initial title is a DOM overlay so the lettering remains crisp, semantic, and
keyboard accessible. Behind it, the renderer shows the exact frozen time-zero
prologue composition under a translucent warm veil. The veil is strong enough for
text contrast but does not conceal the island, and it fades with the plaque on
Begin. Replay-transition covers remain fully opaque because they hide an
intentionally different live gameplay world. The title resembles one irregular
hand-molded clay plaque:

- **CLAY ISLAND** is the dominant embossed title;
- **BEGIN** is a smaller raised pressable seal below it; and
- Enter, Space, click, or tap activates the real Begin button.

The title has no gear or gameplay controls. Begin is the only initial focus target.
The background tableau has no motion or simulation before Begin. The loading
splash yields to the title only after that first stable rendered frame.

### Choreography

Target duration is eleven seconds after Begin:

1. **0–2.5 seconds — The island wakes.** Dawn light rises. Saplings grow in
   staggered 12fps steps while villagers wake, collect tools, and move toward
   visible work sites.
2. **2.5–7.5 seconds — Building the settlement.** Three two-person teams construct
   all three huts concurrently. Villagers carry pieces from shrinking material
   piles, place them, and hammer foundations, walls, and roofs. Every visible
   building stage follows a matching villager placement or hammer beat.
3. **7.5–10 seconds — Gathering together.** The third hut team moves to the centre
   and carries stones and logs to visibly arrange the campfire while the other
   builders finish and approach.
4. **10–11 seconds — Handoff.** One villager kneels and lights the fire. Lighting
   settles into golden hour, the camera arrives at the exact home state, and all
   prologue actors settle on their blueprint-defined gameplay transforms and poses.

The camera follows one continuous constant-speed orbit rather than cutting between
shots. Its target, height, and radius remain fixed. It starts half an orbit from
the gameplay home view and travels exactly 180 degrees over eleven seconds, ending
at the exact home pose. The island does not rotate against the directional light,
and there is no authored pan, target shift, or dolly. Construction sounds, clay
footfalls, growth creaks, hammer taps, and fire ignition are scheduled from the
same choreography beats. No sound is required for timing or comprehension.

With Reduced motion On, the story and duration remain the same but the camera stays
at the home pose while object scale growth and large spatial motion become gentle
opacity/state transitions in that stable composition. The causal villager actions
remain visible.

### Seamless normal-load handoff

The prologue/gameplay boundary is a strict contract:

1. The real gameplay world is constructed from the blueprint before the prologue,
   placed under the shared stage root, hidden, and not simulated.
2. The prologue set is constructed from the same blueprint and is the visible stage
   child.
3. On the final quantized frame, prologue entity transforms, visible states, poses,
   island transform, camera, and campfire presentation equal their frozen gameplay
   counterparts.
4. The fire ignition supplies a small two-frame ember flare, not a full-screen
   flash. During the held frame the prologue child is hidden and the gameplay child
   is shown.
5. On the following frame, the gameplay 12fps clock and fixed-step simulation begin.
   The tray reveals and villagers may select their first autonomous activities.

The swap must not use a crossfade: overlapping nearly identical meshes would reveal
ghosting. Exact transform parity plus a held claymation frame makes the visibility
swap invisible.

A browser-level test captures the final prologue frame and first gameplay frame at
a fixed viewport with ambient motion frozen. Pixel comparison ignores the masked
ember region. Outside that mask, no more than 0.1% of pixels may differ by more than
2/255 in any color channel.

### Returning skip and Settings replay

On returning loads, Skip is a real accessible button visible throughout the
prologue. It places the camera and shared stage root directly in their exact handoff
states, disposes the prologue, reveals the fresh gameplay world, and begins
simulation.

Settings replay preserves the current gameplay world in memory and freezes it.
Because it may no longer resemble the canonical final state, both entry and exit
are covered by the opaque **CLAY ISLAND** title transition. Finishing or skipping
disposes the prologue before revealing and resuming the unchanged gameplay world.

## Error handling and lifecycle safety

- Existing WebGL failure messaging remains unchanged.
- Storage access is optional and wrapped in `try/catch`; storage failure never
  prevents title, prologue, Settings, or gameplay.
- `visibilitychange` pauses prologue time while the document is hidden. Returning to
  the tab resumes from the same beat rather than consuming a large elapsed delta.
- Resize and orientation changes recompute the camera path against the new aspect
  ratio while preserving normalized choreography progress.
- A monotonically increasing phase-generation token invalidates every scheduled
  callback captured by an older phase.
- Replay cannot begin while another prologue or replay transition is active.
- Settings and Journal are mutually modal. Opening one closes or refuses the other
  without leaving stale focus or camera locks.
- Quality reload confirmation is the only Settings action that reloads the page.
- Skipping and finishing converge on one cleanup path.

## Performance constraints

- Use the existing renderer, composer, scene lighting, sky, and shared visual caches;
  never create a second WebGL context.
- Keep only one heavy island set visible. The hidden frozen gameplay group may remain
  allocated during the short prologue, but it performs no simulation or per-frame
  entity updates.
- Prologue actor and construction props are bounded by the canonical starting count;
  no runtime spawning loop is permitted.
- Three consecutive Settings replays must return renderer memory, DOM listener
  counts, event subscriptions, and owned audio voices to their pre-replay baseline.
- Enhanced mode continues targeting smooth display-rate camera/UI rendering on a
  mid-range laptop. Model animation remains intentionally quantized to 12fps.
- Reduced mode remains fully playable and preserves the complete prologue story.

## Verification

### Pure and unit tests

- `InitialWorldBlueprint` is deterministic for the starting seed.
- Blueprint validation rejects duplicate occupied placements and entities outside
  the island's accepted radii.
- Prologue final-state records equal gameplay initial-state records for every entity.
- The blueprint contains three built huts and choreography completes three hut
  stage tracks before the handoff.
- The prologue camera keeps a constant target, height, and radius, advances at
  constant angular speed, and equals the home pose at eleven seconds.
- Camera focus, distance, and dynamic polar clamps hold at boundary inputs.
- Camera lock reasons compose and release independently.
- Reset, idle recenter, user-interrupt, and reduced-motion policies reach the
  specified final states.
- Visual-quality preference parsing rejects corrupt values safely.
- Reduced-motion parsing uses the OS preference only when no valid stored boolean
  exists and uses the explicit stored value thereafter.
- Intro-seen state changes only after mandatory completion.
- App-phase transitions reject duplicate starts and stale callbacks.

### Integration tests

- Gameplay simulation counters do not advance during title or prologue phases.
- The title and running prologue use the same temporary prologue set; Begin cannot
  create a second set or swap the rendered island.
- Prologue actions emit no gameplay event-bus or Journal events.
- First viewing exposes no skip path through pointer, keyboard, or assistive markup.
- Returning load and Settings replay expose a working Skip button.
- Normal completion and returning skip start one gameplay simulation chain.
- Replay completion and replay skip preserve representative current-world state,
  including terrain damage, object state, villagers, and fire timers.
- Power targeting, Journal, Settings, and prologue locks cannot unlock one another's
  camera ownership.
- Changing visual quality requires confirmation, persists only on confirmation, and
  preserves Moments through reload.
- Sound, auto-rotation, and reduced-motion preferences survive reload and storage
  failures degrade safely.

### Browser and visual checks

- Compare the final prologue and first gameplay frames at desktop and mobile aspect
  ratios for camera, object, shadow, and animation continuity.
- Confirm all three huts are built concurrently by visible workers and are already
  fully built in the first gameplay frame.
- Confirm the Begin background clearly shows the frozen opening island, remains
  inert before activation, and continues without a visual swap after activation.
- Inspect tilt-shift at home, mid, and close distances; close models must be sharp
  while the home view retains mild diorama depth.
- Verify the Settings panel sits directly below the gear at desktop and narrow
  widths without clipping the safe area or viewport.
- Exercise mouse, trackpad, touch, keyboard power targeting, Settings focus trap,
  Journal focus trap, resize, orientation change, and tab hide/resume.
- Confirm the island cannot be lost off-screen, the camera cannot settle under it,
  and normal close viewing does not clip through huts or trees.
- Verify Enhanced, Reduced, `?lowfx=1`, reduced motion, unavailable storage, and
  corrupt storage paths.
- Run at least three consecutive replay cycles and inspect renderer memory, browser
  console, active audio, DOM duplication, and event/listener behaviour.

## Documentation impact

Implementation changes must update `docs/architecture.md` with the app-phase owner,
initial-world blueprint, shared stage root, camera controller, visual-quality
controller, Settings persistence, and prologue lifecycle. `STATUS.md` is not updated
unless the user explicitly requests the wrap flow.

## Out of scope

- Persisting island simulation state across page loads.
- A free-flight or strategy-game camera.
- A second renderer, separate WebGL canvas, or prerendered video intro.
- New gameplay actions or autonomous villager FSM states solely for the prologue.
- Clearing discovered Moments from Settings.
- A broad graphics-options matrix beyond Enhanced and Reduced.

## Acceptance criteria

The design is complete when:

1. every page load presents **CLAY ISLAND / BEGIN** over the canonical prologue's
   visible frozen opening frame;
2. the first-ever prologue cannot be skipped, while later and replay viewings can;
3. an unskipped normal-load prologue hands off without a visible camera, lighting,
   model, pose, or animation discontinuity;
4. Settings replay never changes the current gameplay world;
5. three huts are built concurrently, gameplay begins with all three fully built,
   and every visible construction change is caused by a visible villager action;
6. camera exploration is cursor-centred and useful but cannot lose or underfly the
   island;
7. close views are sharp while the home view retains warm, mildly soft diorama
   character;
8. Settings opens next to its gear and owns Sound, visual quality, auto-rotate,
   reduced motion, Reset Camera, and Replay Intro;
9. all modal, keyboard, touch, reduced-motion, Reduced-quality, and storage-failure
   paths remain usable; and
10. automated tests, production build, browser console checks, handoff comparison,
    and repeated-replay resource checks pass.

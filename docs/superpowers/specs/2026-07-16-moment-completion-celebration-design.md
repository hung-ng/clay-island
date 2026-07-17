# Moment Completion Celebration Design

**Date:** 2026-07-16

**Status:** Approved in conversation; implementation in progress

## Goal

Reward discovery of all fifteen Journal Moments with a short celebration in the
live island. The villagers gather, cheer, and watch handmade clay fireworks while
the player keeps full camera control. Completing the Journal also unlocks a
permanent **Celebrate Again** control inside the Journal.

The reward must celebrate the player's current island rather than replace it with
a pristine cinematic set. It must not repair, damage, reset, or otherwise alter
the persistent world state.

## Experience contract

The first celebration is requested when a newly discovered Moment moves the
Journal from fourteen unlocked Moments to all fifteen. The final Moment keeps its
normal toast. The celebration waits until the Moment toast queue is empty and the
world is safe before starting.

Once ready, the celebration lasts fourteen seconds:

1. **0–4 seconds — Gathering.** Power targeting is cancelled, all powers disable
   and dim, and automatic camera rotation pauses. Every living villager suspends
   their current activity and jogs toward an assigned place in a loose circle
   around the campfire footprint. Manual camera orbit, pan, and zoom remain fully
   available. Fireworks start after four seconds even if a distant villager is
   still approaching.
2. **4–12 seconds — Fireworks.** Three staggered waves launch from temporary
   handmade clay tubes near the clearing. Villagers who have arrived look upward,
   clap, hop, cheer, and use staggered celebratory poses. Stragglers keep moving
   toward the group and join the performance when they arrive.
3. **12–14 seconds — Finale.** One larger multicolour burst appears overhead. The
   villagers give a final cheer, the temporary launch pieces and particles clear,
   powers return, automatic camera behavior is restored, and villagers resume the
   activities that were suspended.

The choreography is stage-local, so it follows the island's shared ambient motion
and remains coherent from every allowed camera angle.

At three seconds into gathering, the celebration may suggest a better firework
view with a short camera ease that finishes near the first launch. The pose is
derived from the resolved launcher centre, keeps the player's current horizontal
viewing direction, shifts the ground target toward the launcher, and uses the
camera's maximum 55-metre viewing distance with a 20-metre height. That keeps the
9.2-metre finale comfortably inside a 35-degree portrait viewport while exposing
more sky above the launcher. It is an invitation rather than a shot: controls remain enabled,
any orbit/pan/zoom immediately cancels the ease, and any camera interaction since
gathering began prevents it from starting. Reset Camera counts as an interaction.
Reduced-motion mode and an active modal camera lock skip the suggestion. The
suggestion never retries later in the same celebration.

## Permanent Journal reward

The Journal's existing heading and progress text remain unchanged. When all
fifteen Moments are unlocked, a separate **Celebrate Again** button appears below
the moment grid. It is a permanent completion reward derived from the validated
unlocked Moment set; no new persistence key is needed.

The completed-Journal hint and **Celebrate Again** control move upward together,
preserving their relationship while increasing the button's bottom breathing
room on both desktop and compact layouts.

Activating the button closes the Journal and requests the same safe, live-world
celebration used by the initial completion. While a request is already queued or a
celebration is active, the button remains visible but disabled and communicates
its state accessibly. Repeated activation cannot create overlapping requests.

Loading a page with an already-complete Journal reveals **Celebrate Again** but
does not automatically play the celebration. Automatic playback happens only on
the live fourteen-to-fifteen unlock transition. This avoids surprising returning
players and lets players who completed the Journal before this feature use the
reward deliberately.

## Readiness and safety

A requested celebration may begin only when all of these conditions hold:

- the app is in the `gameplay` phase;
- the Moment toast queue is empty;
- the Journal and Settings are closed;
- no power choreography or aftermath is unresolved;
- no non-campfire object is actively burning and villagers are not handling an
  immediate danger; and
- at least one villager is alive.

The queued state does not lock powers or camera controls. A player whose final
Moment occurs during a wildfire can therefore use Rain and finish making the
island safe. With zero population, the request waits for the world's existing
mercy repopulation path. The permanent Journal button remains available if the
page is reloaded before a queued celebration can begin.

At the instant a queued celebration starts, the world resolves one stable site
that both the fireworks and villagers share. A lit or doused campfire remains the
preferred centre only while its footprint is dry, uncratered, gently sloped, and
clear enough for the temporary launch tubes. A scattered, missing, site-stage, or
building-stage campfire is not a celebration anchor; nor is an invisible pending
rebuild reservation. The resolver instead searches deterministic clearings near
the old campfire and village centre and chooses the candidate with the most safe
viewing slots. This lets a rebuild completed while the request was queued become
the preferred site without moving an already active celebration.

Each living villager receives one stable dry, walkable slot around the resolved
centre; dead villagers are never included. Craters, ponds, steep ground, visible
props, and reserved build sites are rejected. Failure to find every slot does not
block the sequence: the best dry launch point still wins, and affected villagers
remain at their current position while joining the looking-up performance. If no
fully clear launch centre exists, the deterministic search falls back to a dry,
uncratered point rather than placing the temporary launcher in water or waiting
forever for a rebuild.

Powers are locked only after readiness succeeds and the sequence starts. If an
unexpected danger nevertheless appears during the active sequence, the director
aborts immediately, removes temporary effects, restores every participant and
input owner, and returns to idle. The completed Journal still exposes
**Celebrate Again** for another attempt.

## Architecture

### Celebration state and director

Add a dedicated celebration feature boundary rather than expanding `src/main.ts`
with choreography. A `CelebrationDirector` owns the idempotent state machine:

`idle -> queued -> gathering -> fireworks -> finale -> idle`

Its public boundary supports requesting, updating, querying queued/active state,
cancelling, and disposing. Timing and transitions are represented independently
of Three.js so exact phase behavior can be exercised in Node tests. The visual
director consumes those phase transitions and coordinates the live world, UI,
camera policy, audio, and firework renderer.

Both entry paths use the same `request()` operation:

- after `Journal.observe()` returns the fifteenth newly unlocked Moment, the
  composition root requests the automatic celebration; and
- the Journal UI invokes an injected callback when **Celebrate Again** is pressed.

The Journal remains responsible only for Moment persistence and presentation. It
does not own choreography or world readiness. No new `GameEvent` is required and
the celebration cannot unlock another Moment.

### Villager celebration override

Celebration is a transient performance override, like the existing meteor,
startle, and huddle performances. It is not a thirteenth `VillagerState` and does
not enter the weighted activity selector.

Beginning the override captures the villager's ordinary navigation target and
presentation state, freezes their ordinary FSM timers and suggestion progress,
and assigns a separate celebration slot. Work props and held items that would
conflict with the performance are hidden without being disposed or changing their
underlying state. The override owns only gathering movement, upward facing, and
the staggered clap, hop, and cheer poses.

Ending or cancelling restores the captured navigation and presentation state,
then returns control to the existing update path. Pending Nudge suggestions,
partially completed labour, thirst, carried-fruit state, and other ordinary
activity data are suspended rather than discarded. Normal validation on the next
ordinary update safely handles any target that became invalid while suspended.
Danger remains a higher priority than celebration and may force the shared abort
path.

### Fireworks presentation

A separate stage-local fireworks component owns:

- reusable clay launch tubes that exist only for the sequence;
- rising rocket heads and short trails;
- fixed-capacity pooled burst pieces;
- deterministic wave timing, colour, direction, and stagger; and
- complete hide/reset/disposal behavior.

The three regular waves use smaller complementary palette colours. The finale
uses a wider multicolour burst but stays within the diorama's handmade clay style:
chunky pellets and short stepped trails rather than realistic pyrotechnic smoke.
The system uses the shared quantized animation clock for clay motion and does not
allocate new meshes on each replay.

Enhanced quality uses the full pool and soft emissive accents. Reduced quality
uses fewer burst pieces, no added dynamic lights, and the same readable timing.
Reduced-motion mode keeps the fourteen-second structure but removes shake, calms
villager hopping, shortens trails, and lowers particle density. Manual camera
controls remain available in every quality and motion mode.

Firework launch whistles, pops, and the final cheer are synthesized through the
existing `Sfx` boundary, respect the current sound preference, and allocate no
external audio assets. Audio unlock behavior remains unchanged.

### Camera, powers, and app flow

Celebration adds a camera auto-rotation suppression reason that is independent of
the existing gesture locks. It pauses idle recentering and auto-rotation without
disabling `OrbitControls`; direct orbit, pan, and zoom remain available throughout
the sequence. Completion, cancellation, and disposal all remove only the
celebration suppression reason.

The camera controller exposes a revision counter for explicit user camera input
and an interruptible suggested-pose tween. The composition root snapshots that
revision when celebration becomes active. At the director's one-shot pre-launch
cue, it derives a launcher-relative pose and asks the controller to ease only if
the revision is unchanged, reduced motion is off, and no modal lock is active.
This reuses the controller's existing input-cancels-tween behavior and does not
add a gesture lock or forced cinematic state.

At sequence start, active targeting is cancelled and the tray's power controls
become unavailable. The Journal and Settings controls are not globally locked,
but the celebration itself starts only after their modals are closed. If the
player opens one during the sequence, its existing modal and camera policies keep
working; closing it does not alter the celebration's power lock or camera
suppression.

Leaving gameplay, including Settings-driven intro replay, cancels a queued or
active celebration before the app-flow transition proceeds. Cancellation is
idempotent and restores powers, camera policy, villagers, temporary visuals, and
button state exactly once. Returning to gameplay never resumes a half-finished
celebration; the permanent reward can request a fresh run.

## Error handling and invariants

- At most one celebration request exists and at most one sequence is active.
- A queued request never prevents the player from resolving the condition that is
  keeping the celebration unsafe.
- Power controls are locked only while the director is active and are restored on
  every completion, abort, cancellation, and disposal path.
- Manual camera gestures are never locked by celebration. Only automatic camera
  behavior is suppressed.
- Suggested celebration framing runs at most once, never after prior gathering
  camera input, and yields immediately to orbit, pan, zoom, Reset Camera, modal
  locks, or reduced motion.
- Celebration never changes persistent consequences such as Moment data, terrain,
  water, fire, buildings, forest, or villager population. Only temporary villager
  positions and poses change for the performance; task state is restored.
- Every temporary object is pooled or disposed safely, and no replay accumulates
  scene children, listeners, timers, lights, or audio nodes.
- Participant restoration is idempotent and preserves pending suggestions and
  incomplete ordinary actions.
- A missing or invalid gathering slot degrades to a safe viewing position instead
  of blocking or teleporting a villager.
- Storage failures do not affect reward availability within the current session;
  existing guarded Journal persistence behavior remains authoritative across
  reloads.

## Verification

Automated tests will cover:

- exact `idle`, `queued`, `gathering`, `fireworks`, `finale`, and completion
  transitions across variable update steps;
- idempotent request, completion, cancellation, abort, and disposal paths;
- automatic request only on a newly observed fourteen-to-fifteen transition;
- a complete Journal loaded from storage showing **Celebrate Again** without
  auto-playing or changing the `15 of 15 moments` progress text;
- replay activation closing the Journal and using the same request path;
- readiness delays for an active modal, targeting, unresolved power effects,
  non-campfire fire, immediate danger, and zero living villagers;
- power targeting cancellation and lock restoration on success and every exit;
- manual camera controls remaining enabled while auto-rotation is suppressed and
  later restored;
- launcher-relative suggested framing, prior-input suppression, mid-ease input
  cancellation, reduced-motion skipping, and modal-lock skipping;
- stable gathering-slot assignment on ordinary, cratered, obstructed, and
  submerged central ground;
- exclusion of dead villagers and fixed timing with distant stragglers;
- villager task, suggestion, timer, prop, and navigation restoration after normal
  completion and abort;
- deterministic wave scheduling, bounded pool usage, replay cleanup, and distinct
  enhanced, reduced-quality, and reduced-motion settings; and
- app-flow transitions cancelling the feature without leaving powers, camera
  policy, UI, or scene resources in the wrong state.

Manual browser verification will check:

- the first completion after the final toast on a calm island;
- a final Moment earned during wildfire or another unresolved power consequence;
- replays from a doused or scattered campfire, cratered central clearing, and
  pond-obstructed gathering ring;
- one-villager, full-village, and repopulated-island celebrations;
- readable fireworks and villager performances while freely orbiting, panning,
  and zooming throughout the entire sequence;
- Journal and Settings behavior if opened during a celebration;
- repeat playback without visual, audio, listener, or performance-state buildup;
- cancellation through intro replay and clean return to gameplay; and
- Enhanced, Reduced, sound-off, auto-rotate-off, and reduced-motion variants.

The full test suite, TypeScript check, production build, browser console, and diff
hygiene must pass. `docs/architecture.md` must be updated with the celebration
director, villager override, fireworks pool, Journal reward, and camera/power
coordination when the implementation changes the codebase. `STATUS.md` remains
unchanged unless the user explicitly requests the wrap flow.

## Out of scope

- A separate cinematic island, cloned villagers, or a forced camera shot.
- New Journal Moments, achievements, progression tiers, or rewards beyond
  **Celebrate Again**.
- Persistent island simulation or a persisted “celebration watched” flag.
- Realistic fireworks, imported audio files, text overlays, credits, or an ending
  screen.
- Teleporting villagers, waiting indefinitely for every straggler, or changing the
  campfire's current state for presentation.
- Refactoring unrelated app flow, villager activities, powers, or world systems.

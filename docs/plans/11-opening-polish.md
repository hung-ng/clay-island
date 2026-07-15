# Opening Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user has authorized subagent-driven execution, but no task may create a git commit without a separate explicit request.

**Goal:** Refine Clay Island's opening with a visible island behind Begin, three concurrently built huts, one calm constant camera orbit, slightly softer golden-hour rendering, a persisted Reduced motion toggle, and a Settings sheet positioned beneath its gear.

**Architecture:** Keep the deterministic blueprint and exact prologue/gameplay handoff as the source of truth. Extend that blueprint and the pure choreography to three built huts, construct the normal prologue set before Begin so its time-zero frame becomes the title background, and inject one live reduced-motion preference into every motion consumer. CSS distinguishes the translucent normal Begin treatment from opaque replay covers and anchors the existing modal near its trigger.

**Tech Stack:** TypeScript 6, Three.js 0.185, `postprocessing` 6.39, Vite 8, Vitest 4, DOM/CSS UI, Web Audio.

**Design spec:** `docs/superpowers/specs/2026-07-14-camera-prologue-settings-design.md`

## Global Constraints

- Keep the prologue duration exactly 11 seconds and model animation quantized at 12fps.
- The normal title must show the exact frozen time-zero prologue set; Begin continues that same set without constructing or swapping another island.
- Replay-transition covers remain fully opaque and continue preserving the live gameplay world.
- All three huts build concurrently through visible villager actions and are fully built in the first gameplay frame.
- The prologue camera keeps target `(0, 0, 0)`, height `14`, horizontal radius `34`, and constant angular speed through a 180-degree orbit ending at `CAMERA_HOME`.
- Reduced motion is an On/Off preference. With no stored value, initialize it from the OS; after an explicit choice, the stored boolean wins.
- One live effective reduced-motion callback controls prologue framing, camera policy, sky/stage motion, shake/flash, animated grain, Journal/Settings/title timing, and reduced-motion CSS.
- Enhanced rendering uses DPR cap `1.5`, tilt cap `0.45`, grain opacity `0.12`, and VSM shadow radius `5`. Close views at distance `22` or less keep zero tilt.
- The Settings dialog remains modal with its backdrop and focus trap, but opens directly below and right-aligned with the gear at desktop and narrow widths.
- Use one renderer, canvas, stage root, camera, lighting rig, and post-processing stack.
- Do not add runtime or test dependencies.
- Update `docs/architecture.md` for changed persisted keys, title lifecycle, initial world state, camera choreography, and rendering constants.
- Do not edit `STATUS.md` unless the user explicitly requests the wrap flow.
- Do not run `git commit` unless the user explicitly requests it. Each task ends with a diff checkpoint and a suggested commit message only.

## File map

**Create**

- `src/core/motion.test.ts` — effective motion DOM-state and injected-policy coverage.

**Modify**

- `src/core/preferences.ts` and `src/core/preferences.test.ts` — persisted `clayisland.reducedMotion` with OS-derived first default.
- `src/core/motion.ts` — apply the effective choice to the root DOM dataset used by CSS.
- `src/main.ts` — own the live reduced-motion callback, wire all consumers, prepare the normal prologue before Begin, and continue the same director after Begin.
- `src/scene.ts` — consume injected reduced motion and tune shadow radius/initial post-effect values.
- `src/fx/quality.ts` and `src/fx/quality.test.ts` — raise enhanced tilt and grain values.
- `src/fx/shake.ts` and `src/fx/shake.test.ts` — consume injected reduced motion for shake and flash.
- `src/ui/settings.ts` — expose the Reduced motion toggle and use the live motion callback for close timing.
- `src/ui/journal.ts` — replace direct OS reads with the live effective callback.
- `src/ui/title.ts` — replace direct OS reads, animate the plaque away, and keep Begin distinct from an opaque cover.
- `src/styles.css` — translucent Begin veil, root-data reduced-motion rules, and gear-anchored Settings layout.
- `src/world/blueprint.ts`, `src/world/blueprint.test.ts`, and `src/world/initial.test.ts` — turn the third canonical hut site into a built hut.
- `src/prologue/choreography.ts` and `src/prologue/choreography.test.ts` — three hut tracks, three teams, and constant orbit.
- `src/prologue/prologue.ts` and `src/prologue/prologue.test.ts` — three constructed huts, nine hut-material piles, and exact final parity.
- `docs/architecture.md` — document the revised behavior and constants.

---

### Task 1: Persist the effective Reduced motion choice

**Files:**
- Modify: `src/core/preferences.ts`
- Modify: `src/core/preferences.test.ts`
- Modify: `src/core/motion.ts`
- Create: `src/core/motion.test.ts`

**Interfaces:**
- `Preferences` consumes `systemReducedMotion: boolean` as its third constructor argument.
- `PreferencesSnapshot` adds `reducedMotion: boolean`.
- `Preferences.setReducedMotion(on: boolean): void` updates the session immediately and attempts to persist `clayisland.reducedMotion`.
- `applyReducedMotion(root: HTMLElement, reduced: boolean): void` writes `root.dataset.reducedMotion`.

- [ ] **Step 1: Write failing preference tests for OS default, explicit override, corruption, and write failure**

Add these cases to `src/core/preferences.test.ts` and update existing whole-snapshot expectations to include `reducedMotion`:

```ts
it('uses the OS motion preference only when no valid stored choice exists', () => {
  const storage = new MemoryStorage()
  expect(new Preferences(storage, '', true).snapshot.reducedMotion).toBe(true)
  expect(new Preferences(storage, '', false).snapshot.reducedMotion).toBe(false)

  storage.values.set('clayisland.reducedMotion', 'perhaps')
  expect(new Preferences(storage, '', true).snapshot.reducedMotion).toBe(true)
})

it('lets an explicit reduced-motion choice override the OS and survive reload', () => {
  const storage = new MemoryStorage()
  const preferences = new Preferences(storage, '', true)
  preferences.setReducedMotion(false)

  expect(preferences.snapshot.reducedMotion).toBe(false)
  expect(storage.values.get('clayisland.reducedMotion')).toBe('false')
  expect(new Preferences(storage, '', true).snapshot.reducedMotion).toBe(false)
})

it('keeps reduced motion session-local when storage writes fail', () => {
  const storage: PreferenceStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('blocked') },
  }
  const preferences = new Preferences(storage, '', false)
  preferences.setReducedMotion(true)
  expect(preferences.snapshot.reducedMotion).toBe(true)
})
```

- [ ] **Step 2: Run the preference tests and confirm the new assertions fail**

Run: `npx vitest run src/core/preferences.test.ts`

Expected: FAIL because the constructor has no system-motion argument, the snapshot has no `reducedMotion`, and `setReducedMotion` does not exist.

- [ ] **Step 3: Implement strict boolean parsing and session-first writes**

In `src/core/preferences.ts`, add the key, value, snapshot field, constructor fallback, and setter:

```ts
const MOTION_KEY = 'clayisland.reducedMotion'

function storedBoolean(value: string | null, fallback: boolean): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}
```

Use `storedBoolean(read(storage, ROTATE_KEY), true)` for auto-rotate and:

```ts
private reducedMotionValue: boolean

constructor(
  private readonly storage: PreferenceStorage | null,
  search: string,
  systemReducedMotion = false,
) {
  this.forced = new URLSearchParams(search).get('lowfx') === '1'
  const quality = read(storage, QUALITY_KEY)
  this.qualityValue = quality === 'reduced' ? 'reduced' : 'enhanced'
  this.autoRotateValue = storedBoolean(read(storage, ROTATE_KEY), true)
  this.reducedMotionValue = storedBoolean(read(storage, MOTION_KEY), systemReducedMotion)
  this.introSeenValue = read(storage, INTRO_KEY) === 'true'
}
```

Return `reducedMotion: this.reducedMotionValue` from `snapshot` and add:

```ts
setReducedMotion(on: boolean): void {
  this.reducedMotionValue = on
  try { this.storage?.setItem(MOTION_KEY, String(on)) } catch { /* session-only */ }
}
```

- [ ] **Step 4: Add the DOM-state helper test and implementation**

Create `src/core/motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyReducedMotion } from './motion'

describe('effective reduced-motion DOM state', () => {
  it('writes the explicit effective value for CSS consumers', () => {
    const root = { dataset: {} } as unknown as HTMLElement
    applyReducedMotion(root, true)
    expect(root.dataset.reducedMotion).toBe('true')
    applyReducedMotion(root, false)
    expect(root.dataset.reducedMotion).toBe('false')
  })
})
```

Add to `src/core/motion.ts` without changing the OS query helper:

```ts
export function applyReducedMotion(root: HTMLElement, reduced: boolean): void {
  root.dataset.reducedMotion = String(reduced)
}
```

- [ ] **Step 5: Run focused tests and TypeScript**

Run: `npx vitest run src/core/preferences.test.ts src/core/motion.test.ts`

Expected: both files PASS.

Run: `npx tsc --noEmit`

Expected: PASS after every existing snapshot literal includes `reducedMotion`.

- [ ] **Step 6: Review the diff checkpoint**

Run: `git diff --check`

Expected: no output.

Suggested commit message only: `feat: persist reduced motion preference`

---

### Task 2: Route one live motion value through every consumer

**Files:**
- Modify: `src/main.ts`
- Modify: `src/scene.ts`
- Modify: `src/fx/shake.ts`
- Modify: `src/fx/shake.test.ts`
- Modify: `src/ui/settings.ts`
- Modify: `src/ui/journal.ts`
- Modify: `src/ui/title.ts`
- Modify: `src/styles.css`

**Interfaces:**
- `const reducedMotion = (): boolean => preferences.snapshot.reducedMotion` is the composition-root provider.
- `createScene()` consumes `{ lowFx: boolean; reducedMotion(): boolean }`.
- `new Shake(reducedMotion)` consumes the same provider.
- `flash(color, seconds, reducedMotion)` receives the resolved boolean for each flash.
- `JournalUIOptions`, `SettingsUIOptions`, and the title handlers consume `reducedMotion(): boolean`.
- `SettingsUI` adds `setReducedMotion(on: boolean): void`.

- [ ] **Step 1: Replace the shake test's global media stub with an injected live policy**

Change the reduced-motion test in `src/fx/shake.test.ts` to:

```ts
it('removes any active offset and stops shaking when live reduced motion turns on', () => {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(2, 3, 4)
  const origin = camera.position.clone()
  let reduced = false
  const shake = new Shake(() => reduced)

  shake.add(0.8, 0.5)
  shake.update(0.1, camera)
  reduced = true
  shake.update(0.1, camera)

  expect(camera.position.x).toBeCloseTo(origin.x)
  expect(camera.position.y).toBeCloseTo(origin.y)
  expect(camera.position.z).toBeCloseTo(origin.z)
})
```

Update the other two tests to construct `new Shake(() => false)`.

- [ ] **Step 2: Run the shake test and confirm constructor-policy failure**

Run: `npx vitest run src/fx/shake.test.ts`

Expected: FAIL because `Shake` does not yet consume the callback.

- [ ] **Step 3: Inject motion into scene and effects**

Change the core signatures to:

```ts
type SceneOptions = {
  lowFx: boolean
  reducedMotion(): boolean
}
```

Use `options.reducedMotion()` inside `updateSky`. Change `Shake` to:

```ts
export class Shake {
  constructor(private readonly reducedMotion: () => boolean = () => false) {}
```

Use `this.reducedMotion()` in `update`. Change flash to:

```ts
export function flash(color: string, seconds: number, reducedMotion = false): void {
```

and use the argument instead of calling `matchMedia`.

- [ ] **Step 4: Add the Settings toggle and live UI callbacks**

Extend the public settings contracts:

```ts
export type SettingsUI = {
  close(): void
  setVisible(visible: boolean): void
  setMuted(muted: boolean): void
  setAutoRotate(on: boolean): void
  setReducedMotion(on: boolean): void
  dispose(): void
}

export type SettingsUIOptions = {
  muted: boolean
  quality: VisualQuality
  forcedLowFx: boolean
  autoRotate: boolean
  reducedMotion: boolean
  reducedMotionActive(): boolean
  onOpenChange(open: boolean): void
  onSoundChange(muted: boolean): void
  onQualityChange(quality: VisualQuality, reportFailure: () => void): void
  onAutoRotateChange(on: boolean): void
  onReducedMotionChange(on: boolean): void
  onResetCamera(): void
  onReplayIntro(): void
}
```

Create a `.settings-toggle` button after Auto-rotate. Its synchronized copy and ARIA state are:

```ts
const syncReducedMotion = (): void => {
  reducedMotionButton.setAttribute('aria-pressed', String(reducedMotion))
  reducedMotionButton.textContent = reducedMotion ? 'Reduced motion on' : 'Reduced motion off'
}
```

Clicking calls `options.onReducedMotionChange(!reducedMotion)`. The returned `setReducedMotion` updates local state and calls `syncReducedMotion`. Use `options.reducedMotionActive()` instead of direct OS reads when deciding whether the close animation needs a timer.

- [ ] **Step 5: Inject motion into Journal and Title timing**

Add `reducedMotion(): boolean` to `JournalUIOptions`; keep the Journal's `.lowfx` class tied only to `options.lowFx`, then use the callback for close timing, tile-pop eligibility, and toast timing. The root dataset owns dynamic reduced-motion styling so toggling back Off cannot leave a stale class. Add `reducedMotion(): boolean` to the title handler/options object and use it for cover and plaque-exit timing. Remove direct `prefersReducedMotion` imports from `scene.ts`, `shake.ts`, `settings.ts`, `journal.ts`, and `title.ts`.

- [ ] **Step 6: Wire the composition root and root dataset**

In `src/main.ts`, keep the OS query only for the initial preference fallback:

```ts
const preferences = new Preferences(storage, location.search, prefersReducedMotion())
const reducedMotion = (): boolean => preferences.snapshot.reducedMotion
applyReducedMotion(document.documentElement, reducedMotion())
```

Pass `reducedMotion` to `createScene`, `CameraController`, `PrologueDirector`, `Shake`, Journal, Settings, and Title. Pass `reducedMotion()` to `quality.update` and wrap the power flash dependency as:

```ts
flash: (color, seconds) => flash(color, seconds, reducedMotion()),
```

Use these exact option fields at construction boundaries:

```ts
const sceneBundle = createScene({ lowFx: startup.lowFx, reducedMotion })
const shake = new Shake(reducedMotion)

journalUI = createJournalUI(ui, journal, {
  lowFx,
  reducedMotion,
  onOpenChange: (open) => {
    if (open) settingsUI?.close()
    if (open) cameraController.lock('journal')
    else cameraController.unlock('journal')
  },
})

settingsUI = createSettingsUI(ui, {
  muted: sfx.muted,
  quality: startup.quality,
  forcedLowFx: startup.forcedLowFx,
  autoRotate: startup.autoRotate,
  reducedMotion: reducedMotion(),
  reducedMotionActive: reducedMotion,
  onOpenChange(open) {
    settingsOpen = open
    if (open) {
      targeting.cancel(true)
      journalUI?.close()
      cameraController.lock('settings')
    } else cameraController.unlock('settings')
  },
  onSoundChange(muted) {
    sfx.unlock()
    sfx.setMuted(muted)
    settingsUI?.setMuted(sfx.muted)
  },
  onQualityChange(nextQuality, reportFailure) {
    if (preferences.setQuality(nextQuality)) location.reload()
    else reportFailure()
  },
  onAutoRotateChange(on) {
    preferences.setAutoRotate(on)
    cameraController.setAutoRotate(on)
    settingsUI?.setAutoRotate(on)
  },
  onReducedMotionChange(on) {
    preferences.setReducedMotion(on)
    applyReducedMotion(document.documentElement, reducedMotion())
    settingsUI?.setReducedMotion(reducedMotion())
  },
  onResetCamera() {
    settingsUI?.close()
    cameraController.reset()
  },
  onReplayIntro() { beginSettingsReplay() },
})
```

Handle the Settings toggle with:

```ts
onReducedMotionChange(on) {
  preferences.setReducedMotion(on)
  applyReducedMotion(document.documentElement, reducedMotion())
  settingsUI?.setReducedMotion(reducedMotion())
},
```

- [ ] **Step 7: Replace CSS media-query ownership with the effective dataset**

Change:

```css
@media (prefers-reduced-motion: reduce) {
```

to root-scoped selectors under:

```css
:root[data-reduced-motion='true'] * {
  animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important;
}
```

Prefix every remaining rule from that former media block with `:root[data-reduced-motion='true']`. Do not retain an OS-only CSS query because explicit Off must be able to restore full motion.

- [ ] **Step 8: Run focused and full static verification**

Run: `npx vitest run src/core/preferences.test.ts src/core/motion.test.ts src/fx/shake.test.ts src/camera/controller.test.ts`

Expected: all selected tests PASS.

Run: `npx tsc --noEmit`

Expected: PASS with no direct OS-motion imports outside `src/main.ts` and `src/core/motion.ts`.

Run: `rg -n "prefersReducedMotion" src --glob "*.ts"`

Expected: matches only `src/core/motion.ts` and the initialization call/import in `src/main.ts`.

- [ ] **Step 9: Review the diff checkpoint**

Run: `git diff --check`

Expected: no output.

Suggested commit message only: `feat: add live reduced motion control`

---

### Task 3: Restore a little golden-hour softness

**Files:**
- Modify: `src/fx/quality.ts`
- Modify: `src/fx/quality.test.ts`
- Modify: `src/scene.ts`

**Interfaces:**
- `tiltOpacityAtDistance(distance)` still returns zero through distance `22`, now capped at `0.45`.
- `VisualQualityController.update()` writes grain `0.12` in full motion and `0.06` in reduced motion.
- Enhanced VSM shadow radius becomes `5`; Low FX remains unchanged.

- [ ] **Step 1: Update quality tests to the approved exact constants**

Change `src/fx/quality.test.ts` assertions to:

```ts
expect(tiltOpacityAtDistance(15)).toBe(0)
expect(tiltOpacityAtDistance(22)).toBe(0)
expect(tiltOpacityAtDistance(Math.hypot(14, 34))).toBeCloseTo(0.45)
expect(tiltOpacityAtDistance(55)).toBe(0.45)
```

and:

```ts
expect(grain.blendMode.opacity.value).toBe(0.12)
```

- [ ] **Step 2: Run the test and confirm the old values fail**

Run: `npx vitest run src/fx/quality.test.ts`

Expected: FAIL with received values `0.35` and `0.10`.

- [ ] **Step 3: Change the controller and scene initialization constants**

In `src/fx/quality.ts`, use:

```ts
const HOME_TILT_OPACITY = 0.45
```

for both the interpolation multiplier and cap, and write `0.12` for non-reduced grain. In `src/scene.ts`, set:

```ts
key.shadow.radius = 5
tilt.blendMode.opacity.value = 0.45
grain.blendMode.opacity.value = 0.12
```

- [ ] **Step 4: Run the quality test and TypeScript**

Run: `npx vitest run src/fx/quality.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Review the diff checkpoint**

Run: `git diff --check`

Expected: no output.

Suggested commit message only: `style: soften golden hour rendering`

---

### Task 4: Make the canonical initial world contain three built huts

**Files:**
- Modify: `src/world/blueprint.ts`
- Modify: `src/world/blueprint.test.ts`
- Modify: `src/world/initial.test.ts`

**Interfaces:**
- Every placement whose kind is `hut` or `site` produces an `InitialPropSpec` hut with `state: 'built'`.
- `InitialPropSpec` no longer advertises a canonical initial hut site.
- `buildInitialWorld()` continues consuming the blueprint without special cases.

- [ ] **Step 1: Write failing three-built-hut assertions**

Replace the hut count assertions in `src/world/blueprint.test.ts` with:

```ts
const huts = blueprint.props.filter(item => item.kind === 'hut')
expect(huts).toHaveLength(3)
expect(huts.every(item => item.state === 'built')).toBe(true)
```

Add to `src/world/initial.test.ts`:

```ts
expect(world.huts).toHaveLength(3)
expect(world.huts.every(hut => hut.state === 'built')).toBe(true)
```

- [ ] **Step 2: Run the world tests and confirm the old site fails**

Run: `npx vitest run src/world/blueprint.test.ts src/world/initial.test.ts`

Expected: FAIL because one hut still has state `site`.

- [ ] **Step 3: Normalize both placement kinds to a built canonical hut**

Narrow the hut spec to:

```ts
| { id: string; kind: 'hut'; state: 'built'; x: number; z: number; visualSeed: number }
```

and return:

```ts
if (placement.kind === 'hut' || placement.kind === 'site') {
  return {
    id: `hut-${hut++}`,
    kind: 'hut',
    state: 'built',
    x: placement.x,
    z: placement.z,
    visualSeed,
  }
}
```

Do not alter `placeSites`; it remains the deterministic geometric layout authority.

- [ ] **Step 4: Run world and scatter tests**

Run: `npx vitest run src/world/blueprint.test.ts src/world/initial.test.ts src/world/scatter.test.ts`

Expected: all selected tests PASS and placement coordinates remain deterministic.

- [ ] **Step 5: Review the diff checkpoint**

Run: `git diff --check`

Expected: no output.

Suggested commit message only: `feat: start gameplay with three built huts`

---

### Task 5: Author three concurrent build teams and a constant orbit

**Files:**
- Modify: `src/prologue/choreography.ts`
- Modify: `src/prologue/choreography.test.ts`

**Interfaces:**
- Export `HUT_BEATS` as three three-stage tuples.
- `PrologueState.hutStages` becomes `readonly [number, number, number]`.
- Actors `0/1`, `2/3`, and `4/5` build huts `0`, `1`, and `2` respectively.
- Actors `4/5` move from hut 2 to the campfire after hut construction.
- `cameraAt(elapsed, reducedMotion)` uses no hut-dependent target.

- [ ] **Step 1: Write failing three-track and orbit-invariant tests**

Replace the two-track assertions and add orbit checks in `src/prologue/choreography.test.ts`:

```ts
expect(prologueStateAt(3.19, blueprint).hutStages).toEqual([0, 0, 0])
expect(prologueStateAt(3.6, blueprint).hutStages).toEqual([1, 1, 1])
expect(prologueStateAt(6.8, blueprint).hutStages).toEqual([3, 3, 3])
```

Use these causal beats:

```ts
const hutBeats = [
  [3.2, 0, 0], [3.4, 1, 2], [3.6, 2, 4],
  [4.8, 0, 1], [5.0, 1, 3], [5.2, 2, 5],
  [6.4, 0, 0], [6.6, 1, 2], [6.8, 2, 4],
] as const
```

Add:

```ts
it('orbits at constant height, radius, target, and angular speed', () => {
  const samples = [0, 2.75, 5.5, 8.25, 11]
    .map(elapsed => prologueStateAt(elapsed, blueprint).camera)

  for (const pose of samples) {
    expect(pose.position.y).toBe(14)
    expect(Math.hypot(pose.position.x, pose.position.z)).toBeCloseTo(34)
    expect(pose.target).toEqual({ x: 0, y: 0, z: 0 })
  }

  const angles = samples.map(pose => Math.atan2(pose.position.x, pose.position.z))
  const unwrapped = angles.map(angle => angle < 0 ? angle + Math.PI * 2 : angle)
  expect(unwrapped[0]).toBeCloseTo(Math.PI)
  expect(unwrapped[1] - unwrapped[0]).toBeCloseTo(-Math.PI / 4)
  expect(unwrapped[2] - unwrapped[1]).toBeCloseTo(-Math.PI / 4)
  expect(samples.at(-1)).toEqual(CAMERA_HOME)
})
```

- [ ] **Step 2: Run choreography tests and confirm tuple/camera failures**

Run: `npx vitest run src/prologue/choreography.test.ts`

Expected: FAIL because only two hut tracks exist and the current camera changes target, height, and radius.

- [ ] **Step 3: Define three synchronized hut beat tracks**

Use:

```ts
export const HUT_BEATS = [
  [3.2, 4.8, 6.4],
  [3.4, 5.0, 6.6],
  [3.6, 5.2, 6.8],
] as const
```

Add matching hammer cues for actors `0, 2, 4`, then `1, 3, 5`, then `0, 2, 4`. Preserve the existing campfire place/ignite cues for actors `4/5` from 8 seconds onward.

- [ ] **Step 4: Generalize actor assignment to three two-person teams**

At the start of `actorState`, derive:

```ts
const hutIndex = Math.floor(actor / 2) as 0 | 1 | 2
const target = huts[hutIndex]
const side = actor % 2 === 0 ? -1 : 1
const work = workPoint(target, side, 1.45)
```

All six actors travel from their blueprint start to their assigned hut during `1.2–3.2`, carry wood between hammer beats, and face that hut through `6.8`. After construction:

- actors `0–3` travel toward stable gathering points around the campfire during `6.8–8.0`, wait there, then return to blueprint positions during `10–11`;
- actors `4/5` travel from hut 2 to their existing campfire work points during `7.2–8.0`, carry stone/place/ignite through `10`, then return during `10–11`;
- reduced motion uses the corresponding stable work/gather/fire points with no continuous travel while retaining the same action beats.

Keep `activeBeat` as the single pose authority so each stage change is paired with a hammer cue.

- [ ] **Step 5: Replace the authored camera poses with the exact orbit**

Replace `cameraAt` and remove `lerpPose` if it becomes unused:

```ts
function cameraAt(elapsed: number, reducedMotion: boolean): CameraPose {
  if (reducedMotion || elapsed >= PROLOGUE_DURATION) {
    return cameraPoint(CAMERA_HOME.position, CAMERA_HOME.target)
  }
  if (elapsed <= 0) {
    return cameraPoint({ x: 0, y: 14, z: -34 }, CAMERA_HOME.target)
  }
  const progress = elapsed / PROLOGUE_DURATION
  const angle = Math.PI * (1 - progress)
  return cameraPoint({
    x: Math.sin(angle) * 34,
    y: 14,
    z: Math.cos(angle) * 34,
  }, CAMERA_HOME.target)
}
```

Filter all three built huts, require `huts.length === 3`, compute the three-element `hutStages`, and call `cameraAt(clamped, reducedMotion)`.

- [ ] **Step 6: Run choreography tests**

Run: `npx vitest run src/prologue/choreography.test.ts`

Expected: PASS for three causal hut tracks, all cues, reduced-motion home framing, orbit invariants, and exact endpoint.

- [ ] **Step 7: Review the diff checkpoint**

Run: `git diff --check`

Expected: no output.

Suggested commit message only: `feat: choreograph three huts and calm orbit`

---

### Task 6: Extend the temporary prologue set to three huts

**Files:**
- Modify: `src/prologue/prologue.ts`
- Modify: `src/prologue/prologue.test.ts`

**Interfaces:**
- `PrologueSet` requires exactly three blueprint-built huts.
- `appliedHutStages` tracks three hut stage counts.
- Material piles `0–8` belong to huts; `9–11` belong to the campfire.
- `handoffRecords()` remains byte-for-byte equal to `gameplayHandoffRecords()` at final seek.

- [ ] **Step 1: Add failing three-hut prologue assertions**

In the first `PrologueSet` test, before final seek add:

```ts
expect(prologue.huts).toHaveLength(3)
expect(gameplay.world.huts).toHaveLength(3)
```

After `seekFinal`, retain the exact record equality and add:

```ts
expect(records.filter(record => record.id.startsWith('hut-'))).toHaveLength(3)
expect(records.filter(record => record.id.startsWith('hut-')).every(
  record => record.state === 'built',
)).toBe(true)
```

- [ ] **Step 2: Run the prologue test and confirm the two-hut invariant fails**

Run: `npx vitest run src/prologue/prologue.test.ts`

Expected: FAIL at the constructor's `two built huts` invariant or two-element stage storage.

- [ ] **Step 3: Generalize stage and material storage**

Use:

```ts
private readonly appliedHutStages: [number, number, number] = [0, 0, 0]
```

Require `this.builtHuts.length !== 3` as an error and update the message to `three built huts and one campfire`. Import the exported `HUT_BEATS` and use `HUT_BEATS[index]` for reduced-motion reveal timing rather than a two-way conditional.

Change hut material visibility to:

```ts
for (let index = 0; index < 9; index++) {
  const hut = Math.floor(index / 3)
  const stage = index % 3
  this.materialPiles[index].visible = this.hutStage(state, hut) <= stage
}
for (let index = 0; index < 3; index++) {
  const consumed = state.campfireProgress >= (index + 1) * 0.33
  this.materialPiles[9 + index].visible = !consumed
}
```

Implement the local helper as:

```ts
private hutStage(state: PrologueState, index: number): number {
  return state.hutStages[index] ?? 0
}
```

The campfire pile loop must therefore begin after all nine hut piles. Use a deterministic lateral offset such as `[-0.72, 0, 0.72][hutIndex]` when placing the three sets of wood.

- [ ] **Step 4: Run prologue, choreography, and initial-world parity tests**

Run: `npx vitest run src/prologue/prologue.test.ts src/prologue/choreography.test.ts src/world/initial.test.ts`

Expected: all selected tests PASS, including idempotent final seek and exact handoff records.

- [ ] **Step 5: Review the diff checkpoint**

Run: `git diff --check`

Expected: no output.

Suggested commit message only: `feat: build third hut in prologue set`

---

### Task 7: Show and continue the same prologue set behind Begin

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/title.ts`
- Modify: `src/styles.css`
- Modify: `src/prologue/prologue.test.ts`

**Interfaces:**
- The normal `PrologueDirector` is constructed during `title` for the generation that `begin` will enter.
- No `director.update()` occurs during `title`; the time-zero state remains frozen.
- `beginNormalPrologue()` requires and reuses that director.
- `TitleUI.showPrologue()` fades/hides the plaque while revealing Skip only when authorized.
- CSS gives `data-mode='begin'` a translucent veil and `data-mode='cover'` an opaque paper background.

- [ ] **Step 1: Strengthen the director's frozen-time-zero test**

In the `PrologueDirector` test, immediately after construction assert:

```ts
const initialSet = director.set
expect(stageRoot.children).toEqual([initialSet.group])
expect(onCue).not.toHaveBeenCalled()
expect(onFinished).not.toHaveBeenCalled()
expect(camera.setPose).toHaveBeenLastCalledWith(prologueStateAt(0, blueprint).camera)
```

After the first `director.update(0.7)`, assert `director.set` is still `initialSet`.

- [ ] **Step 2: Run the focused director test**

Run: `npx vitest run src/prologue/prologue.test.ts`

Expected: PASS; these assertions document the existing reusable-set behavior needed by orchestration.

- [ ] **Step 3: Prepare the normal director before showing Begin**

In `src/main.ts`, construct the title UI, then prepare the future prologue generation:

```ts
const titleUI = createTitleUI(ui, {
  reducedMotion,
  onBegin: beginNormalPrologue,
  onSkip: skipNormalPrologue,
})

function prepareNormalTitle(): void {
  if (flow.phase !== 'title' || director) return
  director = createDirector(flow.generation + 1)
  titleUI.showBegin()
}

prepareNormalTitle()
```

Change `beginNormalPrologue()` so it validates `director` before transitioning and does not call `createDirector`:

```ts
function beginNormalPrologue(): void {
  if (flow.phase !== 'title' || !director) return
  const next = transitionAppFlow(flow, { type: 'begin' })
  if (next === flow || next.phase !== 'prologue') return
  flow = next
  pendingNormalHandoff = false
  renderedFinalPrologue = false
  normalHandoffSwapped = false
  auditBefore = null
  auditMask = null
  sfx.unlock()
  titleUI.showPrologue(canSkipPrologue(flow))
  island.group.visible = false
}
```

The director callback's expected generation is now correct because title generation `N` prepares prologue generation `N + 1`. Replay continues constructing its director only after the inbound cover is opaque.

Freeze ambient presentation during title by changing the render-loop delta choice to:

```ts
const ambientDt = auditingHandoff || flow.phase === 'title' ? 0 : dt
```

Pass that same zero delta to `updateSky` and `quality.update`; this holds clouds, stage bob, and animated grain until Begin without adding another timer.

- [ ] **Step 4: Separate translucent Begin and opaque cover styling**

Replace the combined rule with translucent and opaque `background-color` values so the existing `background-color` transition can fade the veil without a gradient snap:

```css
#ui > #title-layer[data-mode='begin'] {
  background-color: rgb(245 228 200 / 22%);
}

#ui > #title-layer[data-mode='cover'] {
  background-color: var(--paper);
}
```

Do not add `backdrop-filter`; the island itself must remain readable rather than blurred.

- [ ] **Step 5: Make plaque exit timing compatible with full and reduced motion**

In `src/ui/title.ts`, keep the plaque mounted when entering `prologue`, mark it `aria-hidden="true"`, set an exit class/data state that drives opacity/transform, and hide it after `240ms` in full motion or immediately in reduced motion. Clear that timer in every later mode change and `dispose()`. Begin must become `disabled` and `tabIndex = -1` immediately, while Skip may become focusable according to `canSkip` without waiting for the plaque timer. `showBegin()` must remove `aria-hidden` and re-enable Begin before focusing it. `showCover()` must also remove the plaque's `aria-hidden`, unhide the plaque/title, and keep Begin hidden and disabled so replay covers retain their accessible heading without restoring the action.

Add CSS:

```css
#title-layer[data-mode='prologue'] #title-plaque {
  opacity: 0;
  transform: rotate(-0.7deg) translateY(-3vh) scale(0.98);
  pointer-events: none;
}
```

The effective reduced-motion root rules must remove that transform.

- [ ] **Step 6: Run automated checks**

Run: `npx vitest run src/prologue/prologue.test.ts src/core/appFlow.test.ts`

Expected: all selected tests PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Run a browser continuity check**

Start the app with the existing development command and inspect both `?handoffAudit=1` and a returning visit. Expected:

- the island is visible and frozen behind **CLAY ISLAND / BEGIN**;
- no tree, actor, hut, camera, sky, or stage animation advances before Begin;
- pressing Begin continues the visible set without a one-frame disappearance or replacement;
- the first visit exposes no Skip; a returning visit exposes Skip after Begin;
- replay still uses opaque covers and never reveals the preserved live island beneath the canonical prologue.

- [ ] **Step 8: Review the diff checkpoint**

Run: `git diff --check`

Expected: no output.

Suggested commit message only: `feat: show prologue island behind begin`

---

### Task 8: Anchor Settings beneath the gear and complete final verification

**Files:**
- Modify: `src/styles.css`
- Modify: `docs/architecture.md`
- Verify: all changed source and test files

**Interfaces:**
- The full-screen `#settings-layer` and `.settings-backdrop` remain modal.
- `#settings-dialog` aligns to the trigger's right inset and starts no more than 12px below its bottom edge.
- Narrow layouts use the same top-anchored panel, `max-height`, and vertical scrolling rather than the former bottom sheet.

- [ ] **Step 1: Replace centered and bottom-sheet placement with one top anchor**

Use these desktop rules:

```css
#settings-layer {
  position: fixed;
  inset: 0;
  z-index: 25;
  display: grid;
  place-items: start end;
  box-sizing: border-box;
  padding:
    calc(max(16px, env(safe-area-inset-top)) + 55px)
    max(18px, env(safe-area-inset-right))
    16px
    16px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}

#settings-dialog {
  max-height: calc(100vh - max(16px, env(safe-area-inset-top)) - 82px);
  overflow-y: auto;
}
```

At `max-width: 560px`, use:

```css
#settings-layer {
  place-items: start end;
  padding:
    calc(max(12px, env(safe-area-inset-top)) + 55px)
    max(12px, env(safe-area-inset-right))
    10px
    8px;
}

#settings-dialog {
  width: min(330px, calc(100vw - 20px));
  max-height: calc(100vh - max(12px, env(safe-area-inset-top)) - 77px);
  overflow-y: auto;
  padding-bottom: 22px;
  transform: translateY(-8px) rotate(0.2deg);
}

#settings-layer.open #settings-dialog {
  transform: translateY(0) rotate(-0.2deg);
}
```

Keep `.settings-backdrop { position: absolute; inset: 0; }`, modal semantics, backdrop close, focus trap, and focus return unchanged.

- [ ] **Step 2: Update architecture documentation**

In `docs/architecture.md`, update all of these facts:

- `clayisland.reducedMotion` is a guarded persisted boolean with OS-derived first default and explicit stored override;
- the effective motion callback and root dataset replace direct per-component OS queries;
- the normal prologue set is constructed and frozen during `title`, then reused after Begin;
- the canonical initial world and handoff contain three built huts;
- the prologue camera performs a constant fixed-target/fixed-radius/fixed-height half orbit, while reduced motion holds `CAMERA_HOME`;
- enhanced tilt/grain/shadow values are `0.45`, `0.12`, and `5`;
- Settings opens beneath the gear and includes Reduced motion On/Off.

Do not edit `STATUS.md`.

- [ ] **Step 3: Run the entire automated suite**

Run: `npm test`

Expected: all test files and tests PASS with zero skipped tests.

Run: `npx tsc --noEmit`

Expected: exit code 0 with no output.

Run: `npm run build`

Expected: production build succeeds; the existing non-blocking large-chunk advisory may remain.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Run stale-assumption scans**

Run:

```bash
rg -n "two built huts|hutStages.*number, number\]|grain.*0\.10|shadow\.radius = 4|capped at 0\.35|prefers-reduced-motion: reduce" src docs/architecture.md
```

Expected: no stale implementation or architecture matches. Test descriptions that intentionally compare historical failure text must be rewritten rather than exempted.

Run: `git diff -- STATUS.md`

Expected: no output.

- [ ] **Step 5: Complete desktop and narrow browser checks**

At approximately `1440×900` and `390×844`, verify:

- Settings dialog top is below the gear bottom with a visual gap of at most 12px;
- dialog right edge follows the same safe inset as the gear and the bottom never clips;
- focus stays trapped, Escape/backdrop close work, and focus returns to the gear;
- toggling Reduced motion updates its label/ARIA state immediately, persists after reload, and changes camera, sky/stage, shake, grain, Journal, title, and Settings motion consistently;
- an OS-reduced browser with no stored key starts On; explicitly choosing Off survives reload and restores full motion;
- the title island is visible and frozen, then continues seamlessly after Begin;
- all three huts build concurrently and are built in gameplay;
- the prologue has no pan, target shift, or zoom, and its constant orbit ends at the gameplay home view;
- Reduced motion holds the camera at home for the full 11-second story;
- Enhanced close views remain sharp while the home view is slightly softer than the previous tuning;
- Low FX remains functional.

- [ ] **Step 6: Repeat exact handoff and replay preservation audits**

With `?handoffAudit=1`, run an unskipped normal prologue in Enhanced, Low FX, and Reduced motion. Expected: the audit passes with no changed pixels outside the existing ember mask.

During gameplay, create a representative mutation such as a meteor crater, change the camera pose, then replay the intro three times. Expected: the crater, Moments, camera/stage pose, particle-pool visibility, and singleton title/settings/canvas DOM counts are preserved with no console error.

- [ ] **Step 7: Review the final diff checkpoint**

Run: `git status --short`

Expected: only the approved source, tests, design/plan, and `docs/architecture.md` changes are present; `STATUS.md` is absent.

Run: `git diff --check`

Expected: no output.

Suggested commit message only: `feat: polish clay island opening`

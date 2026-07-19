# Celebration Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The eighteen-launch fireworks celebration runs against a temporary night sky, bursts illuminate the island with one pooled point light, and the camera follows a three-act choreography (bounded protective lock, then interruptible pull-backs) with sky-biased framing.

**Architecture:** The existing `DayClock.requestHold('night')` surface gains a configurable glide so the celebration can darken the world in ~2 s and release on every exit path. `camera/policy.ts` gains a Three.js-free three-act pose table with a lifted-target ceiling; `camera/controller.ts` gains a self-bounding `celebration-intro` gesture lock and an eased target-lift. The `CelebrationDirector` replaces its single camera suggestion with act cues driven by a new `CelebrationClock.totalElapsed`. A new `CelebrationBurstLight` consumes per-burst color callbacks from `CelebrationFireworks`; `main.ts` composes fireworks + light behind the director's existing `fireworks` port.

**Tech Stack:** Vanilla Three.js, TypeScript (strict), Vite 8, Vitest (Node environment — THREE classes are constructible in Node, as `fireworks.test.ts` shows; no DOM/WebGL in tests).

**Spec:** `docs/superpowers/specs/2026-07-18-celebration-upgrade-design.md`

## Global Constraints

- Vitest runs in the **Node environment**: tests may construct THREE objects (see `fireworks.test.ts`, `controller.test.ts` with `fakeControls()`) but never touch DOM/WebGL. `main.ts` wiring is verified by `npm run lint` + `npm run build` + manual QA.
- Hex colors live **only** in `PALETTE` in `src/ui/tokens.ts` — this feature adds **no new hexes** (the burst light is tinted by existing shell colors at runtime).
- No changes to shell count, launch schedule, patterns, audio, or villager choreography — those shipped in plan 15.
- Reduced motion: night override **snaps** (DayClock already does this); **no camera travel in any act**; burst light still flashes (it is light, not motion). Reduced quality / `?lowfx=1`: night colors still apply; **no burst point light**; camera behavior as enhanced.
- The user's Settings time-of-day mode always wins over the temporary night override (DayClock's existing mode-beats-hold semantics).
- Run `npm test && npm run lint` after every task; both must pass before committing.

---

### Task 1: DayClock — configurable hold glide (~2 s for the show)

**Files:**
- Modify: `src/core/dayClock.ts`
- Modify: `src/core/dayClock.test.ts`

**Interfaces:**
- Consumes: existing `DayClock.requestHold/releaseHold/setMode/tick`.
- Produces: `requestHold(kind: 'night', glideSeconds?: number)` — Task 6 calls it with `CELEBRATION_NIGHT_GLIDE_SECONDS` (defined in Task 5). Default stays the current 3-second `GLIDE_SECONDS`, so existing callers and tests are unaffected.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('DayClock', ...)` block in `src/core/dayClock.test.ts`:

```ts
  it('honors a custom hold glide duration and parks for the show', () => {
    const clock = new DayClock(noReduced, 100)
    clock.requestHold('night', 2)
    for (let i = 0; i < 30 * 2; i++) clock.tick(1 / 30)
    expect(clock.time).toBeCloseTo(305, 1)
    clock.tick(5)
    expect(clock.time).toBeCloseTo(305, 1) // parked at night while held
    clock.releaseHold()
    clock.tick(1 / 30)
    expect(clock.time).toBeLessThan(305) // gliding back toward the resume phase
  })
```

(`noReduced` already exists at the top of that describe block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/dayClock.test.ts`
Expected: FAIL — after 2 s the clock has only covered 2/3 of the distance (time ≈ 236, not 305).

- [ ] **Step 3: Implement**

In `src/core/dayClock.ts`, thread an optional duration through `requestHold` and `beginGlide`:

```ts
  requestHold(kind: 'night', glideSeconds = GLIDE_SECONDS): void {
    if (this.holdKind) return
    this.holdKind = kind
    this.holdResumeT = this.t
    if (this.modeValue === 'auto') this.beginGlide(NIGHT_ANCHOR, true, glideSeconds)
  }
```

```ts
  private beginGlide(target: number, parkAfter = true, seconds = GLIDE_SECONDS): void {
    this.glideTarget = wrap(target)
    const distance = wrap(this.glideTarget - this.t)
    this.glideSpeed = distance > 0 ? distance / seconds : 0
    this.parkAfterGlide = parkAfter
  }
```

All other `beginGlide` callers keep their current argument lists.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/dayClock.test.ts`
Expected: PASS, including all pre-existing hold tests (default duration unchanged).

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/core/dayClock.ts src/core/dayClock.test.ts
git commit -m "feat: allow custom day-clock hold glide duration"
```

---

### Task 2: Camera policy — three-act pose table and lifted target

**Files:**
- Modify: `src/camera/policy.ts`
- Modify: `src/camera/policy.test.ts`

**Interfaces:**
- Consumes: existing `CAMERA_LIMITS`, `CameraPose`, `Vec3`.
- Produces (later tasks rely on these exact names):
  - `type CelebrationAct = 1 | 2 | 3`
  - `const CELEBRATION_TARGET_LIFT = 3.5`
  - `const CELEBRATION_INTRO_LOCK_SECONDS = 4`
  - `const CELEBRATION_ACTS: readonly { act: CelebrationAct; at: number; distance: number; height: number; seconds: number }[]`
  - `function celebrationActPose(act: CelebrationAct, current: CameraPose, centre: { x: number; z: number }): CameraPose`
  - `clampCameraTarget(target: Vec3, maxHeight?: number): Vec3` — default `0` keeps every existing caller's behavior byte-identical.
- **Keep** `CELEBRATION_CAMERA` and `celebrationCameraPose` for now — `controller.ts`, `director.ts`, and `main.ts` still import them until Tasks 3 and 5. They are deleted in Task 5.

- [ ] **Step 1: Write the failing tests**

In `src/camera/policy.test.ts`, delete the two tests `'frames the launcher while preserving horizontal viewing direction'` and `'keeps a distant launcher target inside the camera focus disc'`, remove `CELEBRATION_CAMERA` and `celebrationCameraPose` from the import list, add `CELEBRATION_ACTS`, `CELEBRATION_INTRO_LOCK_SECONDS`, `CELEBRATION_TARGET_LIFT`, and `celebrationActPose` to it, and append:

```ts
  it('stages three acts closer to farther, settling before the first launch', () => {
    expect(CELEBRATION_ACTS.map(spec => spec.act)).toEqual([1, 2, 3])
    const starts = CELEBRATION_ACTS.map(spec => spec.at)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(CELEBRATION_ACTS[0]!.at).toBeLessThan(4)
    expect(CELEBRATION_INTRO_LOCK_SECONDS)
      .toBe(CELEBRATION_ACTS[1]!.at - CELEBRATION_ACTS[0]!.at)
    const distances = CELEBRATION_ACTS.map(spec => spec.distance)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
    expect(distances[0]!).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance)
    expect(CELEBRATION_ACTS[2]!.distance).toBe(CAMERA_LIMITS.maxDistance)
  })

  it('frames each act at its distance with a lifted sky target, keeping azimuth', () => {
    const current = {
      position: { x: 10, y: 8, z: 0 },
      target: { x: 0, y: 0, z: 0 },
    }
    for (const act of [1, 2, 3] as const) {
      const spec = CELEBRATION_ACTS[act - 1]!
      const pose = celebrationActPose(act, current, { x: 3, z: 4 })
      expect(pose.target).toEqual({ x: 3, y: CELEBRATION_TARGET_LIFT, z: 4 })
      expect(pose.position.y).toBe(spec.height)
      expect(Math.hypot(
        pose.position.x - pose.target.x,
        pose.position.y - pose.target.y,
        pose.position.z - pose.target.z,
      )).toBeCloseTo(spec.distance)
      // Viewing direction was +x, so the pose stays on the +x side of the target.
      expect(pose.position.z).toBeCloseTo(pose.target.z)
      expect(pose.position.x).toBeGreaterThan(pose.target.x)
    }
  })

  it('clamps the lifted target to the focus disc and the lift ceiling', () => {
    const pose = celebrationActPose(3, CAMERA_HOME, { x: 12, z: 0 })
    expect(pose.target.x).toBeCloseTo(7.5)
    expect(pose.target.y).toBe(CELEBRATION_TARGET_LIFT)
    expect(clampCameraTarget({ x: 0, y: 9, z: 0 }, CELEBRATION_TARGET_LIFT).y)
      .toBe(CELEBRATION_TARGET_LIFT)
    expect(clampCameraTarget({ x: 0, y: 2, z: 0 }, CELEBRATION_TARGET_LIFT).y).toBe(2)
    expect(clampCameraTarget({ x: 0, y: 2, z: 0 }).y).toBe(0) // gameplay default
    expect(clampCameraTarget({ x: 0, y: -3, z: 0 }, CELEBRATION_TARGET_LIFT).y).toBe(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/camera/policy.test.ts`
Expected: FAIL — `CELEBRATION_ACTS` not exported.

- [ ] **Step 3: Implement in `src/camera/policy.ts`**

Change `clampCameraTarget` (existing callers pass one argument and keep y = 0):

```ts
export function clampCameraTarget(target: Vec3, maxHeight = 0): Vec3 {
  const radius = Math.hypot(target.x, target.z)
  const scale = radius > CAMERA_LIMITS.targetRadius
    ? CAMERA_LIMITS.targetRadius / radius
    : 1
  const y = Math.min(Math.max(target.y, 0), maxHeight)
  return { x: target.x * scale, y, z: target.z * scale }
}
```

Below the existing `CELEBRATION_CAMERA` block (leave that block in place for now), add:

```ts
export type CelebrationAct = 1 | 2 | 3

/** Bursts sit centre-frame: the celebration target floats this far above ground. */
export const CELEBRATION_TARGET_LIFT = 3.5

/**
 * Three-act celebration choreography over the 14-second timeline:
 * close protected view for the first launches, a pull-back as bursts grow,
 * and the widest pose for the finale. `at` is seconds since gathering began.
 */
export const CELEBRATION_ACTS: readonly {
  act: CelebrationAct
  at: number
  distance: number
  height: number
  seconds: number
}[] = [
  { act: 1, at: 3, distance: 24, height: 9, seconds: 1.6 },
  { act: 2, at: 7, distance: 40, height: 15, seconds: 1.2 },
  { act: 3, at: 11, distance: CAMERA_LIMITS.maxDistance, height: 20, seconds: 0.8 },
] as const

/** The Act 1 gesture lock always releases at the Act 2 boundary. */
export const CELEBRATION_INTRO_LOCK_SECONDS = CELEBRATION_ACTS[1]!.at - CELEBRATION_ACTS[0]!.at

/** An act's launcher-relative pose that preserves the player's current azimuth. */
export function celebrationActPose(
  act: CelebrationAct,
  current: CameraPose,
  centre: { x: number; z: number },
): CameraPose {
  const spec = CELEBRATION_ACTS[act - 1]!
  const target = clampCameraTarget(
    { x: centre.x, y: CELEBRATION_TARGET_LIFT, z: centre.z },
    CELEBRATION_TARGET_LIFT,
  )
  const dx = current.position.x - current.target.x
  const dz = current.position.z - current.target.z
  const length = Math.hypot(dx, dz)
  const direction = length > 1e-6
    ? { x: dx / length, z: dz / length }
    : { x: 0, z: 1 }
  const rise = spec.height - target.y
  const horizontalDistance = Math.sqrt(Math.max(0, spec.distance ** 2 - rise ** 2))
  return {
    position: {
      x: target.x + direction.x * horizontalDistance,
      y: spec.height,
      z: target.z + direction.z * horizontalDistance,
    },
    target,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/camera/policy.test.ts && npx vitest run src/camera/controller.test.ts`
Expected: PASS (controller untouched; `clampCameraTarget` default preserves y = 0).

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/camera/policy.ts src/camera/policy.test.ts
git commit -m "feat: add three-act celebration camera poses with lifted target"
```

---

### Task 3: Camera controller — bounded intro lock and eased target lift

**Files:**
- Modify: `src/camera/controller.ts`
- Modify: `src/camera/controller.test.ts`

**Interfaces:**
- Consumes: `clampCameraTarget(target, maxHeight)` from Task 2.
- Produces (Task 5/6 wiring relies on these exact names):
  - `CameraLockReason` union gains `'celebration-intro'`
  - `get userInteracting(): boolean`
  - `suggestPose(pose: CameraPose, sinceRevision: number, seconds?: number): boolean` (default `0.8`; the `CELEBRATION_CAMERA` import is dropped here)
  - `beginCelebrationIntro(pose: CameraPose, seconds: number, lockSeconds: number): boolean` — refuses (returns `false`) under reduced motion, any existing lock, or an in-progress gesture; otherwise locks with reason `'celebration-intro'` and glides to `pose`, auto-releasing after `lockSeconds`.
  - `endCelebrationIntro(): void` — idempotent early release; never unlocks other owners.
  - `setTargetLift(height: number): void` — raises/lowers the target-y ceiling, eased at 6 m/s (snapped under reduced motion).

- [ ] **Step 1: Write the failing tests**

Append to `src/camera/controller.test.ts` (reuses the file's existing `fakeControls()` helper):

```ts
describe('celebration intro lock and target lift', () => {
  const actPose = {
    position: { x: 0, y: 9, z: 22 },
    target: { x: 0, y: 3.5, z: 0 },
  }

  function build(reducedMotion = () => false) {
    const controls = fakeControls()
    const subject = new CameraController({
      camera: new THREE.PerspectiveCamera(),
      dom: new EventTarget() as HTMLElement,
      autoRotate: false,
      reducedMotion,
      controls,
    })
    return { controls, subject }
  }

  it('locks, glides while locked, and releases itself at the bound', () => {
    const { controls, subject } = build()
    expect(subject.beginCelebrationIntro(actPose, 1, 4)).toBe(true)
    expect(controls.enabled).toBe(false)
    subject.update(0.5)
    expect(controls.enabled).toBe(false) // still locked mid-glide
    subject.update(1)
    expect(controls.enabled).toBe(false) // glide done, lock persists
    subject.update(3)
    expect(controls.enabled).toBe(true) // 4-second bound elapsed
  })

  it('refuses during a gesture, under reduced motion, and under another lock', () => {
    const dragging = build()
    dragging.controls.emit('start')
    expect(dragging.subject.userInteracting).toBe(true)
    expect(dragging.subject.beginCelebrationIntro(actPose, 1, 4)).toBe(false)
    expect(dragging.controls.enabled).toBe(true)

    const reduced = build(() => true)
    expect(reduced.subject.beginCelebrationIntro(actPose, 1, 4)).toBe(false)

    const modal = build()
    modal.subject.lock('journal')
    expect(modal.subject.beginCelebrationIntro(actPose, 1, 4)).toBe(false)
  })

  it('ends early idempotently without unlocking another owner', () => {
    const { controls, subject } = build()
    subject.beginCelebrationIntro(actPose, 1, 4)
    subject.lock('settings') // modal opened during Act 1
    subject.endCelebrationIntro()
    subject.endCelebrationIntro()
    expect(controls.enabled).toBe(false) // settings still owns the lock
    subject.unlock('settings')
    expect(controls.enabled).toBe(true)
    subject.update(10) // expired bound must not double-release anything
    expect(controls.enabled).toBe(true)
  })

  it('eases the lifted target ceiling up and clamps back down on release', () => {
    const { controls, subject } = build()
    subject.setTargetLift(3.5)
    expect(subject.suggestPose(actPose, subject.userInteractionRevision, 0.5)).toBe(true)
    subject.update(1) // ceiling reaches 3.5 within 1 s at 6 m/s; tween lands
    expect(controls.target.y).toBeCloseTo(3.5)
    subject.setTargetLift(0)
    subject.update(1)
    expect(controls.target.y).toBe(0)
  })

  it('snaps the lift and skips intro travel under reduced motion', () => {
    const { controls, subject } = build(() => true)
    subject.setTargetLift(3.5)
    subject.setPose(actPose)
    expect(controls.target.y).toBeCloseTo(3.5) // no easing delay when reduced
    subject.setTargetLift(0)
    subject.update(0.01)
    expect(controls.target.y).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/camera/controller.test.ts`
Expected: FAIL — `beginCelebrationIntro` is not a function.

- [ ] **Step 3: Implement in `src/camera/controller.ts`**

Update the import from `./policy` — remove `CELEBRATION_CAMERA`; nothing new is needed. Update the lock reason union and tween kinds:

```ts
export type CameraLockReason =
  | 'prologue' | 'targeting' | 'journal' | 'settings' | 'celebration-intro'
```

```ts
type CameraTween = {
  kind: 'reset' | 'recenter' | 'suggestion' | 'intro'
  start: CameraPose
  end: CameraPose
  elapsed: number
  seconds: number
}
```

Add a module constant near the top:

```ts
/** Metres per second the celebration target-lift ceiling eases at. */
const TARGET_LIFT_RATE = 6
```

Add private fields beside `interactionRevision`:

```ts
  private introRemaining: number | null = null
  private targetLift = 0
  private targetLiftGoal = 0
```

Add the public surface (below `suggestPose`):

```ts
  get userInteracting(): boolean { return this.interacting }

  /** Bounded protective glide for the celebration's first launches. */
  beginCelebrationIntro(pose: CameraPose, seconds: number, lockSeconds: number): boolean {
    if (this.reducedMotion() || this.locks.size > 0 || this.interacting) return false
    this.lock('celebration-intro')
    this.introRemaining = lockSeconds
    this.tween = {
      kind: 'intro',
      start: this.pose(),
      end: copyPose(pose),
      elapsed: 0,
      seconds,
    }
    return true
  }

  endCelebrationIntro(): void {
    if (this.introRemaining === null && !this.locks.has('celebration-intro')) return
    this.introRemaining = null
    if (this.tween?.kind === 'intro') this.tween = null
    this.unlock('celebration-intro')
  }

  setTargetLift(height: number): void {
    this.targetLiftGoal = Math.max(0, height)
    if (this.reducedMotion()) this.targetLift = this.targetLiftGoal
  }
```

Change `suggestPose` to take the tween duration (the old fixed `CELEBRATION_CAMERA.seconds` becomes the default):

```ts
  suggestPose(pose: CameraPose, sinceRevision: number, seconds = 0.8): boolean {
    if (this.reducedMotion()
      || this.locks.size > 0
      || this.interacting
      || this.interactionRevision !== sinceRevision) return false
    this.controls.autoRotate = false
    this.tween = {
      kind: 'suggestion',
      start: this.pose(),
      end: copyPose(pose),
      elapsed: 0,
      seconds,
    }
    return true
  }
```

In `update(dt)`, immediately after `const reduced = this.reducedMotion()`:

```ts
    if (this.introRemaining !== null) {
      this.introRemaining -= dt
      if (this.introRemaining <= 0) this.endCelebrationIntro()
    }
    if (this.targetLift !== this.targetLiftGoal) {
      if (reduced) {
        this.targetLift = this.targetLiftGoal
      } else {
        const step = TARGET_LIFT_RATE * dt
        this.targetLift = this.targetLift < this.targetLiftGoal
          ? Math.min(this.targetLiftGoal, this.targetLift + step)
          : Math.max(this.targetLiftGoal, this.targetLift - step)
      }
    }
```

Extend the reduced-motion tween branch so an intro that gets caught by a live reduced-motion toggle releases cleanly:

```ts
    if (reduced && this.tween) {
      if (this.tween.kind === 'reset') {
        this.flushControlsMotion()
        this.applyPose(this.tween.end)
      }
      if (this.tween.kind === 'intro') this.endCelebrationIntro()
      this.tween = null
    }
```

Pass the lift through both clamp sites:

```ts
  private applyPose(pose: CameraPose): void {
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z)
    const target = clampCameraTarget(pose.target, this.targetLift)
    this.controls.target.set(target.x, target.y, target.z)
    this.camera.lookAt(this.controls.target)
  }
```

and in `enforcePolicy()` replace the first line with:

```ts
    const target = clampCameraTarget(this.controls.target, this.targetLift)
```

(No change to `lock()`/`unlock()`: `lock('celebration-intro')` participates in the existing composable-lock behavior, and `beginCelebrationIntro` sets its tween *after* calling `lock()`, which clears any prior tween.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/camera/controller.test.ts`
Expected: PASS, including all pre-existing lock/suggestion tests.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run lint`
Expected: all pass — `main.ts` still calls `suggestPose(pose, revision)` and gets the 0.8 s default.

```bash
git add src/camera/controller.ts src/camera/controller.test.ts
git commit -m "feat: add bounded celebration intro lock and eased target lift"
```

---

### Task 4: Burst light — fireworks color callback + pooled point light

**Files:**
- Create: `src/celebration/burstLight.ts`
- Create: `src/celebration/burstLight.test.ts`
- Modify: `src/celebration/fireworks.ts`
- Modify: `src/celebration/fireworks.test.ts`

**Interfaces:**
- Consumes: `FireworkLaunch.color/finale` from the existing launch schedule.
- Produces (Task 6 wiring relies on these exact names):
  - `CelebrationFireworks` options gain optional `onBurst?(color: string, finale: boolean): void`, invoked once per shell at the moment it bursts.
  - `const BURST_LIGHT = { height, distance, peak, finalePeak, maxIntensity, decaySeconds }`
  - `function decayedBurstIntensity(current: number, dt: number): number` (pure)
  - `class CelebrationBurstLight { readonly light: THREE.PointLight; constructor(parent: THREE.Object3D); begin(centre: { x: number; y: number; z: number }): void; onBurst(color: string, finale: boolean): void; update(dt: number): void; reset(): void; dispose(): void }`

- [ ] **Step 1: Write the failing fireworks test**

Append inside `describe('CelebrationFireworks', ...)` in `src/celebration/fireworks.test.ts`:

```ts
  it('reports each burst color and finale flag for the island light', () => {
    const bursts: [string, boolean][] = []
    const subject = new CelebrationFireworks(new THREE.Group(), {
      lowFx: false,
      reducedMotion: () => false,
      onBurst: (color, finale) => bursts.push([color, finale]),
    })
    subject.begin({ x: 0, y: 0, z: 0 })
    runShow(subject)
    expect(bursts).toHaveLength(FIREWORK_LAUNCHES.length)
    expect(bursts.filter(([, finale]) => finale)).toHaveLength(6)
    expect(bursts[0]![0]).toBe(FIREWORK_LAUNCHES[0]!.color)
    subject.dispose()
  })
```

- [ ] **Step 2: Write the failing burst-light tests**

Create `src/celebration/burstLight.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BURST_LIGHT, CelebrationBurstLight, decayedBurstIntensity } from './burstLight'

describe('decayedBurstIntensity', () => {
  it('dies off linearly over about half a second', () => {
    expect(decayedBurstIntensity(BURST_LIGHT.peak, BURST_LIGHT.decaySeconds)).toBe(0)
    expect(decayedBurstIntensity(BURST_LIGHT.peak, BURST_LIGHT.decaySeconds / 2))
      .toBeCloseTo(BURST_LIGHT.peak / 2)
    expect(decayedBurstIntensity(0, 1)).toBe(0)
  })
})

describe('CelebrationBurstLight', () => {
  it('pulses to the newest shell color with clamped stacking', () => {
    const stage = new THREE.Group()
    const subject = new CelebrationBurstLight(stage)
    subject.begin({ x: 2, y: 1, z: -1 })
    expect(subject.light.position.toArray()).toEqual([2, 1 + BURST_LIGHT.height, -1])
    expect(subject.light.visible).toBe(false)

    subject.onBurst('#ff0000', false)
    expect(subject.light.visible).toBe(true)
    expect(subject.light.intensity).toBe(BURST_LIGHT.peak)

    subject.onBurst('#00ff00', true)
    subject.onBurst('#0000ff', true)
    expect(subject.light.intensity).toBe(BURST_LIGHT.maxIntensity)
    expect(subject.light.color.getHexString()).toBe('0000ff') // newest shell wins

    subject.update(5)
    expect(subject.light.intensity).toBe(0)
    expect(subject.light.visible).toBe(false)
  })

  it('resets and disposes without leaving scene children', () => {
    const stage = new THREE.Group()
    const subject = new CelebrationBurstLight(stage)
    subject.onBurst('#ffffff', false)
    subject.reset()
    expect(subject.light.intensity).toBe(0)
    expect(subject.light.visible).toBe(false)
    subject.dispose()
    expect(subject.light.parent).toBeNull()
    expect(stage.children).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/celebration/burstLight.test.ts src/celebration/fireworks.test.ts`
Expected: FAIL — `./burstLight` cannot resolve; fireworks options reject `onBurst`.

- [ ] **Step 4: Implement**

In `src/celebration/fireworks.ts`, widen the constructor options type:

```ts
    private readonly options: {
      lowFx: boolean
      reducedMotion(): boolean
      onBurst?(color: string, finale: boolean): void
    },
```

and in `update()`, where a rocket completes (immediately after the existing `this.flash(...)` call and before the `if (launch.echo ...)` line), add:

```ts
      this.options.onBurst?.(launch.color, launch.finale)
```

Create `src/celebration/burstLight.ts`:

```ts
import * as THREE from 'three'

export const BURST_LIGHT = {
  /** Metres above the resolved celebration centre. */
  height: 10,
  distance: 34,
  /** Intensity added per shell burst; finale shells hit harder. */
  peak: 5,
  finalePeak: 8,
  /** Overlapping bursts combine but never exceed this. */
  maxIntensity: 12,
  decaySeconds: 0.5,
} as const

/** Sharp attack happens in onBurst; this is the ~0.5 s linear die-off. */
export function decayedBurstIntensity(current: number, dt: number): number {
  return Math.max(0, current - (BURST_LIGHT.peak / BURST_LIGHT.decaySeconds) * dt)
}

/**
 * One pooled point light above the celebration site that flashes the island in
 * each shell's color. Reused across all launches and replays; skipped entirely
 * on reduced quality (the composition root simply never constructs it).
 */
export class CelebrationBurstLight {
  readonly light: THREE.PointLight

  constructor(parent: THREE.Object3D) {
    this.light = new THREE.PointLight(0xffffff, 0, BURST_LIGHT.distance)
    this.light.name = 'celebration-burst-light'
    this.light.visible = false
    parent.add(this.light)
  }

  begin(centre: { x: number; y: number; z: number }): void {
    this.light.position.set(centre.x, centre.y + BURST_LIGHT.height, centre.z)
  }

  onBurst(color: string, finale: boolean): void {
    const added = finale ? BURST_LIGHT.finalePeak : BURST_LIGHT.peak
    this.light.color.set(color)
    this.light.intensity = Math.min(BURST_LIGHT.maxIntensity, this.light.intensity + added)
    this.light.visible = true
  }

  update(dt: number): void {
    if (!this.light.visible) return
    this.light.intensity = decayedBurstIntensity(this.light.intensity, Math.max(0, dt))
    if (this.light.intensity <= 0.01) {
      this.light.intensity = 0
      this.light.visible = false
    }
  }

  reset(): void {
    this.light.intensity = 0
    this.light.visible = false
  }

  dispose(): void {
    this.reset()
    this.light.removeFromParent()
    this.light.dispose()
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/celebration/burstLight.test.ts src/celebration/fireworks.test.ts`
Expected: PASS.

- [ ] **Step 6: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/celebration/burstLight.ts src/celebration/burstLight.test.ts src/celebration/fireworks.ts src/celebration/fireworks.test.ts
git commit -m "feat: island-tinting burst light fed by firework burst callbacks"
```

---

### Task 5: Director act cues + main camera wiring

**Files:**
- Modify: `src/celebration/state.ts`
- Modify: `src/celebration/state.test.ts`
- Modify: `src/celebration/director.ts`
- Modify: `src/celebration/director.test.ts`
- Modify: `src/camera/policy.ts` (delete the superseded exports)
- Modify: `src/main.ts`

This is one task because the director's callback signature and `main.ts` must change together to stay compilable; the old policy exports lose their last consumers here and are deleted in the same commit.

**Interfaces:**
- Consumes: `CELEBRATION_ACTS`, `CELEBRATION_INTRO_LOCK_SECONDS`, `CELEBRATION_TARGET_LIFT`, `celebrationActPose`, `CelebrationAct` (Task 2); `beginCelebrationIntro`, `endCelebrationIntro`, `setTargetLift`, `userInteracting`, `suggestPose(pose, revision, seconds)` (Task 3).
- Produces (Task 6 relies on these exact names):
  - `CelebrationClock` gains `get totalElapsed(): number` — seconds since gathering began, `0` when not active.
  - `const CELEBRATION_NIGHT_GLIDE_SECONDS = 2` exported from `src/celebration/state.ts`.
  - `CelebrationDirectorOptions` replaces `onCameraSuggestion(centre)` with `onCameraAct(act: CelebrationAct, centre: CelebrationPoint): void`, fired exactly once per act per run at `CELEBRATION_ACTS[n].at`.

- [ ] **Step 1: Write the failing state test**

Append to `src/celebration/state.test.ts` (a self-contained readiness literal; no helper needed):

```ts
describe('totalElapsed', () => {
  const ready = {
    gameplay: true,
    toastsIdle: true,
    modalsClosed: true,
    powerEffectsIdle: true,
    worldSafe: true,
  }

  it('reports seconds since gathering began across phases', () => {
    const clock = new CelebrationClock()
    expect(clock.totalElapsed).toBe(0)
    clock.request()
    expect(clock.totalElapsed).toBe(0) // queued is not active
    clock.update(0, ready)
    clock.update(3, ready)
    expect(clock.totalElapsed).toBeCloseTo(3) // mid-gathering
    clock.update(4, ready)
    expect(clock.totalElapsed).toBeCloseTo(7) // 3 s into fireworks
    clock.update(6, ready)
    expect(clock.totalElapsed).toBeCloseTo(13) // 1 s into finale
    clock.update(1, ready)
    expect(clock.totalElapsed).toBe(0) // completed
  })
})
```

Also assert the new constant in any top-level spot of the same file:

```ts
it('darkens for the show well before the first launch', () => {
  expect(CELEBRATION_NIGHT_GLIDE_SECONDS).toBe(2)
  expect(CELEBRATION_NIGHT_GLIDE_SECONDS).toBeLessThan(CELEBRATION_SECONDS.gathering)
})
```

(Add `CELEBRATION_NIGHT_GLIDE_SECONDS` to the file's import from `./state`.)

- [ ] **Step 2: Write the failing director test**

In `src/celebration/director.test.ts`:
1. In `harness()`, replace `onCameraSuggestion: vi.fn(),` with `onCameraAct: vi.fn(),`, bind it to a local `const onCameraAct = vi.fn()` and expose it in the returned object (mirroring how `onActiveChange` is exposed).
2. Search the file for `onCameraSuggestion` and delete the now-obsolete camera-suggestion tests (they are superseded below).
3. Append:

```ts
  it('cues the three camera acts once each and re-arms on replay', () => {
    const { onCameraAct, subject } = harness()
    subject.request()
    subject.update(0)
    subject.update(2.9)
    expect(onCameraAct).not.toHaveBeenCalled()
    subject.update(0.2) // t = 3.1 — Act 1
    expect(onCameraAct).toHaveBeenCalledTimes(1)
    expect(onCameraAct).toHaveBeenLastCalledWith(1, { x: 0, z: 0 })
    subject.update(4) // t = 7.1 — Act 2
    expect(onCameraAct).toHaveBeenLastCalledWith(2, { x: 0, z: 0 })
    subject.update(4) // t = 11.1 — Act 3
    expect(onCameraAct).toHaveBeenLastCalledWith(3, { x: 0, z: 0 })
    subject.update(4) // completes
    expect(onCameraAct).toHaveBeenCalledTimes(3)

    subject.request()
    subject.update(0)
    subject.update(3.5)
    expect(onCameraAct).toHaveBeenCalledTimes(4) // replay re-arms Act 1
  })

  it('stops cueing acts after cancellation', () => {
    const { onCameraAct, subject } = harness()
    subject.request()
    subject.update(0)
    subject.cancel()
    subject.update(12)
    expect(onCameraAct).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/celebration/state.test.ts src/celebration/director.test.ts`
Expected: FAIL — `totalElapsed`/`CELEBRATION_NIGHT_GLIDE_SECONDS` missing; `onCameraAct` never called.

- [ ] **Step 4: Implement state (`src/celebration/state.ts`)**

Add below `CELEBRATION_SECONDS`:

```ts
/** The temporary night override glides in this fast so the show opens under stars. */
export const CELEBRATION_NIGHT_GLIDE_SECONDS = 2

const PHASE_START: Record<ActiveCelebrationPhase, number> = {
  gathering: 0,
  fireworks: CELEBRATION_SECONDS.gathering,
  finale: CELEBRATION_SECONDS.gathering + CELEBRATION_SECONDS.fireworks,
}
```

Add the getter to `CelebrationClock` beside `phaseElapsed`:

```ts
  get totalElapsed(): number {
    if (!this.active) return 0
    return PHASE_START[this.phase as ActiveCelebrationPhase] + this.elapsed
  }
```

- [ ] **Step 5: Implement director (`src/celebration/director.ts`)**

Change the policy import to `import { CELEBRATION_ACTS, type CelebrationAct } from '../camera/policy'`. In `CelebrationDirectorOptions`, replace `onCameraSuggestion(centre: CelebrationPoint): void` with:

```ts
  onCameraAct(act: CelebrationAct, centre: CelebrationPoint): void
```

Replace the field `private cameraSuggested = false` with `private nextAct = 0`. In `update()`, replace the whole `reachedCameraSuggestion` block (the `const reachedCameraSuggestion = ...` through the `if (!this.cameraSuggested ...)` statement) with:

```ts
    while (this.nextAct < CELEBRATION_ACTS.length
      && this.activeCentre !== null
      && this.clock.totalElapsed >= CELEBRATION_ACTS[this.nextAct]!.at) {
      const act = CELEBRATION_ACTS[this.nextAct]!.act
      this.nextAct++
      this.options.onCameraAct(act, this.activeCentre)
    }
```

In `begin()`, replace `this.cameraSuggested = false` with `this.nextAct = 0`. In `releaseActiveWork()`, replace `this.cameraSuggested = false` with `this.nextAct = 0`.

- [ ] **Step 6: Wire `src/main.ts` and delete the superseded policy exports**

In `main.ts`, change the policy import to:

```ts
import {
  CELEBRATION_ACTS,
  CELEBRATION_INTRO_LOCK_SECONDS,
  CELEBRATION_TARGET_LIFT,
  celebrationActPose,
  type CameraPose,
} from './camera/policy'
```

Beside `let celebrationCameraRevision = 0` add:

```ts
let celebrationDragAtStart = false
```

Replace the director's `onActiveChange` and `onCameraSuggestion` options with:

```ts
  onActiveChange: active => {
    if (active) {
      celebrationCameraRevision = cameraController.userInteractionRevision
      celebrationDragAtStart = cameraController.userInteracting
      targeting.cancel(false)
      cameraController.suppressAutoMotion('celebration')
      cameraController.setTargetLift(CELEBRATION_TARGET_LIFT)
    } else {
      cameraController.endCelebrationIntro()
      cameraController.setTargetLift(0)
      cameraController.releaseAutoMotion('celebration')
    }
    for (const power of powerIds) tray.setEnabled(power, !active)
  },
  onCameraAct: (act, centre) => {
    const spec = CELEBRATION_ACTS[act - 1]!
    const pose = celebrationActPose(act, cameraController.pose(), centre)
    if (act !== 1) cameraController.endCelebrationIntro()
    if (act === 1
      && !celebrationDragAtStart
      && cameraController.beginCelebrationIntro(
        pose,
        spec.seconds,
        CELEBRATION_INTRO_LOCK_SECONDS,
      )) {
      return
    }
    cameraController.suggestPose(pose, celebrationCameraRevision, spec.seconds)
  },
```

Notes on why this satisfies the spec:
- **Active-drag exception:** `celebrationDragAtStart` snapshots `userInteracting` at the moment the sequence starts; a true value skips the lock for the whole run and every act flows through the revision-gated `suggestPose`.
- **Bounded lock:** the controller self-releases after `CELEBRATION_INTRO_LOCK_SECONDS`, and the Act 2 cue plus `onActiveChange(false)` both call the idempotent `endCelebrationIntro()`.
- **Reduced motion:** `beginCelebrationIntro` and `suggestPose` both refuse, so no act travels.
- **Modal locks:** both entry points refuse while any other lock is held.

In `src/camera/policy.ts`, delete the now-unreferenced `CELEBRATION_CAMERA` constant and `celebrationCameraPose` function (verify: `grep -rn 'CELEBRATION_CAMERA\|celebrationCameraPose' src/` must return nothing).

- [ ] **Step 7: Run tests, full check + commit**

Run: `npm test && npm run lint && npm run build`
Expected: all pass; the grep in Step 6 is clean.

```bash
git add src/celebration/state.ts src/celebration/state.test.ts src/celebration/director.ts src/celebration/director.test.ts src/camera/policy.ts src/main.ts
git commit -m "feat: drive three-act celebration camera choreography from the director"
```

---

### Task 6: Night override + burst-light wiring, docs, manual QA

**Files:**
- Modify: `src/main.ts`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: `requestHold('night', seconds)` (Task 1), `CELEBRATION_NIGHT_GLIDE_SECONDS` (Task 5), `CelebrationBurstLight` and fireworks `onBurst` (Task 4).
- Produces: nothing new — this is the composition-root integration and documentation gate.

- [ ] **Step 1: Wire the night override and burst light in `src/main.ts`**

Add imports:

```ts
import { CelebrationBurstLight } from './celebration/burstLight'
```

and extend the existing `./celebration/state` import with `CELEBRATION_NIGHT_GLIDE_SECONDS`.

Replace the single `const celebrationFireworks = new CelebrationFireworks(...)` line with a composed show (the burst light is skipped entirely on reduced quality, per spec):

```ts
const celebrationBurstLight = lowFx ? null : new CelebrationBurstLight(stageRoot)
const celebrationFireworks = new CelebrationFireworks(stageRoot, {
  lowFx,
  reducedMotion,
  onBurst: (color, finale) => celebrationBurstLight?.onBurst(color, finale),
})
const celebrationShow = {
  begin(origin: { x: number; y: number; z: number }): void {
    celebrationFireworks.begin(origin)
    celebrationBurstLight?.begin(origin)
  },
  update(dt: number) {
    celebrationBurstLight?.update(dt)
    return celebrationFireworks.update(dt)
  },
  reset(): void {
    celebrationFireworks.reset()
    celebrationBurstLight?.reset()
  },
  dispose(): void {
    celebrationFireworks.dispose()
    celebrationBurstLight?.dispose()
  },
}
```

Pass `fireworks: celebrationShow` to the `CelebrationDirector` (it satisfies the director's existing `Pick<CelebrationFireworks, 'begin' | 'update' | 'reset' | 'dispose'>` port, so cancellation and disposal reset the light for free).

Add the night override to `onActiveChange` (first line of each branch, before the camera work from Task 5):

```ts
    if (active) {
      dayClock.requestHold('night', CELEBRATION_NIGHT_GLIDE_SECONDS)
      ...
    } else {
      dayClock.releaseHold()
      ...
    }
```

This single pair covers every path: completion, danger abort, disposal, and Settings-replay cancellation all funnel through the director's `releaseActiveWork()` → `onActiveChange(false)`. `DayClock` semantics already give the rest of the spec: `auto` resumes from the pre-celebration phase (`holdResumeT`), a user-held `day`/`night` keeps control, a mid-show Settings change wins over the hold, and reduced motion snaps the glide.

- [ ] **Step 2: Verify the full app**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

Manual QA (`npm run dev`):
1. Trigger **Celebrate Again** (or the live fifteenth Moment) during daytime: the world glides to night in ~2 s, stars out; at t≈3 s the camera glides close and orbit input is dead for ~4 s, then frees; mid-show it pulls back and rises; the finale gets the widest pose; bursts flash huts/villagers/terrain in each shell's color; afterwards the world glides back to the pre-show time of day and the camera target settles back to ground level.
2. Be mid-orbit-drag at the exact moment the celebration starts: no hijack — the camera never locks; releasing the drag lets Acts 2–3 arrive as gentle suggestions; a fresh drag cancels the rest.
3. Change Settings → Time of day → Day mid-show: the world glides to day while fireworks continue (user wins); after the show it stays day.
4. Reduced motion: night snaps instantly, the camera never travels in any act, the burst light still flashes.
5. `?lowfx=1`: night colors apply, no extra light appears (verify huts do not flash), camera acts behave as enhanced.
6. Open Journal or Settings during Act 1: the modal opens normally; closing it restores control; the celebration and its power lock continue unaffected.
7. Cancel via Settings → Replay intro mid-show: the override releases (time of day restored on return), no stuck camera lock, no lingering light.
8. Replay **Celebrate Again** three times in a row: identical show, no light/tween/listener buildup (scene child count stable).
9. Watch villagers after the show: sleepers/owls may reshuffle from the temporary `day:phase` night transition — they must resume normal schedules within one phase change.

- [ ] **Step 3: Update `docs/architecture.md`**

- `src/camera/policy.ts` bullet: replace the single celebration-pose sentence with the three-act table (`CELEBRATION_ACTS` at 3/7/11 s, 24/40/55 m, 9/15/20 m heights), the `CELEBRATION_TARGET_LIFT` lifted-target ceiling in `clampCameraTarget`, and the 4-second `CELEBRATION_INTRO_LOCK_SECONDS` bound.
- `src/camera/controller.ts` bullet: add `celebration-intro` to the lock-reason list, describe `beginCelebrationIntro` (refuses under reduced motion, other locks, or an active gesture; self-releases at the bound), and the eased `setTargetLift` ceiling.
- `src/celebration/state.ts` bullet: mention `totalElapsed` and `CELEBRATION_NIGHT_GLIDE_SECONDS`.
- `src/celebration/director.ts` bullet: replace "one launcher-centre camera suggestion at three seconds" with the three once-per-run act cues driven by `totalElapsed`.
- `src/celebration/fireworks.ts` bullet: note the per-burst `onBurst` color callback.
- Add a `src/celebration/burstLight.ts` bullet: one pooled `PointLight` above the resolved centre, newest-shell color, clamped stacking, ~0.5 s linear decay, absent on reduced quality.
- `src/main.ts` bullet: the composed fireworks+light show behind the director's fireworks port, the temporary `requestHold('night', 2)`/`releaseHold()` pair on active-change, the drag-at-start lock skip, and the target-lift lifecycle.
- `src/core/dayClock.ts` bullet: `requestHold` accepts a per-request glide duration.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts docs/architecture.md
git commit -m "feat: wire night override and burst light into the celebration"
```

---

## Self-Review Notes

- Spec coverage: §1 night override (T1 glide + T6 wiring; release-on-cancellation rides `onActiveChange(false)`, which Settings-replay cancellation already reaches; mode-wins and reduced-motion snap are pre-existing `DayClock` semantics under test). §2 burst light (T4; pooled single light, newest-color clamped stacking, 0.5 s decay, lowfx skip in T6). §3 three acts (T2 poses/timing, T3 bounded lock + active-drag refusal, T5 cues + main wiring; revision gating unchanged). §4 sky-biased framing (T2 lifted target owned by the Three.js-free policy module, T3 eased ceiling, released in `onActiveChange(false)`).
- Compile-green ordering: old `CELEBRATION_CAMERA`/`celebrationCameraPose` exports survive Tasks 2–4 (their consumers migrate in T3/T5) and are deleted in T5 with a grep check.
- Type consistency: `onCameraAct(act: CelebrationAct, centre: CelebrationPoint)` (T5) matches `celebrationActPose(act, current, centre)` (T2); `beginCelebrationIntro(pose, seconds, lockSeconds)` and `suggestPose(pose, revision, seconds)` (T3) match the T5 call sites; `onBurst(color, finale)` (T4) matches the T6 closure; `begin(centre: {x,y,z})` matches the director's existing `fireworks.begin(origin)` shape.
- Node-only test environment respected: THREE-constructing tests follow the existing `fireworks.test.ts`/`controller.test.ts` patterns; `main.ts` and visual tuning (light intensity 5–12 at 34 m against the 0.55-intensity night key light) are lint/build/manual-QA verified, with tuning latitude noted in QA step 1.

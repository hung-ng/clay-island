# Moment Completion Celebration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reward the live fourteen-to-fifteen Journal transition with a safe fourteen-second villager fireworks celebration and permanently unlock a replay control inside the completed Journal.

**Architecture:** A pure celebration clock owns `idle -> queued -> gathering -> fireworks -> finale -> idle`, while a `CelebrationDirector` adapts it to the live `World`, transient villager overrides, a dedicated pooled fireworks display, Journal status, power gating, audio, and camera auto-motion suppression. Automatic completion and **Celebrate Again** call the same idempotent request path; the existing Journal store remains the only persistence source.

**Tech Stack:** TypeScript 6, Three.js 0.185, Vite 8, Vitest 4, DOM/CSS UI, Web Audio synthesis.

**Design reference:** `docs/superpowers/specs/2026-07-16-moment-completion-celebration-design.md`

## Global Constraints

- The active sequence is exactly fourteen seconds: gathering from 0–4, fireworks from 4–12, and finale from 12–14.
- Manual camera orbit, pan, and zoom remain available; only idle recentering and auto-rotation are suppressed.
- At three seconds into gathering, an interruptible launcher-relative camera suggestion may ease for 0.8 seconds to the camera's maximum 55-metre viewing distance at a 20-metre height only if the player has not moved or reset the camera since the celebration began; reduced motion and modal locks skip it.
- All four powers lock only while the celebration is active. A queued request leaves powers and camera available.
- The existing Journal heading and `15 of 15 moments` progress area remain unchanged.
- **Celebrate Again** is a separate control below the completed moment grid and is derived from the existing validated Moment set.
- Do not add a persistence key, a sixteenth Moment, a thirteenth `VillagerState`, external audio/image assets, or a new dependency.
- Celebration may temporarily move and pose villagers but must not change terrain, water, fire, buildings, forest, population, Moment data, or incomplete task/suggestion state.
- Resolve one shared launcher-and-viewer site when a queued celebration starts. Only a valid lit or doused campfire may anchor it; scattered, missing, rebuilding, cratered, submerged, steep, or obstructed campfire ground relocates immediately to a deterministic safe clearing.
- Reduced quality lowers pool size and removes added dynamic lighting. Reduced motion keeps fourteen-second timing while removing shake, calming hops, shortening trails, and lowering particle density.
- `STATUS.md` remains unchanged unless the user explicitly requests the wrap flow.
- Do not create a git commit unless the user explicitly requests one. Every task must finish with passing targeted tests and leave changes in the working tree.

---

## File Structure

**Create**

- `src/celebration/state.ts` — pure lifecycle, readiness predicate, timings, and automatic-completion predicate.
- `src/celebration/state.test.ts` — lifecycle, idempotency, overshoot, and 14→15 tests.
- `src/celebration/slots.ts` — deterministic safe ring-slot search with nullable fallback results.
- `src/celebration/slots.test.ts` — ordinary, obstructed, fallback, and deterministic slot tests.
- `src/celebration/fireworks.ts` — reusable launch tubes, rocket slots, dedicated particle pool, deterministic schedule, and cleanup.
- `src/celebration/fireworks.test.ts` — schedule, quality bounds, stage-local coordinates, reset, and disposal tests.
- `src/celebration/director.ts` — live-world adapter that coordinates the clock, villagers, fireworks, input owners, UI state, and audio cues.
- `src/celebration/director.test.ts` — queued readiness, duplicate requests, phase propagation, completion, danger abort, and cancellation tests.
- `src/ui/journal.test.ts` — DOM-free reward-presentation tests.

**Modify**

- `src/world/world.ts` — dangerous-fire query, celebration ground predicate, and slot adapter.
- `src/world/world.test.ts` — fire exclusion and world-backed slot tests.
- `src/ui/journal.ts` — separate reward button, toast-idle port, busy state, and replay callback.
- `src/styles.css` — completed-Journal layout and tactile reward-button states.
- `src/camera/controller.ts` — reason-based auto-motion suppression independent of gesture locks.
- `src/camera/controller.test.ts` — prove suppression leaves controls enabled and composes idempotently.
- `src/powers/power.ts` — expose whether delayed power timelines are still active.
- `src/powers/power.test.ts` — prove timeline activity is independent of cooldown.
- `src/villagers/villager.ts` — safe transient celebration override that snapshots and restores ordinary activity presentation/navigation.
- `src/villagers/villager.test.ts` — task/suggestion/timer/prop restoration, pose timing, and danger rejection.
- `src/fx/particles.ts` — optional spherical emission plus deterministic reset, clear, and disposal for a dedicated celebration pool.
- `src/fx/particles.test.ts` — default compatibility, spherical emission, clear, reset, and disposal.
- `src/audio/sfx.ts` — bounded synthesized launch, pop, finale, and cheer cues.
- `src/audio/sfx.test.ts` — cue-profile coverage.
- `src/main.ts` — instantiate and wire the director, automatic completion, replay, power gating, camera suppression, render updates, and app-flow cancellation.
- `docs/architecture.md` — document the new feature boundary and coordination contracts.

---

### Task 1: Pure Celebration Lifecycle

**Files:**

- Create: `src/celebration/state.ts`
- Create: `src/celebration/state.test.ts`

**Interfaces:**

- Consumes: readiness booleans supplied later by `CelebrationDirector`.
- Produces: `CELEBRATION_SECONDS`, `CelebrationPhase`, `CelebrationReadiness`, `CelebrationSignal`, `CelebrationClock`, `canStartCelebration()`, and `shouldRequestAutomaticCelebration()`.

- [ ] **Step 1: Write the failing lifecycle tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  CELEBRATION_SECONDS,
  CelebrationClock,
  canStartCelebration,
  shouldRequestAutomaticCelebration,
  type CelebrationReadiness,
} from './state'

const READY: CelebrationReadiness = {
  gameplay: true,
  toastsIdle: true,
  modalsClosed: true,
  powerEffectsIdle: true,
  worldSafe: true,
}

describe('CelebrationClock', () => {
  it('queues without advancing until every readiness gate passes', () => {
    const subject = new CelebrationClock()
    expect(subject.request()).toBe(true)
    expect(subject.request()).toBe(false)
    expect(subject.phase).toBe('queued')
    expect(subject.update(40, { ...READY, toastsIdle: false })).toEqual([])
    expect(subject.phase).toBe('queued')
  })

  it('runs the approved 4 + 8 + 2 second sequence', () => {
    const subject = new CelebrationClock()
    subject.request()
    expect(subject.update(0, READY)).toEqual(['started'])
    expect(subject.phase).toBe('gathering')
    expect(subject.update(CELEBRATION_SECONDS.gathering, READY)).toEqual(['fireworks'])
    expect(subject.phase).toBe('fireworks')
    expect(subject.update(CELEBRATION_SECONDS.fireworks, READY)).toEqual(['finale'])
    expect(subject.phase).toBe('finale')
    expect(subject.update(CELEBRATION_SECONDS.finale, READY)).toEqual(['completed'])
    expect(subject.phase).toBe('idle')
  })

  it('emits every crossed boundary in order when a frame overshoots', () => {
    const subject = new CelebrationClock()
    subject.request()
    expect(subject.update(14, READY)).toEqual([
      'started', 'fireworks', 'finale', 'completed',
    ])
    expect(subject.phase).toBe('idle')
  })

  it('cancels queued and active work idempotently', () => {
    const subject = new CelebrationClock()
    expect(subject.cancel()).toBe(false)
    subject.request()
    expect(subject.cancel()).toBe(true)
    expect(subject.cancel()).toBe(false)
    subject.request()
    subject.update(0, READY)
    expect(subject.cancel()).toBe(true)
    expect(subject.phase).toBe('idle')
  })
})

it('requires every readiness gate', () => {
  expect(canStartCelebration(READY)).toBe(true)
  for (const key of Object.keys(READY) as Array<keyof CelebrationReadiness>) {
    expect(canStartCelebration({ ...READY, [key]: false })).toBe(false)
  }
})

it('requests automatic playback only for the live 14 to 15 transition', () => {
  expect(shouldRequestAutomaticCelebration(14, 15, 15)).toBe(true)
  expect(shouldRequestAutomaticCelebration(15, 15, 15)).toBe(false)
  expect(shouldRequestAutomaticCelebration(13, 15, 15)).toBe(false)
  expect(shouldRequestAutomaticCelebration(14, 14, 15)).toBe(false)
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/celebration/state.test.ts`

Expected: FAIL because `src/celebration/state.ts` does not exist.

- [ ] **Step 3: Implement the pure lifecycle**

```ts
export const CELEBRATION_SECONDS = {
  gathering: 4,
  fireworks: 8,
  finale: 2,
  total: 14,
} as const

export type CelebrationPhase = 'idle' | 'queued' | 'gathering' | 'fireworks' | 'finale'
export type ActiveCelebrationPhase = Exclude<CelebrationPhase, 'idle' | 'queued'>
export type CelebrationSignal = 'started' | 'fireworks' | 'finale' | 'completed'

export type CelebrationReadiness = {
  gameplay: boolean
  toastsIdle: boolean
  modalsClosed: boolean
  powerEffectsIdle: boolean
  worldSafe: boolean
}

export function canStartCelebration(readiness: CelebrationReadiness): boolean {
  return readiness.gameplay
    && readiness.toastsIdle
    && readiness.modalsClosed
    && readiness.powerEffectsIdle
    && readiness.worldSafe
}

export function shouldRequestAutomaticCelebration(
  before: number,
  after: number,
  total: number,
): boolean {
  return before === total - 1 && after === total
}

function durationFor(phase: ActiveCelebrationPhase): number {
  return CELEBRATION_SECONDS[phase]
}

function nextPhase(phase: ActiveCelebrationPhase): CelebrationPhase {
  if (phase === 'gathering') return 'fireworks'
  if (phase === 'fireworks') return 'finale'
  return 'idle'
}

function signalFor(phase: CelebrationPhase): CelebrationSignal {
  if (phase === 'fireworks') return 'fireworks'
  if (phase === 'finale') return 'finale'
  return 'completed'
}

export class CelebrationClock {
  phase: CelebrationPhase = 'idle'
  private elapsed = 0

  get busy(): boolean { return this.phase !== 'idle' }
  get active(): boolean { return this.phase !== 'idle' && this.phase !== 'queued' }
  get phaseElapsed(): number { return this.elapsed }

  request(): boolean {
    if (this.busy) return false
    this.phase = 'queued'
    this.elapsed = 0
    return true
  }

  cancel(): boolean {
    if (!this.busy) return false
    this.phase = 'idle'
    this.elapsed = 0
    return true
  }

  update(dt: number, readiness: CelebrationReadiness): CelebrationSignal[] {
    const signals: CelebrationSignal[] = []
    let remaining = Math.max(0, dt)

    if (this.phase === 'queued') {
      if (!canStartCelebration(readiness)) return signals
      this.phase = 'gathering'
      this.elapsed = 0
      signals.push('started')
    }

    while (this.active && remaining > 0) {
      const active = this.phase as ActiveCelebrationPhase
      const untilBoundary = durationFor(active) - this.elapsed
      if (remaining < untilBoundary) {
        this.elapsed += remaining
        remaining = 0
        continue
      }

      remaining -= untilBoundary
      this.phase = nextPhase(active)
      this.elapsed = 0
      signals.push(signalFor(this.phase))
    }

    return signals
  }
}
```

- [ ] **Step 4: Run the lifecycle tests**

Run: `npx vitest run src/celebration/state.test.ts`

Expected: PASS with 6 tests.

---

### Task 2: Safe Gathering Slots and World Readiness Queries

**Files:**

- Create: `src/celebration/slots.ts`
- Create: `src/celebration/slots.test.ts`
- Modify: `src/world/world.ts:1-8,155-171,516-539,777-780`
- Modify: `src/world/world.test.ts`

**Interfaces:**

- Consumes: `WALK_RADIUS`, `World.groundQuery()`, `World.submerged()`, current campfire position, and ordinary world object positions.
- Produces: `CelebrationPoint`, `findCelebrationSlots()`, `World.hasDangerousFire()`, `World.isCelebrationGround()`, and `World.celebrationSlots()`.

- [ ] **Step 1: Write pure slot-search tests**

```ts
import { describe, expect, it } from 'vitest'
import { findCelebrationSlots } from './slots'

describe('findCelebrationSlots', () => {
  it('assigns deterministic separated points around the centre', () => {
    const a = findCelebrationSlots({ x: 1, z: -2 }, 6, () => true)
    const b = findCelebrationSlots({ x: 1, z: -2 }, 6, () => true)
    expect(a).toEqual(b)
    expect(a).toHaveLength(6)
    expect(a.every(Boolean)).toBe(true)
    for (const point of a) {
      expect(Math.hypot(point!.x - 1, point!.z + 2)).toBeCloseTo(2.2)
    }
  })

  it('searches wider rings when the preferred ring is blocked', () => {
    const points = findCelebrationSlots(
      { x: 0, z: 0 },
      2,
      point => Math.hypot(point.x, point.z) >= 2.8,
    )
    expect(points.every(point => point && Math.hypot(point.x, point.z) >= 2.8)).toBe(true)
  })

  it('returns a nullable slot instead of blocking when no point is safe', () => {
    expect(findCelebrationSlots({ x: 0, z: 0 }, 1, () => false)).toEqual([null])
  })
})
```

- [ ] **Step 2: Run the slot test and verify the missing module failure**

Run: `npx vitest run src/celebration/slots.test.ts`

Expected: FAIL because `src/celebration/slots.ts` does not exist.

- [ ] **Step 3: Implement deterministic ring search**

```ts
export type CelebrationPoint = { x: number; z: number }

const RADII = [2.2, 2.8, 3.4, 4] as const
const ANGLE_OFFSETS = [0, 1, -1, 2, -2, 3, -3, 4, -4] as const
const ANGLE_STEP = Math.PI / 18
const MIN_SLOT_DISTANCE = 0.72

export function findCelebrationSlots(
  center: CelebrationPoint,
  count: number,
  canStand: (point: CelebrationPoint) => boolean,
): Array<CelebrationPoint | null> {
  const slots: Array<CelebrationPoint | null> = []
  if (count <= 0) return slots

  for (let index = 0; index < count; index++) {
    const baseAngle = -Math.PI / 2 + index / count * Math.PI * 2
    let accepted: CelebrationPoint | null = null

    for (const radius of RADII) {
      for (const offset of ANGLE_OFFSETS) {
        const angle = baseAngle + offset * ANGLE_STEP
        const candidate = {
          x: center.x + Math.cos(angle) * radius,
          z: center.z + Math.sin(angle) * radius,
        }
        const separated = slots.every(slot => (
          !slot || Math.hypot(slot.x - candidate.x, slot.z - candidate.z) >= MIN_SLOT_DISTANCE
        ))
        if (separated && canStand(candidate)) {
          accepted = candidate
          break
        }
      }
      if (accepted) break
    }

    slots.push(accepted)
  }

  return slots
}
```

- [ ] **Step 4: Add failing world-query tests**

Add these cases to `src/world/world.test.ts`:

```ts
describe('celebration ground and safety', () => {
  it('treats tree and hut fire as dangerous but ignores the ordinary campfire', () => {
    const world = makeWorld()
    world.campfire = { x: 0, z: 0, burning: true } as Campfire
    expect(world.hasDangerousFire()).toBe(false)
    world.trees.push({ burning: true } as Tree)
    expect(world.hasDangerousFire()).toBe(true)
    world.trees = []
    world.huts.push({ burning: true } as Hut)
    expect(world.hasDangerousFire()).toBe(true)
  })

  it('keeps celebration slots dry, on-island, and away from solid props', () => {
    const world = makeWorld()
    world.campfire = { x: 0, z: 0, scattered: false } as Campfire
    world.submerged = vi.fn((x: number) => x > 0)
    addTree(world, 'tree-blocker', -2.2, 0)
    const slots = world.celebrationSlots(4)
    expect(slots).toHaveLength(4)
    for (const point of slots) {
      if (!point) continue
      expect(world.submerged(point.x, point.z)).toBe(false)
      expect(Math.hypot(point.x, point.z)).toBeLessThanOrEqual(12)
      expect(Math.hypot(point.x + 2.2, point.z)).toBeGreaterThanOrEqual(1.6)
    }
  })
})
```

- [ ] **Step 5: Add the narrow `World` adapter**

Import `findCelebrationSlots` and `CelebrationPoint` from `../celebration/slots`, and import `WALK_RADIUS` beside the existing `Island` type. Add these public methods:

```ts
hasDangerousFire(): boolean {
  return this.trees.some(tree => tree.burning)
    || this.huts.some(hut => hut.burning)
}

isCelebrationGround(x: number, z: number): boolean {
  if (Math.hypot(x, z) > WALK_RADIUS || this.submerged(x, z)) return false
  const occupied = this.groundQuery().occupied.filter(object => object !== this.campfire)
  return occupied.every(object => Math.hypot(object.x - x, object.z - z) >= 1.6)
}

celebrationSlots(count: number): Array<CelebrationPoint | null> {
  const center = this.campfire
    ? { x: this.campfire.x, z: this.campfire.z }
    : { x: 0, z: 0 }
  return findCelebrationSlots(
    center,
    count,
    point => this.isCelebrationGround(point.x, point.z),
  )
}
```

- [ ] **Step 6: Run the slot and world tests**

Run: `npx vitest run src/celebration/slots.test.ts src/world/world.test.ts`

Expected: PASS. Existing world tests must remain green.

---

### Task 3: Permanent Journal Reward UI

**Files:**

- Create: `src/ui/journal.test.ts`
- Modify: `src/ui/journal.ts:1-15,42-93,134-169,171-239`
- Modify: `src/styles.css:716-936,1320-1356`

**Interfaces:**

- Consumes: the existing validated unlocked set and injected `onCelebrate()` callback.
- Produces: `CelebrationRewardStatus`, `celebrationRewardView()`, `JournalUI.isToastIdle()`, and `JournalUI.setCelebrationStatus()`.

- [ ] **Step 1: Write DOM-free reward-state tests**

```ts
import { describe, expect, it } from 'vitest'
import { celebrationRewardView } from './journal'

describe('completed Journal reward', () => {
  it('stays hidden before all fifteen Moments are unlocked', () => {
    expect(celebrationRewardView(14, 'ready')).toEqual({
      hidden: true,
      disabled: true,
      label: 'Celebrate Again',
    })
  })

  it('is a separate ready control at fifteen Moments', () => {
    expect(celebrationRewardView(15, 'ready')).toEqual({
      hidden: false,
      disabled: false,
      label: 'Celebrate Again',
    })
  })

  it('communicates queued and active states without hiding the reward', () => {
    expect(celebrationRewardView(15, 'queued')).toMatchObject({
      hidden: false, disabled: true, label: 'Celebration waiting…',
    })
    expect(celebrationRewardView(15, 'active')).toMatchObject({
      hidden: false, disabled: true, label: 'Celebrating…',
    })
  })
})
```

- [ ] **Step 2: Run the test and verify the missing export failure**

Run: `npx vitest run src/ui/journal.test.ts`

Expected: FAIL because `celebrationRewardView` is not exported.

- [ ] **Step 3: Add reward types and pure presentation**

Add near the top of `src/ui/journal.ts`:

```ts
export type CelebrationRewardStatus = 'ready' | 'queued' | 'active'

export type CelebrationRewardView = {
  hidden: boolean
  disabled: boolean
  label: string
}

export function celebrationRewardView(
  unlockedCount: number,
  status: CelebrationRewardStatus,
): CelebrationRewardView {
  if (unlockedCount < MOMENTS.length) {
    return { hidden: true, disabled: true, label: 'Celebrate Again' }
  }
  if (status === 'queued') {
    return { hidden: false, disabled: true, label: 'Celebration waiting…' }
  }
  if (status === 'active') {
    return { hidden: false, disabled: true, label: 'Celebrating…' }
  }
  return { hidden: false, disabled: false, label: 'Celebrate Again' }
}
```

Extend the ports exactly as follows:

```ts
export type JournalUIOptions = {
  lowFx: boolean
  reducedMotion(): boolean
  onOpenChange?(open: boolean): void
  onCelebrate?(): void
}

export type JournalUI = {
  toast(moment: Moment): void
  setUnlocked(unlocked: ReadonlySet<MomentId>): void
  setCelebrationStatus(status: CelebrationRewardStatus): void
  close(): void
  isOpen(): boolean
  isToastIdle(): boolean
}
```

- [ ] **Step 4: Add the separate button and state synchronization**

Create the control after `hint` and append it between `grid` and `hint`:

```ts
const celebrateButton = document.createElement('button')
celebrateButton.type = 'button'
celebrateButton.className = 'journal-celebrate'
celebrateButton.hidden = true
celebrateButton.setAttribute('aria-live', 'polite')

slab.append(heading, count, closeButton, grid, celebrateButton, hint)
```

After the `open` state declarations, add:

```ts
let unlockedCount = journal.count()
let celebrationStatus: CelebrationRewardStatus = 'ready'

const syncCelebrationReward = (): void => {
  const view = celebrationRewardView(unlockedCount, celebrationStatus)
  celebrateButton.hidden = view.hidden
  celebrateButton.disabled = view.disabled
  celebrateButton.textContent = view.label
  slab.classList.toggle('journal-complete', !view.hidden)
}
```

Register the replay action:

```ts
celebrateButton.addEventListener('click', () => {
  if (celebrateButton.disabled) return
  setOpen(false)
  options.onCelebrate?.()
})
```

Include the reward button in tab trapping only when usable:

```ts
const focusable = [
  closeButton,
  ...tiles,
  ...(celebrateButton.hidden || celebrateButton.disabled ? [] : [celebrateButton]),
]
```

Extend the returned API:

```ts
setUnlocked(unlocked) {
  unlockedCount = unlocked.size
  tiles.forEach((button, index) => {
    const moment = MOMENTS[index]
    if (!moment) return
    const isUnlocked = unlocked.has(moment.id)
    const wasUnlocked = button.classList.contains('unlocked')
    button.classList.toggle('unlocked', isUnlocked)
    button.setAttribute(
      'aria-label',
      isUnlocked ? moment.title : `Locked moment: ${moment.hint}`,
    )
    button.style.setProperty('--moment-color', moment.color)
    button.textContent = isUnlocked ? moment.title : ''
    if (isUnlocked && !wasUnlocked && !options.reducedMotion()) {
      button.classList.remove('pop')
      void button.offsetWidth
      button.classList.add('pop')
    }
  })
  count.textContent = `${unlocked.size} of ${MOMENTS.length} moments`
  syncCelebrationReward()
},
setCelebrationStatus(status) {
  celebrationStatus = status
  syncCelebrationReward()
},
close() { setOpen(false) },
isOpen() { return open },
isToastIdle() { return !toastShowing && toastQueue.length === 0 },
```

- [ ] **Step 5: Style the reward without changing the progress area**

Add these rules after `.journal-hint`:

```css
.journal-slab.journal-complete .moment-grid {
  bottom: 96px;
}

.journal-slab.journal-complete .journal-hint {
  bottom: 58px;
}

.journal-celebrate {
  position: absolute;
  z-index: 3;
  bottom: 16px;
  left: 50%;
  min-width: 156px;
  padding: 9px 15px;
  transform: translateX(-50%) rotate(-1deg);
  border: 2px solid var(--ink-soft);
  border-radius: 11px 7px 12px 8px / 8px 12px 7px 11px;
  background: var(--paper);
  box-shadow:
    inset 1px 1px 0 var(--cloud),
    inset -2px -2px 0 var(--skin),
    0 4px 0 var(--terracotta);
  color: var(--ink);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease;
}

.journal-celebrate[hidden] {
  display: none;
}

.journal-celebrate:not(:disabled):hover,
.journal-celebrate:focus-visible {
  transform: translateX(-50%) translateY(-2px) rotate(-1deg);
}

.journal-celebrate:not(:disabled):active {
  transform: translateX(-50%) translateY(1px) scale(0.98) rotate(-1deg);
  box-shadow: inset 1px 1px 0 var(--cloud), 0 2px 0 var(--terracotta);
}

.journal-celebrate:disabled {
  cursor: wait;
  opacity: 0.64;
}
```

Under the existing narrow-screen media query, add:

```css
.journal-slab.journal-complete .moment-grid {
  bottom: 90px;
}

.journal-celebrate {
  bottom: 13px;
  padding-block: 7px;
}
```

- [ ] **Step 6: Run UI-focused tests and TypeScript**

Run: `npx vitest run src/ui/journal.test.ts src/ui/modal.test.ts src/ui/tray.test.ts`

Expected: PASS.

Run: `npm run lint`

Expected: PASS with no TypeScript errors.

---

### Task 4: Camera Auto-Motion and Power-Effect Hooks

**Files:**

- Modify: `src/camera/controller.ts:12,67-131,170-258`
- Modify: `src/camera/controller.test.ts`
- Modify: `src/powers/power.ts:44-80`
- Modify: `src/powers/power.test.ts`

**Interfaces:**

- Consumes: existing reason-based camera locks and `PowerManager.timelines`.
- Produces: `CameraAutoMotionReason`, `CameraController.suppressAutoMotion()`, `CameraController.releaseAutoMotion()`, and `PowerManager.effectsActive`.

- [ ] **Step 1: Add failing camera-suppression tests**

```ts
it('suppresses automatic motion without locking manual controls', () => {
  const camera = new THREE.PerspectiveCamera()
  const controls = fakeControls()
  const subject = new CameraController({
    camera,
    dom: new EventTarget() as HTMLElement,
    autoRotate: true,
    reducedMotion: () => false,
    controls,
  })

  subject.suppressAutoMotion('celebration')
  subject.update(20)
  expect(controls.enabled).toBe(true)
  expect(controls.update).toHaveBeenCalled()
  expect(controls.autoRotate).toBe(false)

  subject.releaseAutoMotion('celebration')
  subject.update(8)
  expect(controls.autoRotate).toBe(true)
})

it('composes duplicate auto-motion reasons idempotently', () => {
  const controls = fakeControls()
  const subject = new CameraController({
    camera: new THREE.PerspectiveCamera(),
    dom: new EventTarget() as HTMLElement,
    autoRotate: true,
    reducedMotion: () => false,
    controls,
  })
  subject.suppressAutoMotion('celebration')
  subject.suppressAutoMotion('celebration')
  subject.releaseAutoMotion('celebration')
  subject.update(8)
  expect(controls.enabled).toBe(true)
  expect(controls.autoRotate).toBe(true)
})
```

- [ ] **Step 2: Implement independent auto-motion suppression**

Add the type and set:

```ts
export type CameraAutoMotionReason = 'celebration'

private readonly autoMotionSuppressions = new Set<CameraAutoMotionReason>()
```

Add public methods:

```ts
suppressAutoMotion(reason: CameraAutoMotionReason): void {
  this.autoMotionSuppressions.add(reason)
  this.controls.autoRotate = false
  this.idleElapsed = 0
  if (this.tween?.kind === 'recenter') this.tween = null
}

releaseAutoMotion(reason: CameraAutoMotionReason): void {
  if (!this.autoMotionSuppressions.delete(reason)) return
  this.controls.autoRotate = false
  this.idleElapsed = 0
}
```

Treat `this.autoMotionSuppressions.size > 0` like reduced motion for automatic behavior only in `update()`, `advanceIdle()`, and the recenter-completion auto-rotate condition. Do not add it to `locks`, do not set `controls.enabled = false`, and continue calling `controls.update(dt)` whenever gesture locks are empty.

- [ ] **Step 3: Add a failing power-timeline activity assertion**

Extend the existing `PowerManager` test:

```ts
expect(manager.effectsActive).toBe(false)
manager.cast('meteor', 2, 3)
expect(manager.effectsActive).toBe(true)
manager.update(0.01)
expect(manager.effectsActive).toBe(true)
manager.update(0.49)
expect(manager.effectsActive).toBe(true)
manager.update(0.5)
expect(manager.effectsActive).toBe(false)
expect(manager.cooldown01('meteor')).toBeCloseTo(0.5)
```

- [ ] **Step 4: Expose delayed-effect activity without conflating cooldown**

Add to `PowerManager`:

```ts
get effectsActive(): boolean { return this.timelines.length > 0 }
```

- [ ] **Step 5: Run targeted camera and power tests**

Run: `npx vitest run src/camera/controller.test.ts src/powers/power.test.ts`

Expected: PASS. The camera assertions must show `controls.enabled === true` during celebration suppression.

---

### Task 5: Transient Villager Celebration Override

**Files:**

- Modify: `src/villagers/villager.ts:120-157,269-333,688-736,1357-1375`
- Modify: `src/villagers/villager.test.ts`

**Interfaces:**

- Consumes: a safe `CelebrationAssignment`, current quantized time, `World` steering queries, and `Island.sampleHeight()`.
- Produces: `VillagerCelebrationPhase`, `CelebrationAssignment`, `Villager.canCelebrate()`, `Villager.beginCelebration()`, `Villager.setCelebrationPhase()`, `Villager.endCelebration()`, and `Villager.celebrating`.

- [ ] **Step 1: Add failing override tests**

Add a focused structural harness beside the existing villager harnesses and cover these cases:

```ts
describe('villager celebration override', () => {
  it('suspends and restores navigation, task timers, suggestions, and props', () => {
    const villager = activityHarness('harvest') as ActivityHarness & {
      tx: number
      tz: number
      speed: number
      lastQt: number
      performance: 'none'
      performanceTime: number
      rainTime: number
      zapTime: number
      emoteSprite: { sprite: THREE.Object3D; update(qt: number): void }
      celebration: unknown
      canCelebrate(): boolean
      beginCelebration(assignment: {
        slot: { x: number; z: number }
        centre: { x: number; z: number }
        order: number
      }): boolean
      endCelebration(): void
    }
    Object.assign(villager, {
      alive: true,
      tx: 7,
      tz: -4,
      speed: 0.86,
      lastQt: 3,
      performance: 'none',
      performanceTime: 0,
      rainTime: 0,
      zapTime: -1,
      emoteSprite: { sprite: new THREE.Object3D(), update: vi.fn() },
      celebration: null,
    })
    villager.suggestion = { kind: 'harvest', x: 2, z: 3 }
    villager.timer = 5
    villager.actionTimer = 1.2
    villager.heldFruit.visible = true

    expect(villager.beginCelebration({
      slot: { x: 1, z: 2 }, centre: { x: 0, z: 0 }, order: 0,
    })).toBe(true)
    expect(villager.timer).toBe(5)
    expect(villager.actionTimer).toBe(1.2)
    expect(villager.suggestion).toEqual({ kind: 'harvest', x: 2, z: 3 })
    expect(villager.heldFruit.visible).toBe(false)

    villager.endCelebration()
    expect(villager.tx).toBe(7)
    expect(villager.tz).toBe(-4)
    expect(villager.speed).toBe(0.86)
    expect(villager.timer).toBe(5)
    expect(villager.actionTimer).toBe(1.2)
    expect(villager.suggestion).toEqual({ kind: 'harvest', x: 2, z: 3 })
    expect(villager.heldFruit.visible).toBe(true)
  })

  it('rejects danger performances and fleeing villagers', () => {
    const villager = activityHarness('harvest') as ActivityHarness & {
      alive: boolean
      performance: 'none' | 'startle'
      rainTime: number
      zapTime: number
      celebration: unknown
      canCelebrate(): boolean
    }
    Object.assign(villager, {
      alive: true, performance: 'startle', rainTime: 0, zapTime: -1, celebration: null,
    })
    expect(villager.canCelebrate()).toBe(false)
    villager.performance = 'none'
    villager.state = 'chopTree'
    expect(villager.canCelebrate()).toBe(true)
    villager.state = 'flee' as ActivityHarness['state']
    expect(villager.canCelebrate()).toBe(false)
  })
})
```

- [ ] **Step 2: Add exact celebration types and snapshot storage**

Add near `Point`:

```ts
export type VillagerCelebrationPhase = 'gathering' | 'fireworks' | 'finale'

export type CelebrationAssignment = {
  slot: Point
  centre: Point
  order: number
}

type CelebrationOverride = {
  assignment: CelebrationAssignment
  phase: VillagerCelebrationPhase
  reducedMotion: boolean
  snapshot: {
    tx: number
    tz: number
    arrived: boolean
    speed: number
    lastQt: number
    rodVisible: boolean
    heldFruitVisible: boolean
    axeVisible: boolean
    emoteVisible: boolean
  }
}
```

Add the private field:

```ts
private celebration: CelebrationOverride | null = null
```

- [ ] **Step 3: Implement the public override boundary**

```ts
get celebrating(): boolean { return this.celebration !== null }

canCelebrate(): boolean {
  return this.alive
    && (this.celebrating || (
      this.zapTime < 0
      && this.rainTime <= 0
      && this.performance === 'none'
      && this.state !== 'flee'
    ))
}

beginCelebration(assignment: CelebrationAssignment): boolean {
  if (this.celebrating || !this.canCelebrate()) return false
  this.celebration = {
    assignment,
    phase: 'gathering',
    reducedMotion: false,
    snapshot: {
      tx: this.tx,
      tz: this.tz,
      arrived: this.arrived,
      speed: this.speed,
      lastQt: this.lastQt,
      rodVisible: this.rod.visible,
      heldFruitVisible: this.heldFruit.visible,
      axeVisible: this.axe.visible,
      emoteVisible: this.emoteSprite.sprite.visible,
    },
  }
  this.speed = 1.35
  this.setTarget(assignment.slot)
  this.resetPose()
  this.rod.visible = false
  this.heldFruit.visible = false
  this.axe.visible = false
  this.emoteSprite.sprite.visible = false
  return true
}

setCelebrationPhase(
  phase: VillagerCelebrationPhase,
  reducedMotion: boolean,
): void {
  if (!this.celebration) return
  this.celebration.phase = phase
  this.celebration.reducedMotion = reducedMotion
}

endCelebration(): void {
  const current = this.celebration
  if (!current) return
  this.celebration = null
  this.tx = current.snapshot.tx
  this.tz = current.snapshot.tz
  this.arrived = current.snapshot.arrived
  this.speed = current.snapshot.speed
  this.lastQt = current.snapshot.lastQt
  this.resetPose()
  this.rod.visible = current.snapshot.rodVisible
  this.heldFruit.visible = current.snapshot.heldFruitVisible
  this.axe.visible = current.snapshot.axeVisible
  this.emoteSprite.sprite.visible = current.snapshot.emoteVisible
}
```

- [ ] **Step 4: Route active participants through celebration movement and poses**

At the beginning of `update()`, after the alive guard and before ordinary suggestion/timer updates, add:

```ts
if (this.celebration) {
  if (world.hasDangerousFire()) {
    this.endCelebration()
    const fire = world.nearestBurning(this.x, this.z, 8)
    if (fire) this.panic(fire)
  } else {
    this.updateCelebration(dt, qt, world, island)
    return
  }
}
```

Add the focused updater:

```ts
private updateCelebration(dt: number, qt: number, world: World, island: Island): void {
  const current = this.celebration
  if (!current) return
  if (!this.arrived) this.steer(dt, world)
  if (this.targetDistance() <= 0.24) this.arrived = true
  if (qt === this.lastQt) return

  this.lastQt = qt
  this.resetPose()
  this.rod.visible = false
  this.heldFruit.visible = false
  this.axe.visible = false
  this.group.position.set(this.x, island.sampleHeight(this.x, this.z), this.z)
  this.group.rotation.y = Math.atan2(
    current.assignment.centre.x - this.x,
    current.assignment.centre.z - this.z,
  )

  const frame = (Math.floor(qt * TIMING.fps) + current.assignment.order) % 4
  if (!this.arrived) {
    this.group.rotation.z = frame === 0 ? 0.09 : frame === 2 ? -0.09 : 0
    if (frame % 2 === 0) world.playStepFoley()
    return
  }

  this.group.rotation.z = 0
  this.head.rotation.x = -0.32
  if (current.phase === 'gathering') return
  if (current.phase === 'fireworks') {
    const clap = frame < 2 ? 1.42 : 0.72
    this.arms[0].rotation.z = -clap
    this.arms[1].rotation.z = clap
    if (!current.reducedMotion && frame === 1) this.group.position.y += 0.08
    return
  }

  this.arms[0].rotation.z = -2.05
  this.arms[1].rotation.z = 2.05
  if (!current.reducedMotion && frame % 2 === 0) this.group.position.y += 0.12
}
```

- [ ] **Step 5: Run villager tests and TypeScript**

Run: `npx vitest run src/villagers/villager.test.ts src/villagers/fsm.test.ts`

Expected: PASS. The existing twelve-state FSM completeness assertion must remain unchanged.

Run: `npm run lint`

Expected: PASS.

---

### Task 6: Dedicated Pooled Fireworks and Synthesized Audio

**Files:**

- Modify: `src/fx/particles.ts`
- Modify: `src/fx/particles.test.ts`
- Create: `src/celebration/fireworks.ts`
- Create: `src/celebration/fireworks.test.ts`
- Modify: `src/audio/sfx.ts:7-20,104-119,166-189`
- Modify: `src/audio/sfx.test.ts`

**Interfaces:**

- Consumes: `stageRoot`, `PALETTE`, `RNG`, `ParticleBurst`, low-FX choice, and live reduced-motion callback.
- Produces: spherical particle emission, `ParticleBurst.clear()`, `ParticleBurst.dispose()`, `CelebrationSoundCue`, `FIREWORK_LAUNCHES`, and `CelebrationFireworks` with `begin()`, `update()`, `reset()`, and `dispose()`.

- [ ] **Step 1: Extend particle tests for a dedicated resettable pool**

Add cases to `src/fx/particles.test.ts`:

```ts
it('supports spherical emission while preserving the default fountain', () => {
  const parent = new THREE.Group()
  const sphere = new ParticleBurst(parent, 32, 91)
  sphere.burst({
    x: 0, y: 5, z: 0, n: 32, color: 0xffffff,
    speed: 2, gravity: 0.5, life: 1, shape: 'sphere',
  })
  const matrix = new THREE.Matrix4()
  const before: number[] = []
  for (let index = 0; index < 32; index++) {
    sphere.mesh.getMatrixAt(index, matrix)
    before.push(new THREE.Vector3().setFromMatrixPosition(matrix).y)
  }
  sphere.update(0.1)
  const after: number[] = []
  for (let index = 0; index < 32; index++) {
    sphere.mesh.getMatrixAt(index, matrix)
    after.push(new THREE.Vector3().setFromMatrixPosition(matrix).y)
  }
  const verticalDeltas = after.map((value, index) => value - before[index]!)
  expect(verticalDeltas.some(value => value < 0)).toBe(true)
  expect(verticalDeltas.some(value => value > 0)).toBe(true)
  expect(sphere.activeCount).toBe(32)
})

it('clears deterministically and disposes owned resources', () => {
  const parent = new THREE.Group()
  const particles = new ParticleBurst(parent, 2, 12)
  const geometryDispose = vi.spyOn(particles.mesh.geometry, 'dispose')
  const material = particles.mesh.material as THREE.Material
  const materialDispose = vi.spyOn(material, 'dispose')
  particles.burst({
    x: 0, y: 0, z: 0, n: 2, color: 0xffffff,
    speed: 1, gravity: 1, life: 1,
  })
  particles.clear()
  expect(particles.activeCount).toBe(0)
  particles.dispose()
  expect(particles.mesh.parent).toBeNull()
  expect(geometryDispose).toHaveBeenCalledOnce()
  expect(materialDispose).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Extend `ParticleBurst` without changing default behavior**

Change the option and constructor boundaries:

```ts
export type BurstOptions = {
  x: number
  y: number
  z: number
  n: number
  color: THREE.ColorRepresentation
  speed: number
  gravity: number
  size?: number
  life: number
  shape?: 'fountain' | 'sphere'
}

private rng: RNG
private readonly seed: number
private disposed = false

constructor(parent: THREE.Object3D, private readonly max = 400, seed = 83) {
  this.seed = seed
  this.rng = new RNG(seed)
}

get activeCount(): number {
  let count = 0
  for (const life of this.lifetime) if (life > 0) count++
  return count
}
```

Inside `spawn()`, keep the current position initialization, then replace the current `angle`, `horizontalSpeed`, and three velocity assignments with this complete branch:

```ts
if (options.shape === 'sphere') {
  const azimuth = this.rng.range(0, Math.PI * 2)
  const vertical = this.rng.range(-1, 1)
  const horizontal = Math.sqrt(1 - vertical * vertical)
  const speed = options.speed * this.rng.range(0.72, 1.08)
  this.velocity[offset] = Math.cos(azimuth) * horizontal * speed
  this.velocity[offset + 1] = vertical * speed
  this.velocity[offset + 2] = Math.sin(azimuth) * horizontal * speed
} else {
  const angle = this.rng.range(0, Math.PI * 2)
  const horizontalSpeed = options.speed * this.rng.range(0.25, 0.8)
  this.velocity[offset] = Math.cos(angle) * horizontalSpeed
  this.velocity[offset + 1] = options.speed * this.rng.range(0.55, 1.1)
  this.velocity[offset + 2] = Math.sin(angle) * horizontalSpeed
}
```

At the first executable line of `burst()`, add:

```ts
if (this.disposed || options.n <= 0 || options.life <= 0) return
```

This replaces the existing `options.n`/`options.life` guard. At the first executable line of `update()`, add:

```ts
if (this.disposed) return
```

Add deterministic cleanup:

```ts
clear(): void {
  if (this.disposed) return
  this.rng = new RNG(this.seed)
  this.cursor = 0
  this.age.fill(0)
  this.lifetime.fill(0)
  this.dummy.scale.setScalar(0)
  this.dummy.updateMatrix()
  for (let index = 0; index < this.max; index++) {
    this.mesh.setMatrixAt(index, this.dummy.matrix)
  }
  this.mesh.instanceMatrix.needsUpdate = true
}

dispose(): void {
  if (this.disposed) return
  this.clear()
  this.disposed = true
  this.mesh.removeFromParent()
  this.mesh.geometry.dispose()
  const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material]
  for (const material of materials) material.dispose()
}
```

- [ ] **Step 3: Write firework schedule and ownership tests**

```ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CelebrationFireworks, FIREWORK_LAUNCHES } from './fireworks'

vi.mock('../fx/clayMaterial', () => ({
  clayMaterial: (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color }),
}))

describe('CelebrationFireworks', () => {
  it('uses three regular waves and one finale inside the 4–14 second window', () => {
    expect(FIREWORK_LAUNCHES.map(cue => cue.wave)).toEqual([
      1, 1, 1, 2, 2, 2, 3, 3, 3, 4,
    ])
    expect(FIREWORK_LAUNCHES[0]?.at).toBe(4)
    expect(FIREWORK_LAUNCHES.at(-1)).toMatchObject({ at: 12, finale: true })
  })

  it('is stage-local, bounded by quality, resettable, and disposable', () => {
    const stage = new THREE.Group()
    stage.position.y = 0.3
    const subject = new CelebrationFireworks(stage, {
      lowFx: true,
      reducedMotion: () => false,
    })
    subject.begin({ x: 2, y: 0, z: -1 })
    for (let elapsed = 0; elapsed < 13; elapsed += 0.1) subject.update(0.1)
    stage.updateMatrixWorld(true)
    expect(subject.group.parent).toBe(stage)
    expect(subject.group.position.toArray()).toEqual([2, 0, -1])
    expect(subject.poolCapacity).toBe(120)
    expect(subject.launchedCount).toBe(10)
    subject.reset()
    expect(subject.activeParticleCount).toBe(0)
    expect(subject.group.visible).toBe(false)
    subject.dispose()
    expect(subject.group.parent).toBeNull()
  })
})
```

- [ ] **Step 4: Implement the deterministic firework display**

Define the exact schedule in `src/celebration/fireworks.ts`:

```ts
import * as THREE from 'three'
import { ParticleBurst } from '../fx/particles'
import { clayMaterial } from '../fx/clayMaterial'
import { PALETTE } from '../ui/tokens'

export type CelebrationSoundCue = 'launch' | 'pop' | 'finale' | 'cheer'
export type FireworkOrigin = { x: number; y: number; z: number }

export type FireworkLaunch = {
  at: number
  wave: 1 | 2 | 3 | 4
  x: number
  z: number
  height: number
  color: string
  finale: boolean
}

export const FIREWORK_LAUNCHES: readonly FireworkLaunch[] = [
  { at: 4.0, wave: 1, x: -2.8, z: -0.6, height: 7.2, color: PALETTE.flame, finale: false },
  { at: 4.3, wave: 1, x: 0.0, z: 2.6, height: 8.0, color: PALETTE.smockB, finale: false },
  { at: 4.6, wave: 1, x: 2.8, z: -0.4, height: 7.5, color: PALETTE.ember, finale: false },
  { at: 6.2, wave: 2, x: -2.1, z: 1.8, height: 8.4, color: PALETTE.bloom, finale: false },
  { at: 6.5, wave: 2, x: 0.8, z: -2.5, height: 7.6, color: PALETTE.leafA, finale: false },
  { at: 6.8, wave: 2, x: 2.6, z: 1.4, height: 8.2, color: PALETTE.smockC, finale: false },
  { at: 8.4, wave: 3, x: -2.9, z: 0.5, height: 8.0, color: PALETTE.smockA, finale: false },
  { at: 8.7, wave: 3, x: -0.2, z: -2.7, height: 8.7, color: PALETTE.water, finale: false },
  { at: 9.0, wave: 3, x: 2.9, z: 0.6, height: 8.1, color: PALETTE.ember, finale: false },
  { at: 12.0, wave: 4, x: 0.0, z: 0.3, height: 9.2, color: PALETTE.cloud, finale: true },
] as const

type RocketSlot = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshToonMaterial>
  material: THREE.MeshToonMaterial
  cue: FireworkLaunch | null
  age: number
  trailElapsed: number
}

const ROCKET_SECONDS = 0.72

export class CelebrationFireworks {
  readonly group = new THREE.Group()
  readonly poolCapacity: number
  private readonly pool: ParticleBurst
  private readonly tubes = new THREE.Group()
  private readonly rockets: RocketSlot[] = []
  private elapsed = 0
  private nextLaunch = 0
  private disposed = false
  launchedCount = 0

  constructor(
    parent: THREE.Object3D,
    private readonly options: { lowFx: boolean; reducedMotion(): boolean },
  ) {
    this.group.name = 'celebration-fireworks'
    this.group.visible = false
    this.poolCapacity = options.lowFx ? 120 : 320
    this.pool = new ParticleBurst(this.group, this.poolCapacity, 1515)

    for (const [index, x] of [-0.48, 0, 0.48].entries()) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.15, 0.52, 7),
        clayMaterial([PALETTE.smockA, PALETTE.smockB, PALETTE.smockC][index]!),
      )
      tube.position.set(x, 0.26, 0)
      tube.rotation.z = (index - 1) * -0.12
      tube.castShadow = !options.lowFx
      this.tubes.add(tube)
    }
    this.tubes.position.set(0, 0, 1.1)
    this.group.add(this.tubes)

    for (let index = 0; index < 4; index++) {
      const material = clayMaterial(PALETTE.ember)
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 7, 5),
        material,
      )
      mesh.visible = false
      mesh.castShadow = !options.lowFx
      this.group.add(mesh)
      this.rockets.push({ mesh, material, cue: null, age: 0, trailElapsed: 0 })
    }
    parent.add(this.group)
  }

  get activeParticleCount(): number { return this.pool.activeCount }

  begin(centre: FireworkOrigin): void {
    if (this.disposed) return
    this.reset()
    this.group.position.set(centre.x, centre.y, centre.z)
    this.group.visible = true
  }

  update(dt: number): CelebrationSoundCue[] {
    if (this.disposed || !this.group.visible) return []
    const cues: CelebrationSoundCue[] = []
    this.elapsed += Math.max(0, dt)

    while (this.nextLaunch < FIREWORK_LAUNCHES.length) {
      const launch = FIREWORK_LAUNCHES[this.nextLaunch]!
      if (launch.at > this.elapsed) break
      const slot = this.rockets.find(candidate => candidate.cue === null)
      if (!slot) break
      slot.cue = launch
      slot.age = 0
      slot.trailElapsed = 0
      slot.mesh.visible = true
      slot.mesh.position.set(launch.x, 0.55, launch.z)
      slot.material.color.set(launch.color)
      slot.material.emissive.set(launch.color).multiplyScalar(0.14)
      this.nextLaunch++
      this.launchedCount++
      cues.push('launch')
    }

    for (const slot of this.rockets) {
      const launch = slot.cue
      if (!launch) continue
      slot.age += dt
      const progress = Math.min(1, slot.age / ROCKET_SECONDS)
      slot.mesh.position.y = 0.55 + launch.height * progress
      slot.trailElapsed += dt
      const trailStep = this.options.reducedMotion() ? 0.18 : 0.08
      while (slot.trailElapsed >= trailStep && slot.age < ROCKET_SECONDS) {
        slot.trailElapsed -= trailStep
        this.pool.burst({
          x: slot.mesh.position.x,
          y: slot.mesh.position.y - 0.08,
          z: slot.mesh.position.z,
          n: 1,
          color: launch.color,
          speed: 0.15,
          gravity: 0.1,
          life: this.options.reducedMotion() ? 0.12 : 0.28,
          size: 0.34,
        })
      }
      if (slot.age < ROCKET_SECONDS) continue

      slot.mesh.visible = false
      const density = this.options.lowFx
        ? (launch.finale ? 54 : 22)
        : (launch.finale ? 120 : 42)
      const reducedDensity = this.options.reducedMotion() ? Math.ceil(density * 0.55) : density
      const colors = launch.finale
        ? [PALETTE.flame, PALETTE.smockB, PALETTE.ember]
        : [launch.color]
      for (const color of colors) {
        this.pool.burst({
          x: launch.x,
          y: slot.mesh.position.y,
          z: launch.z,
          n: Math.ceil(reducedDensity / colors.length),
          color,
          speed: this.options.reducedMotion() ? 2.2 : 3.2,
          gravity: 1.4,
          life: this.options.reducedMotion() ? 0.75 : 1.15,
          size: launch.finale ? 1.15 : 0.9,
          shape: 'sphere',
        })
      }
      cues.push(launch.finale ? 'finale' : 'pop')
      slot.cue = null
      slot.trailElapsed = 0
    }

    this.pool.update(dt)
    return cues
  }

  reset(): void {
    if (this.disposed) return
    this.elapsed = 0
    this.nextLaunch = 0
    this.launchedCount = 0
    this.pool.clear()
    for (const slot of this.rockets) {
      slot.cue = null
      slot.age = 0
      slot.trailElapsed = 0
      slot.mesh.visible = false
    }
    this.group.visible = false
  }

  dispose(): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
    this.pool.dispose()
    this.group.removeFromParent()
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object === this.pool.mesh) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    })
  }
}
```

- [ ] **Step 5: Add synthesized celebration cue profiles**

Add to `src/audio/sfx.ts`:

```ts
export type CelebrationSoundCue = 'launch' | 'pop' | 'finale' | 'cheer'
export type CelebrationSoundProfile = {
  kind: 'tone' | 'knock'
  from: number
  to: number
  seconds: number
  volume: number
}

export function celebrationSoundProfile(cue: CelebrationSoundCue): CelebrationSoundProfile {
  if (cue === 'launch') {
    return { kind: 'tone', from: 240, to: 920, seconds: 0.42, volume: 0.018 }
  }
  if (cue === 'pop') {
    return { kind: 'knock', from: 120, to: 82, seconds: 0.18, volume: 0.038 }
  }
  if (cue === 'finale') {
    return { kind: 'knock', from: 92, to: 54, seconds: 0.32, volume: 0.052 }
  }
  return { kind: 'tone', from: 330, to: 520, seconds: 0.28, volume: 0.022 }
}
```

Add the `Sfx` method:

```ts
celebration(cue: CelebrationSoundCue): void {
  const profile = celebrationSoundProfile(cue)
  if (profile.kind === 'knock') {
    this.knock(profile.from, profile.seconds, profile.volume)
    return
  }
  this.oscillator('sine', profile.from, profile.to, profile.seconds, profile.volume)
}
```

Extend `src/audio/sfx.test.ts`:

```ts
import { celebrationSoundProfile, prologueSoundProfile } from './sfx'

it('keeps every celebration cue bounded and distinct', () => {
  expect(celebrationSoundProfile('launch')).toMatchObject({ kind: 'tone', seconds: 0.42 })
  expect(celebrationSoundProfile('pop')).toMatchObject({ kind: 'knock', from: 120 })
  expect(celebrationSoundProfile('finale')).toMatchObject({ kind: 'knock', from: 92 })
  expect(celebrationSoundProfile('cheer')).toMatchObject({ kind: 'tone', to: 520 })
})
```

- [ ] **Step 6: Run FX and audio tests**

Run: `npx vitest run src/fx/particles.test.ts src/celebration/fireworks.test.ts src/audio/sfx.test.ts`

Expected: PASS with deterministic launch count, bounded pool size, and clean disposal.

---

### Task 7: Live Celebration Director

**Files:**

- Create: `src/celebration/director.ts`
- Create: `src/celebration/director.test.ts`

**Interfaces:**

- Consumes: `World`, `CelebrationClock`, `CelebrationFireworks`, villager celebration ports, readiness callbacks, and UI/input/audio callbacks.
- Produces: `CelebrationStatus`, `CelebrationDirector.request()`, `update()`, `cancel()`, `dispose()`, `busy`, and `active`.

- [ ] **Step 1: Write director contract tests with fakes**

```ts
import { describe, expect, it, vi } from 'vitest'
import { CelebrationDirector, type CelebrationDirectorOptions } from './director'

function harness() {
  const participant = {
    id: 'villager-0', x: 6, z: 0, alive: true,
    canCelebrate: vi.fn(() => true),
    beginCelebration: vi.fn(() => true),
    setCelebrationPhase: vi.fn(),
    endCelebration: vi.fn(),
  }
  const fireworks = {
    begin: vi.fn(), update: vi.fn(() => []), reset: vi.fn(), dispose: vi.fn(),
  }
  const onActiveChange = vi.fn()
  const options = {
    world: {
      villagers: [participant],
      campfire: { x: 0, z: 0 },
      island: { sampleHeight: () => 0 },
      living: () => 1,
      hasDangerousFire: vi.fn(() => false),
      celebrationSlots: () => [{ x: 2.2, z: 0 }],
    },
    fireworks,
    isGameplay: () => true,
    toastsIdle: () => true,
    modalsClosed: () => true,
    powerEffectsIdle: () => true,
    reducedMotion: () => false,
    onStatusChange: vi.fn(),
    onActiveChange,
    onSound: vi.fn(),
  } as unknown as CelebrationDirectorOptions
  return {
    participant,
    fireworks,
    onActiveChange,
    options,
    subject: new CelebrationDirector(options),
  }
}

describe('CelebrationDirector', () => {
  it('queues idempotently, starts only when ready, and assigns the live villager', () => {
    const { options, participant, subject } = harness()
    options.toastsIdle = () => false
    expect(subject.request()).toBe(true)
    expect(subject.request()).toBe(false)
    subject.update(5)
    expect(participant.beginCelebration).not.toHaveBeenCalled()
    options.toastsIdle = () => true
    subject.update(0)
    expect(participant.beginCelebration).toHaveBeenCalledWith({
      slot: { x: 2.2, z: 0 },
      centre: { x: 0, z: 0 },
      order: 0,
    })
    expect(options.onActiveChange).toHaveBeenCalledWith(true)
  })

  it('propagates phases and releases participants after fourteen seconds', () => {
    const { participant, fireworks, options, subject } = harness()
    subject.request()
    subject.update(0)
    subject.update(4)
    expect(participant.setCelebrationPhase).toHaveBeenCalledWith('fireworks', false)
    subject.update(8)
    expect(participant.setCelebrationPhase).toHaveBeenCalledWith('finale', false)
    subject.update(2)
    expect(participant.endCelebration).toHaveBeenCalledOnce()
    expect(fireworks.reset).toHaveBeenCalled()
    expect(options.onActiveChange).toHaveBeenLastCalledWith(false)
    expect(subject.active).toBe(false)
  })

  it('aborts active work when dangerous fire appears', () => {
    const { options, participant, subject } = harness()
    subject.request()
    subject.update(0)
    options.world.hasDangerousFire = () => true
    subject.update(0.1)
    expect(participant.endCelebration).toHaveBeenCalledOnce()
    expect(options.onActiveChange).toHaveBeenLastCalledWith(false)
  })

  it('cancels queued work without toggling active input owners', () => {
    const { options, subject } = harness()
    options.toastsIdle = () => false
    subject.request()
    expect(subject.cancel()).toBe(true)
    expect(options.onActiveChange).not.toHaveBeenCalled()
    expect(subject.cancel()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/celebration/director.test.ts`

Expected: FAIL because `src/celebration/director.ts` does not exist.

- [ ] **Step 3: Implement the director and exact callbacks**

```ts
import type { World } from '../world/world'
import type {
  CelebrationAssignment,
  Villager,
  VillagerCelebrationPhase,
} from '../villagers/villager'
import type { CelebrationFireworks, CelebrationSoundCue } from './fireworks'
import { CelebrationClock, type CelebrationSignal } from './state'

export type CelebrationStatus = 'ready' | 'queued' | 'active'

type CelebrationParticipant = Pick<
  Villager,
  | 'id' | 'x' | 'z' | 'alive' | 'canCelebrate' | 'beginCelebration'
  | 'setCelebrationPhase' | 'endCelebration'
>

export type CelebrationDirectorOptions = {
  world: World
  fireworks: Pick<CelebrationFireworks, 'begin' | 'update' | 'reset' | 'dispose'>
  isGameplay(): boolean
  toastsIdle(): boolean
  modalsClosed(): boolean
  powerEffectsIdle(): boolean
  reducedMotion(): boolean
  onStatusChange(status: CelebrationStatus): void
  onActiveChange(active: boolean): void
  onSound(cue: CelebrationSoundCue): void
}

export class CelebrationDirector {
  private readonly clock = new CelebrationClock()
  private participants: CelebrationParticipant[] = []
  private ownsActiveInputs = false
  private disposed = false

  constructor(private readonly options: CelebrationDirectorOptions) {}

  get busy(): boolean { return this.clock.busy }
  get active(): boolean { return this.clock.active }

  request(): boolean {
    if (this.disposed) return false
    if (!this.clock.request()) return false
    this.options.onStatusChange('queued')
    return true
  }

  update(dt: number): void {
    if (this.disposed) return
    if (this.clock.busy && !this.options.isGameplay()) {
      this.cancel()
      return
    }
    if (this.clock.active && this.options.world.hasDangerousFire()) {
      this.cancel()
      return
    }

    const living = this.options.world.villagers.filter(villager => villager.alive)
    const signals = this.clock.update(dt, {
      gameplay: this.options.isGameplay(),
      toastsIdle: this.options.toastsIdle(),
      modalsClosed: this.options.modalsClosed(),
      powerEffectsIdle: this.options.powerEffectsIdle(),
      worldSafe: living.length > 0
        && !this.options.world.hasDangerousFire()
        && living.every(villager => villager.canCelebrate()),
    })

    for (const signal of signals) this.handleSignal(signal, living)
    if (!this.clock.active) return

    const phase = this.clock.phase as VillagerCelebrationPhase
    for (const participant of this.participants) {
      participant.setCelebrationPhase(phase, this.options.reducedMotion())
    }
    for (const cue of this.options.fireworks.update(dt)) this.options.onSound(cue)
  }

  cancel(): boolean {
    if (!this.clock.cancel()) return false
    this.releaseActiveWork()
    this.options.onStatusChange('ready')
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.cancel()
    this.options.fireworks.dispose()
    this.disposed = true
  }

  private handleSignal(
    signal: CelebrationSignal,
    living: CelebrationParticipant[],
  ): void {
    if (signal === 'started') {
      this.begin(living)
      return
    }
    if (signal === 'fireworks' || signal === 'finale') {
      const phase: VillagerCelebrationPhase = signal
      for (const participant of this.participants) {
        participant.setCelebrationPhase(phase, this.options.reducedMotion())
      }
      return
    }
    this.options.onSound('cheer')
    this.releaseActiveWork()
    this.options.onStatusChange('ready')
  }

  private begin(living: CelebrationParticipant[]): void {
    const centre = this.options.world.campfire
      ? { x: this.options.world.campfire.x, z: this.options.world.campfire.z }
      : { x: 0, z: 0 }
    const origin = {
      x: centre.x,
      y: this.options.world.island.sampleHeight(centre.x, centre.z),
      z: centre.z,
    }
    const slots = this.options.world.celebrationSlots(living.length)
    this.participants = living.filter((participant, order) => {
      const assignment: CelebrationAssignment = {
        slot: slots[order] ?? { x: participant.x, z: participant.z },
        centre,
        order,
      }
      return participant.beginCelebration(assignment)
    })
    this.options.fireworks.begin(origin)
    this.ownsActiveInputs = true
    this.options.onActiveChange(true)
    this.options.onStatusChange('active')
  }

  private releaseActiveWork(): void {
    if (!this.ownsActiveInputs) return
    for (const participant of this.participants) participant.endCelebration()
    this.participants = []
    this.options.fireworks.reset()
    this.ownsActiveInputs = false
    this.options.onActiveChange(false)
  }
}
```

- [ ] **Step 4: Add missing idempotency and reduced-motion assertions**

Extend the test file to verify:

```ts
it('reads reduced motion live while active', () => {
  const { options, participant, subject } = harness()
  let reduced = false
  options.reducedMotion = () => reduced
  subject.request()
  subject.update(0)
  reduced = true
  subject.update(4)
  expect(participant.setCelebrationPhase).toHaveBeenLastCalledWith('fireworks', true)
})

it('dispose is safe after completion and cannot release inputs twice', () => {
  const { onActiveChange, subject } = harness()
  subject.request()
  subject.update(14)
  subject.dispose()
  subject.dispose()
  expect(onActiveChange.mock.calls.filter(([active]) => active === false)).toHaveLength(1)
})
```

- [ ] **Step 5: Run director and dependency tests**

Run: `npx vitest run src/celebration/state.test.ts src/celebration/slots.test.ts src/celebration/director.test.ts src/villagers/villager.test.ts src/world/world.test.ts`

Expected: PASS.

---

### Task 8: Composition-Root Integration

**Files:**

- Modify: `src/main.ts:17-39,95-212,233-266,421-457`

**Interfaces:**

- Consumes: every port produced by Tasks 1–7 plus existing tray, targeting, Settings, app-flow, and render-loop ports.
- Produces: one live `CelebrationDirector`; automatic and replay requests share it.

- [ ] **Step 1: Add imports and one nullable callback bridge**

Add imports:

```ts
import { CelebrationDirector } from './celebration/director'
import { CelebrationFireworks } from './celebration/fireworks'
import { shouldRequestAutomaticCelebration } from './celebration/state'
import { Journal, MOMENTS } from './discovery/moments'
```

Replace the old `Journal`-only import rather than keeping two discovery imports. Before creating the Journal UI, add:

```ts
let celebration: CelebrationDirector | null = null
```

Extend `createJournalUI` options:

```ts
onCelebrate: () => { celebration?.request() },
```

- [ ] **Step 2: Construct fireworks and the director after Settings exists**

Immediately after `settingsUI.setVisible(false)`, add:

```ts
const celebrationFireworks = new CelebrationFireworks(stageRoot, { lowFx, reducedMotion })
celebration = new CelebrationDirector({
  world,
  fireworks: celebrationFireworks,
  isGameplay: () => flow.phase === 'gameplay',
  toastsIdle: () => journalUI?.isToastIdle() ?? true,
  modalsClosed: () => !settingsOpen && !(journalUI?.isOpen() ?? false),
  powerEffectsIdle: () => !powers.effectsActive,
  reducedMotion,
  onStatusChange: status => journalUI?.setCelebrationStatus(status),
  onActiveChange: active => {
    if (active) {
      targeting.cancel(false)
      cameraController.suppressAutoMotion('celebration')
    } else {
      cameraController.releaseAutoMotion('celebration')
    }
    for (const power of powerIds) tray.setEnabled(power, !active)
  },
  onSound: cue => sfx.celebration(cue),
})
```

Keep Settings and Journal controls available. Do not set the full tray inert because that would disable the Journal; use the existing per-power `tray.setEnabled()` port exactly as shown.

- [ ] **Step 3: Request only on the live 14→15 transition**

Replace the Journal event subscriber body with:

```ts
world.bus.on((event) => {
  const before = journal.count()
  const unlocked = journal.observe(event)
  if (!unlocked) return
  journalUI?.toast(unlocked)
  sfx.reward()
  journalUI?.setUnlocked(journal.unlocked)
  tray.setJournalCount(journal.count())
  if (shouldRequestAutomaticCelebration(before, journal.count(), MOMENTS.length)) {
    celebration?.request()
  }
})
```

The toast must be queued before the director request. `isToastIdle()` then holds the queued celebration until the complete notification queue has cleared.

- [ ] **Step 4: Add defensive power gating and app-flow cancellation**

Strengthen the tray arm callback without changing `canArmPower()`:

```ts
onArm: power => {
  const celebrationActive = celebration?.active ?? false
  if (!celebrationActive
    && canArmPower(flow, settingsOpen || Boolean(journalUI?.isOpen()))) {
    targeting.arm(power)
  }
},
```

At the beginning of `beginSettingsReplay()`, after the gameplay-phase guard, add:

```ts
celebration?.cancel()
```

This cancels queued and active work before the cover transition snapshots camera and stage state. Do not cancel merely because Journal or Settings opens during an already-active celebration; the user approved those surfaces remaining available.

- [ ] **Step 5: Advance the director after delayed powers and before rendering world FX**

Inside the `gameplayActive` render block, keep `targeting.update()` and `powers.update(dt)` first, then add:

```ts
celebration?.update(dt)
```

The order must be:

```ts
targeting.update()
powers.update(dt)
celebration?.update(dt)
particles.update(dt)
```

This lets a completed power timeline satisfy readiness on the same frame without allowing celebration to start while an anticipation, impact, or aftermath callback remains pending.

- [ ] **Step 6: Run integration-adjacent tests and full TypeScript**

Run: `npx vitest run src/core/appFlow.test.ts src/discovery/moments.test.ts src/ui/journal.test.ts src/camera/controller.test.ts src/powers/power.test.ts src/celebration/director.test.ts`

Expected: PASS.

Run: `npm run lint`

Expected: PASS with exact-optional, unused-local, and unchecked-index checks satisfied.

---

### Task 9: Architecture Documentation and Full Verification

**Files:**

- Modify: `docs/architecture.md`
- Verify only: `STATUS.md`

**Interfaces:**

- Consumes: the finished implementation and approved design.
- Produces: current architecture documentation and evidence that the feature works across the supported runtime variants.

- [ ] **Step 1: Update architecture documentation in the existing structure**

Add concise bullets or clauses documenting all of these exact contracts:

```md
- `src/celebration/state.ts` owns the pure fourteen-second queued/gathering/fireworks/finale lifecycle and the live 14→15 completion predicate.
- `src/celebration/director.ts` is the live adapter: it waits for toast, modal, power-effect, danger, and population readiness; coordinates villagers and pooled fireworks; locks only powers; suppresses only camera auto-motion; and cleans up idempotently on completion, danger, or app-flow cancellation.
- `src/celebration/slots.ts` deterministically assigns dry, walkable viewing points around the current campfire footprint with nullable fallback slots.
- `src/celebration/fireworks.ts` owns the stage-local launch tubes, bounded dedicated particle pool, deterministic three-wave/finale schedule, reduced-quality density, and reduced-motion presentation.
- `src/villagers/villager.ts` treats celebration as a transient override outside the twelve-state FSM and restores navigation, props, timers, incomplete labour, and Nudge suggestions afterward.
- `src/ui/journal.ts` derives the separate **Celebrate Again** reward from all fifteen validated Moments, exposes toast-idle readiness, and adds no persistence key or progress-area mutation.
- `src/camera/controller.ts` keeps gesture locks separate from reason-based auto-motion suppression, so celebration permits orbit, pan, and zoom while pausing recenter and auto-rotate.
```

Integrate these into the relevant existing bullets instead of appending a disconnected implementation diary.

- [ ] **Step 2: Run all automated verification**

Run: `npm test`

Expected: every Vitest test passes.

Run: `npm run lint`

Expected: TypeScript exits 0 with no diagnostics.

Run: `npm run build`

Expected: production build exits 0. The existing bundle-size advisory is acceptable; new warnings or errors are not.

- [ ] **Step 3: Perform browser acceptance checks**

Use the local Vite app and verify each scenario:

1. Seed storage with fourteen Moments, earn the fifteenth, and confirm the final toast fully clears before celebration starts.
2. Confirm powers dim and cannot arm during the active fourteen seconds while orbit, pan, and zoom work continuously.
3. Confirm three firework waves occur from 4–12 seconds and the larger finale occurs from 12–14 seconds.
4. Open the Journal afterward: `15 of 15 moments` remains unchanged and **Celebrate Again** appears separately below the grid.
5. Replay from the button repeatedly and confirm no duplicate villagers, launch tubes, particles, sounds, listeners, or disabled controls accumulate.
6. Earn or request the reward during dangerous fire and confirm it remains queued while Rain and camera controls stay available; confirm it starts after fire and power aftermath end.
7. Verify doused, scattered, cratered, pond-obstructed, one-villager, full-village, and mercy-repopulated island states.
8. During an active celebration, open and close Journal and Settings; confirm their existing camera locks compose correctly and do not release the celebration power lock.
9. Trigger Replay Intro from Settings during a queued and active celebration; confirm clean cancellation and normal gameplay restoration after the intro.
10. Repeat in Enhanced, Reduced, reduced-motion, sound-off, and auto-rotate-off configurations. Reduced motion must keep fourteen-second timing without hops or shake.
11. Check the browser console throughout; no warning, error, disposed-resource use, or Web Audio exception is acceptable.

- [ ] **Step 4: Check diff hygiene and protected project state**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only files from this feature and the already-approved design/plan are changed or untracked. `STATUS.md` must not appear. Do not commit unless the user explicitly requests it.

---

### Task 10: Unsafe Campfire Relocation and Journal Breathing Room

**Files:**

- Modify: `src/celebration/slots.ts`
- Modify: `src/celebration/slots.test.ts`
- Modify: `src/world/world.ts`
- Modify: `src/world/world.test.ts`
- Modify: `src/celebration/director.ts`
- Modify: `src/celebration/director.test.ts`
- Modify: `src/styles.css`
- Modify: `docs/architecture.md`

**Interfaces:**

- Produces: `CelebrationSite`, `findCelebrationSite()`, and `World.celebrationSite()` as the single source of truth for the frozen launcher centre and villager assignments.
- Preserves: the fourteen-second clock, nullable per-villager fallback, replay path, persistent world state, and existing Journal content.

- [ ] **Step 1: Add failing pure and world-backed site-selection tests**

Cover a preferred valid campfire, a scattered campfire in dry crater ground, a
submerged old footprint, a site/building-stage rebuild, a missing campfire,
obstructed rings, deterministic selection, and a best-dry-point fallback. Assert
that the returned centre and every non-null slot pass the world safety predicate.

- [ ] **Step 2: Run the focused tests and confirm the old anchor policy fails**

Run: `npx vitest run src/celebration/slots.test.ts src/world/world.test.ts src/celebration/director.test.ts`

Expected: FAIL because `World.celebrationSite()` and the shared-site contract do
not exist and the director still reads campfire coordinates independently.

- [ ] **Step 3: Implement one deterministic shared-site resolver**

Use stable radial candidates around the preferred old-footprint and village
anchors. Reject water, crater bowls, excessive slope, props, and reserved build
sites; score remaining candidates by the number of valid separated viewing
slots. Allow only `lit` and `doused` campfires to bypass fallback search, and only
when their launcher footprint is valid. Return the chosen centre and slots as one
value, without mutating terrain, props, reservations, or campfire state.

- [ ] **Step 4: Make the director consume and freeze that one result**

Replace separate `campfire` and `celebrationSlots()` reads with a single
`world.celebrationSite(living.length)` call inside `begin()`. Sample launcher
height from its returned centre, pass the same centre to every villager, and keep
it unchanged until completion or cancellation.

- [ ] **Step 5: Move the Journal reward group upward**

Raise both `.journal-celebrate` and the complete-state `.journal-hint` by 12px on
desktop. Apply an equivalent compact-layout inset so the button gains bottom
breathing room without colliding with the hint or moment grid.

- [ ] **Step 6: Update architecture and verify automatically and in cmux**

Run focused tests, `npm test`, `npm run lint`, `npm run build`, and
`git diff --check`. In cmux, reproduce Meteor followed by Rain over the old
campfire, replay the celebration, verify the launcher and villagers relocate to
dry ground, inspect Journal spacing at desktop and compact window sizes, and keep
the browser console free of errors.

---

### Task 11: Interruptible Pre-launch Camera Suggestion

**Files:**

- Modify: `src/camera/policy.ts`
- Modify: `src/camera/policy.test.ts`
- Modify: `src/camera/controller.ts`
- Modify: `src/camera/controller.test.ts`
- Modify: `src/celebration/director.ts`
- Modify: `src/celebration/director.test.ts`
- Modify: `src/main.ts`
- Modify: `docs/architecture.md`

**Interfaces:**

- Produces: `celebrationCameraPose(current, centre)`, `CameraController.userInteractionRevision`, `CameraController.suggestPose(pose, sinceRevision)`, and `CelebrationDirectorOptions.onCameraSuggestion(centre)`.
- Preserves: enabled OrbitControls, the existing `celebration` auto-motion suppression, camera policy limits, the fourteen-second sequence, and immediate user cancellation.

- [ ] **Step 1: Write failing pose, controller, and cue tests**

```ts
it('frames the launcher while preserving horizontal viewing direction', () => {
  const pose = celebrationCameraPose(
    { position: { x: 10, y: 8, z: 0 }, target: { x: 0, y: 0, z: 0 } },
    { x: 3, z: 4 },
  )
  expect(pose.target).toEqual({ x: 3, y: 0, z: 4 })
  expect(pose.position).toMatchObject({ y: 20, z: 4 })
  expect(Math.hypot(
    pose.position.x - pose.target.x,
    pose.position.y - pose.target.y,
    pose.position.z - pose.target.z,
  )).toBeCloseTo(CAMERA_LIMITS.maxDistance)
})

it('skips a suggestion after prior input and cancels one on new input', () => {
  const revision = subject.userInteractionRevision
  expect(subject.suggestPose(suggested, revision)).toBe(true)
  controls.emit('start')
  subject.update(1)
  expect(camera.position.toArray()).toEqual(startPosition)
  expect(subject.suggestPose(suggested, revision)).toBe(false)
})

it('suggests the frozen launcher view once during pre-launch gathering', () => {
  subject.request()
  subject.update(0)
  subject.update(2.9)
  expect(options.onCameraSuggestion).not.toHaveBeenCalled()
  subject.update(0.1)
  expect(options.onCameraSuggestion).toHaveBeenCalledOnce()
  expect(options.onCameraSuggestion).toHaveBeenCalledWith({ x: 0, z: 0 })
})
```

- [ ] **Step 2: Run the focused tests and confirm the missing-interface failures**

Run: `npx vitest run src/camera/policy.test.ts src/camera/controller.test.ts src/celebration/director.test.ts`

Expected: FAIL because the pose helper, interaction revision, suggested tween,
and director cue do not exist.

- [ ] **Step 3: Add the pure launcher-relative camera pose**

```ts
export const CELEBRATION_CAMERA = {
  distance: CAMERA_LIMITS.maxDistance,
  height: 20,
  seconds: 0.8,
  suggestAt: 3,
} as const

export function celebrationCameraPose(
  current: CameraPose,
  centre: { x: number; z: number },
): CameraPose {
  const target = clampCameraTarget({ x: centre.x, y: 0, z: centre.z })
  const dx = current.position.x - current.target.x
  const dz = current.position.z - current.target.z
  const length = Math.hypot(dx, dz)
  const direction = length > 1e-6 ? { x: dx / length, z: dz / length } : { x: 0, z: 1 }
  const horizontalDistance = Math.sqrt(Math.max(
    0,
    CELEBRATION_CAMERA.distance ** 2 - CELEBRATION_CAMERA.height ** 2,
  ))
  return {
    position: {
      x: target.x + direction.x * horizontalDistance,
      y: CELEBRATION_CAMERA.height,
      z: target.z + direction.z * horizontalDistance,
    },
    target,
  }
}
```

- [ ] **Step 4: Add an input-revision-gated suggested tween**

Extend `CameraTween.kind` with `'suggestion'`, increment the revision from
`handleControlsStart` and `reset()`, and add:

```ts
get userInteractionRevision(): number { return this.interactionRevision }

suggestPose(pose: CameraPose, sinceRevision: number): boolean {
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
    seconds: CELEBRATION_CAMERA.seconds,
  }
  return true
}
```

Keep `handleControlsStart` cancelling every tween. When reduced motion becomes
active, cancel a suggestion without snapping; preserve the existing exact snap
for Reset Camera only.

- [ ] **Step 5: Emit one pre-launch cue from the frozen celebration centre**

Add `onCameraSuggestion(centre: CelebrationPoint): void` to the director options,
store the active centre, and after processing clock signals call:

```ts
const reachedSuggestion = (
  this.clock.phase === 'gathering'
  && this.clock.phaseElapsed >= CELEBRATION_CAMERA.suggestAt
) || (
  this.clock.phase === 'fireworks'
  && signals.includes('fireworks')
)
if (this.clock.active && !this.cameraSuggested && this.centre && reachedSuggestion) {
  this.cameraSuggested = true
  this.options.onCameraSuggestion(this.centre)
}
```

Clear the stored centre and one-shot flag from the shared release path.

- [ ] **Step 6: Wire the interaction snapshot and dynamic pose in `src/main.ts`**

```ts
let celebrationCameraRevision = 0

onActiveChange: active => {
  if (active) {
    celebrationCameraRevision = cameraController.userInteractionRevision
    targeting.cancel(false)
    cameraController.suppressAutoMotion('celebration')
  } else {
    cameraController.releaseAutoMotion('celebration')
  }
  for (const power of powerIds) tray.setEnabled(power, !active)
},
onCameraSuggestion: centre => {
  cameraController.suggestPose(
    celebrationCameraPose(cameraController.pose(), centre),
    celebrationCameraRevision,
  )
},
```

- [ ] **Step 7: Verify automatically and with cmux manual interruption**

Run the focused tests, `npm test`, `npm run lint`, `npm run build`, and
`git diff --check`. In cmux, replay from a relocated launcher, confirm the camera
eases toward it before launch, confirm controls stay enabled, then start another
replay and orbit during gathering so the suggestion is skipped. Check reduced
motion and browser diagnostics.

---

## Execution Notes

- Apply tasks in order because later task interfaces deliberately depend on earlier exact names.
- Use test-first loops inside every task; do not batch all tests at the end.
- Keep `src/main.ts` as composition only. Timing, safety, slot search, visual ownership, and villager performance belong in their dedicated boundaries.
- Do not broaden the task into credits, a forced camera, new achievements, imported assets, persistence, or unrelated villager/app-flow refactoring.

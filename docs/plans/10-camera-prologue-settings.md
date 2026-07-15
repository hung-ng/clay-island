# Camera, Prologue, and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not dispatch subagents unless the user explicitly authorizes delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Clay Island's golden-hour diorama look while adding sharp close views, a constrained exploratory camera, an eleven-second causal construction prologue, and a compact Settings panel with safe replay.

**Architecture:** Generate the fresh gameplay world and a temporary prologue set from one pure deterministic blueprint. Render them beneath one shared stage root and swap visibility on an exact held handoff frame while gameplay is frozen. A reason-locked camera controller, startup preferences, pure app-flow reducer, and isolated prologue director keep camera input, replay, rendering quality, and simulation lifecycle independent.

**Tech Stack:** TypeScript 6, Three.js 0.185 `OrbitControls`, `postprocessing` 6.39, Vite 8, Vitest 4, DOM/CSS UI, Web Audio.

**Design spec:** `docs/superpowers/specs/2026-07-14-camera-prologue-settings-design.md`

## Global Constraints

- Every normal load shows **CLAY ISLAND / BEGIN** and the eleven-second canonical prologue.
- Only the first-ever completed viewing is unskippable; returning-load and Settings-replay viewings expose Skip.
- Do not persist island simulation state. Preserve only Moments, sound, quality, auto-rotate, and intro-seen preferences.
- The normal-load final prologue frame and frozen gameplay frame must share blueprint data, camera pose, stage transform, visible entity transforms, poses, and campfire state.
- Gameplay simulation, powers, targeting, fire, villagers, and world visual updates advance only during `gameplay` phase.
- Use one renderer, one canvas, one sky/light rig, one post stack, and one shared stage root. Never create a second WebGL context.
- Model motion stays quantized at 12fps. Camera and DOM UI remain smooth except under reduced motion.
- Enhanced mode uses DPR cap 1.5, shadow radius 4, grain opacity 0.10, and distance-adaptive tilt-shift capped at 0.35. Reduced mode uses DPR 1, no composer, no map shadows, and existing blob shadows.
- `?lowfx=1` remains a forced diagnostic override and wins over stored quality.
- Direct camera movement remains available under reduced motion; auto-rotate and animated recentering do not.
- No new runtime or test dependencies.
- Update `docs/architecture.md` with implementation changes. Do not edit `STATUS.md` unless the user explicitly requests the wrap flow.
- Do not run `git commit` unless the user explicitly requests it. Each task ends with a diff checkpoint and a suggested commit message only.

## File map

**Create**

- `src/core/preferences.ts` — guarded persisted visual quality, auto-rotate, and intro-seen preferences.
- `src/core/preferences.test.ts` — storage parsing, failures, forced-low-FX, and write semantics.
- `src/core/appFlow.ts` — pure title/prologue/gameplay/replay state reducer with generation tokens.
- `src/core/appFlow.test.ts` — first, returning, replay, skip, invalid-event, and generation coverage.
- `src/world/blueprint.ts` — pure deterministic initial placements, per-entity seeds, final states, and handoff metadata.
- `src/world/blueprint.test.ts` — counts, clearances, determinism, bounds, and unique-seed coverage.
- `src/world/initial.ts` — constructs the real `Island` and `World` from an `InitialWorldBlueprint`.
- `src/world/initial.test.ts` — verifies constructed ids, states, transforms, and seeds.
- `src/camera/policy.ts` — pure camera clamps, dynamic polar limit, easing, and home constants.
- `src/camera/policy.test.ts` — boundary and interpolation coverage.
- `src/camera/controller.ts` — `OrbitControls` ownership, reason locks, reset, recenter, and input lifecycle.
- `src/camera/controller.test.ts` — fake-controls tests for locks, reset, recenter, and user interruption.
- `src/fx/quality.ts` — distance-adaptive tilt/grain controller.
- `src/fx/quality.test.ts` — exact tilt opacity and reduced-mode behavior.
- `src/villagers/model.ts` — shared side-effect-free villager mesh and pose rig.
- `src/villagers/model.test.ts` — deterministic mesh/pose and reset coverage.
- `src/prologue/choreography.ts` — pure eleven-second state, actor role, cue, and camera timeline.
- `src/prologue/choreography.test.ts` — beat boundaries, causal construction, camera endpoint, and cue crossing.
- `src/prologue/actor.ts` — authored villager actor using `VillagerModel`, with no `World` or event bus.
- `src/prologue/prologue.ts` — temporary set construction, timeline application, exact final seek, and disposal.
- `src/prologue/prologue.test.ts` — prologue/gameplay final-state parity and idempotent cleanup.
- `src/prologue/audit.ts` — framebuffer comparison for the development handoff audit.
- `src/prologue/audit.test.ts` — threshold and ember-mask comparison coverage.
- `src/ui/title.ts` — semantic title plaque, Begin, Skip, and opaque replay cover.
- `src/ui/settings.ts` — accessible gear dialog, preferences, confirmation, and actions.

**Modify**

- `src/main.ts` — compose preferences, blueprint, shared stage, app flow, prologue, settings, and phase-gated loop.
- `src/scene.ts` — accept startup quality, expose shared stage root, remove camera policy, and expose adaptive effects.
- `src/intro.ts` — delete after the new prologue lifecycle is connected.
- `src/powers/drag.ts` and `src/powers/drag.test.ts` — report targeting active state for camera locks.
- `src/world/world.ts` — remove initial scatter construction; keep runtime world behavior.
- `src/world/island.ts` — name roots consistently for handoff capture; retain existing geometry authority.
- `src/world/objects.ts` and `src/world/objects.test.ts` — add explicit prologue presentation setters without changing gameplay transitions.
- `src/villagers/villager.ts` and `src/villagers/villager.test.ts` — consume `VillagerModel` and split visual/behavior seeds.
- `src/ui/tray.ts` and `src/ui/tray.test.ts` — remove Sound from the gameplay tray.
- `src/ui/journal.ts` — expose modal-open state changes for camera and Settings coordination.
- `src/audio/sfx.ts` — synthesize direct prologue cues without gameplay bus events.
- `src/styles.css` — title, skip, gear, Settings dialog/bottom sheet, tray simplification, and reduced-motion styles.
- `docs/architecture.md` — document every new class, persisted key, lifecycle, and shared-stage pattern.

---

### Task 1: Guarded startup preferences

**Files:**
- Create: `src/core/preferences.ts`
- Create: `src/core/preferences.test.ts`

**Interfaces:**
- Produces: `VisualQuality`, `PreferenceStorage`, `PreferencesSnapshot`, and `Preferences`.
- `Preferences.snapshot` returns `{ quality, lowFx, forcedLowFx, autoRotate, introSeen }`.
- `setQuality()` returns whether the value was durably stored; callers must not reload after `false`.

- [ ] **Step 1: Write the failing preference tests**

```ts
import { describe, expect, it } from 'vitest'
import { Preferences, type PreferenceStorage } from './preferences'

class MemoryStorage implements PreferenceStorage {
  values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('Preferences', () => {
  it('uses safe defaults for absent and corrupt values', () => {
    const storage = new MemoryStorage()
    storage.values.set('clayisland.visualQuality', 'ultra')
    storage.values.set('clayisland.autoRotate', 'perhaps')
    storage.values.set('clayisland.introSeen', '1')
    expect(new Preferences(storage, '').snapshot).toEqual({
      quality: 'enhanced', lowFx: false, forcedLowFx: false,
      autoRotate: true, introSeen: false,
    })
  })

  it('lets the lowfx query force and lock reduced quality', () => {
    const storage = new MemoryStorage()
    storage.values.set('clayisland.visualQuality', 'enhanced')
    const preferences = new Preferences(storage, '?lowfx=1')
    expect(preferences.snapshot).toMatchObject({
      quality: 'reduced', lowFx: true, forcedLowFx: true,
    })
    expect(preferences.setQuality('enhanced')).toBe(false)
  })

  it('persists quality and updates session preferences', () => {
    const storage = new MemoryStorage()
    const preferences = new Preferences(storage, '')
    expect(preferences.setQuality('reduced')).toBe(true)
    preferences.setAutoRotate(false)
    preferences.markIntroSeen()
    expect(new Preferences(storage, '').snapshot).toMatchObject({
      quality: 'reduced', lowFx: true, autoRotate: false, introSeen: true,
    })
  })

  it('keeps session-only values but reports a failed durable quality write', () => {
    const storage: PreferenceStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('blocked') },
    }
    const preferences = new Preferences(storage, '')
    expect(preferences.setQuality('reduced')).toBe(false)
    preferences.setAutoRotate(false)
    preferences.markIntroSeen()
    expect(preferences.snapshot).toMatchObject({ autoRotate: false, introSeen: true })
  })
})
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `npx vitest run src/core/preferences.test.ts`

Expected: FAIL because `./preferences` does not exist.

- [ ] **Step 3: Implement the guarded store**

```ts
export type VisualQuality = 'enhanced' | 'reduced'
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

export type PreferencesSnapshot = {
  quality: VisualQuality
  lowFx: boolean
  forcedLowFx: boolean
  autoRotate: boolean
  introSeen: boolean
}

const QUALITY_KEY = 'clayisland.visualQuality'
const ROTATE_KEY = 'clayisland.autoRotate'
const INTRO_KEY = 'clayisland.introSeen'

function read(storage: PreferenceStorage | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null } catch { return null }
}

export class Preferences {
  private qualityValue: VisualQuality
  private autoRotateValue: boolean
  private introSeenValue: boolean
  private readonly forced: boolean

  constructor(private readonly storage: PreferenceStorage | null, search: string) {
    this.forced = new URLSearchParams(search).get('lowfx') === '1'
    const quality = read(storage, QUALITY_KEY)
    this.qualityValue = quality === 'reduced' ? 'reduced' : 'enhanced'
    this.autoRotateValue = read(storage, ROTATE_KEY) !== 'false'
    this.introSeenValue = read(storage, INTRO_KEY) === 'true'
  }

  get snapshot(): PreferencesSnapshot {
    const quality = this.forced ? 'reduced' : this.qualityValue
    return {
      quality,
      lowFx: quality === 'reduced',
      forcedLowFx: this.forced,
      autoRotate: this.autoRotateValue,
      introSeen: this.introSeenValue,
    }
  }

  setQuality(quality: VisualQuality): boolean {
    if (this.forced) return false
    try {
      this.storage?.setItem(QUALITY_KEY, quality)
      if (!this.storage) return false
      this.qualityValue = quality
      return true
    } catch { return false }
  }

  setAutoRotate(on: boolean): void {
    this.autoRotateValue = on
    try { this.storage?.setItem(ROTATE_KEY, String(on)) } catch { /* session-only */ }
  }

  markIntroSeen(): void {
    this.introSeenValue = true
    try { this.storage?.setItem(INTRO_KEY, 'true') } catch { /* session-only */ }
  }
}
```

- [ ] **Step 4: Run the focused and core test suites**

Run: `npx vitest run src/core/preferences.test.ts src/core/core.test.ts`

Expected: PASS.

- [ ] **Step 5: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; the task adds only the two preference files beyond the already approved design and plan documents. Suggested commit message if explicitly requested: `feat: add guarded startup preferences`.

---

### Task 2: Pure app-flow reducer

**Files:**
- Create: `src/core/appFlow.ts`
- Create: `src/core/appFlow.test.ts`

**Interfaces:**
- Consumes: `introSeen` from `Preferences.snapshot`.
- Produces: `AppFlowState`, `AppFlowEvent`, `initialAppFlow()`, `transitionAppFlow()`, `canSkipPrologue()`, and `simulatesGameplay()`.
- Every real transition increments `generation`; ignored invalid events preserve object identity and generation.

- [ ] **Step 1: Write first/returning/replay transition tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  canSkipPrologue, initialAppFlow, simulatesGameplay, transitionAppFlow,
} from './appFlow'

describe('app flow', () => {
  it('makes the first normal prologue mandatory', () => {
    const title = initialAppFlow(false)
    const prologue = transitionAppFlow(title, { type: 'begin' })
    expect(prologue).toMatchObject({ phase: 'prologue', mode: 'first', generation: 1 })
    expect(canSkipPrologue(prologue)).toBe(false)
    expect(transitionAppFlow(prologue, { type: 'finishPrologue' }).phase).toBe('gameplay')
  })

  it('authorizes returning and replay prologues, but not first view, for transport skip', () => {
    const prologue = transitionAppFlow(initialAppFlow(true), { type: 'begin' })
    expect(canSkipPrologue(prologue)).toBe(true)
    const first = transitionAppFlow(initialAppFlow(false), { type: 'begin' })
    expect(canSkipPrologue(first)).toBe(false)
  })

  it('covers both sides of replay and returns to gameplay', () => {
    const normal = transitionAppFlow(
      transitionAppFlow(initialAppFlow(true), { type: 'begin' }),
      { type: 'finishPrologue' },
    )
    const coverIn = transitionAppFlow(normal, { type: 'requestReplay' })
    expect(coverIn).toMatchObject({ phase: 'replay-transition', destination: 'prologue' })
    const replay = transitionAppFlow(coverIn, { type: 'coverReady' })
    expect(replay).toMatchObject({ phase: 'prologue', mode: 'replay' })
    expect(canSkipPrologue(replay)).toBe(true)
    const coverOut = transitionAppFlow(replay, { type: 'finishPrologue' })
    expect(coverOut).toMatchObject({ phase: 'replay-transition', destination: 'gameplay' })
    expect(transitionAppFlow(coverOut, { type: 'coverReady' }).phase).toBe('gameplay')
  })

  it('ignores stale or illegal events without advancing generation', () => {
    const state = initialAppFlow(false)
    expect(transitionAppFlow(state, { type: 'requestReplay' })).toBe(state)
    expect(transitionAppFlow(state, { type: 'finishPrologue' })).toBe(state)
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/core/appFlow.test.ts`

Expected: FAIL because `./appFlow` does not exist.

- [ ] **Step 3: Implement the discriminated reducer**

```ts
export type PrologueMode = 'first' | 'returning' | 'replay'
export type AppFlowState =
  | { phase: 'title'; mode: Exclude<PrologueMode, 'replay'>; generation: number }
  | { phase: 'prologue'; mode: PrologueMode; generation: number }
  | { phase: 'gameplay'; generation: number }
  | {
      phase: 'replay-transition'
      mode: 'replay'
      destination: 'prologue' | 'gameplay'
      generation: number
    }

export type AppFlowEvent =
  | { type: 'begin' }
  | { type: 'finishPrologue' }
  | { type: 'requestReplay' }
  | { type: 'coverReady' }

export function initialAppFlow(introSeen: boolean): AppFlowState {
  return { phase: 'title', mode: introSeen ? 'returning' : 'first', generation: 0 }
}

export function canSkipPrologue(state: AppFlowState): boolean {
  return state.phase === 'prologue' && state.mode !== 'first'
}

export function simulatesGameplay(state: AppFlowState): boolean {
  return state.phase === 'gameplay'
}

export function transitionAppFlow(state: AppFlowState, event: AppFlowEvent): AppFlowState {
  const generation = state.generation + 1
  if (state.phase === 'title' && event.type === 'begin') {
    return { phase: 'prologue', mode: state.mode, generation }
  }
  if (state.phase === 'gameplay' && event.type === 'requestReplay') {
    return { phase: 'replay-transition', mode: 'replay', destination: 'prologue', generation }
  }
  if (state.phase === 'replay-transition' && event.type === 'coverReady') {
    return state.destination === 'prologue'
      ? { phase: 'prologue', mode: 'replay', generation }
      : { phase: 'gameplay', generation }
  }
  if (state.phase === 'prologue' && event.type === 'finishPrologue') {
    return state.mode === 'replay'
      ? { phase: 'replay-transition', mode: 'replay', destination: 'gameplay', generation }
      : { phase: 'gameplay', generation }
  }
  return state
}
```

Skip is deliberately not an `AppFlowEvent`: it is a transport action on `PrologueDirector`, authorized by `canSkipPrologue()`. It seeks to the canonical final frame and calls the normal finish callback. App flow changes only after the protected normal-load held-frame swap or after the replay cover is active, so simulation cannot resume early.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run src/core/appFlow.test.ts`

Expected: PASS.

- [ ] **Step 5: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Suggested commit message if explicitly requested: `feat: define app lifecycle state machine`.

---

### Task 3: Deterministic initial-world blueprint

**Files:**
- Create: `src/world/blueprint.ts`
- Create: `src/world/blueprint.test.ts`
- Modify: `src/world/scatter.ts:1-50`

**Interfaces:**
- Consumes: existing pure `placeSites(rng)` placement policy.
- Produces: `InitialWorldBlueprint`, `InitialPropSpec`, `InitialVillagerSpec`, `createInitialWorldBlueprint(seed = 7)`, `INITIAL_HANDOFF_FRAME`.
- Blueprint values contain no Three.js objects and never expose a mutable `RNG`.

- [ ] **Step 1: Write blueprint invariants**

```ts
import { describe, expect, it } from 'vitest'
import { createInitialWorldBlueprint, INITIAL_HANDOFF_FRAME } from './blueprint'

describe('initial world blueprint', () => {
  const blueprint = createInitialWorldBlueprint(7)

  it('contains the canonical starting population and props', () => {
    expect(blueprint.props.filter(item => item.kind === 'tree')).toHaveLength(12)
    expect(blueprint.props.filter(item => item.kind === 'hut' && item.state === 'built')).toHaveLength(2)
    expect(blueprint.props.filter(item => item.kind === 'hut' && item.state === 'site')).toHaveLength(1)
    expect(blueprint.props.filter(item => item.kind === 'campfire')).toHaveLength(1)
    expect(blueprint.villagers).toHaveLength(6)
    expect(blueprint.handoffFrame).toBe(INITIAL_HANDOFF_FRAME)
    expect(INITIAL_HANDOFF_FRAME).toBe(132)
  })

  it('is deeply deterministic and uses unique visual seeds', () => {
    expect(createInitialWorldBlueprint(7)).toEqual(createInitialWorldBlueprint(7))
    expect(createInitialWorldBlueprint(8)).not.toEqual(blueprint)
    const seeds = [
      ...blueprint.props.map(item => item.visualSeed),
      ...blueprint.villagers.map(item => item.visualSeed),
    ]
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('keeps props and villagers in their accepted discs and clear of one another', () => {
    for (const prop of blueprint.props) expect(Math.hypot(prop.x, prop.z)).toBeLessThan(12)
    for (const villager of blueprint.villagers) {
      expect(Math.hypot(villager.x, villager.z)).toBeLessThanOrEqual(12)
      for (const prop of blueprint.props) {
        expect(Math.hypot(villager.x - prop.x, villager.z - prop.z)).toBeGreaterThanOrEqual(1.6)
      }
    }
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/world/blueprint.test.ts`

Expected: FAIL because `./blueprint` does not exist.

- [ ] **Step 3: Export placement clearance and implement blueprint generation**

Change `src/world/scatter.ts` to export `CLEARANCE` and `fitsPlacement`, retaining the existing `placeSites()` output. Then create `src/world/blueprint.ts` with these public shapes and the existing rejection policy:

```ts
import { RNG } from '../core/rng'
import { placeSites, type Placement } from './scatter'

export const INITIAL_HANDOFF_FRAME = 11 * 12

export type InitialPropSpec =
  | { id: string; kind: 'tree'; state: 'normal'; x: number; z: number; visualSeed: number }
  | { id: string; kind: 'hut'; state: 'built' | 'site'; x: number; z: number; visualSeed: number }
  | { id: 'campfire'; kind: 'campfire'; state: 'lit'; x: number; z: number; visualSeed: number }

export type InitialVillagerSpec = {
  id: string
  x: number
  z: number
  facing: number
  visualSeed: number
  behaviorSeed: number
}

export type InitialWorldBlueprint = {
  seed: number
  islandSeed: number
  stageRotationY: 0
  handoffFrame: number
  props: InitialPropSpec[]
  villagers: InitialVillagerSpec[]
}

function derivedSeed(seed: number, label: string, index: number): number {
  let value = (seed ^ 0x811c9dc5 ^ index) >>> 0
  for (const character of label) {
    value ^= character.charCodeAt(0)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value || 1
}

function propSpecs(seed: number, placements: Placement[]): InitialPropSpec[] {
  let tree = 0
  let hut = 0
  return placements.map((placement, index) => {
    const visualSeed = derivedSeed(seed, 'prop', index)
    if (placement.kind === 'tree') {
      return { id: `tree-${tree++}`, kind: 'tree', state: 'normal', ...placement, visualSeed }
    }
    if (placement.kind === 'hut' || placement.kind === 'site') {
      return {
        id: `hut-${hut++}`, kind: 'hut',
        state: placement.kind === 'site' ? 'site' : 'built',
        x: placement.x, z: placement.z, visualSeed,
      }
    }
    return { id: 'campfire', kind: 'campfire', state: 'lit', ...placement, visualSeed }
  })
}

export function createInitialWorldBlueprint(seed = 7): InitialWorldBlueprint {
  const placements = placeSites(new RNG(seed))
  const props = propSpecs(seed, placements)
  const villagers: InitialVillagerSpec[] = []
  const layout = new RNG(derivedSeed(seed, 'villager-layout', 0))
  for (let index = 0; index < 6; index++) {
    let point = { x: 0, z: 0 }
    for (let attempt = 0; attempt < 300; attempt++) {
      const angle = layout.range(0, Math.PI * 2)
      const radius = layout.range(2.2, 9.8)
      const candidate = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
      const propsClear = props.every(prop => Math.hypot(candidate.x - prop.x, candidate.z - prop.z) >= 1.6)
      const peopleClear = villagers.every(person => Math.hypot(candidate.x - person.x, candidate.z - person.z) >= 0.75)
      if (propsClear && peopleClear) { point = candidate; break }
    }
    villagers.push({
      id: `villager-${index}`,
      ...point,
      facing: Math.atan2(-point.x, -point.z),
      visualSeed: derivedSeed(seed, 'villager-visual', index),
      behaviorSeed: derivedSeed(seed, 'villager-behavior', index),
    })
  }
  return {
    seed, islandSeed: derivedSeed(seed, 'island', 0), stageRotationY: 0,
    handoffFrame: INITIAL_HANDOFF_FRAME, props, villagers,
  }
}
```

Do not import `three`, `Island`, `World`, or visual classes into this module.

- [ ] **Step 4: Run blueprint and scatter tests**

Run: `npx vitest run src/world/blueprint.test.ts src/world/scatter.test.ts`

Expected: PASS with the original placement tests unchanged.

- [ ] **Step 5: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Suggested commit message if explicitly requested: `feat: define canonical initial world blueprint`.

---

### Task 4: Build gameplay from the blueprint

**Files:**
- Create: `src/world/initial.ts`
- Create: `src/world/initial.test.ts`
- Modify: `src/main.ts:27-34`
- Modify: `src/world/world.ts:1-10,893-922`

**Interfaces:**
- Consumes: `InitialWorldBlueprint` from Task 3.
- Produces: `GameplayWorldSet = { island: Island; world: World }` and `buildInitialWorld(blueprint, lowFx)`.
- Retains: `spawnVillagers()` for later repopulation; only the initial six stop using its random-placement branch.

- [ ] **Step 1: Write construction parity tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createInitialWorldBlueprint } from './blueprint'
import { buildInitialWorld } from './initial'

vi.mock('../fx/clayMaterial', async () => {
  const THREE = await import('three')
  return { clayMaterial: vi.fn(() => new THREE.MeshToonMaterial()) }
})

describe('buildInitialWorld', () => {
  it('constructs the blueprint ids, states, and transforms', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const { island, world } = buildInitialWorld(blueprint, false)
    expect(world.trees.map(tree => tree.id)).toEqual(
      blueprint.props.filter(item => item.kind === 'tree').map(item => item.id),
    )
    expect(world.huts.map(hut => [hut.id, hut.state])).toEqual(
      blueprint.props.filter(item => item.kind === 'hut').map(item => [item.id, item.state]),
    )
    expect(world.campfire.state).toBe('lit')
    expect(world.villagers.map(person => person.id)).toEqual(blueprint.villagers.map(item => item.id))
    expect(island.group.getObjectByName('villager-0')).toBe(world.villagers[0].group)
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/world/initial.test.ts`

Expected: FAIL because `./initial` does not exist.

- [ ] **Step 3: Implement the initial builder**

```ts
import { RNG } from '../core/rng'
import { Villager } from '../villagers/villager'
import type { InitialWorldBlueprint } from './blueprint'
import { Island } from './island'
import { Campfire, Hut, Tree } from './objects'
import { World } from './world'

export type GameplayWorldSet = { island: Island; world: World }

export function buildInitialWorld(
  blueprint: InitialWorldBlueprint,
  lowFx: boolean,
): GameplayWorldSet {
  const island = new Island(new RNG(blueprint.islandSeed))
  island.group.name = 'gameplay-island'
  const world = new World(island)

  for (const spec of blueprint.props) {
    const y = island.sampleHeight(spec.x, spec.z)
    if (spec.kind === 'tree') {
      const tree = new Tree(spec.id, spec.x, spec.z, y, new RNG(spec.visualSeed), lowFx)
      tree.group.name = spec.id
      world.trees.push(tree)
      island.group.add(tree.group)
    } else if (spec.kind === 'hut') {
      const hut = new Hut(spec.id, spec.x, spec.z, spec.state, y, new RNG(spec.visualSeed), lowFx)
      hut.group.name = spec.id
      world.huts.push(hut)
      island.group.add(hut.group)
    } else {
      const fire = new Campfire(spec.x, spec.z, y, new RNG(spec.visualSeed), lowFx, spec.state)
      fire.group.name = spec.id
      world.campfire = fire
      island.group.add(fire.group)
    }
  }

  for (const spec of blueprint.villagers) {
    const person = new Villager(
      spec.id, spec.x, spec.z, island, new RNG(spec.visualSeed), world, world.bus, lowFx,
    )
    person.group.name = spec.id
    person.group.rotation.y = spec.facing
    world.villagers.push(person)
    island.group.add(person.group)
  }
  return { island, world }
}
```

Remove `scatter()` from `src/world/world.ts`; keep `World` and all runtime mutation paths there. In `src/main.ts`, replace `new Island`, `new World`, `scatter`, and initial `spawnVillagers` with:

```ts
const blueprint = createInitialWorldBlueprint(7)
const { island, world } = buildInitialWorld(blueprint, lowFx)
scene.add(island.group)
floaters.push(island.group)
```

- [ ] **Step 4: Run initial-world and full regression tests**

Run: `npx vitest run src/world/initial.test.ts src/world/world.test.ts src/villagers/villager.test.ts && npm test`

Expected: PASS; test count increases by the new initial-world case.

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0; the existing bundle-size advisory may remain.

- [ ] **Step 6: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and no `STATUS.md` change. Suggested commit message if explicitly requested: `refactor: construct initial world from blueprint`.

---

### Task 5: Constrained diorama camera

**Files:**
- Create: `src/camera/policy.ts`
- Create: `src/camera/policy.test.ts`
- Create: `src/camera/controller.ts`
- Create: `src/camera/controller.test.ts`
- Modify: `src/scene.ts:1-18,90-102,162-205`
- Modify: `src/main.ts:23-34,59-61,73-88,98-107,135-139`
- Modify: `src/intro.ts:6-60` (temporary compatibility; deleted in Task 10)
- Modify: `src/powers/drag.ts:96-169,309-314`
- Modify: `src/powers/drag.test.ts`
- Modify: `src/ui/journal.ts:4-18,114-132`

**Interfaces:**
- Consumes: `Preferences.snapshot.autoRotate`, the scene camera, renderer canvas, and modal/targeting active state.
- Produces: `CAMERA_HOME`, `CAMERA_LIMITS`, `clampCameraTarget()`, `maxPolarAngleAt()`, `CameraController`, `CameraLockReason`, and `CameraPose`.
- `CameraController` owns the only `OrbitControls` instance and exposes `controls` temporarily for the old `Intro`.

- [ ] **Step 1: Write pure camera-policy boundary tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  CAMERA_HOME, CAMERA_LIMITS, clampCameraTarget, maxPolarAngleAt,
} from './policy'

describe('camera policy', () => {
  it('clamps focus to the horizontal 7.5 metre disc and y=0', () => {
    expect(clampCameraTarget({ x: 12, y: 4, z: 0 })).toEqual({ x: 7.5, y: 0, z: 0 })
    expect(clampCameraTarget({ x: 3, y: -2, z: 4 })).toEqual({ x: 3, y: 0, z: 4 })
  })

  it('tightens the low viewing angle only near the island', () => {
    expect(maxPolarAngleAt(15)).toBeCloseTo(1.20)
    expect(maxPolarAngleAt(25)).toBeCloseTo(1.35)
    expect(maxPolarAngleAt(55)).toBeCloseTo(1.35)
  })

  it('keeps exact home and distance acceptance values', () => {
    expect(CAMERA_HOME).toEqual({ position: { x: 0, y: 14, z: 34 }, target: { x: 0, y: 0, z: 0 } })
    expect(CAMERA_LIMITS).toMatchObject({ minDistance: 15, maxDistance: 55, targetRadius: 7.5 })
  })
})
```

- [ ] **Step 2: Run the policy test and verify the missing module failure**

Run: `npx vitest run src/camera/policy.test.ts`

Expected: FAIL because `./policy` does not exist.

- [ ] **Step 3: Implement pure constants and clamps**

```ts
export type Vec3 = { x: number; y: number; z: number }
export type CameraPose = { position: Vec3; target: Vec3 }

export const CAMERA_HOME: CameraPose = {
  position: { x: 0, y: 14, z: 34 },
  target: { x: 0, y: 0, z: 0 },
}

export const CAMERA_LIMITS = {
  minDistance: 15,
  maxDistance: 55,
  targetRadius: 7.5,
  minPolarAngle: 0.6,
  nearMaxPolarAngle: 1.20,
  farMaxPolarAngle: 1.35,
  polarRelaxDistance: 25,
  resetSeconds: 0.7,
  idleSeconds: 8,
  recenterSeconds: 1.2,
} as const

export function clampCameraTarget(target: Vec3): Vec3 {
  const radius = Math.hypot(target.x, target.z)
  const scale = radius > CAMERA_LIMITS.targetRadius ? CAMERA_LIMITS.targetRadius / radius : 1
  return { x: target.x * scale, y: 0, z: target.z * scale }
}

export function maxPolarAngleAt(distance: number): number {
  const span = CAMERA_LIMITS.polarRelaxDistance - CAMERA_LIMITS.minDistance
  const t = Math.max(0, Math.min(1, (distance - CAMERA_LIMITS.minDistance) / span))
  return CAMERA_LIMITS.nearMaxPolarAngle
    + (CAMERA_LIMITS.farMaxPolarAngle - CAMERA_LIMITS.nearMaxPolarAngle) * t
}

export function smooth01(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
```

- [ ] **Step 4: Write controller tests with an injected controls port**

Add tests that use a fake controls object rather than a real DOM:

```ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CameraController, type CameraControlsPort } from './controller'

function fakeControls(): CameraControlsPort & { emit(type: 'start' | 'end'): void } {
  const listeners = { start: new Set<() => void>(), end: new Set<() => void>() }
  return {
    target: new THREE.Vector3(), cursor: new THREE.Vector3(),
    enabled: true, autoRotate: false, autoRotateSpeed: 0,
    enableDamping: false, enablePan: false, screenSpacePanning: true, zoomToCursor: false,
    minDistance: 0, maxDistance: Infinity,
    minTargetRadius: 0, maxTargetRadius: Infinity, touches: {},
    minPolarAngle: 0, maxPolarAngle: Math.PI,
    update: vi.fn(), dispose: vi.fn(),
    addEventListener: (type, listener) => listeners[type].add(listener),
    removeEventListener: (type, listener) => listeners[type].delete(listener),
    emit: type => { for (const listener of listeners[type]) listener() },
  }
}

describe('CameraController', () => {
  it('composes lock reasons without unlocking another owner', () => {
    const controls = fakeControls()
    const subject = new CameraController({
      camera: new THREE.PerspectiveCamera(), dom: new EventTarget() as HTMLElement,
      autoRotate: true, reducedMotion: () => false, controls,
    })
    subject.lock('journal'); subject.lock('settings'); subject.unlock('journal')
    expect(controls.enabled).toBe(false)
    subject.unlock('settings')
    expect(controls.enabled).toBe(true)
  })

  it('reaches exact home after a reset and lets user input cancel the tween', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = fakeControls()
    const subject = new CameraController({
      camera, dom: new EventTarget() as HTMLElement,
      autoRotate: false, reducedMotion: () => false, controls,
    })
    camera.position.set(4, 9, 20); controls.target.set(3, 0, 4)
    subject.reset(); subject.update(0.7)
    expect(camera.position.toArray()).toEqual([0, 14, 34])
    expect(controls.target.toArray()).toEqual([0, 0, 0])
    camera.position.set(4, 9, 20); subject.reset(); controls.emit('start'); subject.update(0.7)
    expect(camera.position.toArray()).toEqual([4, 9, 20])
  })

  it('reduced motion applies reset immediately and never auto-rotates', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = fakeControls()
    const subject = new CameraController({
      camera, dom: new EventTarget() as HTMLElement,
      autoRotate: true, reducedMotion: () => true, controls,
    })
    camera.position.set(1, 2, 3); subject.reset()
    expect(camera.position.toArray()).toEqual([0, 14, 34])
    subject.update(20)
    expect(controls.autoRotate).toBe(false)
  })
})
```

- [ ] **Step 5: Implement `CameraController` around the installed OrbitControls API**

Use the locally installed Three.js properties `zoomToCursor`, `cursor`, `maxTargetRadius`, `touches.TWO = TOUCH.DOLLY_PAN`, and `controls.update(dt)`. The public surface must be:

```ts
export type CameraLockReason = 'prologue' | 'targeting' | 'journal' | 'settings'

export type CameraControlsPort = {
  target: THREE.Vector3
  cursor: THREE.Vector3
  enabled: boolean
  autoRotate: boolean
  autoRotateSpeed: number
  enableDamping: boolean
  enablePan: boolean
  screenSpacePanning: boolean
  zoomToCursor: boolean
  minDistance: number
  maxDistance: number
  minTargetRadius: number
  maxTargetRadius: number
  minPolarAngle: number
  maxPolarAngle: number
  touches: { ONE?: THREE.TOUCH | null; TWO?: THREE.TOUCH | null }
  update(dt?: number): void
  dispose(): void
  addEventListener(type: 'start' | 'end', listener: () => void): void
  removeEventListener(type: 'start' | 'end', listener: () => void): void
}

export type CameraControllerOptions = {
  camera: THREE.PerspectiveCamera
  dom: HTMLElement
  autoRotate: boolean
  reducedMotion: () => boolean
  controls?: CameraControlsPort
}

export class CameraController {
  readonly controls: CameraControlsPort
  lock(reason: CameraLockReason): void
  unlock(reason: CameraLockReason): void
  setAutoRotate(on: boolean): void
  setPose(pose: CameraPose): void
  pose(): CameraPose
  reset(): void
  update(dt: number): void
  distance(): number
  dispose(): void
}
```

Configure production controls exactly as follows:

```ts
controls.enablePan = true
controls.enableDamping = true
controls.zoomToCursor = true
controls.minDistance = CAMERA_LIMITS.minDistance
controls.maxDistance = CAMERA_LIMITS.maxDistance
controls.minPolarAngle = CAMERA_LIMITS.minPolarAngle
controls.maxPolarAngle = CAMERA_LIMITS.farMaxPolarAngle
controls.cursor.set(0, 0, 0)
controls.maxTargetRadius = CAMERA_LIMITS.targetRadius
controls.touches.ONE = THREE.TOUCH.ROTATE
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
controls.autoRotateSpeed = 0.35
```

After each `controls.update(dt)`, clamp the target with `clampCameraTarget`, compute distance from camera to target, and set `controls.maxPolarAngle = maxPolarAngleAt(distance)`. Store reset/recenter start poses and interpolate with `smooth01`. A controls `start` event cancels any tween, disables auto-rotation, and resets idle time; `end` starts the eight-second idle count. Only enable auto-rotation after an off-centre target finishes the 1.2-second recenter. `setAutoRotate(false)` cancels automatic recentering. `lock()` disables controls and auto-rotation; `unlock()` enables them only when the reason set is empty.

Track a right-button pointerdown on the canvas and suppress only the corresponding `contextmenu`; remove those listeners in `dispose()`.

- [ ] **Step 6: Connect camera ownership and active-state callbacks**

In `src/scene.ts`, remove `OrbitControls` construction and auto-rotate timing from `updateSky()`. Return only the camera and rendering bundle. In `src/main.ts`, acquire storage and preferences before scene creation, then construct the controller:

```ts
let storage: Storage | null = null
try { storage = localStorage } catch { /* optional */ }
const preferences = new Preferences(storage, location.search)
const startup = preferences.snapshot
const sceneBundle = createScene({ lowFx: startup.lowFx })
const cameraController = new CameraController({
  camera: sceneBundle.camera,
  dom: sceneBundle.renderer.domElement,
  autoRotate: startup.autoRotate,
  reducedMotion: prefersReducedMotion,
})
```

Add a final optional `onActiveChange(active: boolean)` argument to `DragTargeting`; call it with `true` after arming and `false` from the shared `cancel()` cleanup. Main maps it to the `targeting` lock. Extend `JournalUIOptions` with `onOpenChange?(open: boolean): void`; invoke it from `setOpen()` and map it to the `journal` lock. Pass `cameraController.controls` to the temporary old `Intro` and call `cameraController.update(dt)` where `controls.update()` currently runs.

- [ ] **Step 7: Run focused and full verification**

Run: `npx vitest run src/camera/policy.test.ts src/camera/controller.test.ts src/powers/drag.test.ts && npm test && npx tsc --noEmit && npm run build`

Expected: all commands pass; no camera-policy code remains in `updateSky()`.

- [ ] **Step 8: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Suggested commit message if explicitly requested: `feat: add constrained diorama camera`.

---

### Task 6: Shared stage root and adaptive visual quality

**Files:**
- Create: `src/fx/quality.ts`
- Create: `src/fx/quality.test.ts`
- Modify: `src/scene.ts:67-205`
- Modify: `src/main.ts:25-35,135-141`
- Modify: `src/intro.ts:6-40` (temporary shared-root compatibility)

**Interfaces:**
- Consumes: current camera distance and live reduced-motion result.
- Produces: `tiltOpacityAtDistance()`, `VisualQualityController`, and `SceneBundle.stageRoot`.
- `createScene({ lowFx })` returns `{ scene, stageRoot, camera, renderer, updateSky, quality, composer, lowFx }`.

- [ ] **Step 1: Write exact adaptive-quality tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { tiltOpacityAtDistance, VisualQualityController } from './quality'

describe('adaptive quality', () => {
  it('removes tilt shift close and caps it at the home view', () => {
    expect(tiltOpacityAtDistance(15)).toBe(0)
    expect(tiltOpacityAtDistance(22)).toBe(0)
    expect(tiltOpacityAtDistance(Math.hypot(14, 34))).toBeCloseTo(0.35)
    expect(tiltOpacityAtDistance(55)).toBe(0.35)
  })

  it('writes adaptive tilt and restrained grain without recreating effects', () => {
    const tilt = { blendMode: { opacity: { value: 1 } } }
    const grain = { blendMode: { opacity: { value: 1 } }, seed: 0 }
    const subject = new VisualQualityController(tilt, grain, false)
    subject.update(1 / 12, 20, false)
    expect(tilt.blendMode.opacity.value).toBe(0)
    expect(grain.blendMode.opacity.value).toBe(0.10)
    subject.update(1 / 12, 40, true)
    expect(grain.blendMode.opacity.value).toBe(0.06)
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/fx/quality.test.ts`

Expected: FAIL because `./quality` does not exist.

- [ ] **Step 3: Implement the quality controller**

```ts
import { QuantizedClock } from '../core/loop'
import { TIMING } from '../ui/tokens'

type OpacityEffect = { blendMode: { opacity: { value: number } } }
type GrainEffect = OpacityEffect & { seed: number }
const HOME_DISTANCE = Math.hypot(14, 34)

export function tiltOpacityAtDistance(distance: number): number {
  if (distance <= 22) return 0
  return Math.min(0.35, 0.35 * (distance - 22) / (HOME_DISTANCE - 22))
}

export class VisualQualityController {
  private readonly clock = new QuantizedClock(TIMING.fps)
  constructor(
    private readonly tilt: OpacityEffect | null,
    private readonly grain: GrainEffect | null,
    private readonly lowFx: boolean,
  ) {}
  update(dt: number, distance: number, reducedMotion: boolean): void {
    if (this.lowFx) return
    this.clock.advance(dt)
    if (this.tilt) this.tilt.blendMode.opacity.value = tiltOpacityAtDistance(distance)
    if (!this.grain) return
    this.grain.blendMode.opacity.value = reducedMotion ? 0.06 : 0.10
    if (!reducedMotion && this.clock.ticked) this.grain.seed = this.clock.quantizedTime
  }
}
```

- [ ] **Step 4: Reshape scene construction around one stage root**

In `createScene({ lowFx })`:

```ts
renderer.setPixelRatio(lowFx ? 1 : Math.min(devicePixelRatio, 1.5))
key.shadow.radius = 4
const stageRoot = new THREE.Group()
stageRoot.name = 'island-stage'
scene.add(stageRoot)
```

Keep `TiltShiftEffect({ focusArea: 0.45, feather: 0.35 })`, set its initial blend opacity to `0.35`, set grain to `0.10`, and return one `VisualQualityController`. Replace the `floaters` array with stage-root bobbing:

```ts
stageRoot.position.y = reduced ? 0 : Math.sin(elapsed * 0.15) * 0.3
```

In main, add the gameplay island to `stageRoot`, call `quality.update(dt, cameraController.distance(), prefersReducedMotion())`, and render through the unchanged low-FX/composer branches. The temporary old Intro may rotate `stageRoot`, but it must restore `stageRoot.rotation.y = 0` when it ends so Task 10 starts from a canonical transform.

- [ ] **Step 5: Run focused and full verification**

Run: `npx vitest run src/fx/quality.test.ts && npm test && npx tsc --noEmit && npm run build`

Expected: PASS; enhanced build still reports only the existing bundle-size advisory.

- [ ] **Step 6: Browser-check clarity before proceeding**

Run: `npm run dev`

Check at the home view, a mid zoom, and the minimum zoom. Expected: warm light remains; top/bottom softness is mild at home and absent close; villagers and hut edges are sharper; `?lowfx=1` still bypasses map shadows and the composer.

- [ ] **Step 7: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Suggested commit message if explicitly requested: `feat: sharpen adaptive golden hour rendering`.

---

### Task 7: Shared villager visual rig

**Files:**
- Create: `src/villagers/model.ts`
- Create: `src/villagers/model.test.ts`
- Modify: `src/villagers/villager.ts:1-30,91-294,634-641,1373-1378,1436-1475`
- Modify: `src/villagers/villager.test.ts`
- Modify: `src/world/initial.ts`

**Interfaces:**
- Consumes: `InitialVillagerSpec.visualSeed` and `.behaviorSeed`.
- Produces: `VillagerModel`, `VillagerProloguePose`, and `VillagerOptions`.
- Gameplay `Villager` keeps its existing public behavior; only visual construction and reset move behind the rig.

- [ ] **Step 1: Write deterministic rig and prologue-pose tests**

```ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { VillagerModel } from './model'

vi.mock('../fx/clayMaterial', async () => {
  const THREE = await import('three')
  return { clayMaterial: vi.fn((color: string) => new THREE.MeshToonMaterial({ color })) }
})

function namedTransforms(root: THREE.Object3D): Record<string, number[]> {
  const result: Record<string, number[]> = {}
  root.traverse(object => {
    if (!object.name) return
    result[object.name] = [...object.position.toArray(), ...object.rotation.toArray().slice(0, 3), ...object.scale.toArray()]
  })
  return result
}

describe('VillagerModel', () => {
  it('builds identical named meshes and transforms from one visual seed', () => {
    expect(namedTransforms(new VillagerModel('v', 41, false).group)).toEqual(
      namedTransforms(new VillagerModel('v', 41, false).group),
    )
  })

  it('returns every authored pose to the exact idle pose', () => {
    const subject = new VillagerModel('v', 41, false)
    const idle = namedTransforms(subject.group)
    for (const pose of ['wake', 'carry', 'hammer', 'place', 'kneel'] as const) {
      subject.setProloguePose(pose, 3)
      subject.resetPose()
      expect(namedTransforms(subject.group)).toEqual(idle)
    }
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run src/villagers/model.test.ts`

Expected: FAIL because `./model` does not exist.

- [ ] **Step 3: Extract the rig without changing gameplay geometry**

Create the rig with the current geometry, material, wobble, placement, and shadow values, but give every part a stable name for parity capture:

```ts
export type VillagerProloguePose = 'idle' | 'wake' | 'carry' | 'hammer' | 'place' | 'kneel'
export const MODEL_SCALE = 0.75

export class VillagerModel {
  readonly group = new THREE.Group()
  readonly head: THREE.Mesh
  readonly arms: [THREE.Mesh, THREE.Mesh]
  readonly axe: THREE.Group
  readonly materials: THREE.MeshToonMaterial[] = []
  readonly cleanColors: THREE.Color[] = []

  constructor(id: string, visualSeed: number, lowFx: boolean) {
    const rng = new RNG(visualSeed)
    this.group.name = `${id}-model`
    const smock = rng.pick([PALETTE.smockA, PALETTE.smockB, PALETTE.smockC])
    const body = new THREE.Mesh(
      wobble(new THREE.CapsuleGeometry(0.22, 0.34, 5, 10), rng, 0.035),
      clayMaterial(smock),
    )
    body.name = 'villager-body'
    body.position.y = 0.44
    this.addPart(body, lowFx)

    this.head = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.22, 12, 9), rng, 0.035),
      clayMaterial(PALETTE.skin),
    )
    this.head.name = 'villager-head'
    this.head.position.y = 0.94
    this.head.scale.set(1, 0.96, 0.94)
    this.addPart(this.head, lowFx)

    const arms: THREE.Mesh[] = []
    for (const side of [-1, 1] as const) {
      const arm = new THREE.Mesh(
        wobble(new THREE.CapsuleGeometry(0.065, 0.2, 4, 8), rng, 0.018),
        clayMaterial(PALETTE.skin),
      )
      arm.name = side < 0 ? 'villager-arm-left' : 'villager-arm-right'
      arm.position.set(side * 0.28, 0.51, 0)
      arm.rotation.z = side * -0.28
      arm.userData.baseRotation = arm.rotation.z
      arms.push(arm)
      this.addPart(arm, lowFx)

      const leg = new THREE.Mesh(
        wobble(new THREE.CapsuleGeometry(0.075, 0.13, 4, 8), rng, 0.018),
        clayMaterial(PALETTE.skin),
      )
      leg.name = side < 0 ? 'villager-leg-left' : 'villager-leg-right'
      leg.position.set(side * 0.11, 0.12, 0)
      this.addPart(leg, lowFx)
    }
    this.arms = [arms[0], arms[1]]
    this.group.scale.setScalar(MODEL_SCALE)

    this.axe = new THREE.Group()
    this.axe.name = 'villager-axe'
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.62, 5),
      clayMaterial(PALETTE.bark),
    )
    handle.name = 'villager-axe-handle'
    const axeHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.12, 0.07),
      clayMaterial(PALETTE.stone),
    )
    axeHead.name = 'villager-axe-head'
    axeHead.position.y = 0.3
    handle.castShadow = !lowFx
    axeHead.castShadow = !lowFx
    this.axe.add(handle, axeHead)
    this.axe.position.set(-0.27, 0.62, 0.05)
    this.axe.rotation.z = -0.7
    this.axe.visible = false
    this.group.add(this.axe)
  }

  private addPart(mesh: THREE.Mesh, lowFx: boolean): void {
    mesh.castShadow = !lowFx
    if (mesh.material instanceof THREE.MeshToonMaterial) {
      this.materials.push(mesh.material)
      this.cleanColors.push(mesh.material.color.clone())
    }
    this.group.add(mesh)
  }

  resetPose(): void {
    this.group.scale.setScalar(MODEL_SCALE)
    this.head.rotation.set(0, 0, 0)
    for (const arm of this.arms) arm.rotation.z = arm.userData.baseRotation
    this.axe.rotation.z = -0.7
    this.axe.visible = false
  }

  setProloguePose(pose: VillagerProloguePose, frame: number): void {
    this.resetPose()
    if (pose === 'wake') this.group.scale.y = MODEL_SCALE * (0.72 + Math.min(1, frame / 4) * 0.28)
    if (pose === 'carry') { this.arms[0].rotation.z = -1.35; this.arms[1].rotation.z = 1.35 }
    if (pose === 'hammer') {
      const raised = frame % 2 === 0
      this.axe.visible = true
      this.arms[0].rotation.z = raised ? -1.9 : -0.8
      this.arms[1].rotation.z = raised ? 1.9 : 0.8
      this.axe.rotation.z = raised ? -1.2 : -0.35
    }
    if (pose === 'place') { this.arms[0].rotation.z = -1.7; this.arms[1].rotation.z = 1.7 }
    if (pose === 'kneel') {
      this.group.scale.set(MODEL_SCALE, MODEL_SCALE * 0.72, MODEL_SCALE)
      this.head.rotation.x = 0.28
      this.arms[0].rotation.z = -1.1
      this.arms[1].rotation.z = 1.1
    }
  }

  restoreColors(): void {
    this.materials.forEach((material, index) => material.color.copy(this.cleanColors[index]))
  }

  dispose(): void {
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    })
  }
}
```

Import `RNG`, `clayMaterial`, `wobble`, `PALETTE`, and Three.js directly in `model.ts`. Remove `MODEL_SCALE` from `villager.ts`, import it from `model.ts`, and re-export it from `villager.ts` so existing tests and consumers retain the same public import.

- [ ] **Step 4: Make gameplay Villager consume the shared rig**

Define:

```ts
export type VillagerOptions = {
  lowFx?: boolean
  animateIn?: boolean
  visualSeed: number
}
```

Change the constructor tail from positional booleans to `options: VillagerOptions`. Construct `this.rig = new VillagerModel(id, options.visualSeed, options.lowFx ?? false)`, add `rig.group` to the outer villager group, and replace direct model/head/arms/axe/material/color fields with getters that return the matching rig members. Keep rain leaf, fishing rig, held fruit, ghost, emote sprite, behavior timers, FSM, and world/event dependencies in `Villager`. Delete its old `addPart()`.

Make `resetPose()` call `this.rig.resetPose()` and reset only the outer `group.rotation.z`. Make zap recovery call `this.rig.restoreColors()`.

Update dynamic spawning and the initial builder:

```ts
// dynamic spawn
const visualSeed = rng.int(1, 0x7fffffff)
new Villager(id, x, z, island, rng, world, world.bus, {
  lowFx: options.lowFx, animateIn: options.animateIn, visualSeed,
})

// initial blueprint spawn
new Villager(spec.id, spec.x, spec.z, island, new RNG(spec.behaviorSeed), world, world.bus, {
  lowFx, visualSeed: spec.visualSeed,
})
```

- [ ] **Step 5: Run the high-risk villager regressions**

Run: `npx vitest run src/villagers/model.test.ts src/villagers/villager.test.ts src/world/world.test.ts && npm test`

Expected: PASS; existing FSM, fishing, fruit, zap, fire, and repopulation behavior remains unchanged.

- [ ] **Step 6: Type-check and build**

Run: `npx tsc --noEmit && npm run build`

Expected: PASS.

- [ ] **Step 7: Browser-check the extraction**

Run: `npm run dev`

Expected: villager body proportions, smock variation, props, zap ghost, poses, and 12fps movement look the same as before this task.

- [ ] **Step 8: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Suggested commit message if explicitly requested: `refactor: share villager visual rig`.

---

### Task 8: Canonical prologue choreography and temporary set

**Files:**
- Create: `src/prologue/choreography.ts`
- Create: `src/prologue/choreography.test.ts`
- Create: `src/prologue/actor.ts`
- Create: `src/prologue/prologue.ts`
- Create: `src/prologue/prologue.test.ts`
- Modify: `src/world/objects.ts:218-312,515-533`
- Modify: `src/world/objects.test.ts:184-202`

**Interfaces:**
- Consumes: `InitialWorldBlueprint`, `VillagerModel`, `CameraController`, and existing `Tree`, `Hut`, `Campfire`, `Island` visuals.
- Produces: `PROLOGUE_DURATION`, `PrologueCue`, `PrologueState`, `prologueStateAt()`, `crossedPrologueCues()`, `PrologueActor`, `PrologueSet`, `PrologueDirector`, and `HandoffRecord`.
- The prologue has no `World`, `EventBus`, Journal, FSM, needs, fire simulation, or power dependency.

- [ ] **Step 1: Write the pure beat-contract tests**

```ts
import { describe, expect, it } from 'vitest'
import { CAMERA_HOME } from '../camera/policy'
import { createInitialWorldBlueprint } from '../world/blueprint'
import {
  crossedPrologueCues, PROLOGUE_DURATION, prologueStateAt,
} from './choreography'

describe('prologue choreography', () => {
  const blueprint = createInitialWorldBlueprint(7)

  it('uses the approved causal eleven-second beats', () => {
    expect(PROLOGUE_DURATION).toBe(11)
    expect(prologueStateAt(0, blueprint).treeGrowth).toBe(0)
    expect(prologueStateAt(2.5, blueprint).treeGrowth).toBe(1)
    expect(prologueStateAt(3.19, blueprint).hutStages).toEqual([0, 0])
    expect(prologueStateAt(3.6, blueprint).hutStages).toEqual([1, 1])
    expect(prologueStateAt(6.8, blueprint).hutStages).toEqual([3, 3])
    expect(prologueStateAt(7.49, blueprint).campfireProgress).toBe(0)
    expect(prologueStateAt(10, blueprint).campfireProgress).toBe(1)
    expect(prologueStateAt(10, blueprint).ignited).toBe(true)
  })

  it('ends on the exact camera home pose and blueprint frame', () => {
    const final = prologueStateAt(11, blueprint)
    expect(final.camera).toEqual(CAMERA_HOME)
    expect(final.frame).toBe(blueprint.handoffFrame)
    expect(final.finished).toBe(true)
  })

  it('uses stable home framing under reduced motion', () => {
    expect(prologueStateAt(0, blueprint, true).camera).toEqual(CAMERA_HOME)
    expect(prologueStateAt(5.5, blueprint, true).camera).toEqual(CAMERA_HOME)
    expect(prologueStateAt(11, blueprint, true).camera).toEqual(CAMERA_HOME)
  })

  it('emits each crossed sound/action cue exactly once', () => {
    const cues = crossedPrologueCues(3.1, 5.3)
    expect(cues.map(cue => cue.kind)).toEqual(['hammer', 'hammer', 'hammer', 'hammer'])
  })
})
```

- [ ] **Step 2: Implement the pure choreography**

Define exact hut beats `[[3.2, 4.8, 6.4], [3.6, 5.2, 6.8]]`, campfire placement beats `[8.0, 8.8, 9.6]`, ignition at `10`, and finish at `11`. `prologueStateAt()` clamps time, derives the 12fps frame, uses `smooth01` for tree growth and continuous actor/camera segments, and returns:

```ts
export type PrologueCue = {
  at: number
  kind: 'growth' | 'step' | 'hammer' | 'place' | 'ignite'
  actor?: number
}

export type ActorState = {
  position: { x: number; y: number; z: number }
  facing: number
  pose: VillagerProloguePose
  carry: 'wood' | 'stone' | null
  frame: number
}

export type PrologueState = {
  elapsed: number
  frame: number
  treeGrowth: number
  hutStages: readonly [number, number]
  campfireProgress: number
  ignited: boolean
  actorStates: readonly ActorState[]
  camera: CameraPose
  reducedMotion: boolean
  finished: boolean
}
```

Implement `prologueStateAt(elapsed, blueprint, reducedMotion = false)`. Assign actors 0–1 to hut 0, 2–3 to hut 1, and 4–5 to the campfire. Each hut stage changes on the same frame that one assigned actor is in `hammer` or `place`; each campfire progress beat has actor 4 or 5 in `place`. Use blueprint hut coordinates and centre to derive paths. The normal camera path begins at `{ position: { x: -18, y: 11, z: 28 }, target: { x: firstBuiltHut.x, y: 0, z: firstBuiltHut.z } }`, passes the second hut and centre using piecewise `smooth01` interpolation, and equals `CAMERA_HOME` at 11 seconds. When `reducedMotion` is true, return `CAMERA_HOME` for all times while retaining the same causal state beats and duration.

`crossedPrologueCues(previous, current)` returns cues with `previous < cue.at && cue.at <= current`, sorted by time, so a frame-rate hitch neither loses nor duplicates a beat.

- [ ] **Step 3: Add an explicit tree presentation setter**

Add and test:

```ts
setGrowthProgress(value: number): void {
  if (this.state !== 'sapling' && this.state !== 'normal') return
  const growth = THREE.MathUtils.clamp(value, 0, 1)
  this.phase = growth * GROW_SECONDS
  this.state = growth >= 1 ? 'normal' : 'sapling'
  this.setGrowth(growth)
  this.syncAppearance()
}
```

The new object test must assert 0, 0.5, and 1 change trunk/crown scale together and end in `normal`. Gameplay forest growth continues calling `update()` and must retain its existing tests.

- [ ] **Step 4: Implement authored `PrologueActor`**

```ts
export class PrologueActor {
  readonly group = new THREE.Group()
  readonly model: VillagerModel
  private carried: THREE.Object3D | null = null

  constructor(readonly spec: InitialVillagerSpec, lowFx: boolean) {
    this.group.name = spec.id
    this.model = new VillagerModel(spec.id, spec.visualSeed, lowFx)
    this.group.add(this.model.group)
  }

  apply(state: ActorState): void {
    this.group.position.set(state.position.x, state.position.y, state.position.z)
    this.group.rotation.y = state.facing
    this.model.setProloguePose(state.pose, state.frame)
    if (this.carried) this.carried.visible = state.carry !== null
  }

  settle(y: number): void {
    this.group.position.set(this.spec.x, y, this.spec.z)
    this.group.rotation.set(0, this.spec.facing, 0)
    this.model.resetPose()
    if (this.carried) this.carried.visible = false
  }

  dispose(): void { this.model.dispose() }
}
```

`PrologueSet.seekFinal()` calls `actor.settle(island.sampleHeight(spec.x, spec.z))` so the final Y comes from the prologue island. Carried wood/stone is owned by the actor, attached to its arms, named, hidden at handoff, and disposed with the actor.

- [ ] **Step 5: Implement `PrologueSet` and exact handoff records**

`PrologueSet` creates a separate `Island` with the blueprint island seed. For every normal tree it creates the same visual seed in `sapling` state; for each final built hut it creates the same seed in `site` state; the final empty site stays a site; the campfire begins as a site; six `PrologueActor`s use the blueprint villager visual seeds. Add only this island group to the shared stage root when a prologue session begins.

Public surface:

```ts
export type HandoffRecord = {
  id: string
  state: string
  position: readonly number[]
  rotation: readonly number[]
  scale: readonly number[]
  parts: readonly {
    name: string
    visible: boolean
    position: readonly number[]
    rotation: readonly number[]
    scale: readonly number[]
  }[]
}

export class PrologueSet {
  readonly island: Island
  readonly group: THREE.Group
  constructor(blueprint: InitialWorldBlueprint, lowFx: boolean, reducedMotion: boolean)
  apply(state: PrologueState): void
  seekFinal(): void
  handoffRecords(): HandoffRecord[]
  dispose(): void
}

export function gameplayHandoffRecords(set: GameplayWorldSet): HandoffRecord[]
```

In ordinary motion, `apply()` advances each tree with `setGrowthProgress`, applies only newly reached hut build stages using existing `buildTick()`, advances campfire using delta progress through `buildTick(amount)`, applies actors, and hides material piles as their pieces are consumed. Under reduced motion, trees remain at full authored size and appear in staggered batches with short opacity steps; huts and the campfire change only at their causal beats with a short opacity reveal; actors use stable work positions and poses without interpolated travel. The causal times, sound cues, eleven-second duration, and final state remain unchanged.

`seekFinal()` directly applies `prologueStateAt(11, blueprint, reducedMotion)`, settles every actor, hides all extra props, sets group rotation to `blueprint.stageRotationY`, and is idempotent.

Both record functions sort by id and include island, tree, hut, campfire, and villager outer transforms plus final semantic state. Their `parts` arrays traverse named visible children, capture each child's visibility and local transform, and sort by name. The two functions must return equal arrays at handoff, including villager pose geometry rather than only the outer group.

- [ ] **Step 6: Implement `PrologueDirector` lifecycle**

```ts
export type PrologueDirectorOptions = {
  blueprint: InitialWorldBlueprint
  lowFx: boolean
  stageRoot: THREE.Group
  camera: CameraController
  reducedMotion: () => boolean
  onCue(cue: PrologueCue): void
  onFinished(): void
}

export class PrologueDirector {
  readonly set: PrologueSet
  private elapsed = 0
  private previous = 0
  private finished = false
  update(dt: number): void
  skip(): void
  finish(): void
  dispose(): void
}
```

The constructor creates `new PrologueSet(blueprint, lowFx, reducedMotion())`, adds `set.group`, locks camera with `prologue`, and starts at state 0. `update()` ignores hidden-document time at the caller, calls `prologueStateAt(elapsed, blueprint, reducedMotion())`, crosses cues once, applies state, writes the authored camera pose, and calls the single `finish()` path at 11. If the media query changes during a session, the next state switches presentation without changing elapsed time or causal beats. `skip()` is only called after app-flow authorization and seeks the final set first. `finish()` seeks final, sets exact home camera, calls `onFinished()` once, and does not dispose before the owner swaps visibility. `dispose()` removes the set, releases only the `prologue` camera lock, and is safe after finish or skip.

- [ ] **Step 7: Test prologue/gameplay parity and cleanup**

In `src/prologue/prologue.test.ts`, build a gameplay set and prologue set from one blueprint, call `seekFinal()`, and assert:

```ts
expect(prologue.handoffRecords()).toEqual(gameplayHandoffRecords(gameplay))
expect(() => { prologue.dispose(); prologue.dispose() }).not.toThrow()
```

Also inject a cue spy into `PrologueDirector`, advance with uneven deltas summing to 11, and assert every declared cue fires once, `onFinished` fires once, and no `World` or `EventBus` object is accepted by its constructor. Add a reduced-motion director case asserting stable home camera, no continuous actor travel/tree scaling between causal beats, and the same final handoff records.

- [ ] **Step 8: Run the prologue and object suites**

Run: `npx vitest run src/prologue/choreography.test.ts src/prologue/prologue.test.ts src/world/objects.test.ts src/villagers/model.test.ts && npm test`

Expected: PASS.

- [ ] **Step 9: Type-check and build**

Run: `npx tsc --noEmit && npm run build`

Expected: PASS.

- [ ] **Step 10: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Suggested commit message if explicitly requested: `feat: build canonical construction prologue`.

---

### Task 9: Clay Island title, skip surface, and prologue sound cues

**Files:**
- Create: `src/ui/title.ts`
- Create: `src/audio/sfx.test.ts`
- Modify: `src/audio/sfx.ts:1-20,67-90,137-160`
- Modify: `src/styles.css:1-80,822-869`

**Interfaces:**
- Consumes: Begin/Skip callbacks from the later app orchestrator and `PrologueCue.kind` from Task 8.
- Produces: `TitleUI`, `createTitleUI()`, and `Sfx.prologue(cue)`.
- Title transitions expose a callback rather than mutating app flow; main validates the captured flow generation.

- [ ] **Step 1: Write the pure prologue sound-profile test**

Extract cue-to-synth data into a pure export so it can be checked without an `AudioContext`:

```ts
import { describe, expect, it } from 'vitest'
import { prologueSoundProfile } from './sfx'

describe('prologue sound profiles', () => {
  it('gives every visual cue a bounded distinct sound profile', () => {
    expect(prologueSoundProfile('growth')).toMatchObject({ kind: 'tone', seconds: 0.15 })
    expect(prologueSoundProfile('step')).toEqual({ kind: 'step' })
    expect(prologueSoundProfile('hammer')).toMatchObject({ kind: 'knock', pitch: 150 })
    expect(prologueSoundProfile('place')).toMatchObject({ kind: 'knock', pitch: 95 })
    expect(prologueSoundProfile('ignite')).toMatchObject({ kind: 'tone', seconds: 0.4 })
  })
})
```

- [ ] **Step 2: Add direct prologue cues to the existing voice-capped mixer**

Define:

```ts
export type PrologueSoundCue = 'growth' | 'step' | 'hammer' | 'place' | 'ignite'
export type PrologueSoundProfile =
  | { kind: 'step' }
  | { kind: 'knock'; pitch: number; seconds: number; volume: number }
  | { kind: 'tone'; from: number; to: number; seconds: number; volume: number }

export function prologueSoundProfile(cue: PrologueSoundCue): PrologueSoundProfile {
  if (cue === 'step') return { kind: 'step' }
  if (cue === 'hammer') return { kind: 'knock', pitch: 150, seconds: 0.10, volume: 0.028 }
  if (cue === 'place') return { kind: 'knock', pitch: 95, seconds: 0.14, volume: 0.032 }
  if (cue === 'growth') return { kind: 'tone', from: 150, to: 230, seconds: 0.15, volume: 0.012 }
  return { kind: 'tone', from: 180, to: 520, seconds: 0.4, volume: 0.026 }
}
```

Add `Sfx.prologue(cue)`. Route `step` to the existing `step()`, tones to `oscillator()`, and knocks to a new short sine/noise helper that still ends in `trackVoice()` so `MAX_VOICES` applies. Do not emit gameplay events or attach the prologue to `EventBus`.

- [ ] **Step 3: Run the audio profile test**

Run: `npx vitest run src/audio/sfx.test.ts`

Expected: PASS.

- [ ] **Step 4: Implement semantic title/prologue UI**

```ts
export type TitleUI = {
  showBegin(): void
  showPrologue(canSkip: boolean): void
  showCover(onCovered: () => void): void
  hide(): void
  dispose(): void
}

export function createTitleUI(
  ui: HTMLElement,
  handlers: { onBegin(): void; onSkip(): void },
): TitleUI
```

Create one `#title-layer` with:

```html
<section id="title-plaque" aria-labelledby="title-heading">
  <h1 id="title-heading">Clay Island</h1>
  <button id="begin-btn" type="button">Begin</button>
</section>
<button id="intro-skip" type="button">Skip intro</button>
```

`showBegin()` makes the layer opaque, shows/focuses Begin, hides Skip, and gives Begin the only tab stop. `showPrologue(canSkip)` makes the background transparent, hides the plaque, and exposes Skip only when authorized. `showCover()` makes the opaque **CLAY ISLAND** plaque visible without Begin or Skip, then invokes `onCovered` after the opacity transition (`0ms` when `prefersReducedMotion()` is true, otherwise `320ms`); retain one timeout id and clear it before any new mode. `hide()` removes hit testing and tab stops immediately before fading. `dispose()` clears the timeout, removes listeners, and removes the layer.

- [ ] **Step 5: Add the clay plaque and reduced-motion styles**

Use the existing paper/skin/ink tokens. The title layer is fixed, inset 0, above scene UI, opaque paper during Begin/cover, and pointer-transparent during prologue except for Skip. The plaque uses an irregular clay border, inset highlights, and embossed text-shadow; Begin is a raised smaller seal that depresses on activation. Skip sits top-right with a real text label and visible focus.

Under `prefers-reduced-motion`, remove plaque travel/scale and retain opacity changes. Do not hide the Skip button visually while leaving it focusable.

- [ ] **Step 6: Run automated verification**

Run: `npx vitest run src/audio/sfx.test.ts && npm test && npx tsc --noEmit && npm run build`

Expected: PASS.

- [ ] **Step 7: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Suggested commit message if explicitly requested: `feat: add clay island title and prologue cues`.

---

### Task 10: Normal-load orchestration and seamless handoff

**Files:**
- Create: `src/prologue/audit.ts`
- Create: `src/prologue/audit.test.ts`
- Modify: `src/main.ts:1-148`
- Modify: `src/scene.ts`
- Modify: `src/styles.css`
- Delete: `src/intro.ts`

**Interfaces:**
- Consumes: preferences, app flow, blueprint/gameplay set, scene stage root, camera, title UI, prologue director, Sfx cues.
- Produces: one phase-gated main loop and an optional `?handoffAudit=1` framebuffer report.
- Normal handoff sequence: render final prologue hold -> swap groups -> render frozen gameplay -> enter gameplay -> next RAF may simulate.

- [ ] **Step 1: Write framebuffer comparison tests**

```ts
import { describe, expect, it } from 'vitest'
import { compareFramebuffers } from './audit'

describe('handoff framebuffer audit', () => {
  it('passes identical frames and ignores the ember mask', () => {
    const before = new Uint8Array(4 * 4 * 4)
    const after = before.slice()
    after[(1 * 4 + 1) * 4] = 255
    expect(compareFramebuffers(before, after, 4, 4, { x: 1, y: 1, radius: 1 })).toMatchObject({
      changedRatio: 0, pass: true,
    })
  })

  it('fails when more than 0.1 percent of unmasked pixels change by over 2', () => {
    const before = new Uint8Array(1000 * 4)
    const after = before.slice()
    after[0] = 3; after[4] = 3
    expect(compareFramebuffers(before, after, 1000, 1, null).pass).toBe(false)
  })
})
```

- [ ] **Step 2: Implement framebuffer read and threshold logic**

```ts
export type EmberMask = { x: number; y: number; radius: number }
export type FrameDiff = { changed: number; compared: number; changedRatio: number; pass: boolean }

export function compareFramebuffers(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
  height: number,
  mask: EmberMask | null,
): FrameDiff {
  let changed = 0
  let compared = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (mask && Math.hypot(x - mask.x, y - mask.y) <= mask.radius) continue
    compared++
    const offset = (y * width + x) * 4
    if ([0, 1, 2].some(channel => Math.abs(before[offset + channel] - after[offset + channel]) > 2)) changed++
  }
  const changedRatio = compared === 0 ? 0 : changed / compared
  return { changed, compared, changedRatio, pass: changedRatio <= 0.001 }
}

export function readFramebuffer(renderer: THREE.WebGLRenderer): {
  pixels: Uint8Array; width: number; height: number
} {
  const gl = renderer.getContext()
  const width = gl.drawingBufferWidth
  const height = gl.drawingBufferHeight
  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return { pixels, width, height }
}
```

Project the campfire world position through the camera to create a mask centred on the ember flare with a 64-device-pixel radius.

- [ ] **Step 3: Recompose startup in dependency order**

Rewrite `src/main.ts` in this order:

```ts
const ui = document.getElementById('ui')!
const splash = document.getElementById('splash')!
let storage: Storage | null = null
try { storage = localStorage } catch { /* optional */ }

const preferences = new Preferences(storage, location.search)
const startup = preferences.snapshot
const blueprint = createInitialWorldBlueprint(7)
const sceneBundle = createScene({ lowFx: startup.lowFx })
const cameraController = new CameraController({
  camera: sceneBundle.camera,
  dom: sceneBundle.renderer.domElement,
  autoRotate: startup.autoRotate,
  reducedMotion: prefersReducedMotion,
})
const gameplay = buildInitialWorld(blueprint, startup.lowFx)
sceneBundle.stageRoot.add(gameplay.island.group)
gameplay.island.group.visible = false
let flow = initialAppFlow(startup.introSeen)
let director: PrologueDirector | null = null
```

Then construct powers, targeting, tray, Sfx, Journal, and particles against `gameplay.world` exactly once. Keep tray hidden and inert until gameplay. Do not create any power or Journal objects for the prologue.

- [ ] **Step 4: Wire Begin, authorized Skip, and generation-safe completion**

Use these ownership rules:

```ts
function beginNormalPrologue(): void {
  const next = transitionAppFlow(flow, { type: 'begin' })
  if (next === flow || next.phase !== 'prologue') return
  flow = next
  sfx.unlock()
  titleUI.showPrologue(canSkipPrologue(flow))
  gameplay.island.group.visible = false
  director = createDirector(flow.generation)
}

function createDirector(generation: number): PrologueDirector {
  return new PrologueDirector({
    blueprint, lowFx: startup.lowFx, stageRoot: sceneBundle.stageRoot,
    camera: cameraController, reducedMotion: prefersReducedMotion,
    onCue: cue => sfx.prologue(cue.kind),
    onFinished: () => {
      if (flow.generation !== generation || flow.phase !== 'prologue') return
      pendingNormalHandoff = true
    },
  })
}
```

Begin is the only route from title. Skip first checks `canSkipPrologue(flow)`; when false it performs no action, and first-view markup never exposes the button. When true, call `director.skip()` and let its normal finish callback set the same pending handoff.

- [ ] **Step 5: Implement the held-frame swap**

Track `pendingNormalHandoff`, `renderedFinalPrologue`, and optional audit pixels. The render loop must perform this order:

1. While prologue is active and the document is visible, call `director.update(dt)`.
2. Render the final prologue state once after finish; after rendering, capture audit-before when enabled and mark `renderedFinalPrologue`.
3. At the start of the next render callback, hide/remove the prologue group, reveal gameplay, set stage rotation and camera home exactly, and dispose the director. Do not change flow yet.
4. Render the frozen gameplay world once; after rendering, capture audit-after/report when enabled.
5. Save `const completedMode = flow.mode`, transition with `finishPrologue`, call `preferences.markIntroSeen()` only when `completedMode === 'first'`, reveal tray, hide title UI, and leave simulation to the next RAF.

The ordinary path uses the same two-frame hold even when the audit query is absent. Do not crossfade the groups.

For the optional audit only, hold every non-handoff visual constant during those two compared renders:

```ts
const auditingHandoff = handoffAuditEnabled && (pendingNormalHandoff || renderedFinalPrologue)
const ambientDt = auditingHandoff ? 0 : dt
sceneBundle.updateSky(ambientDt)
sceneBundle.quality.update(ambientDt, cameraController.distance(), prefersReducedMotion())
```

Do not advance or apply camera shake while `auditingHandoff` is true. Preserve the same sky, stage bob, cloud rotation, grain seed, camera matrix, and light state until the after-frame has been captured.

- [ ] **Step 6: Gate every simulation and world-visual update**

At the start of the fixed-step callback:

```ts
if (!simulatesGameplay(flow)) return
```

In the render callback, advance the gameplay `QuantizedClock`, targeting, powers, particles, cooldown DOM, trees, huts, campfire, ponds, and fire lights only while `simulatesGameplay(flow)`. Camera, sky, quality, title/prologue UI, and renderer still update in non-gameplay phases. This ensures hidden gameplay fire timers, villagers, forest recovery, and particle pools do not move before handoff or during replay.

Skip `director.update(dt)` while `document.hidden`; the existing 0.1-second loop clamp remains a second guard. Because camera path is derived from normalized elapsed state each frame, resize uses the new camera aspect without restarting the director.

- [ ] **Step 7: Delete the old intro and its global skip capture**

Remove the `Intro` import, instance, `pointerdown`/`keydown` skip listeners, `intro.update()`, and `src/intro.ts`. Remove old intro-only island rotation and wake calls. Keep the tray hidden class but rename it from `intro-hidden` to `gameplay-hidden` so replay can reuse it without implying the deleted class.

- [ ] **Step 8: Run automated lifecycle verification**

Run: `npx vitest run src/prologue/audit.test.ts src/core/appFlow.test.ts src/prologue/prologue.test.ts && npm test && npx tsc --noEmit && npm run build`

Expected: PASS; no import of `./intro` remains.

- [ ] **Step 9: Browser-check first and returning normal loads**

Run: `npm run dev`

In browser storage, remove only `clayisland.introSeen`, reload, and verify:

- loading yields to **CLAY ISLAND / BEGIN**;
- Begin unlocks audio and the first intro exposes no Skip in DOM or tab order;
- villagers visibly cause hut and campfire stages;
- gameplay tray remains hidden/inert and world consequences do not advance;
- fire handoff has no camera, model, pose, shadow, or animation jump;
- `clayisland.introSeen` becomes `true` only after handoff.

Reload and verify the same title/prologue appears with Skip. Skip must land on the exact fresh gameplay composition.

- [ ] **Step 10: Run the measurable handoff audit**

Open `?handoffAudit=1`, complete the unskipped normal prologue, and inspect the console.

Expected: `handoff audit pass` with `changedRatio <= 0.001` outside the 64-pixel ember mask. The audit path freezes sky bob, cloud rotation, grain seed, and camera shake across the two compared renders only; normal play resumes immediately afterward.

- [ ] **Step 11: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and `src/intro.ts` is the only deletion. Suggested commit message if explicitly requested: `feat: orchestrate seamless island prologue`.

---

### Task 11: Settings, modal coordination, and safe replay

**Files:**
- Create: `src/ui/settings.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/tray.ts:49-55,108-128,161-188`
- Modify: `src/ui/tray.test.ts`
- Modify: `src/ui/journal.ts:4-18,114-136,183-221`
- Modify: `src/styles.css:365-415,417-430,842-920`

**Interfaces:**
- Consumes: `Preferences`, `Sfx`, `CameraController`, `JournalUI`, `DragTargeting`, and replay transitions in `AppFlowState`.
- Produces: `SettingsUI` with `close()`, `setVisible()`, `setMuted()`, `setAutoRotate()`, and `dispose()`.
- Settings replay always enters/exits under an opaque title cover and never uses the exact normal-load group swap.

- [ ] **Step 1: Add a pure tray-contract regression**

Export and test the fixed auxiliary control list:

```ts
import { expect, it } from 'vitest'
import { TRAY_AUXILIARY_CONTROLS } from './tray'

it('keeps only Journal beside the four powers', () => {
  expect(TRAY_AUXILIARY_CONTROLS).toEqual(['journal'])
})
```

Define `export const TRAY_AUXILIARY_CONTROLS = ['journal'] as const`, remove `#mute-btn`, `setMuted()`, `onMute()`, and their handlers from `createTray()`. Main stops wiring sound through tray.

- [ ] **Step 2: Implement the accessible Settings component**

```ts
export type SettingsUI = {
  close(): void
  setVisible(visible: boolean): void
  setMuted(muted: boolean): void
  setAutoRotate(on: boolean): void
  dispose(): void
}

export type SettingsUIOptions = {
  muted: boolean
  quality: VisualQuality
  forcedLowFx: boolean
  autoRotate: boolean
  onOpenChange(open: boolean): void
  onSoundChange(muted: boolean): void
  onQualityChange(quality: VisualQuality, reportFailure: () => void): void
  onAutoRotateChange(on: boolean): void
  onResetCamera(): void
  onReplayIntro(): void
}
```

Create `#settings-btn` in the upper-right and one hidden `#settings-layer` containing a backdrop and `#settings-dialog` with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="settings-heading"`, close button, and these controls in order:

1. Sound toggle.
2. Enhanced/Reduced quality radio group.
3. Auto-rotate toggle.
4. Reset camera button.
5. Replay intro button.

When a different quality is selected, replace the preference body with an inline confirmation containing this exact copy and two buttons:

> Changing quality will remold the current island. Discovered Moments are kept.

Buttons are `Keep current` and `Remold and reload`. Escape from confirmation returns to the settings body; Escape from the body closes Settings. On a failed durable preference write, keep the current selection and show `This browser could not save that quality setting.` in an `aria-live="polite"` status.

Trap Tab within visible dialog controls, restore focus to the gear on close, close on backdrop, and call `onOpenChange` exactly once per real state change. `setVisible(false)` closes first and removes the gear from tab order during title, prologue, and replay transition.

- [ ] **Step 3: Coordinate Settings, Journal, targeting, and camera locks**

Extend `JournalUI` with `isOpen(): boolean` and the already introduced `onOpenChange`. In main:

```ts
let settingsUI: SettingsUI
const journalUI = createJournalUI(ui, journal, {
  lowFx: startup.lowFx,
  onOpenChange(open) {
    if (open) settingsUI?.close()
    if (open) cameraController.lock('journal')
    else cameraController.unlock('journal')
  },
})

settingsUI = createSettingsUI(ui, {
  ...,
  onOpenChange(open) {
    if (open) {
      targeting.cancel(true)
      journalUI.close()
      cameraController.lock('settings')
    } else cameraController.unlock('settings')
  },
})
```

Sound calls `sfx.unlock()`, `sfx.setMuted()`, and updates Settings. Auto-rotate writes `Preferences`, calls `cameraController.setAutoRotate()`, and updates `aria-pressed`. Reset closes Settings then calls `cameraController.reset()`.

Quality confirmation calls `preferences.setQuality(next)`. On `true`, call `location.reload()`; on `false`, invoke `reportFailure()` and do not reload. Under `?lowfx=1`, show `Reduced (forced by link)`, disable the radio group, and never offer confirmation.

- [ ] **Step 4: Wire safe Settings replay through the app-flow cover**

Replay handler:

1. Close Settings and cancel targeting.
2. Transition with `requestReplay`; capture the returned generation.
3. Capture `cameraController.pose()` plus cloned stage position/rotation, hide tray and gear, freeze simulation through the phase guard, and call `titleUI.showCover()`.
4. In the covered callback, verify generation, hide the current gameplay island, create a fresh director, transition with `coverReady`, and call `titleUI.showPrologue(true)`.
5. On replay finish or authorized replay skip, transition to the outbound replay cover instead of the normal held-frame swap.
6. Once covered, dispose the prologue, reveal the unchanged gameplay island, restore the pre-replay camera pose and stage transform, transition with `coverReady`, hide title, reveal tray/gear, and resume simulation on the next RAF.

Capture before replay and restore after replay:

```ts
type ReplayRestore = {
  camera: CameraPose
  stagePosition: THREE.Vector3
  stageRotation: THREE.Euler
}
```

Do not recreate `World`, powers, Journal, Sfx, particles, or gameplay entities. The opaque cover deliberately hides the canonical/current-world mismatch.

- [ ] **Step 5: Add Settings/title/tray responsive styles**

The gear is a small irregular clay button at top-right and never overlaps the centred Moment toast. Desktop Settings is a compact right-side panel; at `max-width: 560px` it is a bottom sheet with safe-area padding. Reuse the Journal's dent/raised recipes and focus ring. Remove every `#mute-btn` selector and reduce tray width so four powers plus Journal fit without horizontal clipping.

Under reduced motion, Settings and cover use opacity only. Hidden layers use `display: none` or `hidden`, and closed layers disable pointer input immediately.

- [ ] **Step 6: Run automated verification**

Run: `npx vitest run src/ui/tray.test.ts src/core/preferences.test.ts src/core/appFlow.test.ts src/prologue/prologue.test.ts && npm test && npx tsc --noEmit && npm run build`

Expected: PASS.

- [ ] **Step 7: Browser-check Settings and preservation**

Run: `npm run dev`

Verify:

- gear appears only in gameplay;
- Tab/Shift+Tab trap, Escape, backdrop close, and focus return;
- Journal and Settings cannot remain open together;
- active targeting cancels before Settings opens and camera remains locked until every modal owner closes;
- Sound persists and no Sound button remains in tray;
- Auto-rotate persists, reduced motion overrides it without changing storage, and reset reaches exact home;
- quality cancellation does not write/reload; confirmation warns and reloads; Moments survive;
- `?lowfx=1` shows a disabled forced Reduced row;
- after creating a crater, changing a tree, and starting a fire, Replay Intro finishes and skips back to those exact current states;
- three consecutive replays create no duplicate DOM, callbacks, audio, or prologue groups.

- [ ] **Step 8: Check the task diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Suggested commit message if explicitly requested: `feat: add settings and safe prologue replay`.

---

### Task 12: Full verification and architecture handoff

**Files:**
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: every completed task and the approved design acceptance criteria.
- Produces: an accurate architecture reference and evidence that all paths pass.

- [ ] **Step 1: Update architecture documentation**

Add exact entries for these project-defined classes and modules:

- `Preferences` and the three new storage keys;
- pure `AppFlowState` reducer and phase-generation token;
- `InitialWorldBlueprint` and `buildInitialWorld()`;
- shared scene stage root;
- `CameraController` reason locks and constrained controls;
- `VisualQualityController` distance-adaptive tilt/grain;
- `VillagerModel` shared visual boundary;
- `PrologueActor`, `PrologueSet`, and `PrologueDirector` isolation;
- title/Begin/Skip lifecycle and exact held-frame normal handoff;
- opaque-cover Settings replay preservation;
- Settings ownership and removal of Sound from tray; and
- framebuffer handoff audit.

In the database/persistence section, explicitly state that there is still no database or island-state persistence and list `clayisland.visualQuality`, `clayisland.autoRotate`, and `clayisland.introSeen` beside the existing Moment and mute keys.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with no skipped tests.

Run: `npx tsc --noEmit`

Expected: exit 0 with no diagnostics.

Run: `npm run build`

Expected: exit 0; only the existing advisory about the main bundle exceeding 500 kB may remain.

- [ ] **Step 3: Run static diff hygiene**

Run: `git diff --check`

Expected: no output.

Run: `rg -n "from './intro'|intro-hidden|mute-btn|enablePan = false|grain.*0\.18|shadow\.radius = 7|Math\.min\(devicePixelRatio, 1\.25\)" src docs/architecture.md`

Expected: no output; the old intro import/class, tray mute control, centre-lock, and superseded visual tuning are gone.

- [ ] **Step 4: Complete the desktop acceptance pass**

At 1440×900 Enhanced quality:

1. Clear `clayisland.introSeen`; verify semantic title and mandatory prologue.
2. Watch all causal build beats and complete the unskipped seamless handoff.
3. Run `?handoffAudit=1`; require `changedRatio <= 0.001` outside the ember mask.
4. Orbit, pointer-zoom, right/middle-pan to the 7.5m bound, and test 15m/55m distance bounds.
5. Confirm close tilt is zero, home tilt is mild, shadows are tighter, and golden hour remains.
6. Arm/cancel/fire every power after moving the camera; verify camera-relative keyboard reticle movement.
7. Exercise Journal, Settings, reset, sound, auto-rotate, quality confirmation, returning Skip, and replay preservation.
8. Hide the tab mid-prologue and return; verify it resumes rather than jumps.

- [ ] **Step 5: Complete touch/narrow/reduced paths**

At a 390×844 viewport:

1. One-finger orbit; two-finger dolly/pan; pinch midpoint zoom.
2. Confirm the bottom tray, Settings sheet, title plaque, Skip, gear, toast, and target readout do not overlap.
3. Confirm the island cannot leave frame or expose its underside.
4. Enable reduced motion: prologue keeps the same causal beats/duration with stable compositions, auto-rotate stays off, reset snaps, and UI uses opacity only.
5. Load Reduced quality and `?lowfx=1`: full prologue, camera, powers, Journal, and Settings remain usable.

- [ ] **Step 6: Complete failure and repeated-lifecycle checks**

Use browser devtools to make `localStorage.getItem`/`setItem` throw for the app origin, then reload. Expected: title/prologue/gameplay still work; the view is conservatively mandatory on the next load; auto-rotate changes for the current session; quality failure reports inline and does not reload.

Replay three times after mutating terrain and objects. Record `renderer.info.memory.geometries`, `renderer.info.memory.textures`, count `#title-layer`, `#settings-layer`, `.prologue-island`, and inspect active console/audio behavior before and after. Expected: counts return to baseline, one title/settings layer remains, no prologue group remains, and no cue fires twice.

- [ ] **Step 7: Final repository check**

Run: `git status --short`

Expected: only plan-authorized source, test, CSS, `docs/architecture.md`, the approved design spec, and this plan are changed/untracked; `STATUS.md` is unchanged.

Suggested final commit message if the user explicitly requests one: `feat: add cinematic prologue and diorama camera`.

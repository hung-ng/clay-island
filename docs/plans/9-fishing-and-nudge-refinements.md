# Fishing and Nudge Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every pond three visible, finite fish; make fishing, Lightning, Rain, and Nudge respect that population; and correct the fishing-rod, held-fruit, and Nudge-glyph presentation.

**Architecture:** `Pond` remains the only owner of fish population and animation. `World` supplies resource-aware spatial queries and Rain restoration, while the existing power matrix stages Lightning stun and the pure FSM gates fishing and drinking. `Villager` consumes those interfaces, keeps Nudge suggestions until one requested action completes, and owns the corrected prop poses.

**Tech Stack:** TypeScript 6, Three.js 0.185, Vitest 4, Vite 8, DOM/CSS

## Global Constraints

- Read the approved design first: `docs/superpowers/specs/2026-07-14-fishing-and-nudge-refinements-design.md`.
- A pond contains zero to three fish; there is no passive regeneration and no fish HUD.
- New ponds start with three fish. Fishing removes one. Rain restores three once at first impact. Lightning stuns remaining fish for exactly two seconds without changing the count.
- A fishing cast lasts four seconds and succeeds when the cycle completes; remove the current five-percent roll.
- Ordinary fish stay below the water surface, inside submerged space, and above the pond bed on the shared 12fps clock.
- Rain reaches a pond when the shower radius intersects the pond basin radius.
- Drinking remains absent from the random idle roll; it is available for thirst and explicit Nudge suggestions.
- A Nudge reaches the existing four nearest eligible villagers with the existing suggestion weight. It persists until each reached villager completes one requested action or its target becomes impossible.
- Danger, mourning, rebuilding, and Rain reactions can interrupt a Nudge without erasing it.
- Keep the world-space Nudge ripple brief. Replace only the tray glyph with the pointing-finger design.
- Add no dependencies, external assets, resource inventory, save data, Journal moments, or unrelated refactors.
- Update `docs/architecture.md` when implementation changes land. Do not edit `STATUS.md` unless the user explicitly requests the wrap flow.
- Never commit unless the user explicitly authorizes a commit. Every commit step below is an authorization gate, not standing permission.

---

## File map

- `src/world/objects.ts` — replace `Pond.hasFish`/`floatFish()` with counted fish, reusable fish visuals, swim paths, stun, restore, and `update(dt, qt)`.
- `src/world/water.test.ts` — test population invariants, visibility, swimming depth, catch/restore, and stun recovery.
- `src/world/world.ts` — preserve counts while basins merge, query stocked ponds, restore fish inside Rain reach, send suggestions without a TTL, and pass `dt` into ponds.
- `src/world/world.test.ts` — test merge preservation, radius restoration, stocked queries, and the exact suggestion payload.
- `src/powers/matrix.ts` / `src/powers/matrix.test.ts` — rename the Lightning pond outcome from `floatFish` to `stunFish`.
- `src/powers/outcomes.ts` / `src/powers/outcomes.test.ts` — apply Lightning stun and resolve stocked-versus-empty pond suggestions.
- `src/powers/rain.ts` / `src/powers/rain.test.ts` — restore reached ponds once, after first-impact crater filling.
- `src/main.ts` — call `world.updatePonds(dt, qt)`.
- `src/villagers/fsm.ts` / `src/villagers/fsm.test.ts` — distinguish pond presence from fish availability and add suggestion-only drinking.
- `src/powers/nudge.ts` / `src/powers/nudge.test.ts` — give ground intent separate any-pond and stocked-pond inputs.
- `src/villagers/villager.ts` / `src/villagers/villager.test.ts` — perform deterministic catches, fall back to drinking, preserve suggestions until completion, align the fishing float, and parent fruit to the arm.
- `src/styles.css` — draw the pointing-finger Nudge glyph.
- `docs/architecture.md` — document the final contracts and patterns.

---

### Task 1: Give `Pond` a counted, animated fish population

**Files:**
- Modify: `src/world/objects.ts:1160-1276`
- Modify: `src/world/world.ts:627-629`
- Modify: `src/main.ts:128-134`
- Test: `src/world/water.test.ts:13-216`

**Interfaces:**
- Consumes: `Basin`, `RNG`, `TIMING.fps`, and the existing `groundY(x, z): number` callback.
- Produces:
  - `MAX_POND_FISH = 3`
  - `new Pond(basin, groundY, rng, lowFx?, initialFishCount?)`
  - `pond.fishCount: number`
  - `pond.hasFish: boolean`
  - `pond.fishStunned: boolean`
  - `pond.catchFish(): boolean`
  - `pond.restoreFish(): boolean`
  - `pond.stunFish(): boolean`
  - `pond.update(dt: number, qt: number): void`
  - `World.updatePonds(dt: number, qt: number): void`

- [ ] **Step 1: Write failing pond-population tests**

Add these helpers and tests to `src/world/water.test.ts`:

```ts
function pondFish(pond: Pond): THREE.Mesh[] {
  const school = pond.group.getObjectByName('pond-fish') as THREE.Group
  return school.children as THREE.Mesh[]
}

describe('pond fish population', () => {
  const makePond = (initialFish = 3): {
    pond: Pond
    craters: Crater[]
    groundY: (x: number, z: number) => number
  } => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const groundY = dish(craters)
    return {
      pond: new Pond(basin, groundY, new RNG(7), false, initialFish),
      craters,
      groundY,
    }
  }

  it('starts with three visible fish swimming below the surface and above the bed', () => {
    const { pond, groundY } = makePond()

    pond.update(1 / 12, 1 / 12)

    expect(pond.fishCount).toBe(3)
    for (const fish of pondFish(pond)) {
      const worldX = pond.x + fish.position.x
      const worldZ = pond.z + fish.position.z
      const bedY = groundY(worldX, worldZ) - pond.basin.waterLevel
      expect(fish.visible).toBe(true)
      expect(fish.position.y).toBeLessThan(-0.05)
      expect(fish.position.y).toBeGreaterThan(bedY + 0.08)
      expect(pond.contains(worldX, worldZ)).toBe(true)
    }
  })

  it('removes exactly one fish per catch and never underflows', () => {
    const { pond } = makePond()

    expect(pond.catchFish()).toBe(true)
    expect(pond.fishCount).toBe(2)
    expect(pondFish(pond).filter(fish => fish.visible)).toHaveLength(2)

    expect(pond.catchFish()).toBe(true)
    expect(pond.catchFish()).toBe(true)
    expect(pond.catchFish()).toBe(false)
    expect(pond.fishCount).toBe(0)
    expect(pond.hasFish).toBe(false)
  })

  it('restores a partial or empty pond to three without allocating another school', () => {
    const { pond } = makePond()
    const school = pond.group.getObjectByName('pond-fish')
    pond.catchFish()
    pond.catchFish()

    expect(pond.restoreFish()).toBe(true)
    expect(pond.fishCount).toBe(3)
    expect(pond.group.getObjectByName('pond-fish')).toBe(school)
    expect(pond.restoreFish()).toBe(false)
  })

  it('stuns remaining fish at the surface for two seconds without consuming them', () => {
    const { pond } = makePond()
    pond.catchFish()
    const before = pond.fishCount

    expect(pond.stunFish()).toBe(true)
    pond.update(1 / 12, 1 / 12)
    expect(pond.fishStunned).toBe(true)
    expect(pondFish(pond).filter(fish => fish.visible).every(
      fish => fish.position.y >= 0,
    )).toBe(true)

    pond.update(2.01, 2.1)
    expect(pond.fishStunned).toBe(false)
    expect(pond.fishCount).toBe(before)
    expect(pondFish(pond).filter(fish => fish.visible).every(
      fish => fish.position.y < -0.05,
    )).toBe(true)
  })

  it('does not stun an empty pond', () => {
    const { pond } = makePond(0)
    expect(pond.stunFish()).toBe(false)
    expect(pond.fishStunned).toBe(false)
  })
})
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run src/world/water.test.ts
```

Expected: FAIL because `Pond` has no `fishCount`, `catchFish()`, `restoreFish()`, `stunFish()`, or five-argument constructor.

- [ ] **Step 3: Replace the boolean fish state with a bounded population**

In `src/world/objects.ts`, add the public constant and private visual record:

```ts
export const MAX_POND_FISH = 3

type PondFish = {
  mesh: THREE.Mesh
  anchorX: number
  anchorZ: number
  radius: number
  phase: number
  direction: -1 | 1
}
```

Replace the old `hasFish` and `floatingFish` fields with:

```ts
private readonly fishSchool = new THREE.Group()
private readonly fish: PondFish[] = []
private fishPopulation: number
private fishStunTime = 0
private lastQt = Number.NEGATIVE_INFINITY
```

Extend the constructor and initialize the bounded count:

```ts
constructor(
  public readonly basin: Basin,
  private readonly groundY: (x: number, z: number) => number,
  rng: RNG,
  lowFx = false,
  initialFishCount = MAX_POND_FISH,
) {
  this.fishPopulation = Math.max(
    0,
    Math.min(MAX_POND_FISH, Math.floor(initialFishCount)),
  )
```

Replace the current floating-fish construction with one reusable school. Anchoring each route inside a source crater keeps routes inside deep submerged space even for a multi-lobed basin:

```ts
this.fishSchool.name = 'pond-fish'
const fishGeometry = wobble(new THREE.SphereGeometry(0.19, 8, 6), rng, 0.025)
const fishMaterial = clayMaterial(PALETTE.fish)
for (let i = 0; i < MAX_POND_FISH; i++) {
  const crater = basin.craters[i % basin.craters.length]
  const mesh = new THREE.Mesh(fishGeometry, fishMaterial)
  mesh.name = `pond-fish-${i}`
  mesh.scale.set(1.35, 0.45, 0.72)
  mesh.castShadow = !lowFx
  mesh.visible = i < this.fishPopulation
  this.fish.push({
    mesh,
    anchorX: crater.x - basin.x,
    anchorZ: crater.z - basin.z,
    radius: Math.min(0.42, crater.radius * 0.14),
    phase: (i / MAX_POND_FISH) * Math.PI * 2 + rng.range(-0.2, 0.2),
    direction: i % 2 === 0 ? 1 : -1,
  })
  this.fishSchool.add(mesh)
}
this.group.add(this.fishSchool)
```

- [ ] **Step 4: Add catch, restore, and stun operations**

Replace `floatFish()` with:

```ts
get fishCount(): number {
  return this.fishPopulation
}

get hasFish(): boolean {
  return this.fishPopulation > 0
}

get fishStunned(): boolean {
  return this.fishStunTime > 0
}

catchFish(): boolean {
  if (this.fishPopulation <= 0) return false
  this.fishPopulation--
  this.fish[this.fishPopulation].mesh.visible = false
  return true
}

restoreFish(): boolean {
  const changed = this.fishPopulation !== MAX_POND_FISH
  this.fishPopulation = MAX_POND_FISH
  this.fishStunTime = 0
  for (const fish of this.fish) fish.mesh.visible = true
  return changed
}

stunFish(): boolean {
  if (!this.hasFish) return false
  this.fishStunTime = 2
  return true
}
```

- [ ] **Step 5: Animate live fish underwater and stunned fish at the surface**

Replace `update(qt)` with `update(dt, qt)`. Use each fish route's analytic tangent for its heading and clamp its submergence against the sampled floor:

```ts
update(dt: number, qt: number): void {
  this.fishStunTime = Math.max(0, this.fishStunTime - dt)
  if (qt === this.lastQt) return

  const frame = Math.floor(qt * TIMING.fps)
  this.water.material.opacity = 0.69 + Math.sin(frame * 0.32) * 0.035

  for (let i = 0; i < this.fish.length; i++) {
    const fish = this.fish[i]
    if (!fish.mesh.visible) continue
    const angle = fish.phase + frame * 0.035 * fish.direction
    const localX = fish.anchorX + Math.cos(angle) * fish.radius
    const localZ = fish.anchorZ + Math.sin(angle) * fish.radius * 0.68
    const depth = Math.max(
      0,
      this.basin.waterLevel - this.groundY(this.x + localX, this.z + localZ),
    )

    fish.mesh.position.x = localX
    fish.mesh.position.z = localZ
    fish.mesh.rotation.y = Math.atan2(
      -Math.sin(angle) * fish.direction,
      Math.cos(angle) * 0.68 * fish.direction,
    )
    fish.mesh.position.y = this.fishStunned
      ? 0.035 + (((frame + i) % 4 < 2) ? 0.025 : 0)
      : -Math.min(0.28, Math.max(0.1, depth * 0.45), Math.max(0.08, depth - 0.12))
  }
  this.lastQt = qt
}
```

- [ ] **Step 6: Pass display delta time through the pond update bridge**

In `src/world/world.ts`:

```ts
updatePonds(dt: number, qt: number): void {
  for (const pond of this.ponds) pond.update(dt, qt)
}
```

In `src/main.ts`:

```ts
world.updatePonds(dt, clock.quantizedTime)
```

- [ ] **Step 7: Run the pond tests and TypeScript**

Run:

```bash
npx vitest run src/world/water.test.ts
npx tsc --noEmit
```

Expected: pond tests PASS and TypeScript exits zero.

- [ ] **Step 8: Commit only if explicitly authorized**

If the user explicitly authorizes a commit for this task:

```bash
git add src/world/objects.ts src/world/water.test.ts src/world/world.ts src/main.ts
git commit -m "feat: add counted pond fish"
```

Otherwise skip this step.

---

### Task 2: Preserve fish through world changes and integrate Rain and Lightning

**Files:**
- Modify: `src/world/world.ts:298-308,391-449,627-629`
- Modify: `src/powers/matrix.ts:5-29,45-54`
- Modify: `src/powers/outcomes.ts:81-84`
- Modify: `src/powers/rain.ts:207-248`
- Test: `src/world/world.test.ts:229-377`
- Test: `src/powers/matrix.test.ts:9-46`
- Create: `src/powers/outcomes.test.ts`
- Test: `src/powers/rain.test.ts`

**Interfaces:**
- Consumes: Task 1's `MAX_POND_FISH`, `fishCount`, `hasFish`, `restoreFish()`, `stunFish()`, and delta-time-aware pond update bridge.
- Produces:
  - `World.stockedPondNear(x, z, radius): boolean`
  - `World.restoreFishNear(x, z, radius): number`
  - count-preserving `World.syncPonds(wetted, rng, lowFx)`
  - `InteractionKind = 'stunFish'` for Lightning-on-pond
  - first-impact-only Rain restoration

- [ ] **Step 1: Write failing World population and radius tests**

Add to `src/world/world.test.ts`:

```ts
describe('World pond fish', () => {
  it('combines surviving fish when two lakes merge and caps the result at three', () => {
    const craters = [
      { x: 0, z: 0, radius: 2.5, depth: 1.5 },
      { x: 6, z: 0, radius: 2.5, depth: 1.5 },
    ]
    const world = floodedWorld(craters)
    world.fillCratersNear(3, 0, 20, new RNG(1))
    world.ponds[0].catchFish()
    world.ponds[1].catchFish()
    world.ponds[1].catchFish()

    craters.push({ x: 3, z: 0, radius: 2.5, depth: 1.5 })
    world.refloodBasins(new RNG(2))

    expect(world.ponds).toHaveLength(1)
    expect(world.ponds[0].fishCount).toBe(3)
  })

  it('does not resurrect an empty lake when a new crater expands its basin', () => {
    const craters = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const world = floodedWorld(craters)
    world.fillCratersNear(0, 0, 10, new RNG(1))
    while (world.ponds[0].catchFish()) {
      expect(world.ponds[0].fishCount).toBeGreaterThanOrEqual(0)
    }

    craters.push({ x: 3, z: 0, radius: 3, depth: 1.5 })
    world.refloodBasins(new RNG(2))

    expect(world.ponds[0].fishCount).toBe(0)
  })

  it('restores only ponds whose basin radius intersects the rain radius', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 2, depth: 1.5 },
      { x: 9, z: 0, radius: 2, depth: 1.5 },
    ])
    world.fillCratersNear(4.5, 0, 20, new RNG(1))
    for (const pond of world.ponds) {
      while (pond.catchFish()) {
        expect(pond.fishCount).toBeGreaterThanOrEqual(0)
      }
    }

    expect(world.restoreFishNear(-3, 0, 1.1)).toBe(1)
    expect(world.ponds.find(pond => pond.x < 4)!.fishCount).toBe(3)
    expect(world.ponds.find(pond => pond.x > 4)!.fishCount).toBe(0)
  })

  it('distinguishes nearby water from nearby stocked water', () => {
    const world = floodedWorld([{ x: 0, z: 0, radius: 3, depth: 1.5 }])
    world.fillCratersNear(0, 0, 10, new RNG(1))
    expect(world.pondNear(0, 0, 5)).toBe(true)
    expect(world.stockedPondNear(0, 0, 5)).toBe(true)

    while (world.ponds[0].catchFish()) {
      expect(world.ponds[0].fishCount).toBeGreaterThanOrEqual(0)
    }

    expect(world.pondNear(0, 0, 5)).toBe(true)
    expect(world.stockedPondNear(0, 0, 5)).toBe(false)
  })
})
```

- [ ] **Step 2: Write failing power-integration tests**

In `src/powers/matrix.test.ts`, change the expected Lightning pond cell:

```ts
pond: ['stunFish'],
```

Create `src/powers/outcomes.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { EventBus } from '../core/events'
import type { Pond } from '../world/objects'
import type { CastCtx } from './power'
import { OUTCOME_HANDLERS } from './outcomes'

describe('pond power outcomes', () => {
  it('stuns existing fish and emits the compatibility event without consuming them', () => {
    const pond = { stunFish: vi.fn(() => true) } as unknown as Pond
    const emit = vi.fn()
    const ctx = {
      x: 1,
      z: 2,
      world: { pondAt: () => pond },
      bus: { emit } as unknown as EventBus,
    } as unknown as CastCtx

    OUTCOME_HANDLERS.stunFish(ctx, 0)

    expect(pond.stunFish).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({ type: 'fish:floated' })
  })

  it('does not emit a fish event for an empty pond', () => {
    const pond = { stunFish: vi.fn(() => false) } as unknown as Pond
    const emit = vi.fn()
    const ctx = {
      x: 1,
      z: 2,
      world: { pondAt: () => pond },
      bus: { emit } as unknown as EventBus,
    } as unknown as CastCtx

    OUTCOME_HANDLERS.stunFish(ctx, 0)

    expect(emit).not.toHaveBeenCalled()
  })
})
```

Extend `src/powers/rain.test.ts` imports and mock only construction-time visual dependencies:

```ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../core/events'
import type { CastCtx } from './power'
import { Rain, rainOffset } from './rain'

vi.mock('../fx/clayMaterial', async () => {
  const actual = await import('three')
  return { clayMaterial: vi.fn(() => new actual.MeshToonMaterial()) }
})

vi.mock('../fx/wobble', () => ({
  wobble: <T>(geometry: T): T => geometry,
}))
```

Add this Rain timeline test:

```ts
it('restores fish once after the first crater-fill impact', () => {
  const fillCratersNear = vi.fn()
  const restoreFishNear = vi.fn()
  const world = {
    campfire: { lit: false, x: 99, z: 99 },
    douseNear: vi.fn(),
    fillCratersNear,
    restoreFishNear,
    growFruitNear: vi.fn(),
    bloomNear: vi.fn(),
    grumpNear: vi.fn(),
    sadNear: vi.fn(),
  }
  const ctx = {
    x: 0,
    z: 0,
    kind: 'ground',
    power: 'rain',
    world,
    island: { sampleHeight: () => 0, group: new THREE.Group() },
    scene: new THREE.Scene(),
    fx: {},
    bus: new EventBus(),
    rng: new RNG(1),
    lowFx: true,
  } as unknown as CastCtx

  const timeline = new Rain().cast(ctx)
  timeline.update(1.2)
  timeline.update(1)

  expect(restoreFishNear).toHaveBeenCalledTimes(1)
  expect(fillCratersNear.mock.invocationCallOrder[0]).toBeLessThan(
    restoreFishNear.mock.invocationCallOrder[0],
  )
})
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run src/world/world.test.ts src/powers/matrix.test.ts src/powers/outcomes.test.ts src/powers/rain.test.ts
```

Expected: FAIL for missing count preservation, `stockedPondNear`, `restoreFishNear`, and `stunFish` interaction.

- [ ] **Step 4: Preserve populations and add World queries**

Import `MAX_POND_FISH` in `src/world/world.ts`. Add:

```ts
stockedPondNear(x: number, z: number, radius: number): boolean {
  return this.ponds.some(pond => (
    pond.hasFish && Math.hypot(pond.x - x, pond.z - z) <= radius
  ))
}

restoreFishNear(x: number, z: number, radius: number): number {
  let restored = 0
  for (const pond of this.ponds) {
    const reached = Math.hypot(pond.x - x, pond.z - z) - pond.radius <= radius
    if (reached && pond.restoreFish()) restored++
  }
  return restored
}
```

In `syncPonds`, replace `keepsFish` and post-construction mutation with:

```ts
const fishCount = absorbed.length === 0
  ? MAX_POND_FISH
  : Math.min(
      MAX_POND_FISH,
      absorbed.reduce((sum, pond) => sum + pond.fishCount, 0),
    )
for (const pond of absorbed) this.removePond(pond)

const pond = new Pond(
  basin,
  (px, pz) => this.island.sampleHeight(px, pz),
  rng,
  lowFx,
  fishCount,
)
```

- [ ] **Step 5: Rename and implement the Lightning stun outcome**

In `src/powers/matrix.ts`, replace every `floatFish` interaction-kind occurrence with `stunFish`. Keep the matrix cell as:

```ts
lightning: {
  tree: ['ignite'],
  hut: ['ignite'],
  villager: ['zap'],
  pond: ['stunFish'],
  campfire: ['flare'],
  crater: [],
  ground: [],
},
```

In `src/powers/outcomes.ts`:

```ts
stunFish: (ctx) => {
  const pond = ctx.world.pondAt(ctx.x, ctx.z)
  if (pond?.stunFish()) ctx.bus.emit({ type: 'fish:floated' })
},
```

- [ ] **Step 6: Restore fish once during Rain's first impact**

Beside `bloomed` in `Rain.cast`:

```ts
let bloomed = false
let fishRestored = false
```

Immediately after `fillCratersNear` inside `effectTick`:

```ts
ctx.world.fillCratersNear(ctx.x, ctx.z, RAIN_RADIUS, ctx.rng, ctx.lowFx)
if (!fishRestored) {
  ctx.world.restoreFishNear(ctx.x, ctx.z, RAIN_RADIUS)
  fishRestored = true
}
```

- [ ] **Step 7: Run focused and regression tests**

Run:

```bash
npx vitest run src/world/water.test.ts src/world/world.test.ts src/powers/matrix.test.ts src/powers/outcomes.test.ts src/powers/rain.test.ts
npx tsc --noEmit
```

Expected: all listed tests PASS and TypeScript exits zero.

- [ ] **Step 8: Commit only if explicitly authorized**

If the user explicitly authorizes a commit for this task:

```bash
git add src/world/world.ts src/world/world.test.ts src/powers/matrix.ts src/powers/matrix.test.ts src/powers/outcomes.ts src/powers/outcomes.test.ts src/powers/rain.ts src/powers/rain.test.ts
git commit -m "feat: integrate pond fish with powers"
```

Otherwise skip this step.

---

### Task 3: Make the FSM and Nudge fish-aware

**Files:**
- Modify: `src/villagers/fsm.ts:8-65`
- Modify: `src/villagers/fsm.test.ts:5-125`
- Modify: `src/powers/nudge.ts:16-65`
- Modify: `src/powers/nudge.test.ts:5-76`
- Modify: `src/powers/outcomes.ts:11-39`
- Modify: `src/powers/outcomes.test.ts`

**Interfaces:**
- Consumes: `World.pondNear`, Task 2's `World.stockedPondNear`, and `Pond.hasFish`.
- Produces:
  - `SuggestionKind` includes `drink`
  - `stateForSuggestion(kind): VillagerState`
  - `FsmCtx.hasPond` and `FsmCtx.hasFishPond`
  - `GroundNudgeCtx.pondNear` and `GroundNudgeCtx.stockedPondNear`
  - direct empty-pond Nudge resolves to `drink`
- Transitional constraint: keep `Suggestion.ttl` in this task so `Villager` remains type-correct. Task 5 removes the timer after persistence tests exist.

- [ ] **Step 1: Write failing FSM tests for stocked fishing and suggestion-only drinking**

Update the `base` context in `src/villagers/fsm.test.ts`:

```ts
const base = (o: Partial<FsmCtx> = {}): FsmCtx => ({
  state: 'wander',
  fireNear: false,
  freshGrave: false,
  hasRuin: false,
  hasSite: false,
  hasPond: false,
  hasFishPond: false,
  hasTree: true,
  campfireLit: true,
  needsFire: false,
  hasFruitTree: false,
  fireOut: false,
  suggestion: null,
  rng: new RNG(3),
  ...o,
})
```

Replace the fishing and drinking availability tests with:

```ts
it('fishes only when at least one pond is stocked', () => {
  let fished = false
  for (let seed = 0; seed < 300; seed++) {
    if (decideNext(base({
      rng: new RNG(seed),
      hasPond: true,
      hasFishPond: true,
    })) === 'fish') fished = true
  }
  expect(fished).toBe(true)

  for (let seed = 0; seed < 300; seed++) {
    expect(decideNext(base({
      rng: new RNG(seed),
      hasPond: true,
      hasFishPond: false,
    }))).not.toBe('fish')
  }
})

it('never rolls drink from idle but accepts a drink suggestion at a pond', () => {
  for (let seed = 0; seed < 400; seed++) {
    expect(decideNext(base({
      rng: new RNG(seed),
      hasPond: true,
    }))).not.toBe('drink')
  }

  expect(decideNext(base({
    hasPond: true,
    suggestion: { kind: 'drink', x: 0, z: 0, ttl: 5 },
    rng: { next: () => 0.5 } as unknown as RNG,
  }))).toBe('drink')
})

it('rejects a drink suggestion when no pond exists', () => {
  for (let seed = 0; seed < 100; seed++) {
    expect(decideNext(base({
      hasPond: false,
      suggestion: { kind: 'drink', x: 0, z: 0, ttl: 5 },
      rng: new RNG(seed),
    }))).not.toBe('drink')
  }
})
```

- [ ] **Step 2: Write failing ground- and direct-pond Nudge tests**

Add `stockedPondNear: false` to the default `GroundNudgeCtx` in `src/powers/nudge.test.ts`. Replace the pond tests with:

```ts
it('suggests fishing beside stocked water', () => {
  expect(kinds({ pondNear: true, stockedPondNear: true })).toContain('fish')
  expect(kinds({ pondNear: true, stockedPondNear: true })).not.toContain('drink')
})

it('suggests drinking beside water only when every nearby pond is empty', () => {
  expect(kinds({ pondNear: true, stockedPondNear: false })).toContain('drink')
  expect(kinds({ pondNear: true, stockedPondNear: false })).not.toContain('fish')
})

it('suggests neither fishing nor drinking away from water', () => {
  expect(kinds({ pondNear: false, stockedPondNear: false })).not.toContain('fish')
  expect(kinds({ pondNear: false, stockedPondNear: false })).not.toContain('drink')
})
```

Add to `src/powers/outcomes.test.ts`:

```ts
describe('pond Nudge outcomes', () => {
  const cast = (hasFish: boolean): ReturnType<typeof vi.fn> => {
    const suggest = vi.fn()
    const ctx = {
      kind: 'pond',
      x: 4,
      z: -2,
      world: {
        pondAt: () => ({ hasFish }),
        suggest,
      },
    } as unknown as CastCtx

    OUTCOME_HANDLERS.suggest(ctx, 0)
    return suggest
  }

  it('suggests fishing at a stocked pond', () => {
    expect(cast(true)).toHaveBeenCalledWith(4, -2, 'fish')
  })

  it('suggests drinking at an empty pond', () => {
    expect(cast(false)).toHaveBeenCalledWith(4, -2, 'drink')
  })
})
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run src/villagers/fsm.test.ts src/powers/nudge.test.ts src/powers/outcomes.test.ts
```

Expected: FAIL because `drink` is not a suggestion, the FSM has no `hasFishPond`, and ground Nudge cannot distinguish stocked ponds.

- [ ] **Step 4: Add suggestion-only drinking and stocked fishing to the FSM**

In `src/villagers/fsm.ts`:

```ts
export type SuggestionKind =
  | 'chop'
  | 'fish'
  | 'drink'
  | 'build'
  | 'makeFire'
  | 'gather'

export type FsmCtx = {
  state: VillagerState
  fireNear: boolean
  freshGrave: boolean
  hasRuin: boolean
  hasSite: boolean
  hasPond: boolean
  hasFishPond: boolean
  hasTree: boolean
  campfireLit: boolean
  needsFire: boolean
  hasFruitTree: boolean
  fireOut: boolean
  suggestion: Suggestion | null
  rng: RNG
}
```

Change the fish candidate and add a zero-base-weight drink candidate:

```ts
{ state: 'fish', weight: 4, when: c => c.hasFishPond },
{
  state: 'drink',
  weight: 0,
  when: c => c.hasPond && c.suggestion?.kind === 'drink',
},
```

Export the mapping for Task 5:

```ts
const SUGGESTED: Record<SuggestionKind, VillagerState> = {
  chop: 'chopTree',
  fish: 'fish',
  drink: 'drink',
  build: 'buildHut',
  makeFire: 'makeFire',
  gather: 'gather',
}

export function stateForSuggestion(kind: SuggestionKind): VillagerState {
  return SUGGESTED[kind]
}
```

- [ ] **Step 5: Split ground water intent and direct pond intent**

Add `stockedPondNear: boolean` to `GroundNudgeCtx`. Replace the current single pond option:

```ts
if (ctx.stockedPondNear) {
  options.push({ kind: 'fish', weight: 3 })
} else if (ctx.pondNear) {
  options.push({ kind: 'drink', weight: 3 })
}
```

In `src/powers/outcomes.ts`, resolve a direct pond from its current state:

```ts
case 'pond': {
  const pond = ctx.world.pondAt(ctx.x, ctx.z)
  return pond ? (pond.hasFish ? 'fish' : 'drink') : null
}
```

Pass both queries for a ground Nudge:

```ts
pondNear: ctx.world.pondNear(ctx.x, ctx.z, NUDGE_SENSE_RADIUS),
stockedPondNear: ctx.world.stockedPondNear(
  ctx.x,
  ctx.z,
  NUDGE_SENSE_RADIUS,
),
```

- [ ] **Step 6: Run focused tests and TypeScript**

Run:

```bash
npx vitest run src/villagers/fsm.test.ts src/powers/nudge.test.ts src/powers/outcomes.test.ts
npx tsc --noEmit
```

Expected: all listed tests PASS and TypeScript exits zero.

- [ ] **Step 7: Commit only if explicitly authorized**

If the user explicitly authorizes a commit for this task:

```bash
git add src/villagers/fsm.ts src/villagers/fsm.test.ts src/powers/nudge.ts src/powers/nudge.test.ts src/powers/outcomes.ts src/powers/outcomes.test.ts
git commit -m "feat: make nudge fish aware"
```

Otherwise skip this step.

---

### Task 4: Catch one fish, fall back to drinking, and correct held props

**Files:**
- Modify: `src/villagers/villager.ts:29-33,91-133,200-238,287-360,741-845,1007-1075`
- Test: `src/villagers/villager.test.ts:9-63,185-300`

**Interfaces:**
- Consumes: Task 1's `Pond.hasFish` and `Pond.catchFish()`, Task 3's `FsmCtx.hasFishPond` and drink suggestion.
- Produces:
  - `FISH_CAST_TIME = 4`
  - stocked-only fish target selection
  - `enter(state, world, preferredPond?)` for race fallback
  - dynamic fishing line/float alignment
  - held fruit parented to `arms[0]`

- [ ] **Step 1: Widen the activity harness and write failing fishing tests**

In `src/villagers/villager.test.ts`, make `rod` a Three group with named line and float children in `activityHarness`:

```ts
// Replace the prop fields in ActivityHarness.
rod: THREE.Object3D
heldFruit: THREE.Object3D
alignFishingRig(pond: Pond): void
```

Build the test rig with:

```ts
const rod = bone()
rod.name = 'fishing-rig'
rod.visible = false
const line = bone()
line.name = 'fishing-line'
const fishingFloat = bone()
fishingFloat.name = 'fishing-float'
rod.add(line, fishingFloat)
villager.rod = rod as unknown as ActivityHarness['rod']
```

Change the held-fruit harness parent:

```ts
const heldFruit = bone()
heldFruit.name = 'held-fruit'
heldFruit.visible = false
heldFruit.position.set(0, -0.18, 0.06)
villager.heldFruit = heldFruit as unknown as ActivityHarness['heldFruit']
villager.arms[0].add(heldFruit)
```

Add:

```ts
describe('fishing population', () => {
  it('catches exactly one fish after one four-second cast', () => {
    const emit = vi.fn()
    const pond = {
      x: 0,
      z: 0,
      hasFish: true,
      catchFish: vi.fn(() => true),
      group: { position: { y: 0 } },
    } as unknown as Pond
    const villager = activityHarness('fish', pond)
    villager.arrived = true
    villager.actionTimer = 0.1
    villager.bus = { emit } as unknown as EventBus
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(0.11, true, world)

    expect(pond.catchFish).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({ type: 'villager:fished' })
    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })

  it('switches to drinking when another villager takes the last fish', () => {
    const pond = {
      x: 0,
      z: 0,
      hasFish: false,
      catchFish: vi.fn(() => false),
    } as unknown as Pond
    const villager = activityHarness('fish', pond)
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.enter).toHaveBeenCalledWith('drink', world, pond)
    expect(pond.catchFish).not.toHaveBeenCalled()
  })

  it('abandons fishing when the pond itself disappears', () => {
    const pond = { hasFish: true } as Pond
    const villager = activityHarness('fish', pond)
    const world = { ponds: [] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })
})
```

- [ ] **Step 2: Write failing prop-alignment tests**

Add:

```ts
describe('held prop alignment', () => {
  it('aligns the fishing float to the target water level', () => {
    const pond = {
      group: { position: { y: -0.5 } },
    } as Pond
    const villager = activityHarness('fish', pond)
    villager.group.position.y = 0.2

    villager.alignFishingRig(pond)

    const fishingFloat = villager.rod.getObjectByName('fishing-float')!
    const line = villager.rod.getObjectByName('fishing-line')!
    expect(fishingFloat.position.y).toBeCloseTo(-0.68)
    expect(line.position.y).toBeGreaterThan(fishingFloat.position.y)
    expect(line.scale.y).toBeGreaterThan(0)
  })

  it('keeps held fruit on the carrying arm through the bite pose', () => {
    const tree = {
      x: 0,
      z: 0,
      state: 'normal',
      hasFruit: true,
      pickFruit: vi.fn(() => true),
    }
    const villager = activityHarness('harvest')
    villager.targetTree = tree as unknown as Tree
    const world = { ponds: [], trees: [tree] } as unknown as World

    villager.performActivity(1.3, true, world)

    expect(villager.heldFruit.parent).toBe(villager.arms[0])
    expect(villager.heldFruit.visible).toBe(true)
    expect(villager.heldFruit.position.y).toBeLessThan(0)
  })
})
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run src/villagers/villager.test.ts
```

Expected: FAIL because fishing still calls `floatFish()` probabilistically, no preferred pond is accepted, and fruit is still a group-level object.

- [ ] **Step 4: Make one casting cycle consume one fish**

Export the duration:

```ts
export const FISH_CAST_TIME = 4
```

Change `enter` to accept a preferred pond:

```ts
private enter(
  state: VillagerState,
  world: World,
  preferredPond: Pond | null = null,
): void {
```

In the `fish` entry branch, filter stocked ponds and resolve the directly nudged pond once:

```ts
case 'fish': {
  const ponds = world.ponds.filter(pond => pond.hasFish)
  const nudgedPond = suggestion?.kind === 'fish'
    ? world.pondAt(suggestion.x, suggestion.z)
    : null
  this.targetPond = nudgedPond?.hasFish
    ? nudgedPond
    : suggestion?.kind === 'fish'
      ? ponds.sort((a, b) => (
          Math.hypot(a.x - suggestion.x, a.z - suggestion.z)
          - Math.hypot(b.x - suggestion.x, b.z - suggestion.z)
        ))[0] ?? null
      : ponds.sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
  if (!this.targetPond) return this.enter('wander', world)
  this.setTarget(this.targetPond.shoreNear(this.x, this.z))
  return
}
```

Use `preferredPond` in the drink branch:

```ts
case 'drink': {
  const ponds = [...world.ponds]
  const nudgedPond = suggestion?.kind === 'drink'
    ? world.pondAt(suggestion.x, suggestion.z)
    : null
  this.targetPond = preferredPond && world.ponds.includes(preferredPond)
    ? preferredPond
    : nudgedPond
      ?? ponds.sort((a, b) => distance(this, a) - distance(this, b))[0]
      ?? null
  if (!this.targetPond) return this.enter('wander', world)
  this.setTarget(this.targetPond.shoreNear(this.x, this.z))
  return
}
```

Replace the fishing activity:

```ts
case 'fish': {
  if (!this.targetPond || !world.ponds.includes(this.targetPond)) {
    this.rod.visible = false
    this.enter('wander', world)
    return
  }
  if (!this.targetPond.hasFish) {
    const pond = this.targetPond
    this.rod.visible = false
    this.enter('drink', world, pond)
    return
  }
  if (this.targetDistance() < 0.25) {
    if (!this.arrived) {
      this.arrived = true
      this.actionTimer = FISH_CAST_TIME
      this.rod.visible = true
      this.emote('fish')
    }
    this.alignFishingRig(this.targetPond)
    this.actionTimer -= dt
    if (this.actionTimer <= 0) {
      if (this.targetPond.catchFish()) {
        this.bus.emit({ type: 'villager:fished' })
        this.enter('wander', world)
      } else {
        const pond = this.targetPond
        this.enter('drink', world, pond)
      }
    }
  }
  return
}
```

In `context(world)`:

```ts
hasPond: world.ponds.length > 0,
hasFishPond: world.ponds.some(pond => pond.hasFish),
```

- [ ] **Step 5: Lower and dynamically align the fishing rig**

Lower the rod by 0.12:

```ts
rod.position.set(0.3, 0.8, 0.42)
```

Create the line with unit height so `scale.y` represents its live length:

```ts
const line = new THREE.Mesh(
  new THREE.CylinderGeometry(0.006, 0.006, 1, 4),
  clayMaterial(PALETTE.inkSoft, { flat: true }),
)
```

Add:

```ts
private alignFishingRig(pond: Pond): void {
  const line = this.rod.getObjectByName('fishing-line')
  const fishingFloat = this.rod.getObjectByName('fishing-float')
  if (!line || !fishingFloat) return

  const lineTop = 1.02
  const waterY = pond.group.position.y - this.group.position.y + 0.02
  fishingFloat.position.set(0.4, waterY, 0.98)
  line.position.set(0.4, (lineTop + waterY) / 2, 0.98)
  line.scale.y = Math.max(0.05, lineTop - waterY)
}
```

- [ ] **Step 6: Parent fruit to the carrying arm**

Use a slightly larger local sphere because `model` scales the arm and fruit by `MODEL_SCALE`:

```ts
this.heldFruit = new THREE.Mesh(
  new THREE.SphereGeometry(0.14, 7, 5),
  clayMaterial(PALETTE.smockA),
)
this.heldFruit.name = 'held-fruit'
this.heldFruit.position.set(0, -0.18, 0.06)
this.heldFruit.visible = false
this.heldFruit.castShadow = !lowFx
this.arms[0].add(this.heldFruit)
```

Remove `this.heldFruit` from `this.group.add(...)`. During harvest, never assign a group-space fruit position. The bite pose only rotates the carrying arm:

```ts
if (ticked) {
  this.arms[0].rotation.z = -2.1
  this.head.rotation.x = -0.12
}
```

After a successful pick:

```ts
this.heldFruit.visible = true
this.eating = 1.6
```

- [ ] **Step 7: Run focused tests and TypeScript**

Run:

```bash
npx vitest run src/villagers/villager.test.ts src/villagers/fsm.test.ts
npx tsc --noEmit
```

Expected: all listed tests PASS and TypeScript exits zero.

- [ ] **Step 8: Commit only if explicitly authorized**

If the user explicitly authorizes a commit for this task:

```bash
git add src/villagers/villager.ts src/villagers/villager.test.ts
git commit -m "feat: make villagers consume pond fish"
```

Otherwise skip this step.

---

### Task 5: Keep Nudge suggestions until one requested action completes

**Files:**
- Modify: `src/villagers/fsm.ts:9-10`
- Modify: `src/villagers/fsm.test.ts:94-125`
- Modify: `src/world/world.ts:490-502`
- Modify: `src/world/world.test.ts:706-723`
- Modify: `src/villagers/villager.ts:292-337,475-495,641-920,932-1075`
- Test: `src/villagers/villager.test.ts`

**Interfaces:**
- Consumes: Task 3's `stateForSuggestion(kind)` and Task 4's deterministic activity completion points.
- Produces:
  - `Suggestion = { kind; x; z }` with no timer
  - `Villager.completeSuggestionFor(state)` and `cancelSuggestionFor(state)` internal lifecycle
  - `Villager.normalizeSuggestion(world)` internal invalidation/fallback boundary
  - persistence across overrides and unrelated idle choices
  - fish-to-drink conversion when stock disappears

- [ ] **Step 1: Write failing payload and lifecycle tests**

In `src/world/world.test.ts`, extend the reach test:

```ts
it('sends a completion-based suggestion without a wall-clock TTL', () => {
  const world = makeWorld()
  const villager = idleVillagerAt(0, 0)
  world.villagers = [villager] as Villager[]

  world.suggest(0, 0, 'chop')

  expect(villager.suggest).toHaveBeenCalledWith({
    kind: 'chop',
    x: 0,
    z: 0,
  })
})
```

Remove `ttl` from every suggestion fixture in `src/villagers/fsm.test.ts`.

In `src/villagers/villager.test.ts`, import the type and extend the existing harness:

```ts
import type { Suggestion } from './fsm'

// Add to ActivityHarness.
suggestion: Suggestion | null

// Add inside activityHarness initialization.
villager.suggestion = null
```

Add to `src/villagers/villager.test.ts`:

```ts
describe('completion-based suggestions', () => {
  it('does not expire a suggestion merely because time passes', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: { kind: 'chop'; x: number; z: number }
      update(dt: number, qt: number, world: World, island: never): void
      alive: boolean
      huddleTime: number
      zapTime: number
      rainTime: number
      lastQt: number
      state: 'wander'
      timer: number
      thirst: number
      arrived: boolean
      updatePerformance: ReturnType<typeof vi.fn>
      updateFleeTarget: ReturnType<typeof vi.fn>
      steer: ReturnType<typeof vi.fn>
      performActivity: ReturnType<typeof vi.fn>
      enter: ReturnType<typeof vi.fn>
    }
    Object.assign(villager, {
      suggestion: { kind: 'chop', x: 1, z: 2 },
      alive: true,
      huddleTime: 0,
      zapTime: -1,
      rainTime: 0,
      lastQt: 0,
      state: 'wander',
      timer: 10,
      thirst: 0,
      arrived: true,
      updatePerformance: vi.fn(() => false),
      updateFleeTarget: vi.fn(),
      steer: vi.fn(),
      performActivity: vi.fn(),
      enter: vi.fn(),
    })
    const world = {
      nearestBurning: () => null,
      ponds: [],
      trees: [{ state: 'normal' }],
    } as unknown as World

    villager.update(7, 0, world, {} as never)

    expect(villager.suggestion).toEqual({ kind: 'chop', x: 1, z: 2 })
  })

  it('preserves a suggestion while panic overrides the current state', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: { kind: 'chop'; x: number; z: number }
      state: 'wander' | 'flee'
      rng: RNG
      world: { submerged(): boolean }
      timer: number
      retargetTimer: number
      x: number
      z: number
      setTarget: ReturnType<typeof vi.fn>
      emote: ReturnType<typeof vi.fn>
      panic(from: { x: number; z: number }): void
    }
    Object.assign(villager, {
      suggestion: { kind: 'chop', x: 1, z: 2 },
      state: 'wander',
      rng: new RNG(1),
      world: { submerged: () => false },
      timer: 0,
      retargetTimer: 0,
      x: 0,
      z: 0,
      setTarget: vi.fn(),
      emote: vi.fn(),
    })

    villager.panic({ x: 0.5, z: 0 })

    expect(villager.state).toBe('flee')
    expect(villager.suggestion).toEqual({ kind: 'chop', x: 1, z: 2 })
  })

  it('clears a suggestion only when its matching action completes', () => {
    const pond = {
      x: 0,
      z: 0,
      hasFish: true,
      catchFish: vi.fn(() => true),
      group: { position: { y: 0 } },
    } as unknown as Pond
    const villager = activityHarness('fish', pond)
    villager.suggestion = { kind: 'fish', x: 0, z: 0 }
    villager.arrived = true
    villager.actionTimer = 0.01
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(0.02, true, world)

    expect(villager.suggestion).toBeNull()
  })

  it('converts a depleted fishing suggestion into one completed drink', () => {
    const pond = { x: 0, z: 0, hasFish: false } as Pond
    const villager = activityHarness('fish', pond)
    villager.suggestion = { kind: 'fish', x: 0, z: 0 }
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.suggestion?.kind).toBe('drink')
    expect(villager.enter).toHaveBeenCalledWith('drink', world, pond)
  })

  it('clears a suggestion whose required world resource no longer exists', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: Suggestion | null
      normalizeSuggestion(world: World): void
    }
    villager.suggestion = { kind: 'drink', x: 0, z: 0 }

    villager.normalizeSuggestion({ ponds: [] } as unknown as World)

    expect(villager.suggestion).toBeNull()
  })
})
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run src/world/world.test.ts src/villagers/fsm.test.ts src/villagers/villager.test.ts
```

Expected: FAIL because `Suggestion` still requires `ttl` and `enter()` consumes every suggestion immediately.

- [ ] **Step 3: Remove the timer contract**

In `src/villagers/fsm.ts`:

```ts
export type Suggestion = {
  kind: SuggestionKind
  x: number
  z: number
}
```

In `World.suggest`:

```ts
for (const villager of idle) villager.suggest({ kind, x, z })
```

Delete the `suggestion.ttl` decrement block from `Villager.update`.

- [ ] **Step 4: Add explicit completion and cancellation helpers**

Import `stateForSuggestion` in `src/villagers/villager.ts`. Add:

```ts
private suggestionForState(state: VillagerState): Suggestion | null {
  const suggestion = this.suggestion
  return suggestion && stateForSuggestion(suggestion.kind) === state
    ? suggestion
    : null
}

private completeSuggestionFor(state: VillagerState): void {
  if (this.suggestionForState(state)) this.suggestion = null
}

private cancelSuggestionFor(state: VillagerState): void {
  if (this.suggestionForState(state)) this.suggestion = null
}

private convertFishingSuggestionToDrink(): void {
  if (this.suggestion?.kind !== 'fish') return
  this.suggestion = { ...this.suggestion, kind: 'drink' }
}

private normalizeSuggestion(world: World): void {
  const suggestion = this.suggestion
  if (!suggestion) return

  switch (suggestion.kind) {
    case 'chop':
      if (!world.trees.some(tree => tree.state === 'normal')) this.suggestion = null
      return
    case 'fish':
      if (world.ponds.some(pond => pond.hasFish)) return
      if (world.ponds.length > 0) this.convertFishingSuggestionToDrink()
      else this.suggestion = null
      return
    case 'drink':
      if (world.ponds.length === 0) this.suggestion = null
      return
    case 'build':
      if (!world.hasHutWork()) this.suggestion = null
      return
    case 'makeFire':
      if (!world.needsFire()) this.suggestion = null
      return
    case 'gather':
      return
  }
}
```

Call the normalizer immediately after the alive guard in `update`, before any performance or danger override can return early:

```ts
if (!this.alive) return
this.normalizeSuggestion(world)
```

At the start of `enter`, keep the field and expose it only to its matching state:

```ts
const suggestion = this.suggestionForState(state)
```

Delete the old unconditional `this.suggestion = null`. After `this.timer = stateDuration(...)`, make a pending suggestion retry promptly whenever the villager returns to wander:

```ts
if (state === 'wander' && this.suggestion) {
  this.timer = Math.min(this.timer, 0.4)
}
```

- [ ] **Step 5: Hold accepted suggested work through its ordinary state timeout**

Replace the single timer-expiry line in `update`:

```ts
if (this.timer <= 0) {
  const activeSuggestion = this.suggestionForState(this.state)
  if (activeSuggestion && this.state === 'gather') {
    this.completeSuggestionFor('gather')
    this.enter(decideNext(this.context(world)), world)
  } else if (activeSuggestion) {
    this.timer = 0.25
  } else {
    this.enter(decideNext(this.context(world)), world)
  }
}
```

This keeps travel and action watchdogs from cancelling accepted Nudge work, while a suggested gather still has a definite completion at its state-duration boundary.

- [ ] **Step 6: Mark every requested action's success and failure boundary**

Immediately before leaving a successfully completed matching action, call:

```ts
this.completeSuggestionFor('chopTree')
this.completeSuggestionFor('buildHut')
this.completeSuggestionFor('fish')
this.completeSuggestionFor('drink')
this.completeSuggestionFor('makeFire')
```

Place only the matching call in each corresponding branch:

- after `targetTree.chop()`;
- after hut `progress >= 1`;
- after `catchFish()` succeeds;
- after the drink cycle ends;
- before entering `sitAtFire` when the fire becomes lit or is rebuilt.

Before abandoning a removed or impossible target, call the matching `cancelSuggestionFor(state)`. Cover tree no longer normal, missing/invalid hut, removed pond, and invalid campfire reservation.

When fish disappear but the pond remains:

```ts
if (!this.targetPond.hasFish) {
  const pond = this.targetPond
  this.convertFishingSuggestionToDrink()
  this.rod.visible = false
  this.enter('drink', world, pond)
  return
}
```

On drink completion, `completeSuggestionFor('drink')` clears both an original drink suggestion and a converted fishing suggestion.

- [ ] **Step 7: Run focused tests and the full villager/FSM suite**

Run:

```bash
npx vitest run src/world/world.test.ts src/villagers/fsm.test.ts src/villagers/villager.test.ts src/powers/nudge.test.ts src/powers/outcomes.test.ts
npx tsc --noEmit
```

Expected: all listed tests PASS and TypeScript exits zero.

- [ ] **Step 8: Commit only if explicitly authorized**

If the user explicitly authorizes a commit for this task:

```bash
git add src/villagers/fsm.ts src/villagers/fsm.test.ts src/world/world.ts src/world/world.test.ts src/villagers/villager.ts src/villagers/villager.test.ts
git commit -m "feat: persist nudge through one action"
```

Otherwise skip this step.

---

### Task 6: Replace the Nudge target rings with a pointing finger

**Files:**
- Modify: `src/styles.css:173-256`

**Interfaces:**
- Consumes: existing `.power-glyph[data-glyph='nudge']` DOM, palette custom properties, cooldown fill, disabled styling.
- Produces: a CSS-only skin-clay finger pressing toward a yellow dimple; no emoji, image, SVG, or new DOM node.

- [ ] **Step 1: Replace the current Nudge glyph CSS**

Replace both existing Nudge pseudo-element rules and add a background drawing on the glyph itself:

```css
.power-glyph[data-glyph='nudge'] {
  background:
    radial-gradient(
      ellipse at 43% 61%,
      var(--skin) 0 22%,
      var(--ink-soft) 23% 29%,
      transparent 30%
    );
}

.power-glyph[data-glyph='nudge']::before {
  position: absolute;
  top: 0;
  left: 12px;
  width: 8px;
  height: 20px;
  transform: rotate(18deg);
  transform-origin: 50% 88%;
  border: 2px solid var(--ink-soft);
  border-radius: 58% 58% 45% 45% / 42% 42% 58% 58%;
  background: var(--skin);
  box-shadow: inset 2px 1px 0 var(--paper);
  content: '';
}

.power-glyph[data-glyph='nudge']::after {
  position: absolute;
  bottom: 0;
  left: 11px;
  width: 8px;
  height: 3px;
  border: 2px solid var(--yellow);
  border-radius: 50%;
  opacity: 0.8;
  content: '';
}
```

- [ ] **Step 2: Build and inspect the static states**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build PASS.

Then run:

```bash
npm run dev
```

Inspect Nudge at normal, hover, armed, cooldown, and disabled presentation. Expected: the fingertip points toward the dimple at 30-by-27-pixel glyph size; it does not read as a bullseye, exclamation mark, or generic vertical pill.

- [ ] **Step 3: Tune only geometry if the silhouette is unclear**

Adjust only `top`, `left`, `width`, `height`, `rotation`, and border radii in the three Nudge rules. Keep palette tokens, DOM structure, accessibility label, two-second cooldown, and world ripple unchanged.

- [ ] **Step 4: Commit only if explicitly authorized**

If the user explicitly authorizes a commit for this task:

```bash
git add src/styles.css
git commit -m "style: draw pointing nudge glyph"
```

Otherwise skip this step.

---

### Task 7: Update architecture and verify the complete refinement

**Files:**
- Modify: `docs/architecture.md:26-37,58-73`
- Verify only: all source and test files changed in Tasks 1-6

**Interfaces:**
- Consumes: every final interface from Tasks 1-6.
- Produces: architecture documentation and end-to-end evidence; no new runtime API.

- [ ] **Step 1: Update `docs/architecture.md`**

Amend the existing module bullets with these exact facts:

- `src/world/objects.ts`: `Pond` owns three reusable underwater fish, a bounded `fishCount`, deterministic swim routes, individual catches, two-second Lightning stun, and allocation-free Rain restoration.
- `src/world/world.ts`: basin merging sums surviving fish up to three; `stockedPondNear` and `restoreFishNear` are the fish-aware query/mutation boundary.
- `src/villagers/fsm.ts`: fishing requires stocked water; drinking has zero ordinary idle weight and is reachable through thirst or a valid drink suggestion.
- `src/villagers/villager.ts`: a four-second completed cast consumes one fish; stale fishers drink; suggestions persist across priority overrides until one matching action completes; the float follows water level and fruit follows the arm.
- `src/powers/rain.ts`: first impact restores intersected ponds after crater filling, once per cast.
- `src/powers/nudge.ts`: ground intent distinguishes stocked water from empty water.
- `src/styles.css`: Nudge uses the CSS pointing-finger glyph.

Add a key-pattern paragraph stating:

```md
- Pond fish are a bounded visual resource owned entirely by `Pond`: meshes are allocated once, fishing hides one, Rain reuses and restores them, and Lightning changes only their temporary presentation. Availability is checked again at FSM selection, target acquisition, and mutation so simultaneous fishers cannot produce phantom catches. Nudge suggestions carry intent rather than a time-to-live; priority overrides preserve them, while completion or target invalidation clears them explicitly.
```

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Expected:

- all Vitest tests PASS;
- TypeScript exits zero;
- Vite production build succeeds;
- `git diff --check` prints nothing.

- [ ] **Step 3: Inspect scope and repository state**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the approved design, plan, implementation/test files, `src/styles.css`, and `docs/architecture.md` are changed. `STATUS.md` is absent from the diff.

- [ ] **Step 4: Perform the in-game acceptance checklist**

Run:

```bash
npm run dev
```

Verify:

1. Create a pond: three salmon fish are already visible below the surface and swim without clipping.
2. Wait for fishing: one four-second completed cast removes exactly one fish and unlock behavior still emits `villager:fished`.
3. Empty the pond: autonomous villagers stop choosing fishing.
4. Nudge the empty pond: reached villagers perform one drink cycle.
5. Rain the empty pond: three fish return below the surface once, under the shower ripples.
6. Catch during the remaining shower: the fish does not respawn on later half-second Rain ticks.
7. Lightning a stocked pond: only remaining fish surface for two seconds, then dive; the population does not change.
8. Lightning an empty pond: the power spectacle occurs without phantom fish.
9. Nudge stocked water, empty water, trees, buildable ground, and fire work: each reached villager retains intent through travel and finishes one matching action; nearby danger interrupts and the intent resumes afterward.
10. Observe fishing from multiple banks: the rod sits lower, points forward, the line reaches the actual water level, and the float does not hover.
11. Grow and harvest fruit: it stays on the hand and reaches the mouth without floating above the head.
12. Inspect Nudge at tray size and cooldown: the pointing finger and dimple remain legible.
13. Repeat with `?lowfx=1` and reduced motion: fish state and action semantics remain identical.

- [ ] **Step 5: Commit only if explicitly authorized**

If the user explicitly authorizes a final commit:

```bash
git add docs/architecture.md docs/superpowers/specs/2026-07-14-fishing-and-nudge-refinements-design.md docs/plans/9-fishing-and-nudge-refinements.md src
git commit -m "feat: refine fishing and nudge behavior"
```

Otherwise leave all work uncommitted and report the verified file list.

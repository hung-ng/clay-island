# Honest Ground Implementation Plan (Stage 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terrain the source of truth: overlapping craters merge into one lake with one water level, and nothing gets built on ground that is flooded, cratered, or occupied.

**Architecture:** A new pure module `src/world/terrain.ts` answers three questions about the ground (`waterLevelAt`, `isSubmerged`, `isBuildable`). Craters are grouped into connected **basins** whose water sits at one level — the lowest rim of the merged bowl. `Pond` keeps its public name and its place in `world.ponds` (so fishing, Moments and `resolveTarget` keep working) but is rebuilt to represent a whole basin with a terrain-fitted surface. Huts and the campfire then consult `isBuildable` and relocate rather than rebuild into a lake.

**Tech Stack:** TypeScript, Three.js r185, Vitest. No new dependencies.

Implements Stage 1 of `docs/superpowers/specs/2026-07-13-honest-world-design.md`. Fixes spec defects 3 (clipping water discs), 4 (huts rebuilt in ponds, fixed at 3) and 5 (campfire gone forever).

## Global Constraints

- **No new dependencies.** Three.js r185 and Vitest only.
- **Pure logic lives in its own module and is unit-tested directly.** Modules that touch `THREE` are tested with `vi.fn()` stubs, as `world.test.ts` already does. Do not construct a real `Island` in a test.
- **Determinism.** All randomness goes through `RNG` (`src/core/rng.ts`). Never call `Math.random()`.
- **`world.ponds` stays a `Pond[]`** with `x`, `z`, `radius` and `hasFish`, so `moments.ts` needs no change. `villager.ts` and `world.ts` *do* change, because a merged basin is not a circle — see the note below.
- **A merged basin is not a circle.** Three existing places assume a pond is a disc and must be corrected, or clicking dry land between two lobes of an L-shaped lake will register as "pond":
  - `world.ts:87` `resolveTarget` — `within(pond, x, z, pond.radius)`
  - `world.ts:99` `pondAt` — same
  - `villager.ts:641` — stands at `pond.radius` from the centre to fish, which for a merged lake is dry land

  Task 3 gives `Pond` a real `contains(x, z)` and a `shoreNear(x, z)`; Tasks 4 and 6 adopt them.
- **Island geometry constants** live in `src/world/island.ts`: `ISLAND_RADIUS = 15`, `WALK_RADIUS = 12`.
- **Existing behaviour must not regress.** `npm test` is 125 tests green before this plan starts; it must stay green.
- Run `npm test` and `npx tsc --noEmit` before every commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/world/terrain.ts` | **Create.** Pure. Basin grouping, water levels, and the `isBuildable` / `isSubmerged` / `waterLevelAt` queries. No THREE. |
| `src/world/terrain.test.ts` | **Create.** Unit tests for the above. |
| `src/world/objects.ts` | **Modify.** `Pond` becomes basin-shaped: terrain-fitted surface, plus `contains()` / `shoreNear()` so a merged lake is not treated as a disc. `HutState` gains `'abandoned'`. |
| `src/world/world.ts` | **Modify.** `fillCratersNear` rebuilds ponds from basins. `resolveTarget`/`pondAt` use `pond.contains`. Hut relocation and campfire rebuild consult `isBuildable`. |
| `src/world/world.test.ts` | **Modify.** Tests for merged ponds, hut relocation, campfire rebuild. |
| `src/villagers/fsm.ts` | **Modify.** Add the `makeFire` state. |
| `src/villagers/fsm.test.ts` | **Modify.** Add `needsFire` to the existing `base()` helper; **update the "exactly 8 states" assertion to 9**; test `makeFire`. |
| `src/villagers/villager.ts` | **Modify.** Implement the `makeFire` activity; fish at `pond.shoreNear()` rather than at `pond.radius`. |

---

## Task 1: Basin grouping and water levels

The heart of the fix. Two overlapping craters must become **one** basin with **one** water level, so we stop drawing two discs at two heights.

A basin's water level is the **lowest rim height** across its craters. A crater's rim height is the terrain height at its centre (the *undeformed* surface, since the crater is a hole cut into it). Taking the minimum means water can never sit higher than the lowest lip it would pour over.

**Files:**
- Create: `src/world/terrain.ts`
- Test: `src/world/terrain.test.ts`

**Interfaces:**
- Consumes: `Crater` from `./craters` — `{ x: number; z: number; radius: number; depth: number }`.
- Produces:
  ```ts
  export type Basin = {
    craters: Crater[]
    waterLevel: number   // world Y of the water surface
    x: number            // centroid, for Pond.x
    z: number
    radius: number       // max distance from centroid to any crater rim
  }
  export function groupBasins(
    craters: Crater[],
    surfaceY: (x: number, z: number) => number,
  ): Basin[]
  ```

- [ ] **Step 1: Write the failing test**

Create `src/world/terrain.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Crater } from './craters'
import { groupBasins } from './terrain'

// A flat world at y=0 keeps the arithmetic obvious: a crater of depth d has its
// floor at -d and its rim at 0.
const flat = () => 0

describe('groupBasins', () => {
  it('returns nothing for no craters', () => {
    expect(groupBasins([], flat)).toEqual([])
  })

  it('makes one basin from one crater', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const basins = groupBasins(craters, flat)

    expect(basins).toHaveLength(1)
    expect(basins[0].craters).toEqual(craters)
  })

  it('merges two OVERLAPPING craters into a single basin', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },   // centres 4 apart, radii sum 6 → overlap
    ]
    const basins = groupBasins(craters, flat)

    expect(basins).toHaveLength(1)
    expect(basins[0].craters).toHaveLength(2)
  })

  it('keeps two SEPARATE craters as two basins', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 2, depth: 1 },
      { x: 10, z: 0, radius: 2, depth: 1 },    // far apart
    ]
    expect(groupBasins(craters, flat)).toHaveLength(2)
  })

  it('merges transitively: A touches B, B touches C, so all three are one basin', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 2, depth: 1 },
      { x: 3, z: 0, radius: 2, depth: 1 },     // touches A
      { x: 6, z: 0, radius: 2, depth: 1 },     // touches B, but NOT A
    ]
    const basins = groupBasins(craters, flat)

    expect(basins).toHaveLength(1)
    expect(basins[0].craters).toHaveLength(3)
  })

  it('puts the water at ONE level — the lowest rim of the merged bowl', () => {
    // Sloped ground: the surface falls away as x grows, so the second crater
    // sits lower and its rim is the one that would overflow first.
    const sloped = (x: number) => -x * 0.1
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },   // rim at y = 0
      { x: 4, z: 0, radius: 3, depth: 1.5 },   // rim at y = -0.4
    ]
    const basins = groupBasins(craters, sloped)

    expect(basins).toHaveLength(1)
    expect(basins[0].waterLevel).toBeCloseTo(-0.4)
  })

  it('never lets the water sit above the ground that contains it', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, flat)

    // Rim is at 0; the floor is at -1.5. Water must be between them.
    expect(basin.waterLevel).toBeLessThanOrEqual(0)
    expect(basin.waterLevel).toBeGreaterThan(-1.5)
  })

  it('spans the merged bowl: radius reaches the far rim from the centroid', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ]
    const [basin] = groupBasins(craters, flat)

    expect(basin.x).toBeCloseTo(2)          // centroid between the two
    expect(basin.z).toBeCloseTo(0)
    expect(basin.radius).toBeCloseTo(5)     // 2 (to a centre) + 3 (its radius)
  })

  it('is deterministic', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ]
    expect(groupBasins(craters, flat)).toEqual(groupBasins(craters, flat))
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/world/terrain.test.ts`
Expected: FAIL — `Failed to resolve import "./terrain"`.

- [ ] **Step 3: Write the implementation**

Create `src/world/terrain.ts`:

```ts
import type { Crater } from './craters'

/**
 * A connected group of overlapping craters sharing ONE water surface.
 * Two meteors side by side make one lake, not two clipping discs.
 */
export type Basin = {
  craters: Crater[]
  /** World Y of the water surface — the lowest rim of the merged bowl. */
  waterLevel: number
  x: number
  z: number
  /** Distance from the centroid out to the furthest rim. */
  radius: number
}

/** Two craters share a basin when their bowls overlap. */
function overlaps(a: Crater, b: Crater): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < a.radius + b.radius
}

/**
 * Water can never sit higher than the lowest lip it would pour over, so a
 * basin's level is the MINIMUM rim height across its craters. A crater's rim
 * sits at the undeformed surface height at its centre — the crater is a hole
 * cut into that surface, so the surrounding ground is where the water stops.
 *
 * The level is dropped a little below the rim so the water reads as sitting
 * IN the bowl rather than brimming exactly level with the grass.
 */
const FREEBOARD = 0.12

function waterLevelOf(craters: Crater[], surfaceY: (x: number, z: number) => number): number {
  let lowest = Number.POSITIVE_INFINITY
  for (const crater of craters) {
    lowest = Math.min(lowest, surfaceY(crater.x, crater.z))
  }
  return lowest - FREEBOARD
}

function centroidOf(craters: Crater[]): { x: number; z: number } {
  let x = 0
  let z = 0
  for (const crater of craters) {
    x += crater.x
    z += crater.z
  }
  return { x: x / craters.length, z: z / craters.length }
}

function spanOf(craters: Crater[], x: number, z: number): number {
  let radius = 0
  for (const crater of craters) {
    radius = Math.max(radius, Math.hypot(crater.x - x, crater.z - z) + crater.radius)
  }
  return radius
}

/**
 * Group craters into basins by transitive overlap: if A touches B and B touches
 * C, all three share one basin even though A never touches C.
 */
export function groupBasins(
  craters: Crater[],
  surfaceY: (x: number, z: number) => number,
): Basin[] {
  const unassigned = [...craters]
  const basins: Basin[] = []

  while (unassigned.length > 0) {
    const group = [unassigned.shift() as Crater]

    // Flood-fill: keep sweeping the remaining craters until nothing new joins.
    for (let i = 0; i < group.length; i++) {
      for (let j = unassigned.length - 1; j >= 0; j--) {
        if (!overlaps(group[i], unassigned[j])) continue
        group.push(unassigned[j])
        unassigned.splice(j, 1)
      }
    }

    const { x, z } = centroidOf(group)
    basins.push({
      craters: group,
      waterLevel: waterLevelOf(group, surfaceY),
      x,
      z,
      radius: spanOf(group, x, z),
    })
  }

  return basins
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/world/terrain.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/world/terrain.ts src/world/terrain.test.ts
git commit -m "feat: group overlapping craters into basins with one water level"
```

---

## Task 2: The ground queries

`isBuildable` is the gate every builder passes through. This is the task that makes "don't rebuild in the lake" a one-line call.

**Files:**
- Modify: `src/world/terrain.ts`
- Test: `src/world/terrain.test.ts`

**Interfaces:**
- Consumes: `Basin`, `groupBasins` from Task 1. `craterAt` from `./craters`. `WALK_RADIUS` from `./island`.
- Produces:
  ```ts
  export type GroundQuery = {
    basins: readonly Basin[]
    craters: readonly Crater[]
    /** Things already standing here. Buildings must not land on top of them. */
    occupied: readonly { x: number; z: number }[]
  }
  export function waterLevelAt(x: number, z: number, basins: readonly Basin[]): number | null
  export function isSubmerged(
    x: number, z: number,
    basins: readonly Basin[],
    groundY: (x: number, z: number) => number,
  ): boolean
  export function isBuildable(
    x: number, z: number,
    query: GroundQuery,
    groundY: (x: number, z: number) => number,
  ): boolean
  ```
  `BUILD_CLEARANCE = 2` is exported: the radius a new building needs clear of other props.

- [ ] **Step 1: Write the failing test**

Append to `src/world/terrain.test.ts`:

```ts
import {
  BUILD_CLEARANCE, groupBasins, isBuildable, isSubmerged, waterLevelAt,
  type GroundQuery,
} from './terrain'

// Flat ground at y=0, one crater 3 wide and 1.5 deep at the origin.
const oneCrater: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
// Ground is flat except inside the crater, where it dips.
const dished = (x: number, z: number): number => {
  const d = Math.hypot(x, z)
  return d < 3 ? -1.5 * Math.cos((d / 3) * Math.PI * 0.5) ** 2 : 0
}

describe('waterLevelAt', () => {
  it('is null on dry ground', () => {
    const basins = groupBasins(oneCrater, flat)
    expect(waterLevelAt(10, 10, basins)).toBeNull()
  })

  it('returns the basin water level inside a basin', () => {
    const basins = groupBasins(oneCrater, flat)
    expect(waterLevelAt(0, 0, basins)).toBeCloseTo(basins[0].waterLevel)
  })

  it('is null when there are no basins at all', () => {
    expect(waterLevelAt(0, 0, [])).toBeNull()
  })
})

describe('isSubmerged', () => {
  const basins = groupBasins(oneCrater, flat)

  it('is true at the bottom of a flooded crater', () => {
    expect(isSubmerged(0, 0, basins, dished)).toBe(true)
  })

  it('is false on the dry ground outside it', () => {
    expect(isSubmerged(10, 0, basins, dished)).toBe(false)
  })

  it('is false everywhere when nothing is flooded', () => {
    expect(isSubmerged(0, 0, [], dished)).toBe(false)
  })
})

describe('isBuildable', () => {
  const dry: GroundQuery = { basins: [], craters: [], occupied: [] }

  it('accepts open, dry, flat ground', () => {
    expect(isBuildable(5, 5, dry, flat)).toBe(true)
  })

  it('REJECTS ground under water — the bug that let huts rebuild in a pond', () => {
    const query: GroundQuery = {
      basins: groupBasins(oneCrater, flat),
      craters: oneCrater,
      occupied: [],
    }
    expect(isBuildable(0, 0, query, dished)).toBe(false)
  })

  it('rejects a dry crater — you cannot build in a hole either', () => {
    const query: GroundQuery = { basins: [], craters: oneCrater, occupied: [] }
    expect(isBuildable(0, 0, query, dished)).toBe(false)
  })

  it('rejects ground occupied by something else', () => {
    const query: GroundQuery = { basins: [], craters: [], occupied: [{ x: 5, z: 5 }] }
    expect(isBuildable(5, 5, query, flat)).toBe(false)
    expect(isBuildable(5 + BUILD_CLEARANCE + 0.1, 5, query, flat)).toBe(true)
  })

  it('rejects ground off the walkable island', () => {
    expect(isBuildable(50, 0, dry, flat)).toBe(false)
  })

  it('rejects ground too steep to build on', () => {
    const cliff = (x: number): number => x * 5   // absurdly steep
    expect(isBuildable(5, 5, dry, cliff)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/world/terrain.test.ts`
Expected: FAIL — `isBuildable is not a function` (and the other new names).

- [ ] **Step 3: Write the implementation**

Append to `src/world/terrain.ts`, and add `craterAt` / `WALK_RADIUS` to the imports at the top:

```ts
import { craterAt, type Crater } from './craters'
import { WALK_RADIUS } from './island'
```

```ts
/** A new building needs this much room clear of other props. */
export const BUILD_CLEARANCE = 2

/** The steepest ground a building will tolerate, as a height change per metre. */
const MAX_SLOPE = 0.55

export type GroundQuery = {
  basins: readonly Basin[]
  craters: readonly Crater[]
  /** Things already standing here. Buildings must not land on top of them. */
  occupied: readonly { x: number; z: number }[]
}

/** The height of the water surface here, or null if this spot is not in a basin. */
export function waterLevelAt(x: number, z: number, basins: readonly Basin[]): number | null {
  for (const basin of basins) {
    if (craterAt(x, z, basin.craters)) return basin.waterLevel
  }
  return null
}

/** Is the ground here below the water? */
export function isSubmerged(
  x: number,
  z: number,
  basins: readonly Basin[],
  groundY: (x: number, z: number) => number,
): boolean {
  const water = waterLevelAt(x, z, basins)
  return water !== null && groundY(x, z) < water
}

/** Rise over run, sampled across a metre in each direction. */
function slopeAt(x: number, z: number, groundY: (x: number, z: number) => number): number {
  const here = groundY(x, z)
  return Math.max(
    Math.abs(groundY(x + 1, z) - here),
    Math.abs(groundY(x, z + 1) - here),
  )
}

/**
 * The one gate every builder passes through. Huts, campfires and saplings all
 * ask this before choosing a spot — which is what stops them being built in a
 * lake, in a hole, or on top of each other.
 */
export function isBuildable(
  x: number,
  z: number,
  query: GroundQuery,
  groundY: (x: number, z: number) => number,
): boolean {
  if (Math.hypot(x, z) > WALK_RADIUS) return false
  if (isSubmerged(x, z, query.basins, groundY)) return false
  if (craterAt(x, z, query.craters)) return false
  if (slopeAt(x, z, groundY) > MAX_SLOPE) return false
  for (const prop of query.occupied) {
    if (Math.hypot(prop.x - x, prop.z - z) < BUILD_CLEARANCE) return false
  }
  return true
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/world/terrain.test.ts`
Expected: PASS — all tests, including the 7 new `isBuildable` cases.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/world/terrain.ts src/world/terrain.test.ts
git commit -m "feat: add isBuildable, isSubmerged and waterLevelAt ground queries"
```

---

## Task 3: Ponds become basin-shaped

The visible fix. A `Pond` stops being a flat disc at an arbitrary height and becomes a **water surface at the basin's one water level**, shaped to the terrain: it is drawn only where the ground is actually below the water.

Keeping the class name `Pond` means `world.ponds`, `villager.fish`, `resolveTarget` and the Moments all keep working with no changes.

**Files:**
- Modify: `src/world/objects.ts` (the `Pond` class, currently lines 663–733)

**Interfaces:**
- Consumes: `Basin` from `./terrain`.
- Produces: the `Pond` constructor changes. Old:
  ```ts
  new Pond(x, z, radius, y, rng, lowFx)
  ```
  New — it takes the basin and a height sampler, and derives `x`/`z`/`radius`/water level from it:
  ```ts
  new Pond(basin: Basin, groundY: (x: number, z: number) => number, rng: RNG, lowFx?: boolean)
  ```
  `pond.x`, `pond.z`, `pond.radius` and `pond.hasFish` remain public and unchanged in meaning. Three new public members are added:
  ```ts
  readonly basin: Basin              // so World can tell if a basin already has a pond
  contains(x: number, z: number): boolean            // real containment, not a disc test
  shoreNear(x: number, z: number): { x: number; z: number }  // a dry spot on the bank
  ```
  `contains` and `shoreNear` exist because **a merged basin is not a circle**. An L-shaped lake's bounding circle covers dry land between its lobes, so the existing `within(pond, x, z, pond.radius)` tests in `resolveTarget`/`pondAt` would call that dry land "pond", and a villager fishing at `pond.radius` from the centroid would stand on grass.

- [ ] **Step 1: Replace the `Pond` class**

In `src/world/objects.ts`, add `Basin` to the imports:

```ts
import type { Basin } from './terrain'
```

Replace the whole `Pond` class (lines 663–733) with:

```ts
/**
 * The water in one basin. Not a disc: the surface is a grid clipped to the
 * ground that actually lies below the water level, so two overlapping craters
 * read as ONE lake shaped like the hole they dug — rather than two flat discs
 * at two different heights, clipping through each other.
 */
export class Pond {
  readonly group = new THREE.Group()
  hasFish = true
  readonly x: number
  readonly z: number
  readonly radius: number

  private readonly water: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private readonly floatingFish = new THREE.Group()
  private lastQt = Number.NEGATIVE_INFINITY

  constructor(
    public readonly basin: Basin,
    groundY: (x: number, z: number) => number,
    rng: RNG,
    lowFx = false,
  ) {
    this.x = basin.x
    this.z = basin.z
    this.radius = basin.radius

    this.group.name = 'pond'
    // The surface sits at the basin's water level, in island space.
    this.group.position.set(basin.x, basin.waterLevel, basin.z)

    const material = clayMaterial(PALETTE.water, { flat: true })
    material.transparent = true
    material.opacity = 0.72
    material.depthWrite = false
    material.side = THREE.DoubleSide
    this.water = new THREE.Mesh(
      submergedSurface(basin, groundY),
      material,
    )
    this.water.name = 'pond-water'
    this.water.receiveShadow = !lowFx
    this.group.add(this.water)

    const fishGeometry = wobble(new THREE.SphereGeometry(0.19, 8, 6), rng, 0.025)
    const fishMaterial = clayMaterial(PALETTE.ghost)
    for (let i = 0; i < 3; i++) {
      const fish = new THREE.Mesh(fishGeometry, fishMaterial)
      fish.name = 'floating-fish'
      const angle = (i / 3) * Math.PI * 2 + rng.range(-0.25, 0.25)
      fish.position.set(
        Math.cos(angle) * basin.radius * 0.3,
        0.1,
        Math.sin(angle) * basin.radius * 0.3,
      )
      fish.scale.set(1.35, 0.45, 0.72)
      fish.rotation.y = angle + Math.PI / 2
      fish.castShadow = !lowFx
      this.floatingFish.add(fish)
    }
    this.floatingFish.visible = false
    this.group.add(this.floatingFish)
  }

  /**
   * Is this point actually in the water? A merged basin is NOT a circle — an
   * L-shaped lake's bounding circle covers the dry grass between its lobes — so
   * containment means "inside one of my craters", not "within my radius".
   */
  contains(x: number, z: number): boolean {
    return craterAt(x, z, this.basin.craters) !== null
  }

  /**
   * A dry spot on the bank nearest to (x, z), for a villager to fish from.
   * Walks outward from the water's edge until the ground clears the waterline.
   */
  shoreNear(x: number, z: number): { x: number; z: number } {
    const crater = this.basin.craters
      .slice()
      .sort((a, b) => (
        Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)
      ))[0]
    const angle = Math.atan2(z - crater.z, x - crater.x)
    return {
      x: crater.x + Math.cos(angle) * (crater.radius + 0.35),
      z: crater.z + Math.sin(angle) * (crater.radius + 0.35),
    }
  }

  floatFish(): boolean {
    if (!this.hasFish) return false
    this.hasFish = false
    this.floatingFish.visible = true
    return true
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }

  update(qt: number): void {
    if (qt === this.lastQt) return
    const frame = Math.floor(qt * TIMING.fps)
    this.water.material.opacity = 0.69 + Math.sin(frame * 0.32) * 0.035
    if (this.floatingFish.visible) {
      this.floatingFish.position.y = 0.035 + (frame % 4 < 2 ? 0.025 : 0)
      this.floatingFish.rotation.y = Math.sin(frame * 0.2) * 0.035
    }
    this.lastQt = qt
  }
}
```

`craterAt` is already imported by `terrain.ts`; add it to `objects.ts`'s imports too:

```ts
import { craterAt } from './craters'
```

- [ ] **Step 2: Add the surface builder**

Add this function to `src/world/objects.ts`, above the `Pond` class:

```ts
/** How finely the water surface is tessellated, in metres per cell. */
const WATER_CELL = 0.5

/**
 * Build the water surface for a basin: a grid over the basin's bounding square,
 * keeping only the cells whose ground lies below the water level. The result is
 * the shape of the flooded hole, not a circle.
 *
 * Vertices are in the pond group's local space, whose origin is the basin
 * centroid at the water level — so every vertex sits at local y = 0.
 */
function submergedSurface(
  basin: Basin,
  groundY: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const cells = Math.max(2, Math.ceil((basin.radius * 2) / WATER_CELL))
  const step = (basin.radius * 2) / cells
  const origin = -basin.radius

  const wet = (i: number, j: number): boolean => {
    const x = basin.x + origin + i * step
    const z = basin.z + origin + j * step
    return groundY(x, z) < basin.waterLevel
  }

  const positions: number[] = []
  // One quad per cell, but only where all four of its corners are under water.
  // Dropping partly-dry quads keeps the water inside the bowl instead of
  // spilling a square of blue across the grass.
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if (!wet(i, j) || !wet(i + 1, j) || !wet(i, j + 1) || !wet(i + 1, j + 1)) continue
      const x0 = origin + i * step
      const z0 = origin + j * step
      const x1 = x0 + step
      const z1 = z0 + step
      positions.push(
        x0, 0, z0, x1, 0, z0, x1, 0, z1,
        x0, 0, z0, x1, 0, z1, x0, 0, z1,
      )
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}
```

- [ ] **Step 3: Typecheck — expect `World` to break**

Run: `npx tsc --noEmit`
Expected: FAIL in `src/world/world.ts` — `fillCratersNear` still calls the old `new Pond(x, z, radius, y, ...)` signature. Task 4 fixes it. This failure is the proof that the call site needs updating.

- [ ] **Step 4: Commit**

The build is intentionally red between Tasks 3 and 4 — they are one change split for review. Commit anyway so the diff stays reviewable:

```bash
git add src/world/objects.ts
git commit -m "refactor: shape pond water to the flooded basin, not a flat disc"
```

---

## Task 4: The world builds ponds from basins

Wire it up. `fillCratersNear` stops making one pond per crater and instead **rebuilds all ponds from the current basins** — which is what makes two overlapping craters collapse into one lake.

**Files:**
- Modify: `src/world/world.ts` (`fillCratersNear`, currently lines 219–232)
- Test: `src/world/world.test.ts`

**Interfaces:**
- Consumes: `groupBasins` (Task 1), `Pond` (Task 3).
- Produces: `World.syncPonds(rng, lowFx)` — rebuilds `world.ponds` from `island.craters`. `fillCratersNear` keeps its signature so `rain.ts` needs no change.

- [ ] **Step 1: Write the failing test**

Add to `src/world/world.test.ts`. Note the stub island now needs real craters and a height function:

```ts
// Module scope, NOT inside the describe — Task 5's tests need it too.
function floodedWorld(
  craters: { x: number; z: number; radius: number; depth: number }[],
): World {
  const island = {
    craters,
    // Flat ground with a dip inside each crater, like the real island.
    sampleHeight: (x: number, z: number) => {
      let y = 0
      for (const c of craters) {
        const d = Math.hypot(x - c.x, z - c.z) / c.radius
        if (d < 1) y -= c.depth * Math.cos(d * Math.PI * 0.5) ** 2
      }
      return y
    },
    group: { add: vi.fn(), remove: vi.fn() },
  } as unknown as Island
  return new World(island)
}

describe('World ponds', () => {
  it('makes ONE pond from two overlapping craters — not two clipping discs', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ])

    world.fillCratersNear(2, 0, 10, new RNG(1))

    expect(world.ponds).toHaveLength(1)
  })

  it('gives the merged pond ONE water level', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ])

    world.fillCratersNear(2, 0, 10, new RNG(1))

    // One surface height for the whole lake — the thing that was broken.
    expect(world.ponds[0].group.position.y).toBeCloseTo(world.ponds[0].basin.waterLevel)
  })

  it('keeps separate craters as separate ponds', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 2, depth: 1 },
      { x: 9, z: 0, radius: 2, depth: 1 },
    ])

    world.fillCratersNear(0, 0, 20, new RNG(1))

    expect(world.ponds).toHaveLength(2)
  })

  it('does not double-fill a basin that is already a pond', () => {
    const world = floodedWorld([{ x: 0, z: 0, radius: 3, depth: 1.5 }])

    world.fillCratersNear(0, 0, 10, new RNG(1))
    world.fillCratersNear(0, 0, 10, new RNG(1))

    expect(world.ponds).toHaveLength(1)
  })

  it('does NOT call the dry grass between two lobes "pond"', () => {
    // An L-shaped lake: two craters meeting at a right angle. The bounding
    // circle of the merged basin covers the dry corner they do not reach.
    const world = floodedWorld([
      { x: 0, z: 0, radius: 2.5, depth: 1.5 },
      { x: 0, z: 5, radius: 2.5, depth: 1.5 },
    ])
    world.fillCratersNear(0, 2.5, 12, new RNG(1))

    // Inside the water.
    expect(world.resolveTarget(0, 0)).toBe('pond')
    // Off to the side: within the basin's RADIUS, but dry land. The old
    // disc test called this "pond"; it must not.
    expect(world.resolveTarget(4.4, 2.5)).not.toBe('pond')
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — the first test finds 2 ponds, not 1.

- [ ] **Step 3: Rewrite `fillCratersNear`**

In `src/world/world.ts`, add the import:

```ts
import { groupBasins, type Basin } from './terrain'
```

Replace `fillCratersNear` (lines 219–232) with:

```ts
  /**
   * Flood every crater within reach. Craters that overlap merge into ONE basin
   * with ONE water level, so two meteors side by side make a single lake rather
   * than two discs clipping through each other.
   */
  fillCratersNear(x: number, z: number, radius: number, rng: RNG, lowFx = false): number {
    const reached = this.island.craters.filter(crater => (
      Math.hypot(crater.x - x, crater.z - z) - crater.radius <= radius
    ))
    if (reached.length === 0) return 0

    // Rebuild every basin that the rain touched. A new crater can merge two
    // existing lakes into one, so we re-derive from the craters rather than
    // patching the ponds we already have.
    const flooded = new Set(this.ponds.map(pond => pond.basin))
    const basins = groupBasins(this.island.craters, (bx, bz) => islandSurfaceY(bx, bz))
    const wanted = basins.filter(basin => (
      basin.craters.some(crater => reached.includes(crater))
      || basin.craters.some(crater => (
        [...flooded].some(old => old.craters.includes(crater))
      ))
    ))

    let created = 0
    for (const basin of wanted) {
      // Already exactly this basin? Leave it — and keep its fish.
      if (this.ponds.some(pond => sameBasin(pond.basin, basin))) continue
      // Otherwise the basin has changed shape (or is new). Drop any pond whose
      // craters it has absorbed, then build the merged one.
      const absorbed = this.ponds.filter(pond => (
        pond.basin.craters.some(crater => basin.craters.includes(crater))
      ))
      const keepsFish = absorbed.length === 0 || absorbed.some(pond => pond.hasFish)
      for (const pond of absorbed) this.removePond(pond)

      const pond = new Pond(basin, (px, pz) => this.island.sampleHeight(px, pz), rng, lowFx)
      pond.hasFish = keepsFish
      this.ponds.push(pond)
      this.island.group.add(pond.group)
      this.bus.emit({ type: 'pond:created', x: basin.x, z: basin.z })
      created++
    }
    return created
  }

  private removePond(pond: Pond): void {
    const index = this.ponds.indexOf(pond)
    if (index === -1) return
    this.ponds.splice(index, 1)
    this.island.group.remove(pond.group)
    pond.dispose()
  }
```

Add this helper at module scope in `world.ts`, next to `within`:

```ts
/** Two basins are the same when they hold exactly the same craters. */
function sameBasin(a: Basin, b: Basin): boolean {
  if (a.craters.length !== b.craters.length) return false
  return a.craters.every(crater => b.craters.includes(crater))
}
```

Import `islandSurfaceY` at the top of `world.ts`:

```ts
import { Island, islandSurfaceY } from './island'
```

Then update `emptyPondAt` to use the shared removal path:

```ts
  emptyPondAt(x: number, z: number): boolean {
    const pond = this.pondAt(x, z)
    if (!pond) return false
    this.removePond(pond)
    this.bus.emit({ type: 'pond:emptied' })
    return true
  }
```

**Stop treating a pond as a disc.** `resolveTarget` (line 87) and `pondAt` (line 99)
both use `within(pond, x, z, pond.radius)`, which for a merged L-shaped lake covers
the dry grass between its lobes. Replace both with the real containment test:

```ts
  pondAt(x: number, z: number): Pond | null {
    return this.ponds.find(pond => pond.contains(x, z)) ?? null
  }
```

And in `resolveTarget`, replace the pond line with:

```ts
    if (this.ponds.some(pond => pond.contains(x, z))) return 'pond'
```

`isPondShape` and the `PondShape` type are now unused in `world.ts` — delete them
(lines 11 and 19–22), or `tsc` will flag them as dead code.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — all 125 existing tests, plus the 4 new pond tests. `tsc` should also now be clean, since the `Pond` call site is fixed.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/world/world.ts src/world/world.test.ts
git commit -m "feat: merge overlapping craters into one lake with one water level"
```

---

## Task 5: Huts relocate off bad ground

Spec defect 4. A ruin on ground that has become a crater or a lake is **abandoned** — it stays as a sunken monument — and the villagers pick a valid site nearby instead.

**Files:**
- Modify: `src/world/objects.ts` (add `'abandoned'` to `HutState`)
- Modify: `src/world/world.ts` (`buildSite`, plus a new `relocateDrownedRuins`)
- Test: `src/world/world.test.ts`

**Interfaces:**
- Consumes: `isBuildable`, `BUILD_CLEARANCE`, `type GroundQuery` (Task 2); `groupBasins` (Task 1).
- Produces:
  - `HutState` gains `'abandoned'`.
  - `World.groundQuery(): GroundQuery` — the current ground, for any builder.
  - `World.findBuildSite(rng, near?): { x, z } | null` — a valid spot near the village.
  - `World.relocateDrownedRuins(rng, lowFx)` — abandons unbuildable ruins and adds a replacement site. Called from the game loop.
  - `MAX_HUTS = 6` exported from `world.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/world/world.test.ts`:

```ts
describe('World hut relocation', () => {
  it('abandons a ruin that is now underwater instead of rebuilding in the lake', () => {
    const crater = { x: 5, z: 0, radius: 3, depth: 1.5 }
    const world = floodedWorld([crater])
    // A ruin sitting in what is now the bottom of a flooded crater.
    const drowned = { id: 'hut-0', x: 5, z: 0, state: 'ruin', group: { position: { y: 0 } } }
    world.huts.push(drowned as unknown as Hut)
    world.fillCratersNear(5, 0, 10, new RNG(1))

    world.relocateDrownedRuins(new RNG(1))

    expect(drowned.state).toBe('abandoned')
  })

  it('adds a replacement site on dry ground when it abandons one', () => {
    const crater = { x: 5, z: 0, radius: 3, depth: 1.5 }
    const world = floodedWorld([crater])
    world.huts.push(
      { id: 'hut-0', x: 5, z: 0, state: 'ruin', group: { position: { y: 0 } } } as unknown as Hut,
    )
    world.fillCratersNear(5, 0, 10, new RNG(1))

    world.relocateDrownedRuins(new RNG(1))

    const site = world.huts.find(hut => hut.state === 'site')
    expect(site).toBeDefined()
    expect(world.island.sampleHeight(site!.x, site!.z)).toBeGreaterThanOrEqual(0)
  })

  it('leaves a ruin on good dry ground alone — it is still rebuildable', () => {
    const world = floodedWorld([])
    const fine = { id: 'hut-0', x: 5, z: 0, state: 'ruin', group: { position: { y: 0 } } }
    world.huts.push(fine as unknown as Hut)

    world.relocateDrownedRuins(new RNG(1))

    expect(fine.state).toBe('ruin')
  })

  it('never offers an abandoned ruin as a build site', () => {
    const world = floodedWorld([])
    world.huts.push(
      { id: 'hut-0', x: 5, z: 0, state: 'abandoned' } as unknown as Hut,
    )

    expect(world.buildSite()).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — `world.relocateDrownedRuins is not a function`.

- [ ] **Step 3: Add the `abandoned` state**

In `src/world/objects.ts`, line 9:

```ts
export type HutState = 'site' | 'building' | 'built' | 'burning' | 'ruin' | 'abandoned'
```

In `Hut.syncAppearance()`, make an abandoned hut show its site stones as a sunken monument, and never show a structure. Change the `siteStones.visible` line to:

```ts
    this.siteStones.visible = this.state === 'site'
      || this.state === 'building'
      || this.state === 'ruin'
      || this.state === 'abandoned'
```

In `Hut.buildTick()`, guard against building an abandoned hut — it must stay abandoned:

```ts
  buildTick(): void {
    if (this.state === 'abandoned') return
    if (this.state !== 'site' && this.state !== 'building' && this.state !== 'ruin') return
    // ... rest unchanged
```

- [ ] **Step 4: Add the world logic**

In `src/world/world.ts`, add the imports:

```ts
import { BUILD_CLEARANCE, groupBasins, isBuildable, type Basin, type GroundQuery } from './terrain'
import { WALK_RADIUS } from './island'
```

Add `MAX_HUTS` at module scope:

```ts
/** The village can grow to this many huts — see the housing rule in the spec. */
export const MAX_HUTS = 6
```

Add these methods to `World`:

```ts
  /** Everything a builder needs to know about the current ground. */
  groundQuery(): GroundQuery {
    const occupied: { x: number; z: number }[] = [
      ...this.trees,
      ...this.huts.filter(hut => hut.state !== 'abandoned'),
    ]
    if (this.campfire && !this.campfire.scattered) occupied.push(this.campfire)
    return {
      basins: this.ponds.map(pond => pond.basin),
      craters: this.island.craters,
      occupied,
    }
  }

  /**
   * A valid spot for a new building, preferring ground near the village so the
   * settlement stays a settlement rather than scattering across the island.
   */
  findBuildSite(rng: RNG, near?: { x: number; z: number }): { x: number; z: number } | null {
    const query = this.groundQuery()
    const groundY = (x: number, z: number): number => this.island.sampleHeight(x, z)
    const home = near ?? this.villageCentre()

    // Search outward from home: close spots first, then further afield.
    for (let ring = 0; ring < 6; ring++) {
      const distance = BUILD_CLEARANCE + ring * 1.5
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = rng.range(0, Math.PI * 2)
        const x = home.x + Math.cos(angle) * distance
        const z = home.z + Math.sin(angle) * distance
        if (Math.hypot(x, z) > WALK_RADIUS - 1) continue
        if (isBuildable(x, z, query, groundY)) return { x, z }
      }
    }
    return null
  }

  /** The heart of the village: the mean of its standing huts, else the origin. */
  private villageCentre(): { x: number; z: number } {
    const homes = this.huts.filter(hut => hut.state !== 'abandoned')
    if (homes.length === 0) return { x: 0, z: 0 }
    let x = 0
    let z = 0
    for (const hut of homes) {
      x += hut.x
      z += hut.z
    }
    return { x: x / homes.length, z: z / homes.length }
  }

  /**
   * A ruin whose ground has gone bad — flooded or cratered — is abandoned rather
   * than rebuilt underwater. It stays as a sunken monument and the village puts a
   * fresh site on good ground instead, so the village drifts as it is bombed.
   */
  relocateDrownedRuins(rng: RNG, lowFx = false): void {
    const query = this.groundQuery()
    const groundY = (x: number, z: number): number => this.island.sampleHeight(x, z)

    for (const hut of this.huts) {
      if (hut.state !== 'ruin') continue
      // A ruin standing on its own footprint is fine — exclude itself from the
      // occupancy test, or every ruin would report its own spot as taken.
      const ground: GroundQuery = {
        ...query,
        occupied: query.occupied.filter(prop => prop !== hut),
      }
      if (isBuildable(hut.x, hut.z, ground, groundY)) continue

      hut.state = 'abandoned'
      if (this.huts.filter(candidate => candidate.state !== 'abandoned').length >= MAX_HUTS) continue

      const site = this.findBuildSite(rng)
      if (!site) continue
      const replacement = new Hut(
        `hut-${this.huts.length}`,
        site.x,
        site.z,
        'site',
        this.island.sampleHeight(site.x, site.z),
        rng,
        lowFx,
      )
      this.huts.push(replacement)
      this.island.group.add(replacement.group)
    }
  }
```

Update `buildSite` so an abandoned hut is never offered for building:

```ts
  buildSite(): Hut | null {
    return this.huts.find(hut => (
      hut.state === 'site' || hut.state === 'building' || hut.state === 'ruin'
    )) ?? null
  }
```

(`'abandoned'` is simply not in the list, so this is already correct once the state exists — but confirm it reads exactly as above.)

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — all existing tests plus the 4 new relocation tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/world/objects.ts src/world/world.ts src/world/world.test.ts
git commit -m "feat: abandon drowned ruins and relocate huts to buildable ground"
```

---

## Task 6: The campfire can be rebuilt

Spec defect 5. Once scattered, the fire is currently gone forever. Now the villagers rebuild it.

**Files:**
- Modify: `src/villagers/fsm.ts` (add the `makeFire` state)
- Modify: `src/villagers/fsm.test.ts`
- Modify: `src/villagers/villager.ts` (the `makeFire` activity)
- Modify: `src/world/world.ts` (`rebuildCampfire`)

**Interfaces:**
- Consumes: `findBuildSite` (Task 5).
- Produces:
  - `VillagerState` gains `'makeFire'`.
  - `FsmCtx` gains `needsFire: boolean`.
  - `World.rebuildCampfireAt(x, z, rng, lowFx)` — relights or replaces the campfire at a spot.

- [ ] **Step 1: Update the existing test file, then add the failing test**

`src/villagers/fsm.test.ts` **already has** a `base()` helper and an assertion that
pins the state count. Both must be updated, or Task 6 turns an existing green test
red for reasons unrelated to the feature.

First, add `needsFire` to the existing `base()` helper (line 5) so every existing
test still compiles — default `false`, meaning "the fire is fine":

```ts
const base = (o: Partial<FsmCtx> = {}): FsmCtx => ({
  state: 'wander', fireNear: false, freshGrave: false, hasRuin: false,
  hasSite: false, hasPond: false, hasTree: true, campfireLit: true,
  needsFire: false, rng: new RNG(3), ...o,
})
```

Second, update the `FSM shape` assertion (line 11) from 8 states to 9 — `makeFire`
is a deliberate addition, and this test exists precisely to make that a conscious
choice:

```ts
describe('FSM shape', () => {
  it('has exactly 9 states', () => {
    expect(STATES).toHaveLength(9)
    expect([...STATES].sort()).toEqual(
      ['buildHut', 'chopTree', 'fish', 'flee', 'makeFire', 'mourn', 'rebuild', 'sitAtFire', 'wander'],
    )
  })
})
```

Now add the new tests, reusing the file's existing `base()` helper:

```ts
describe('makeFire', () => {
  it('is reachable when the village has no fire', () => {
    const picked = new Set<string>()
    for (let i = 0; i < 200; i++) {
      picked.add(decideNext(base({
        needsFire: true, campfireLit: false, hasTree: false, rng: new RNG(i),
      })))
    }
    expect(picked.has('makeFire')).toBe(true)
  })

  it('is NEVER chosen when the fire is already lit', () => {
    for (let i = 0; i < 200; i++) {
      expect(decideNext(base({
        needsFire: false, campfireLit: true, rng: new RNG(i),
      }))).not.toBe('makeFire')
    }
  })

  it('yields to an emergency — a fire nearby still means flee', () => {
    expect(decideNext(base({ needsFire: true, fireNear: true }))).toBe('flee')
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/villagers/fsm.test.ts`
Expected: FAIL — a type error on `needsFire` (not yet on `FsmCtx`), and `makeFire`
is never picked.

- [ ] **Step 3: Add the state to the FSM**

In `src/villagers/fsm.ts`:

```ts
export const STATES = [
  'wander', 'chopTree', 'buildHut', 'sitAtFire', 'flee', 'mourn', 'rebuild', 'fish', 'makeFire',
] as const
```

Add to `FsmCtx`:

```ts
  /** The village has no usable fire — someone should go build one. */
  needsFire: boolean
```

Add to the `IDLE` table:

```ts
  { state: 'makeFire', weight: 5, when: c => c.needsFire },
```

Add to `stateDuration`:

```ts
    case 'makeFire': return rng.range(6, 10)
```

- [ ] **Step 4: Add `rebuildCampfireAt` to the world**

In `src/world/world.ts`:

```ts
  /** Is there no usable fire? Then someone should go and build one. */
  needsFire(): boolean {
    return !this.campfire || this.campfire.scattered || !this.campfire.lit
  }

  /**
   * Put a fire back. A merely doused fire is relit where it stands; a scattered
   * one is replaced by a new campfire on buildable ground, so a meteor can no
   * longer take the village's fire away permanently.
   */
  rebuildCampfireAt(x: number, z: number, rng: RNG, lowFx = false): void {
    if (this.campfire && !this.campfire.scattered) {
      this.campfire.flare(1.5, 1.4)
      return
    }
    if (this.campfire) {
      this.island.group.remove(this.campfire.group)
    }
    const campfire = new Campfire(x, z, this.island.sampleHeight(x, z), rng, lowFx)
    this.campfire = campfire
    this.island.group.add(campfire.group)
  }
```

- [ ] **Step 5: Implement the villager activity**

In `src/villagers/villager.ts`, add `makeFire` to `enter()`'s switch:

```ts
      case 'makeFire': {
        const site = world.findBuildSite(this.rng, world.campfire ?? undefined)
        if (!site) return this.enter('wander', world)
        this.fireSite = site
        this.setTarget(site)
        return
      }
```

Add the field beside the other targets:

```ts
  private fireSite: Point | null = null
```

Clear it in `enter()` with the others:

```ts
    this.fireSite = null
```

Add the activity to `performActivity()`'s switch:

```ts
      case 'makeFire': {
        if (!this.fireSite || !world.needsFire()) {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.4) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 2.5
          }
          this.actionTimer -= dt
          if (ticked) {
            // Stacking logs: the same swing the builders use.
            const swing = Math.floor(this.actionTimer * TIMING.fps) % 2 === 0 ? 0.85 : 0.25
            this.arms[0].rotation.z = -swing
            this.arms[1].rotation.z = swing
          }
          if (this.actionTimer <= 0) {
            world.rebuildCampfireAt(this.fireSite.x, this.fireSite.z, this.rng, this.lowFx)
            this.enter('sitAtFire', world)
          }
        }
        return
      }
```

Add `needsFire` to `context()`:

```ts
      needsFire: world.needsFire(),
```

**Fish from the real shore, not the bounding circle.** `enter()`'s `fish` case
(lines 635–644) sends the villager to `pond.radius` from the pond centre — which,
for a merged L-shaped lake, is dry grass well away from the water. Replace the
`fish` case body with:

```ts
      case 'fish': {
        const ponds = world.ponds
        this.targetPond = ponds.sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
        if (!this.targetPond) return this.enter('wander', world)
        this.setTarget(this.targetPond.shoreNear(this.x, this.z))
      }
```

This also drops the `isPond` type-guard filter, which was only ever compensating for
the untyped `ponds` array. Removing it means **three** more edits in `villager.ts` —
do all of them, or `tsc` will fail:

1. Delete the `PondLike` type (line 15) and the `isPond` guard (lines 32–36).
2. Retype the field (line 94) and import `Pond`:

```ts
import type { Hut, Pond, Tree } from '../world/objects'
```
```ts
  private targetPond: Pond | null = null
```

3. `context()` (line 655) also calls `isPond`. Replace that line with a plain
   emptiness check:

```ts
      hasPond: world.ponds.length > 0,
```

The `performActivity` `fish` case (line 547) needs no change: it only asks whether
the target pond is still in `world.ponds`, which stays true.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS — all tests including the 3 new FSM tests.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/villagers/fsm.ts src/villagers/fsm.test.ts src/villagers/villager.ts src/world/world.ts
git commit -m "feat: let villagers rebuild the campfire on buildable ground"
```

---

## Task 7: Drive relocation from the game loop, and verify in the browser

Nothing calls `relocateDrownedRuins` yet. Wire it into the tick, then actually play the thing.

**Files:**
- Modify: `src/main.ts`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Find the world tick**

Run: `grep -n "updateFire\|updatePonds\|repopulate" src/main.ts`
This shows where the per-frame world updates are called.

- [ ] **Step 2: Call relocation on the tick**

In `src/main.ts`, beside the other per-frame world updates (`world.updateFire(...)`, `world.repopulate(...)`), add:

```ts
    world.relocateDrownedRuins(rng, lowFx)
```

It is cheap — it early-outs unless a ruin exists on bad ground.

- [ ] **Step 3: Run the whole suite and build**

```bash
npm test
npx tsc --noEmit
npm run build
```
Expected: all green.

- [ ] **Step 4: Verify in the browser — this is the real test**

Run `npm run dev` and check each fix by hand. The unit tests prove the maths; only the browser proves the game.

1. **One lake, one level.** Drop two meteors side by side, overlapping. Rain on them. → **One** continuous lake at **one** height. No clipping discs, no seam, no two-tone water.
2. **Separate lakes stay separate.** Two meteors far apart, then rain. → Two distinct ponds.
3. **No hut in the lake.** Meteor a hut, then rain until its crater floods. → The ruin does **not** get rebuilt underwater. It stays as a sunken monument and a **new site** appears on dry ground nearby, which villagers then build.
4. **The fire comes back.** Meteor the campfire (it scatters), then rain on the spot. → After a short while a villager walks to a dry spot near the huts, stacks logs, and a **new campfire lights**. Villagers gather at it.
5. **Nothing regressed.** Fishing still works in the merged lake; lightning on it still floats fish; a meteor on it still empties it.

- [ ] **Step 5: Update the architecture doc**

In `docs/architecture.md`, add `src/world/terrain.ts` to the module list and describe the basin model: *craters group into basins by transitive overlap; each basin has one water level (its lowest rim, less freeboard); `Pond` renders one basin as a terrain-clipped surface; `isBuildable` gates every builder.* Note that `HutState` gained `'abandoned'` and `VillagerState` gained `'makeFire'`.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts docs/architecture.md
git commit -m "feat: relocate drowned ruins on the world tick; document the terrain model"
```

---

## Done when

- Two overlapping meteor craters, once rained on, are **one lake at one water level**.
- A ruin that ends up underwater is **abandoned**, and the village rebuilds on dry ground nearby.
- A scattered campfire is **rebuilt** by the villagers on buildable ground.
- `npm test` green, `npx tsc --noEmit` clean, `npm run build` succeeds.
- Stages 2 (the living forest) and 3 (the people) remain untouched and unblocked.

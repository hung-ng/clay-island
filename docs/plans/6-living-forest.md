# Living Forest Implementation Plan (Stage 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tree that dies stays dead, leaving a permanent stump; the forest recovers by seeding saplings near survivors, so forests visibly drift across the island.

**Architecture:** `Tree` stops being "a crown you scale down" and becomes a real lifecycle (`sapling → normal → toppling → felled → stump`, with `burning → snag` branching in). A new pure module `src/world/forest.ts` owns the reseeding rule and is unit-tested without THREE. A new `Charring` helper owns scorch colour for both `Tree` and `Hut`, giving one code path where there were several and fixing the hut's black-rebuild and cheerful-roof-knob bugs at the class level.

**Tech Stack:** TypeScript, Three.js r185, Vitest. No new dependencies.

Implements Stage 2 of `docs/superpowers/specs/2026-07-13-honest-world-design.md`, as designed in `docs/superpowers/specs/2026-07-14-living-forest-design.md`. Fixes spec defects 1 (chopped tree keeps trunk and shadow), 2 (growth invisible), 7 (rebuilt hut stays black), 8 (roof knob never chars) and 9 (meteor both ignites and destroys).

## Global Constraints

- **No new dependencies.** Three.js r185 and Vitest only.
- **Pure logic lives in its own module and is unit-tested directly.** Modules that touch `THREE` are tested with `vi.fn()` stubs, as `world.test.ts` already does. Never construct a real `Island` in a test.
- **Determinism.** All randomness goes through `RNG` (`src/core/rng.ts`). Never call `Math.random()`.
- **`npm test` is 190 tests green before this plan starts.** It must stay green, with exactly one deliberate exception: `matrix.test.ts`'s `meteor.tree` assertion changes from `['ignite', 'destroy']` to `['destroy']` (Task 6). That test exists precisely to make this a conscious change.
- **Dead wood does not burn.** `FireSystem` mutates `item.burning` directly and treats anything with `burnt === false` as fuel, so the moment trees can be dead, `World.flammables()` must stop passing every tree (Task 5). Without it, a clearing full of stumps is a tinderbox.
- **`Tree.ignite()` must keep its early-return when already burning.** `FireSystem` sets `burning = true` on the object and *then* `World.updateFire` calls `object.ignite()`. The `split` flag is therefore decided by the **caller**, never inferred inside `Tree`.
- **Island geometry constants** live in `src/world/island.ts`: `ISLAND_RADIUS = 15`, `WALK_RADIUS = 12`.
- **Ground gating** reuses Stage 1: `isBuildable(x, z, query, groundY)` and `type GroundQuery` from `src/world/terrain.ts`.
- Run `npm test` and `npx tsc --noEmit` before every commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/world/charring.ts` | **Create.** Pure. One scorch value (0–1) driving every material an object owns. No THREE beyond the material type. |
| `src/world/charring.test.ts` | **Create.** Unit tests, with stub materials. |
| `src/world/forest.ts` | **Create.** Pure. `MAX_TREES`, and `seedSite()` — where the next sapling sprouts. No THREE. |
| `src/world/forest.test.ts` | **Create.** Unit tests for the reseeding rule. |
| `src/world/objects.ts` | **Modify.** `Tree` becomes a lifecycle with a separately-controlled trunk, a resizable blob shadow, `topple`/`obliterate`, and `ignite(split)`. `Hut` adopts `Charring`. |
| `src/world/objects.test.ts` | **Create.** Tests for the `Tree` state machine's timings, driven through `update()`. |
| `src/world/world.ts` | **Modify.** `flammables()` excludes dead trees. `destroyTarget` obliterates. `igniteTarget` splits. New `reseedForest`. |
| `src/world/world.test.ts` | **Modify.** Tests for reseeding and for stumps not burning. |
| `src/powers/matrix.ts` | **Modify.** `meteor.tree` becomes `['destroy']`. |
| `src/powers/matrix.test.ts` | **Modify.** The pinned assertion follows. |
| `src/main.ts` | **Modify.** Call `reseedForest` on the fixed step. |
| `docs/architecture.md` | **Modify.** Document the lifecycle, the two new modules, and the char model. |

---

## Task 1: `Charring` — one value, every material

The fix for defects 7 and 8, done once instead of per-material-per-state. Both `Tree` and `Hut` will own one of these.

**Files:**
- Create: `src/world/charring.ts`
- Test: `src/world/charring.test.ts`

**Interfaces:**
- Consumes: `THREE.MeshToonMaterial` (only for its `.color`), `PALETTE.scorch` from `../ui/tokens`.
- Produces:
  ```ts
  export class Charring {
    constructor(materials: readonly THREE.MeshToonMaterial[])
    /** 0 = pristine, 1 = fully scorched. Applied to EVERY registered material. */
    set(amount: number): void
    get amount(): number
    /** Register more materials later (the tree builds its crown after its trunk). */
    add(...materials: THREE.MeshToonMaterial[]): void
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/world/charring.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PALETTE } from '../ui/tokens'
import { Charring } from './charring'

const SCORCH = new THREE.Color(PALETTE.scorch)

const material = (color: string): THREE.MeshToonMaterial =>
  new THREE.MeshToonMaterial({ color })

describe('Charring', () => {
  it('leaves materials at their base colour when pristine', () => {
    const clay = material('#ff0000')
    const charring = new Charring([clay])

    charring.set(0)

    expect(clay.color.getHex()).toBe(0xff0000)
  })

  it('drives EVERY material it owns, not just the first', () => {
    // The hut bug: only `base` was scorched, so the door and roof knob stayed
    // cheerfully clay-coloured on a burning hut.
    const base = material('#ff0000')
    const door = material('#00ff00')
    const knob = material('#0000ff')
    const charring = new Charring([base, door, knob])

    charring.set(1)

    for (const m of [base, door, knob]) {
      expect(m.color.getHex()).toBe(SCORCH.getHex())
    }
  })

  it('interpolates between the base colour and scorch', () => {
    const clay = material('#ff0000')
    const charring = new Charring([clay])

    charring.set(0.5)

    const expected = new THREE.Color('#ff0000').lerp(SCORCH, 0.5)
    expect(clay.color.getHex()).toBe(expected.getHex())
  })

  it('RESTORES the base colour when driven back to 0 — a rebuilt hut is not black', () => {
    // Defect 7: `buildTick()` never restored the colour, so a rebuilt hut stayed
    // charcoal forever. Going back to 0 must be exactly as good as never burning.
    const clay = material('#ff0000')
    const charring = new Charring([clay])

    charring.set(1)
    charring.set(0)

    expect(clay.color.getHex()).toBe(0xff0000)
  })

  it('clamps out-of-range amounts', () => {
    const clay = material('#ff0000')
    const charring = new Charring([clay])

    charring.set(5)
    expect(charring.amount).toBe(1)

    charring.set(-3)
    expect(charring.amount).toBe(0)
    expect(clay.color.getHex()).toBe(0xff0000)
  })

  it('reports the amount it was set to', () => {
    const charring = new Charring([material('#ff0000')])
    charring.set(0.25)
    expect(charring.amount).toBeCloseTo(0.25)
  })

  it('captures the base colour of materials added later', () => {
    // The tree registers its trunk first, then its crown blobs as it builds them.
    const trunk = material('#ff0000')
    const charring = new Charring([trunk])
    const leaf = material('#00ff00')

    charring.add(leaf)
    charring.set(1)
    charring.set(0)

    expect(leaf.color.getHex()).toBe(0x00ff00)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/world/charring.test.ts`
Expected: FAIL — `Failed to resolve import "./charring"`.

- [ ] **Step 3: Write the implementation**

Create `src/world/charring.ts`:

```ts
import * as THREE from 'three'
import { PALETTE } from '../ui/tokens'

const SCORCH = new THREE.Color(PALETTE.scorch)

/**
 * One scorch value driving every material an object owns.
 *
 * Scorch colour used to be applied ad hoc — per material, per state — so some
 * materials were missed (a burning hut kept a cheerful clay roof knob) and some
 * states leaked a stale colour (a rebuilt hut stayed charcoal forever). Here the
 * base colours are captured once and `amount` is the ONLY thing that decides what
 * is drawn, so no state can leak: driving it to 0 is exactly as good as never
 * having burned.
 */
export class Charring {
  private readonly materials: THREE.MeshToonMaterial[] = []
  private readonly baseColors: THREE.Color[] = []
  private value = 0

  constructor(materials: readonly THREE.MeshToonMaterial[]) {
    this.add(...materials)
  }

  /** Register more materials. Their current colour is taken as their base. */
  add(...materials: THREE.MeshToonMaterial[]): void {
    for (const material of materials) {
      this.materials.push(material)
      this.baseColors.push(material.color.clone())
    }
    this.apply()
  }

  set(amount: number): void {
    this.value = THREE.MathUtils.clamp(amount, 0, 1)
    this.apply()
  }

  get amount(): number {
    return this.value
  }

  private apply(): void {
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].color.copy(this.baseColors[i]).lerp(SCORCH, this.value)
    }
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/world/charring.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/world/charring.ts src/world/charring.test.ts
git commit -m "feat: add Charring — one scorch value driving every material"
```

---

## Task 2: The reseeding rule

Pure, and the heart of "forests move". Kept out of `objects.ts` so it can be tested without a scene.

**Files:**
- Create: `src/world/forest.ts`
- Test: `src/world/forest.test.ts`

**Interfaces:**
- Consumes: `isBuildable`, `type GroundQuery` from `./terrain`. `RNG` from `../core/rng`. `WALK_RADIUS` from `./island`.
- Produces:
  ```ts
  export const MAX_TREES = 13
  /** A tree only for the purposes of the seeding rule — no THREE, no class. */
  export type Seedling = { x: number; z: number; state: TreeState }
  /** Still standing matter: forest AND fuel. Includes `toppling` (see below). */
  export function isLiving(state: TreeState): boolean
  /** Holds a place in the population cap. Narrower: excludes `toppling`. */
  export function holdsPlace(state: TreeState): boolean
  export function seedSite(
    trees: readonly Seedling[],
    query: GroundQuery,
    groundY: (x: number, z: number) => number,
    rng: RNG,
  ): { x: number; z: number } | null
  ```
  **Two predicates, deliberately.** `isLiving` answers "is this burnable matter"
  (used by `World.flammables()`); `holdsPlace` answers "does this count against the
  13-tree cap" (used by `World.reseedForest`). They differ on exactly one state:
  a lightning-split tree is `toppling` **and** burning, so it must stay fuel — but
  it is on its way out, so the forest may start replacing it now.
  `TreeState` is imported from `./objects` — Task 3 widens it. **Write Task 3's `TreeState` union now if you are doing this task first**, or `tsc` will not know `'stump'`.

- [ ] **Step 1: Move `TreeState` into `forest.ts`, and re-export it**

`TreeState` currently lives in `objects.ts` (line 10). It has to move, or we get a
cycle: `objects.ts` will import the forest rules (`isLiving`), and `forest.ts` needs
`TreeState`. The state names *are* forest vocabulary, so they belong here.

Put the widened union at the top of the new `src/world/forest.ts` (its full contents
come in Step 4):

```ts
export type TreeState =
  | 'sapling'
  | 'normal'
  | 'toppling'
  | 'felled'
  | 'stump'
  | 'burning'
  | 'snag'
```

Then in `src/world/objects.ts`, **delete** the old `TreeState` on line 10 and
re-export the new one in its place, so every existing importer of
`TreeState` from `./objects` keeps working untouched:

```ts
export type { TreeState } from './forest'
```

This alone breaks `tsc` — the `Tree` class still assigns `'chopped'` and `'burnt'`,
which are no longer members. That is expected, and Task 3 fixes it. Do not chase it
here.

- [ ] **Step 2: Write the failing test**

Create `src/world/forest.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RNG } from '../core/rng'
import { MAX_TREES, holdsPlace, isLiving, seedSite, type Seedling } from './forest'
import type { GroundQuery } from './terrain'

const flat = (): number => 0
const open: GroundQuery = { basins: [], craters: [], occupied: [] }

describe('isLiving', () => {
  it('counts a sapling and a grown tree as forest', () => {
    expect(isLiving('sapling')).toBe(true)
    expect(isLiving('normal')).toBe(true)
  })

  it('does NOT count dead wood — stumps and snags are scenery, not forest', () => {
    expect(isLiving('stump')).toBe(false)
    expect(isLiving('snag')).toBe(false)
    expect(isLiving('felled')).toBe(false)
  })

  it('counts a BURNING tree as living — it is still standing, and still fuel', () => {
    // This matters twice over. `World.flammables()` is built from the same test, so
    // if a burning tree stopped being "living" it would drop out of the fuel list
    // mid-burn and never finish burning. And it still occupies its spot in the
    // forest, so the cap must not let a sapling sprout on top of it.
    expect(isLiving('burning')).toBe(true)
  })

  it('a toppling tree is still living — lightning fells a tree that is still on fire', () => {
    // A lightning split leaves the tree BOTH `toppling` and `burning`. If toppling
    // were not living it would drop out of the fuel list mid-fall and its fire
    // would never resolve — it would lie there burning forever.
    expect(isLiving('toppling')).toBe(true)
  })
})

describe('holdsPlace', () => {
  it('counts standing trees against the cap', () => {
    expect(holdsPlace('sapling')).toBe(true)
    expect(holdsPlace('normal')).toBe(true)
    expect(holdsPlace('burning')).toBe(true)
  })

  it('releases the spot as soon as a tree starts to go over', () => {
    // Narrower than isLiving on exactly this state: a tree mid-fall is still fuel,
    // but it is not going to be a tree much longer, so the forest may replace it
    // now rather than waiting out its 30-second log.
    expect(holdsPlace('toppling')).toBe(false)
  })

  it('never counts dead wood', () => {
    expect(holdsPlace('felled')).toBe(false)
    expect(holdsPlace('stump')).toBe(false)
    expect(holdsPlace('snag')).toBe(false)
  })
})

describe('seedSite', () => {
  it('sprouts NEAR a surviving tree, so the forest creeps rather than respawns', () => {
    const parent: Seedling = { x: 4, z: 0, state: 'normal' }
    const site = seedSite([parent], open, flat, new RNG(1))

    expect(site).not.toBeNull()
    const distance = Math.hypot(site!.x - parent.x, site!.z - parent.z)
    expect(distance).toBeGreaterThanOrEqual(2.5)
    expect(distance).toBeLessThanOrEqual(5)
  })

  it('seeds from a LIVING parent, never from a stump', () => {
    // The stump is far away; the only living tree is at the origin. A seed must
    // land near the living one, or the forest would regrow from its own corpses.
    const trees: Seedling[] = [
      { x: 0, z: 0, state: 'normal' },
      { x: -11, z: 0, state: 'stump' },
    ]
    for (let i = 0; i < 40; i++) {
      const site = seedSite(trees, open, flat, new RNG(i))
      expect(site).not.toBeNull()
      expect(Math.hypot(site!.x, site!.z)).toBeLessThanOrEqual(5)
    }
  })

  it('MERCY RULE: seeds anywhere buildable when every tree is gone', () => {
    const site = seedSite([], open, flat, new RNG(1))

    expect(site).not.toBeNull()
    expect(Math.hypot(site!.x, site!.z)).toBeLessThanOrEqual(12)
  })

  it('applies the mercy rule when only dead wood remains', () => {
    const site = seedSite([{ x: 0, z: 0, state: 'stump' }], open, flat, new RNG(1))
    expect(site).not.toBeNull()
  })

  it('never seeds on ground that is not buildable', () => {
    // Everything within reach of the parent is occupied, so there is nowhere to go.
    const parent: Seedling = { x: 0, z: 0, state: 'normal' }
    const crowded: GroundQuery = {
      basins: [],
      craters: [],
      occupied: Array.from({ length: 72 }, (_, i) => ({
        x: Math.cos((i / 36) * Math.PI) * (2.5 + (i % 2) * 2.5),
        z: Math.sin((i / 36) * Math.PI) * (2.5 + (i % 2) * 2.5),
      })),
    }
    expect(seedSite([parent], crowded, flat, new RNG(1))).toBeNull()
  })

  it('keeps saplings on the walkable island', () => {
    // A parent right at the rim: every seed must still land inside WALK_RADIUS.
    const parent: Seedling = { x: 11.5, z: 0, state: 'normal' }
    for (let i = 0; i < 60; i++) {
      const site = seedSite([parent], open, flat, new RNG(i))
      if (!site) continue
      expect(Math.hypot(site.x, site.z)).toBeLessThanOrEqual(12)
    }
  })

  it('is deterministic', () => {
    const trees: Seedling[] = [{ x: 3, z: 3, state: 'normal' }]
    expect(seedSite(trees, open, flat, new RNG(7)))
      .toEqual(seedSite(trees, open, flat, new RNG(7)))
  })

  it('caps the forest at 13', () => {
    expect(MAX_TREES).toBe(13)
  })
})
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run src/world/forest.test.ts`
Expected: FAIL — `Failed to resolve import "./forest"`.

- [ ] **Step 4: Write the implementation**

Create `src/world/forest.ts`:

```ts
import type { RNG } from '../core/rng'
import { WALK_RADIUS } from './island'
import { isBuildable, type GroundQuery } from './terrain'

/**
 * A tree's life, in order. The old game had only `normal | chopped | burning |
 * burnt`, and expressed every one of them by scaling a single crown down — so a
 * growing tree and a chopped tree were indistinguishable, and a chopped tree
 * quietly regrew in place. These states are what make the forest honest.
 *
 * Defined here rather than in `objects.ts` because they are forest vocabulary, and
 * because `objects.ts` imports the rules below — the other direction would cycle.
 */
export type TreeState =
  | 'sapling'
  | 'normal'
  | 'toppling'
  | 'felled'
  | 'stump'
  | 'burning'
  | 'snag'

/** The island supports this many living trees. Stumps and snags do not count. */
export const MAX_TREES = 13

/** How far a sapling sprouts from its parent. Close enough to read as spread. */
const SEED_MIN = 2.5
const SEED_MAX = 5

/** A tree, as far as the seeding rule cares. No THREE, no class. */
export type Seedling = { x: number; z: number; state: TreeState }

/**
 * Is this tree still standing matter — forest, and fuel?
 *
 * A stump, a felled log and a snag are dead wood: clay markers of what has been
 * done to the island. They are scenery. They hold no place in the population cap,
 * they sow no seeds, and — critically — they do not burn, which is what keeps a
 * clearing full of stumps from becoming a tinderbox.
 *
 * A `toppling` tree still counts, because a lightning split leaves a tree BOTH
 * toppling and burning: drop it here and its fire never resolves.
 */
export function isLiving(state: TreeState): boolean {
  return state === 'sapling'
    || state === 'normal'
    || state === 'burning'
    || state === 'toppling'
}

/**
 * Does this tree hold a place in the forest's population cap?
 *
 * Narrower than `isLiving`: a tree already going over is not going to be a tree
 * much longer, so the forest may start replacing it now rather than waiting out
 * its 30-second log.
 */
export function holdsPlace(state: TreeState): boolean {
  return state === 'sapling' || state === 'normal' || state === 'burning'
}

/**
 * Where the next sapling should sprout, or null if there is nowhere good.
 *
 * Saplings sprout NEAR a surviving tree, which is what makes forests move: clear
 * the north woods and they creep back from the south, growing around your stumps.
 * If every tree is gone, the mercy rule seeds one anywhere buildable, so total
 * deforestation is recoverable — but slowly, and from wherever the island decides.
 */
export function seedSite(
  trees: readonly Seedling[],
  query: GroundQuery,
  groundY: (x: number, z: number) => number,
  rng: RNG,
): { x: number; z: number } | null {
  // Seeds come from trees that are actually standing. A tree mid-fall sows nothing.
  const parents = trees.filter(tree => holdsPlace(tree.state))

  if (parents.length === 0) {
    // Mercy rule: nothing is left to seed from, so the island seeds itself.
    for (let attempt = 0; attempt < 60; attempt++) {
      const angle = rng.range(0, Math.PI * 2)
      const distance = Math.sqrt(rng.next()) * (WALK_RADIUS - 1)
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      if (isBuildable(x, z, query, groundY)) return { x, z }
    }
    return null
  }

  const parent = rng.pick([...parents])
  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(SEED_MIN, SEED_MAX)
    const x = parent.x + Math.cos(angle) * distance
    const z = parent.z + Math.sin(angle) * distance
    if (Math.hypot(x, z) > WALK_RADIUS - 1) continue
    if (isBuildable(x, z, query, groundY)) return { x, z }
  }
  return null
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/world/forest.test.ts`
Expected: PASS — 9 tests. (`tsc` is still red from Step 1; Task 3 clears it.)

- [ ] **Step 6: Commit**

The build is intentionally red between Tasks 2 and 3 — the widened `TreeState` has no matching class yet. Commit anyway so the diff stays reviewable:

```bash
git add src/world/forest.ts src/world/forest.test.ts src/world/objects.ts
git commit -m "feat: add the forest reseeding rule — saplings sprout near survivors"
```

---

## Task 3: `Tree` becomes a lifecycle

The visible fix. Trunk and crown become separately controlled, dead trees stay dead, and the shadow tracks the tree's real size.

**Files:**
- Modify: `src/world/objects.ts` — the `Tree` class (currently lines 183–367), and `addBlobShadow` (lines 32–45)

**Interfaces:**
- Consumes: `Charring` (Task 1), `TreeState` (widened in Task 2).
- Produces: the `Tree` public surface changes.
  - **Kept:** `id`, `x`, `z`, `state`, `group`, `kind`, `burning`, `burnt`, `burnTime`, `update(dt, qt)`, `extinguish()`, `growFruit()`, `hasFruit`, `setFireLightEnabled(on)`.
  - **Changed:** `ignite(split = false)` — a direct strike splits and topples; spreading fire does not.
  - **Replaced:** `chop()` now topples (it no longer schedules regrowth). `setBurnt()` now makes a **snag**, not a scaled-down crown.
  - **New:**
    ```ts
    obliterate(): void     // straight to stump. A meteor annihilates.
    readonly living: boolean   // sapling | normal | burning — i.e. is it fuel, is it forest
    ```
  - **Gone:** the in-place regrowth path (`recoveryTime`, `shrinkFrames`, `beginRecovery`, `resetCrownColors`). A dead tree stays dead.

- [ ] **Step 1: Make the blob shadow resizable**

In `src/world/objects.ts`, replace `addBlobShadow` (lines 32–45) with a version that hands back a handle. The old one baked the radius in at construction, which is exactly why a chopped tree kept a full-size shadow forever (defect 1).

```ts
/**
 * The soft shadow under an object in low-FX mode, as a handle rather than a
 * fire-and-forget. A tree's shadow has to shrink when it becomes a stump and
 * stretch out when it is lying on the ground, so the radius cannot be a constant
 * baked in at construction.
 */
class BlobShadow {
  private readonly mesh: THREE.Mesh | null

  constructor(group: THREE.Group, private readonly baseRadius: number, lowFx: boolean) {
    if (!lowFx) {
      this.mesh = null
      return
    }
    const material = new THREE.MeshBasicMaterial({
      color: PALETTE.scorch,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = 0.025
    this.mesh.renderOrder = 1
    this.mesh.scale.setScalar(baseRadius)
    group.add(this.mesh)
  }

  /** Resize to a fraction of the shadow this object had when it was whole. */
  setScale(fraction: number, stretch = 1): void {
    if (!this.mesh) return
    this.mesh.scale.set(this.baseRadius * fraction * stretch, this.baseRadius * fraction, 1)
  }
}

function addBlobShadow(group: THREE.Group, radius: number, lowFx: boolean): BlobShadow {
  return new BlobShadow(group, radius, lowFx)
}
```

`Hut`, `Campfire` and `Grave` call `addBlobShadow(...)` and ignore the return value, so they need no change.

- [ ] **Step 2: Write the failing test**

Create `src/world/objects.test.ts`. The `Tree` needs no `Island` — it takes a plain `y`:

```ts
import { describe, expect, it } from 'vitest'
import { RNG } from '../core/rng'
import { Tree } from './objects'

const tree = (): Tree => new Tree('tree-0', 0, 0, 0, new RNG(1))

/** Drive the clock forward. `qt` must advance or quantized work is skipped. */
function run(subject: Tree, seconds: number, from = 0): number {
  const step = 1 / 12
  let qt = from
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    qt += step
    subject.update(step, qt)
  }
  return qt
}

describe('Tree lifecycle', () => {
  it('starts grown', () => {
    expect(tree().state).toBe('normal')
  })

  it('topples when chopped, rather than shrinking its crown in place', () => {
    const subject = tree()
    subject.chop()
    expect(subject.state).toBe('toppling')
  })

  it('lies as a felled log once it has gone over', () => {
    const subject = tree()
    subject.chop()
    run(subject, 1)                       // topple takes ~0.6s
    expect(subject.state).toBe('felled')
  })

  it('leaves a PERMANENT stump — a dead tree does not come back', () => {
    const subject = tree()
    subject.chop()
    const qt = run(subject, 1)
    run(subject, 31, qt)                  // the log lies for ~30s, then fades
    expect(subject.state).toBe('stump')

    // The old game regrew a chopped tree after 120s. It must not.
    run(subject, 200, qt + 31)
    expect(subject.state).toBe('stump')
  })

  it('a stump is not living — it is neither fuel nor forest', () => {
    const subject = tree()
    subject.obliterate()
    expect(subject.state).toBe('stump')
    expect(subject.living).toBe(false)
    expect(subject.burnt).toBe(true)
  })

  it('obliterate goes straight to a stump — a meteor annihilates', () => {
    const subject = tree()
    subject.obliterate()
    expect(subject.state).toBe('stump')
  })

  it('a spreading fire leaves a standing snag', () => {
    const subject = tree()
    subject.ignite()                      // no split: this is spread, not a strike
    expect(subject.state).toBe('burning')
    subject.setBurnt()
    expect(subject.state).toBe('snag')
  })

  it('a SPLIT ignite topples the tree — lightning fells what it strikes', () => {
    const subject = tree()
    subject.ignite(true)
    expect(subject.state).toBe('toppling')
    expect(subject.burning).toBe(true)
  })

  it('ignoring a re-ignite keeps FireSystem from resetting a burning tree', () => {
    // FireSystem sets `burning = true` directly, then World calls ignite() again.
    const subject = tree()
    subject.ignite(true)
    subject.ignite()                      // must not undo the split
    expect(subject.state).toBe('toppling')
  })

  it('never ignites dead wood', () => {
    const subject = tree()
    subject.obliterate()
    subject.ignite()
    expect(subject.state).toBe('stump')
    expect(subject.burning).toBe(false)
  })

  it('a snag eventually topples and becomes a stump too', () => {
    const subject = tree()
    subject.ignite()
    subject.setBurnt()
    expect(subject.state).toBe('snag')

    run(subject, 60)
    expect(subject.state).toBe('stump')
  })

  it('a sapling grows into a full tree', () => {
    const sapling = new Tree('tree-1', 0, 0, 0, new RNG(1), false, 'sapling')
    expect(sapling.state).toBe('sapling')
    expect(sapling.living).toBe(true)

    run(sapling, 45)                      // growth takes ~40s
    expect(sapling.state).toBe('normal')
  })

  it('a sapling is visibly SMALLER than a grown tree — growth is not a shrunk crown', () => {
    // Defect 2: a growing tree used to be indistinguishable from a chopped one,
    // because both were "the same crown, scaled down". A sapling's TRUNK is small
    // too, and a stump has no crown at all.
    const sapling = new Tree('tree-2', 0, 0, 0, new RNG(1), false, 'sapling')
    const grown = tree()

    const sizeOf = (t: Tree): number => {
      const box = new THREE.Box3().setFromObject(t.group)
      return box.max.y - box.min.y
    }
    expect(sizeOf(sapling)).toBeLessThan(sizeOf(grown))
  })

  it('extinguishing a burning tree returns it to normal, unscorched', () => {
    const subject = tree()
    subject.ignite()
    run(subject, 2)
    subject.extinguish()
    expect(subject.state).toBe('normal')
    expect(subject.burning).toBe(false)
  })
})
```

Add the THREE import at the top of the test file, for the `Box3` size check:

```ts
import * as THREE from 'three'
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run src/world/objects.test.ts`
Expected: FAIL — `subject.obliterate is not a function`, and `chop()` sets `'chopped'`, not `'toppling'`.

- [ ] **Step 4: Rewrite the `Tree` class**

In `src/world/objects.ts`, add the imports. The forest owns both the state names and
the two rules, so the class cannot drift from them:

```ts
import { Charring } from './charring'
import { holdsPlace, isLiving } from './forest'
```

Replace the whole `Tree` class (lines 183–367) with:

```ts
/** How long each phase of a tree's death takes, in seconds. */
const TOPPLE_SECONDS = 0.6
const FELLED_SECONDS = 30
const FADE_SECONDS = 2
/** A sapling takes this long to become a full tree. */
const GROW_SECONDS = 40
/** A charred snag stands this long before it goes over too. */
const SNAG_SECONDS = 45

/**
 * A tree with a life.
 *
 * The trunk and the crown are controlled separately, which is the whole point: the
 * old tree expressed every state by scaling one crown down, so a growing tree and
 * a chopped tree looked identical, and a chopped tree quietly regrew in place after
 * two minutes as though nothing had happened.
 *
 * Now a dead tree STAYS DEAD — it topples, lies as a log, and leaves a permanent
 * stump. The forest recovers by seeding saplings somewhere else (see `forest.ts`),
 * so the island keeps a memory of what was done to it.
 */
export class Tree {
  state: TreeState
  group = new THREE.Group()
  readonly kind = 'tree' as const
  burning = false
  burnt = false
  burnTime = 0

  private trunk: THREE.Mesh
  private stump: THREE.Mesh
  private crown = new THREE.Group()
  private charring: Charring
  private shadow: BlobShadow
  private fireVisual: BurningVisual
  private fruit: THREE.InstancedMesh | null = null
  private fruitTime = 0
  private lastQt = Number.NEGATIVE_INFINITY

  /** Seconds spent in the current phase. Drives toppling, felling and growth. */
  private phase = 0

  constructor(
    public id: string,
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    private lowFx = false,
    state: TreeState = 'normal',
  ) {
    this.state = state
    this.group.position.set(x, y, z)

    const trunkMaterial = clayMaterial(PALETTE.bark)
    this.trunk = new THREE.Mesh(
      wobble(new THREE.CylinderGeometry(0.18, 0.28, 1.1, 10, 3), rng, 0.045),
      trunkMaterial,
    )
    this.trunk.position.y = 0.55
    setShadow(this.trunk, lowFx)
    this.group.add(this.trunk)

    // The stump is built up front and simply revealed: a jagged remnant of trunk,
    // permanent scenery once the tree is gone.
    const stumpMaterial = clayMaterial(PALETTE.bark)
    stumpMaterial.color.multiplyScalar(0.85)
    this.stump = new THREE.Mesh(
      wobble(new THREE.CylinderGeometry(0.26, 0.3, 0.3, 9, 2), rng, 0.06),
      stumpMaterial,
    )
    this.stump.position.y = 0.15
    this.stump.visible = false
    setShadow(this.stump, lowFx)
    this.group.add(this.stump)

    this.charring = new Charring([trunkMaterial])

    const leafColors = [PALETTE.leafA, PALETTE.grassDark, PALETTE.leafB]
    const crownCount = rng.int(2, 3)
    for (let i = 0; i < crownCount; i++) {
      const radius = rng.range(0.7, 1)
      const material = clayMaterial(rng.pick(leafColors))
      const blob = new THREE.Mesh(
        wobble(new THREE.SphereGeometry(radius, 14, 10), rng, 0.08),
        material,
      )
      blob.position.set(
        rng.range(-0.42, 0.42),
        rng.range(-0.08, 0.42),
        rng.range(-0.35, 0.35),
      )
      blob.scale.set(rng.range(0.9, 1.15), rng.range(0.8, 1.05), rng.range(0.9, 1.15))
      blob.rotation.set(rng.range(-0.18, 0.18), rng.range(0, Math.PI * 2), rng.range(-0.18, 0.18))
      setShadow(blob, lowFx)
      this.charring.add(material)
      this.crown.add(blob)
    }
    this.crown.position.y = 1.45
    this.crown.rotation.y = rng.range(0, Math.PI * 2)
    this.group.add(this.crown)

    this.fireVisual = new BurningVisual(seedFromId(id), 1.25, 0.34, lowFx)
    this.group.add(this.fireVisual.group)
    this.shadow = addBlobShadow(this.group, 1.05, lowFx)
    this.syncAppearance()
  }

  /**
   * Is this tree still burnable matter? Dead wood — stump, log, snag — is not.
   *
   * `toppling` counts, because a lightning split leaves a tree both toppling and
   * burning: if it left the fuel list mid-fall its fire would never resolve.
   * Delegated to `forest.ts` so the fuel rule and the population rule cannot drift
   * apart.
   */
  get living(): boolean {
    return isLiving(this.state)
  }

  /** Does this tree hold a place against the forest's cap? Narrower than `living`. */
  get holdsPlace(): boolean {
    return holdsPlace(this.state)
  }

  /** The villager's axe. The trunk goes over; a stump is left behind. */
  chop(): void {
    if (!this.living) return
    this.topple()
  }

  /**
   * Set alight. `split` is a DIRECT strike — lightning — which fells the tree where
   * it stands; fire that arrives by spread leaves it standing to become a snag.
   *
   * The early-return matters: `FireSystem` sets `burning = true` on this object and
   * only THEN does `World.updateFire` call `ignite()`, so this is routinely invoked
   * on a tree that is already alight. It must be a no-op, or a spreading fire would
   * undo a lightning split.
   */
  ignite(split = false): void {
    if (this.burning || this.burnt || !this.living) return
    this.state = 'burning'
    this.burning = true
    this.burnt = false
    this.burnTime = 0
    this.fireVisual.setBurning(true)
    if (split) this.topple()
    this.syncAppearance()
  }

  extinguish(): void {
    if (this.state !== 'burning') return
    this.state = 'normal'
    this.burning = false
    this.burnTime = 0
    this.charring.set(0)
    this.fireVisual.setBurning(false)
    this.syncAppearance()
  }

  /** The fire consumed it: a charred trunk, standing, which topples in its own time. */
  setBurnt(): void {
    if (this.state === 'stump' || this.state === 'felled') return
    this.burning = false
    this.burnt = true
    this.fireVisual.setBurning(false)
    this.charring.set(1)
    // A tree already going over keeps going over — it just finishes as charcoal.
    if (this.state !== 'toppling') {
      this.state = 'snag'
      this.phase = 0
    }
    this.syncAppearance()
  }

  /** A meteor annihilates what it lands on. Splinters, no fire, a stump left behind. */
  obliterate(): void {
    this.state = 'stump'
    this.burning = false
    this.burnt = true
    this.burnTime = 0
    this.phase = 0
    this.fireVisual.setBurning(false)
    this.syncAppearance()
  }

  setFireLightEnabled(on: boolean): void {
    this.fireVisual.setLightEnabled(on)
  }

  growFruit(): boolean {
    if (this.state !== 'normal') return false
    if (this.fruit) {
      this.fruitTime = 60
      return false
    }
    const geometry = wobble(new THREE.SphereGeometry(0.12, 8, 6), new RNG(this.id.length * 97), 0.018)
    const fruit = new THREE.InstancedMesh(geometry, clayMaterial(PALETTE.smockA), 4)
    const matrix = new THREE.Matrix4()
    const positions = [
      [-0.52, 0.02, 0.28],
      [0.5, 0.12, 0.18],
      [-0.18, -0.38, 0.5],
      [0.26, -0.34, -0.44],
    ]
    for (let i = 0; i < positions.length; i++) {
      const [px, py, pz] = positions[i]
      matrix.makeTranslation(px, py, pz)
      fruit.setMatrixAt(i, matrix)
    }
    fruit.instanceMatrix.needsUpdate = true
    fruit.castShadow = !this.lowFx
    this.crown.add(fruit)
    this.fruit = fruit
    this.fruitTime = 60
    return true
  }

  get hasFruit(): boolean {
    return this.fruit !== null
  }

  update(dt: number, qt: number): void {
    this.phase += dt

    if (this.state === 'burning') {
      this.charring.set(Math.min(1, this.charring.amount + dt * 0.65))
    }

    if (this.state === 'sapling') {
      const growth = Math.min(1, this.phase / GROW_SECONDS)
      this.setGrowth(growth)
      if (growth >= 1) {
        this.state = 'normal'
        this.phase = 0
      }
    }

    if (this.state === 'toppling') {
      const fall = Math.min(1, this.phase / TOPPLE_SECONDS)
      // Ease into the ground so it lands with weight rather than a linear sweep.
      this.trunk.rotation.z = (Math.PI / 2) * (fall * fall)
      this.crown.rotation.z = this.trunk.rotation.z
      this.trunk.position.y = 0.55 * (1 - fall) + 0.18 * fall
      this.crown.position.y = 1.45 * (1 - fall) + 0.42 * fall
      this.shadow.setScale(1, 1 + fall * 0.6)
      if (fall >= 1) {
        this.state = 'felled'
        this.phase = 0
        this.dropCrown()
        this.syncAppearance()
      }
    }

    if (this.state === 'snag' && this.phase >= SNAG_SECONDS) {
      this.topple()
    }

    if (this.state === 'felled') {
      // Lie there long enough to read as something you did, then sink into the grass.
      const fade = Math.max(0, this.phase - FELLED_SECONDS) / FADE_SECONDS
      if (fade > 0) {
        const material = this.trunk.material as THREE.MeshToonMaterial
        material.transparent = true
        material.opacity = Math.max(0, 1 - fade)
      }
      if (this.phase >= FELLED_SECONDS + FADE_SECONDS) {
        this.state = 'stump'
        this.phase = 0
        this.syncAppearance()
      }
    }

    if (this.fruit) {
      this.fruitTime -= dt
      if (this.fruitTime <= 0) {
        this.crown.remove(this.fruit)
        disposeObjectResources(this.fruit)
        this.fruit = null
      }
    }
    this.fireVisual.update(qt)
    this.lastQt = qt
  }

  /** Begin the fall. Shared by the axe, a lightning split, and a rotten snag. */
  private topple(): void {
    if (this.state === 'toppling' || this.state === 'felled' || this.state === 'stump') return
    this.state = 'toppling'
    this.phase = 0
    this.syncAppearance()
  }

  /** The crown does not survive the fall. */
  private dropCrown(): void {
    this.crown.visible = false
  }

  /** A sapling's TRUNK is small too — that is what makes growth legible. */
  private setGrowth(growth: number): void {
    const scale = THREE.MathUtils.lerp(0.25, 1, growth)
    this.trunk.scale.setScalar(scale)
    this.trunk.position.y = 0.55 * scale
    this.crown.scale.setScalar(scale)
    this.crown.position.y = 1.45 * scale
    this.shadow.setScale(scale)
  }

  private syncAppearance(): void {
    const standing = this.state === 'sapling' || this.state === 'normal' || this.state === 'burning'
    const fallen = this.state === 'toppling' || this.state === 'felled'

    this.trunk.visible = standing || fallen || this.state === 'snag'
    this.crown.visible = standing || this.state === 'toppling'
    this.stump.visible = this.state === 'stump'

    if (this.state === 'stump') {
      this.shadow.setScale(0.33)
      return
    }
    if (this.state === 'felled') {
      this.shadow.setScale(1, 1.6)
      return
    }
    if (this.state === 'snag') {
      // No crown, so the canopy shadow goes with it.
      this.shadow.setScale(0.5)
      this.crown.visible = false
      return
    }
    if (this.state === 'sapling') return   // setGrowth owns the scale
    this.shadow.setScale(1)
  }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/world/objects.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL in `src/world/world.ts` — `destroyTarget` calls `tree.setBurnt()` (still valid, but now means "snag"), and `flammables()` passes dead trees. Task 5 fixes both. `villager.ts:472` calls `chop()`, which still exists and still compiles.

If `tsc` reports anything *else* — a missing `TreeState` member, an unused `crownColors` — fix it here.

- [ ] **Step 7: Commit**

```bash
git add src/world/objects.ts src/world/objects.test.ts
git commit -m "feat: give trees a life — topple, felled log, permanent stump, snag"
```

---

## Task 4: The hut adopts `Charring`

Defects 7 and 8, deleted rather than patched.

**Files:**
- Modify: `src/world/objects.ts` — the `Hut` class (currently lines 369–529)
- Test: `src/world/objects.test.ts`

**Interfaces:**
- Consumes: `Charring` (Task 1).
- Produces: no public API change. `Hut`'s `burnMix` field is replaced by a `Charring`.

- [ ] **Step 1: Write the failing test**

Append to `src/world/objects.test.ts`:

```ts
import { Hut } from './objects'

/** Read a mesh's material colour by name, wherever it sits in the hut's group. */
function colorOf(hut: Hut, name: string): number {
  let found = 0
  hut.group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child.name !== name) return
    found = (child.material as THREE.MeshToonMaterial).color.getHex()
  })
  return found
}

describe('Hut charring', () => {
  const built = (): Hut => new Hut('hut-0', 0, 0, 'built', 0, new RNG(1))

  it('chars the door and the roof knob too, not just the body', () => {
    // Defect 8: a burning hut had a charred body and a cheerful clay roof knob,
    // because only `base` was ever scorched.
    const hut = built()
    const knobBefore = colorOf(hut, 'hut-roof-knob')

    hut.ignite()
    for (let i = 0; i < 40; i++) hut.update(1 / 12, i / 12)

    expect(colorOf(hut, 'hut-roof-knob')).not.toBe(knobBefore)
    expect(colorOf(hut, 'hut-door')).not.toBe(0)
  })

  it('a REBUILT hut is clay-coloured again, not charcoal forever', () => {
    // Defect 7: `buildTick()` never restored the colour.
    const hut = built()
    const clean = colorOf(hut, 'hut-base')

    hut.ignite()
    for (let i = 0; i < 40; i++) hut.update(1 / 12, i / 12)
    hut.setRuin()

    hut.buildTick()
    hut.buildTick()
    hut.buildTick()
    expect(hut.state).toBe('built')
    expect(colorOf(hut, 'hut-base')).toBe(clean)
  })

  it('extinguishing a burning hut also clears the scorch', () => {
    const hut = built()
    const clean = colorOf(hut, 'hut-base')

    hut.ignite()
    for (let i = 0; i < 20; i++) hut.update(1 / 12, i / 12)
    hut.extinguish()

    expect(colorOf(hut, 'hut-base')).toBe(clean)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/world/objects.test.ts`
Expected: FAIL — the meshes have no names yet, so `colorOf` returns 0; and the knob never chars.

- [ ] **Step 3: Name the meshes and adopt `Charring`**

In `src/world/objects.ts`, in the `Hut` constructor, name the three meshes so they can be found (and so the scene graph is legible in the inspector), and register all three with one `Charring`:

```ts
    const baseMaterial = clayMaterial(PALETTE.hutClay)
    this.base = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(1.1, 18, 12), rng, 0.1),
      baseMaterial,
    )
    this.base.name = 'hut-base'
    this.base.position.y = 0.82
    setShadow(this.base, lowFx)

    const doorMaterial = clayMaterial(PALETTE.scorch)
    this.door = new THREE.Mesh(
      wobble(new THREE.BoxGeometry(0.52, 0.74, 0.14, 3, 3, 2), rng, 0.025),
      doorMaterial,
    )
    this.door.name = 'hut-door'
    this.door.position.set(0, 0.6, 0.96)
    setShadow(this.door, lowFx)

    const knobMaterial = clayMaterial(PALETTE.hutClay)
    this.roofKnob = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.25, 10, 8), rng, 0.04),
      knobMaterial,
    )
    this.roofKnob.name = 'hut-roof-knob'
    this.roofKnob.position.y = 1.72
    this.roofKnob.scale.y = 0.8
    setShadow(this.roofKnob, lowFx)

    // One scorch value for the whole hut. The door and the knob used to be missed
    // entirely, and nothing ever drove the colour back to clay on a rebuild.
    this.charring = new Charring([baseMaterial, doorMaterial, knobMaterial])
```

Replace the `burnMix` field declaration with:

```ts
  private charring: Charring
```

Change the `door` and `roofKnob` field types so `tsc` can see their materials:

```ts
  private door: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private roofKnob: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
```

- [ ] **Step 4: Route every state through it**

Replace the four methods that touch colour.

`buildTick()` — **this is the defect-7 fix.** A rebuilt hut is a new hut:

```ts
  buildTick(): void {
    if (this.state === 'abandoned') return
    if (this.state !== 'site' && this.state !== 'building' && this.state !== 'ruin') return
    if (this.state === 'ruin') {
      this.burnt = false
      this.burnTime = 0
    }
    this.state = 'building'
    this.progress = Math.min(1, this.progress + 0.34)
    // Rebuilding drives the scorch to nothing. The old hut never did this, so a
    // rebuilt hut stayed charcoal-black forever.
    this.charring.set(0)
    if (this.progress >= 1) this.state = 'built'
    this.syncAppearance()
  }
```

`ignite()`:

```ts
  ignite(): void {
    if (this.state !== 'built' || this.burnt) return
    this.state = 'burning'
    this.burning = true
    this.burnt = false
    this.burnTime = 0
    this.charring.set(0)
    this.fireVisual.setBurning(true)
    this.syncAppearance()
  }
```

`extinguish()`:

```ts
  extinguish(): void {
    if (this.state !== 'burning') return
    this.state = 'built'
    this.burning = false
    this.burnTime = 0
    this.charring.set(0)
    this.fireVisual.setBurning(false)
    this.syncAppearance()
  }
```

`setRuin()`:

```ts
  setRuin(): void {
    this.state = 'ruin'
    this.burning = false
    this.burnt = true
    this.progress = 0
    this.charring.set(1)
    this.fireVisual.setBurning(false)
    this.syncAppearance()
  }
```

And in `update()`, replace the `burnMix` lerp:

```ts
    if (this.state === 'burning') {
      this.charring.set(Math.min(1, this.charring.amount + dt * 0.5))
    }
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — the 3 new hut tests, plus everything from Tasks 1–3. `tsc` is still red on `world.ts` until Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/world/objects.ts src/world/objects.test.ts
git commit -m "fix: char every material a hut owns, and clear it on rebuild"
```

---

## Task 5: The world grows and burns the right trees

Wire it up: dead wood stops being fuel, meteors obliterate, lightning splits, and the forest reseeds.

**Files:**
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`

**Interfaces:**
- Consumes: `MAX_TREES`, `seedSite`, `type Seedling` (Task 2); `Tree.obliterate`, `Tree.ignite(split)`, `Tree.living` (fuel) and `Tree.holdsPlace` (cap) (Task 3).
- Produces:
  - `World.reseedForest(dt, rng, lowFx)` — sprouts a sapling on a timer while the forest is under `MAX_TREES`.
  - `World.livingTrees(): Tree[]`.
  - `flammables()` stops passing dead trees.
  - `destroyTarget('tree', …)` calls `obliterate()`; `igniteTarget('tree', …)` splits.

- [ ] **Step 1: Write the failing test**

Add to `src/world/world.test.ts`. Reuse the existing stub-island helper in that file if it fits; otherwise this one, at module scope:

```ts
function forestWorld(): World {
  const island = {
    craters: [],
    sampleHeight: () => 0,
    group: { add: vi.fn(), remove: vi.fn() },
  } as unknown as Island
  return new World(island)
}

function addTree(world: World, id: string, x: number, z: number): Tree {
  const tree = new Tree(id, x, z, 0, new RNG(1))
  world.trees.push(tree)
  return tree
}

describe('World forest', () => {
  it('a STUMP is not fuel — a clearing of stumps is not a tinderbox', () => {
    // FireSystem treats anything with burnt === false as fuel and sets `burning`
    // on it directly. If dead trees stay in the flammable list, stumps catch fire.
    const world = forestWorld()
    const stump = addTree(world, 'tree-0', 0, 0)
    stump.obliterate()
    const alight = addTree(world, 'tree-1', 1, 0)
    alight.ignite()

    for (let i = 0; i < 200; i++) world.updateFire(1 / 12, new RNG(i))

    expect(stump.state).toBe('stump')
    expect(stump.burning).toBe(false)
  })

  it('grows a sapling when the forest is below the cap', () => {
    const world = forestWorld()
    addTree(world, 'tree-0', 0, 0)

    // The timer is 25-40s; drive well past it.
    for (let i = 0; i < 60; i++) world.reseedForest(1, new RNG(2), false)

    expect(world.trees.length).toBeGreaterThan(1)
    expect(world.trees.some(tree => tree.state === 'sapling')).toBe(true)
  })

  it('stops at MAX_TREES', () => {
    const world = forestWorld()
    for (let i = 0; i < MAX_TREES; i++) addTree(world, `tree-${i}`, i - 6, 0)

    for (let i = 0; i < 200; i++) world.reseedForest(1, new RNG(3), false)

    expect(world.livingTrees()).toHaveLength(MAX_TREES)
  })

  it('does NOT count stumps toward the cap — a cleared island regrows', () => {
    const world = forestWorld()
    for (let i = 0; i < MAX_TREES; i++) {
      addTree(world, `tree-${i}`, i - 6, 0).obliterate()
    }

    for (let i = 0; i < 60; i++) world.reseedForest(1, new RNG(4), false)

    expect(world.livingTrees().length).toBeGreaterThan(0)
  })

  it('a meteor OBLITERATES a tree — no fire, just a stump', () => {
    const world = forestWorld()
    const tree = addTree(world, 'tree-0', 2, 2)

    world.destroyTarget('tree', 2, 2)

    expect(tree.state).toBe('stump')
    expect(tree.burning).toBe(false)
  })

  it('lightning SPLITS a tree — it topples as it burns', () => {
    const world = forestWorld()
    const tree = addTree(world, 'tree-0', 2, 2)

    world.igniteTarget('tree', 2, 2)

    expect(tree.burning).toBe(true)
    expect(tree.state).toBe('toppling')
  })

  it('a hut ignited by lightning does not "topple" — split is a tree idea', () => {
    const world = forestWorld()
    const hut = new Hut('hut-0', 3, 3, 'built', 0, new RNG(1))
    world.huts.push(hut)

    world.igniteTarget('hut', 3, 3)

    expect(hut.state).toBe('burning')
  })
})
```

Add whatever imports the file is missing: `Tree`, `Hut`, `MAX_TREES` from `./forest`.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — `world.reseedForest is not a function`, and the meteor test finds `'snag'` rather than `'stump'`.

- [ ] **Step 3: Stop feeding dead wood to the fire**

In `src/world/world.ts`, add the imports:

```ts
import { MAX_TREES, seedSite, type Seedling } from './forest'
```

Replace `flammables()` (currently lines 530–537):

```ts
  private flammables(): Flammable[] {
    const items: Flammable[] = [
      // Only a LIVING tree is fuel. A stump, a felled log and a snag are dead wood
      // — and `fire.ts` calls anything with `burnt === false` healthy, so leaving
      // them in this list would turn a clearing of stumps into a tinderbox.
      ...this.trees.filter(tree => tree.living),
      ...this.huts.filter(hut => hut.state === 'built' || hut.state === 'burning' || hut.state === 'ruin'),
    ]
    if (this.campfire && !this.campfire.scattered) items.push(this.campfire)
    return items
  }
```

- [ ] **Step 4: Correct the two powers**

In `destroyTarget`, a meteor now annihilates rather than burns:

```ts
    if (kind === 'tree') {
      const tree = this.trees
        .filter(candidate => within(candidate, x, z, radius))
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]
      if (!tree) return false
      // A meteor annihilates what it lands on: splinters, no fire, a stump left
      // behind. Fire is what happens to the NEIGHBOURS, via igniteNear.
      tree.obliterate()
      this.bus.emit({ type: 'burnt', kind: 'tree' })
      return true
    }
```

In `igniteTarget`, a direct strike splits the tree. Note `object.ignite()` is called on a union of `Tree | Hut`, and only `Tree` takes the flag:

```ts
  igniteTarget(kind: 'tree' | 'hut', x: number, z: number): void {
    const candidates: Array<Tree | Hut> = kind === 'tree' ? this.trees : this.huts
    const object = candidates
      .filter(candidate => within(candidate, x, z, kind === 'tree' ? 1.3 : 1.8))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]
    if (!object) return
    const wasBurning = object.burning
    // A DIRECT strike splits a tree and fells it. Fire that arrives by spread (via
    // igniteNear or FireSystem) leaves it standing, to char into a snag.
    if (object instanceof Tree) object.ignite(true)
    else object.ignite()
    if (wasBurning || !object.burning) return
    this.bus.emit({
      type: 'fire:ignited', kind: object.kind, bySpread: false, burning: this.burningCount(),
    })
    this.alarmNear(object.x, object.z, 7)
  }
```

- [ ] **Step 5: Add the reseeding**

Add to `World`, beside `repopulate`:

```ts
  /** The trees that are actually forest — not stumps, logs, snags, or mid-fall. */
  livingTrees(): Tree[] {
    return this.trees.filter(tree => tree.holdsPlace)
  }

  /**
   * The forest grows back — somewhere else. Saplings sprout near survivors, so a
   * cleared wood stays cleared while the forest creeps in from the side that still
   * stands. Stumps do not count toward the cap: they are scenery, not forest.
   */
  reseedForest(dt: number, rng: RNG, lowFx = false): void {
    if (this.livingTrees().length >= MAX_TREES) {
      this.reseedTimer = null
      return
    }
    if (this.reseedTimer === null) this.reseedTimer = rng.range(25, 40)
    this.reseedTimer -= dt
    if (this.reseedTimer > 0) return
    this.reseedTimer = null

    const seedlings: Seedling[] = this.trees.map(tree => ({
      x: tree.x,
      z: tree.z,
      state: tree.state,
    }))
    const site = seedSite(
      seedlings,
      this.groundQuery(),
      (x, z) => this.island.sampleHeight(x, z),
      rng,
    )
    if (!site) return

    const sapling = new Tree(
      `tree-${this.treeSerial++}`,
      site.x,
      site.z,
      this.island.sampleHeight(site.x, site.z),
      rng,
      lowFx,
      'sapling',
    )
    this.trees.push(sapling)
    this.island.group.add(sapling.group)
  }
```

Add the two fields beside `repopulateTimer`:

```ts
  private reseedTimer: number | null = null
  /** Tree ids must stay unique as the forest turns over, so never reuse an index. */
  private treeSerial = 1000
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS — all of Tasks 1–5. `matrix.test.ts` still pins the old meteor row; Task 6 fixes it. `tsc` should now be clean.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/world/world.ts src/world/world.test.ts
git commit -m "feat: reseed the forest, and stop stumps from burning"
```

---

## Task 6: The matrix stops contradicting itself

Defect 9. `meteor.tree = ['ignite', 'destroy']` sets a tree alight *and* instantly incinerates it.

**Files:**
- Modify: `src/powers/matrix.ts:34`
- Modify: `src/powers/matrix.test.ts:11`
- Modify: `src/powers/meteor.test.ts:25-31`

**Interfaces:**
- Consumes: `destroyTarget` (Task 5), which now obliterates.
- Produces: no API change. `INTERACTION_KINDS` is unchanged — `ignite` is still emitted by `lightning.tree` and `lightning.hut`, so the "declares no kind the matrix can never emit" assertion still holds.

- [ ] **Step 1: Update the pinned assertion**

In `src/powers/matrix.test.ts`, line 11:

```ts
  meteor: {
    tree: ['destroy'],
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/powers/matrix.test.ts`
Expected: FAIL — `meteor on tree` expects `['destroy']` but the matrix still says `['ignite', 'destroy']`.

- [ ] **Step 3: Correct the matrix**

In `src/powers/matrix.ts`, line 34:

```ts
  meteor: {
    // A meteor ANNIHILATES what it lands on — splinters, no fire. Neighbours catch
    // fire from the blast, via the meteor's own igniteNear. Setting the struck tree
    // alight AND instantly incinerating it was incoherent.
    tree: ['destroy'],
```

- [ ] **Step 4: Fix the meteor test that asserts the old behaviour**

`src/powers/meteor.test.ts:25` reads "ignites and destroys a directly hit tree" and asserts both calls. Replace that test:

```ts
  it('obliterates a directly hit tree without setting it alight', () => {
    const ctx = context('tree')

    applyInteractions(resolveInteraction('meteor', 'tree'), ctx, 0)

    expect(ctx.world.destroyTarget).toHaveBeenCalledWith('tree', 2, 3)
    expect(ctx.world.igniteTarget).not.toHaveBeenCalled()
  })
```

Read the surrounding file before editing — keep its existing `context()` helper and import style.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — everything.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/powers/matrix.ts src/powers/matrix.test.ts src/powers/meteor.test.ts
git commit -m "fix: a meteor obliterates a tree instead of igniting and destroying it"
```

---

## Task 7: Drive it from the loop, and play it

Nothing calls `reseedForest` yet.

**Files:**
- Modify: `src/main.ts`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Call reseeding on the fixed step**

`src/main.ts` has two callbacks: a **fixed** simulation step (which calls `world.updateFire`, `world.relocateDrownedRuins`, `world.repopulate`) and a **render** step (which calls `tree.update`). Reseeding is simulation. Add it beside `repopulate`, around line 106:

```ts
    world.repopulate(dt, rng, lowFx)
    world.reseedForest(dt, rng, lowFx)
```

- [ ] **Step 2: Run the whole suite and build**

```bash
npm test
npx tsc --noEmit
npm run build
```
Expected: all green.

- [ ] **Step 3: Verify in the browser — this is the real test**

Run `npm run dev`. The unit tests prove the state machine; only the browser proves the game.

1. **A chop leaves a scar.** Watch a villager chop a tree. → The trunk **topples over** with a thump, lies as a **log**, fades after ~30s, and leaves a **stump** with a small shadow. The stump is still there minutes later — it does **not** regrow.
2. **Growth looks like growth.** Wait for a sapling (or chop a few trees to drop below 13). → A **small tree** appears near a surviving one and visibly **grows**, trunk and all. It is never mistakable for a chopped tree.
3. **The forest drifts.** Clear one side of the island. → New saplings appear on the side that still has trees, and creep back **around the stumps**. Clear everything → a lone mercy sapling eventually appears.
4. **A meteor annihilates.** Meteor a tree. → It is **gone** — splinters, a stump, **no fire on that tree**. Nearby trees may still catch from the blast.
5. **Lightning fells.** Lightning a tree. → It **splits and topples, burning** on the ground. It does not stand there slowly turning orange.
6. **The hut chars honestly.** Burn a hut. → The body, **the door and the roof knob** all char together. Let villagers rebuild it → it comes back **clay-coloured**, not charcoal.
7. **Stumps do not burn.** Chop several trees into stumps, then set a nearby tree alight. → The fire spreads among **living** trees only; the stumps never catch.
8. **Nothing regressed.** Rain still grows fruit on living trees. Fishing, huts, ponds, campfire all behave.

- [ ] **Step 4: Update the architecture doc**

In `docs/architecture.md`:
- Add `src/world/forest.ts` (the reseeding rule: `MAX_TREES = 13`, saplings sprout 2.5–5m from a living tree on `isBuildable` ground, mercy rule at zero trees) and `src/world/charring.ts` (one scorch value driving every material an object owns) to the module list.
- Record that `TreeState` is now `sapling | normal | toppling | felled | stump | burning | snag`, that **dead trees never regrow**, and that only living trees are fuel (`World.flammables()`).
- Record that meteor-on-tree is now `['destroy']` alone.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts docs/architecture.md
git commit -m "feat: reseed the forest on the world tick; document the tree lifecycle"
```

---

## Done when

- A chopped tree **topples**, lies as a log, fades, and leaves a **permanent stump**. It never regrows in place.
- A **sapling** is visibly a sapling — thin trunk, small crown, both growing — and can never be confused with a chopped tree.
- Clearing one side of the island lets the forest **creep back from the other**, around the stumps. Total deforestation is recoverable via the mercy sapling.
- A meteor on a tree **obliterates** it: splinters, no fire, a stump.
- Lightning on a tree **splits and topples it burning**; fire arriving by spread leaves a standing **snag**.
- A rebuilt hut is **clay-coloured**; a burning hut's **door and roof knob char with the rest of it**.
- **Stumps do not burn.**
- `npm test` green, `npx tsc --noEmit` clean, `npm run build` succeeds.
- Stage 3 (the people) remains untouched and unblocked.

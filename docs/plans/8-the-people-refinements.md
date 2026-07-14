# The People — Refinements Implementation Plan (Stage 3b)

> **For agentic workers:** Implement this plan task-by-task with tests first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stage 3 shipped, but the village reads wrong: every ground nudge founds a hut, fruit clumps on one side of the crown and vanishes four-at-once, the fishing rod points backwards, drinking is invisible, the fish are white, and the Journal has an entry that duplicates another. This plan fixes the feel.

**Architecture:** Three ideas carry the refinements. **Ground nudge becomes a weighted, place-aware roll** rather than a first-match ladder — it reads the ground *around* the nudge (trees, ponds, the fire) and rolls among the eligible intents, so `build` stops being the deterministic winner. **Fruit becomes individually pickable** — the crown's `InstancedMesh` keeps four slots but hides them one at a time, and the villager carries the picked fruit to their mouth before `villager:ate` fires. **The Journal becomes a teaching device** — `Wildfire` retargets from a body count onto `bySpread` (fire jumps tree to tree, the actual lesson), `Full Harvest` is absorbed into `Fed`, and `Drained` picks up the already-emitted-but-unwatched `pond:emptied`.

**Tech Stack:** TypeScript, Three.js r185, Vitest. No new dependencies.

## Global Constraints

- Do not call `Math.random()`; all randomness goes through `RNG`.
- **Only the player kills villagers.** Water is an obstacle, never a hazard.
- **Over-capacity is a legal, stable state.** Never cull, evict, or despawn a living villager.
- **Nudge is a suggestion, never a command.** A villager who is fleeing, mourning, zapped, or mid-activity ignores it.
- Pure decision logic stays in `src/villagers/fsm.ts` and is tested without THREE.
- Pure nudge resolution stays in `src/powers/nudge.ts` and is tested without THREE, `World`, or `Island`.
- The mercy repopulation path is preserved: a village bombed to zero must always be able to return.
- Journal count must derive from `MOMENTS.length`, never a hard-coded number. **`MOMENTS.length` stays 15.**
- `MomentId` is persisted to `localStorage`. Removing an id is safe (`load()` filters through `MOMENT_IDS`), but **do not rename a surviving id** — that silently revokes a player's unlock.
- Maintain `docs/architecture.md` when implementation changes.
- Do not edit `STATUS.md` unless explicitly asked.
- Do not commit unless explicitly asked.

---

## Task 1: The nudge glyph

**Files:**
- Modify: `src/styles.css:229-256`

The current glyph draws a pointing hand from two `--skin` blobs (`::before` a palm, `::after` a finger at `rotate(43deg)`). At 24px it reads as mush, and it is the only glyph attempting anatomy — the others are a rock, a `ϟ`, and three dots. Replace it with the **fingertip spark**: a filled dot with a ring around it, mirroring the `pokeRipple` the power actually renders on the ground.

- [ ] **Step 1: Replace both glyph rules.**

Replace `src/styles.css:229-256` wholesale:

```css
.power-glyph[data-glyph='nudge']::before {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--ink-soft);
  border-radius: 52% 48% 46% 54%;
  background: var(--yellow);
  box-shadow: inset 2px 2px 0 var(--paper);
  content: '';
}

.power-glyph[data-glyph='nudge']::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 22px;
  height: 22px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--yellow);
  border-radius: 49% 51% 53% 47%;
  opacity: 0.55;
  content: '';
}
```

The wobbly `border-radius` values keep it consistent with the hand-thrown clay look of the meteor glyph; a perfect circle would read as a UI icon rather than a drawn one.

- [ ] **Step 2: Verify by eye.**

Run: `npm run dev` and look at the fourth tray slot.
Expected: a small yellow dot inside a soft yellow ring. Legible at a glance, distinct from the other three.

---

## Task 2: Ground nudge stops always building huts

**Files:**
- Modify: `src/powers/nudge.ts:19-30`
- Test: `src/powers/nudge.test.ts`
- Modify: `src/powers/outcomes.ts:8-33`
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`

**Interfaces:**
- Produces:

```ts
export type GroundNudgeCtx = {
  needsFire: boolean
  living: number
  capacity: number
  huts: number
  buildable: boolean
  pendingSite: boolean
  treesNear: number
  pondNear: boolean
  rng: RNG
}
export function groundNudge(ctx: GroundNudgeCtx): SuggestionKind
World.pendingSite(): boolean
World.treesNear(x: number, z: number, radius: number): number
World.pondNear(x: number, z: number, radius: number): boolean
```

Two separate causes produce the bug you saw.

**Cause 1 — the resolver is a fall-through ladder.** `groundNudge` (`nudge.ts:26-29`) returns the *first* match. Given a buildable spot, a lit fire, and huts under the cap, `build` always wins. Nothing else can ever be selected.

**Cause 2 — "full" is the default state.** `capacity()` is `2 × built huts`. The village starts at roughly 3 huts and 6 villagers, so `living >= capacity` is true from the first frame. Every ground nudge therefore founds a hut until `MAX_HUTS`.

The fix is both halves: **hysteresis** (only propose `build` when housing is genuinely pressed *and* no site is already pending) plus a **weighted roll over eligible intents**, seeded by what is actually near the nudged point.

- [ ] **Step 1: Write the failing resolver tests.**

Replace `src/powers/nudge.test.ts` entirely:

```ts
import { describe, expect, it } from 'vitest'
import { RNG } from '../core/rng'
import { groundNudge, type GroundNudgeCtx } from './nudge'

const ctx = (o: Partial<GroundNudgeCtx> = {}): GroundNudgeCtx => ({
  needsFire: false,
  living: 2,
  capacity: 6,
  huts: 3,
  buildable: true,
  pendingSite: false,
  treesNear: 0,
  pondNear: false,
  rng: new RNG(1),
  ...o,
})

/** Every kind this resolver produces across 400 seeds. */
const kinds = (o: Partial<GroundNudgeCtx>): Set<string> => {
  const seen = new Set<string>()
  for (let seed = 0; seed < 400; seed++) {
    seen.add(groundNudge(ctx({ ...o, rng: new RNG(seed) })))
  }
  return seen
}

describe('ground nudge resolves from the village needs', () => {
  it('builds the campfire first when there is no fire — an emergency overrides the roll', () => {
    expect(kinds({ needsFire: true })).toEqual(new Set(['makeFire']))
  })

  it('gathers on ground that cannot be built on', () => {
    expect(groundNudge(ctx({ needsFire: true, buildable: false }))).toBe('gather')
  })

  it('can found a hut when housing is pressed and there is room to grow', () => {
    expect(kinds({ living: 6, capacity: 6, huts: 3 })).toContain('build')
  })

  it('does not always found a hut, even when housing is pressed', () => {
    // The bug: `build` used to be the deterministic winner here.
    const seen = kinds({ living: 6, capacity: 6, huts: 3, treesNear: 2, pondNear: true })
    expect(seen.size).toBeGreaterThan(1)
  })

  it('never founds a hut when the village is not full', () => {
    expect(kinds({ living: 2, capacity: 6 })).not.toContain('build')
  })

  it('never founds a hut beyond the six-hut cap', () => {
    expect(kinds({ living: 12, capacity: 12, huts: 6 })).not.toContain('build')
  })

  it('never founds a hut while a site already stands unbuilt', () => {
    // Hysteresis: two quick nudges must not strand two empty sites.
    expect(kinds({ living: 6, capacity: 6, huts: 3, pendingSite: true })).not.toContain('build')
  })

  it('suggests chopping when the nudge lands among trees', () => {
    expect(kinds({ treesNear: 3 })).toContain('chop')
  })

  it('never suggests chopping where there are no trees', () => {
    expect(kinds({ treesNear: 0 })).not.toContain('chop')
  })

  it('suggests fishing when the nudge lands by the water', () => {
    expect(kinds({ pondNear: true })).toContain('fish')
  })

  it('never suggests fishing away from the water', () => {
    expect(kinds({ pondNear: false })).not.toContain('fish')
  })

  it('always falls back to gathering when nothing else is eligible', () => {
    expect(kinds({})).toEqual(new Set(['gather']))
  })
})
```

- [ ] **Step 2: Run and watch fail.**

Run: `npx vitest run src/powers/nudge.test.ts`
Expected: FAIL — `groundNudge` takes no `rng`, and `build` wins deterministically.

- [ ] **Step 3: Rewrite the resolver as a weighted, place-aware roll.**

Replace `src/powers/nudge.ts:19-30`:

```ts
export type GroundNudgeCtx = {
  needsFire: boolean
  living: number
  capacity: number
  huts: number
  buildable: boolean
  /** A founded site nobody has finished yet. One at a time. */
  pendingSite: boolean
  treesNear: number
  pondNear: boolean
  rng: RNG
}

/**
 * Ground-nudge means one thing — *tend to this spot* — and both the village's
 * needs and the ground itself decide the outcome.
 *
 * This is a weighted roll, not a ladder. A ladder made `build` the deterministic
 * winner: capacity is 2 x built huts, so a starting village is already "full",
 * and every nudge founded a hut until the cap. Rolling keeps the growth valve
 * meaningful while letting the place speak — nudge a stand of trees and they
 * are likely to chop, nudge the shore and they are likely to fish.
 */
export function groundNudge(ctx: GroundNudgeCtx): SuggestionKind {
  // Unbuildable ground carries no meaning beyond "stand here".
  if (!ctx.buildable) return 'gather'
  // No fire is an emergency, not a preference. It skips the roll.
  if (ctx.needsFire) return 'makeFire'

  const options: { kind: SuggestionKind; weight: number }[] = [
    { kind: 'gather', weight: 2 },
  ]
  // The growth valve: a new home only when the old ones are full, the cap has
  // room, and no founded site is already standing empty.
  const pressed = ctx.living >= ctx.capacity
    && ctx.huts < MAX_HUTS
    && !ctx.pendingSite
  if (pressed) options.push({ kind: 'build', weight: 5 })
  if (ctx.treesNear > 0) options.push({ kind: 'chop', weight: Math.min(3, ctx.treesNear) + 1 })
  if (ctx.pondNear) options.push({ kind: 'fish', weight: 3 })

  const total = options.reduce((sum, option) => sum + option.weight, 0)
  let roll = ctx.rng.next() * total
  for (const option of options) {
    roll -= option.weight
    if (roll < 0) return option.kind
  }
  return 'gather'
}
```

Add the `RNG` import at the top of `nudge.ts`:

```ts
import { RNG } from '../core/rng'
```

`groundNudge` stays a pure function of plain data plus an `RNG`, so it is tested with no THREE, no `World`, and no `Island` — exactly like `forest.ts`.

- [ ] **Step 4: Run the resolver tests.**

Run: `npx vitest run src/powers/nudge.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing world-query tests.**

Note: the existing `addTree(world, id, x, z)` helper takes no `state` — a `Tree` is
born `normal`, so set the state afterwards when a test needs a different one.

```ts
// src/world/world.test.ts
describe('the ground around a nudge', () => {
  it('counts only normal trees within the radius', () => {
    const world = makeWorld()
    addTree(world, 'tree-0', 0, 0)
    addTree(world, 'tree-1', 1.5, 0)
    addTree(world, 'tree-2', 1.5, 0).state = 'burning'   // not a tree you can chop
    addTree(world, 'tree-3', 40, 0)                      // out of range

    expect(world.treesNear(0, 0, 4)).toBe(2)
  })

  it('sees a pond within the radius', () => {
    const world = floodedWorld([{ x: 0, z: 0, radius: 3, depth: 1.5 }])
    expect(world.pondNear(2, 0, 4)).toBe(true)
    expect(world.pondNear(40, 40, 4)).toBe(false)
  })

  it('reports a founded-but-unbuilt site as pending', () => {
    const world = makeWorld()
    expect(world.pendingSite()).toBe(false)

    addHut(world, 'hut-9', 6, 0, 'site')

    expect(world.pendingSite()).toBe(true)
  })

  it('a finished hut is no longer pending', () => {
    const world = makeWorld()
    addHut(world, 'hut-9', 6, 0, 'built')
    expect(world.pendingSite()).toBe(false)
  })
})
```

- [ ] **Step 6: Run and watch fail.**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — `world.treesNear is not a function`.

- [ ] **Step 7: Add the three queries to `World`.**

Add beside the other queries in `src/world/world.ts` (near `needsFire()` at line 292):

```ts
  /** Trees a villager could actually chop, within `radius` of a point. */
  treesNear(x: number, z: number, radius: number): number {
    return this.trees.filter(tree => (
      tree.state === 'normal' && Math.hypot(tree.x - x, tree.z - z) <= radius
    )).length
  }

  /** Whether any pond lies within `radius` of a point. */
  pondNear(x: number, z: number, radius: number): boolean {
    return this.ponds.some(pond => Math.hypot(pond.x - x, pond.z - z) <= radius)
  }

  /** A hut founded but not yet finished. The village builds one at a time. */
  pendingSite(): boolean {
    return this.huts.some(hut => hut.state === 'site' || hut.state === 'building')
  }
```

- [ ] **Step 8: Feed the new context in `outcomes.ts`.**

Replace the `ground` branch of `suggestionFor` (`outcomes.ts:14-30`):

```ts
    case 'ground': {
      const buildable = isBuildable(
        ctx.x,
        ctx.z,
        ctx.world.groundQuery(),
        (x, z) => ctx.island.sampleHeight(x, z),
      )
      const kind = groundNudge({
        needsFire: ctx.world.needsFire(),
        living: ctx.world.living(),
        capacity: ctx.world.capacity(),
        huts: ctx.world.huts.filter(hut => hut.state !== 'abandoned').length,
        buildable,
        pendingSite: ctx.world.pendingSite(),
        treesNear: ctx.world.treesNear(ctx.x, ctx.z, NUDGE_SENSE_RADIUS),
        pondNear: ctx.world.pondNear(ctx.x, ctx.z, NUDGE_SENSE_RADIUS),
        rng: ctx.rng,
      })
      // A ground nudge that resolves to `build` must create the site to build on.
      if (kind === 'build') ctx.world.foundHutAt(ctx.x, ctx.z, ctx.rng, ctx.lowFx)
      return kind
    }
```

and add the constant at the top of `outcomes.ts`, under the imports:

```ts
/** How far a ground nudge "sees" when deciding what the place is for. */
const NUDGE_SENSE_RADIUS = 5
```

- [ ] **Step 9: Run the tests.**

Run: `npx vitest run src/powers/ src/world/world.test.ts`
Expected: PASS.

---

## Task 3: Nudges reach further

**Files:**
- Modify: `src/world/world.ts:465-473`
- Test: `src/world/world.test.ts`

`SUGGESTION_WEIGHT = 30` against idle weights of 3–5 already means a nudged option wins ~85–90% of the roll. Raising it approaches coercion asymptotically and would violate the "suggest, never command" constraint for no real gain.

The reason a nudge *feels* weak is reach, not weight: `suggest()` tags only the **2** nearest villagers, and `canBeNudged()` accepts only `wander` / `sitAtFire` / `gather`. Most of the village is mid-job and simply never hears you. Widen the reach; leave the weight alone.

- [ ] **Step 1: Write the failing test.**

```ts
// src/world/world.test.ts
describe('a nudge carries', () => {
  it('reaches the four nearest idle villagers, not two', () => {
    const world = makeWorld()
    world.villagers = [
      idleVillagerAt(0, 0), idleVillagerAt(1, 0), idleVillagerAt(2, 0),
      idleVillagerAt(3, 0), idleVillagerAt(30, 30),
    ] as Villager[]

    expect(world.suggest(0, 0, 'chop')).toBe(4)
  })

  it('reaches nobody who is out of earshot', () => {
    const world = makeWorld()
    world.villagers = [idleVillagerAt(40, 40)] as Villager[]

    expect(world.suggest(0, 0, 'chop')).toBe(0)
  })
})
```

Add the helper beside the other test factories in `world.test.ts`:

```ts
const idleVillagerAt = (x: number, z: number): Partial<Villager> => ({
  x, z, alive: true,
  canBeNudged: () => true,
  suggest: vi.fn(),
})
```

- [ ] **Step 2: Run and watch fail.**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — `suggest` returns 2, and the distant villager is still tagged.

- [ ] **Step 3: Widen the reach and add a range limit.**

Replace `World.suggest` (`world.ts:465-473`):

```ts
  /**
   * Tag the nearest idle villagers. Returns how many were reached.
   *
   * Four, not two: a nudge that half the village never hears reads as a weak
   * power, and the fix is reach rather than weight — raising SUGGESTION_WEIGHT
   * would only walk the roll toward coercion.
   */
  suggest(x: number, z: number, kind: SuggestionKind): number {
    const idle = this.villagers
      .filter(villager => (
        villager.alive
        && villager.canBeNudged()
        && Math.hypot(villager.x - x, villager.z - z) <= NUDGE_EARSHOT
      ))
      .sort((a, b) => (
        Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)
      ))
      .slice(0, 4)
    for (const villager of idle) villager.suggest({ kind, x, z, ttl: 6 })
    return idle.length
  }
```

Add the constant beside `MAX_HUTS` (`world.ts:24`):

```ts
/** A nudge is a poke, not a proclamation. Villagers past this never hear it. */
const NUDGE_EARSHOT = 18
```

- [ ] **Step 4: Run the tests.**

Run: `npx vitest run src/world/world.test.ts`
Expected: PASS.

---

## Task 4: Fruit scatters around the crown

**Files:**
- Modify: `src/world/objects.ts:397-453`
- Test: `src/world/objects.test.ts`

`growFruit()` assigns fruit *i* to `blobs[i % blobs.length]` with a free yaw in `rng.range(0, 2π)`. With 2–3 blobs and 4 fruit, two fruit share a blob, and the anti-burial projection pass then shoves both toward the same uncovered pocket. The result clumps.

Stratify the yaw: fruit *i* gets its own quadrant, `i * π/2` plus jitter. That guarantees angular spread before the projection pass ever runs.

- [ ] **Step 1: Write the failing test.**

```ts
// src/world/objects.test.ts
it('scatters the fruit around the crown rather than clumping them', () => {
  const tree = new Tree('tree-1', 0, 0, 0, new RNG(5))
  tree.growFruit()

  const crown = tree.group.getObjectByName('tree-crown') as THREE.Group
  const fruit = crown.getObjectByName('tree-fruit') as THREE.InstancedMesh

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const angles: number[] = []
  for (let i = 0; i < fruit.count; i++) {
    fruit.getMatrixAt(i, matrix)
    position.setFromMatrixPosition(matrix)
    angles.push(Math.atan2(position.z, position.x))
  }

  // Four fruit, four quadrants: no two may share a bearing from the trunk.
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      const delta = Math.abs(angles[i] - angles[j])
      const separation = Math.min(delta, Math.PI * 2 - delta)
      expect(separation).toBeGreaterThan(0.5)
    }
  }
})
```

- [ ] **Step 2: Run and watch fail.**

Run: `npx vitest run src/world/objects.test.ts`
Expected: FAIL — two fruit share a bearing.

- [ ] **Step 3: Stratify the yaw.**

In `growFruit()` (`objects.ts:415`), replace the free yaw:

```ts
      const yaw = rng.range(0, Math.PI * 2)
```

with a stratified one:

```ts
      // One fruit per quadrant. A free yaw let two fruit share a bearing, and
      // the burial-projection pass below then shoved both into the same pocket.
      const yaw = (i * Math.PI) / 2 + rng.range(-0.5, 0.5)
```

- [ ] **Step 4: Run the tests.**

Run: `npx vitest run src/world/objects.test.ts`
Expected: PASS.

---

## Task 5: Picking takes one fruit, and the villager eats it

**Files:**
- Modify: `src/world/objects.ts:455-467`
- Test: `src/world/objects.test.ts`
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`

**Interfaces:**
- Produces: `Tree.pickFruit(x: number, z: number): boolean`, `Tree.fruitCount: number`, `Tree.hasFruit: boolean` (unchanged semantics: "any fruit left")

Today `pickFruit()` disposes the entire `InstancedMesh` — one villager arrives and all four fruit vanish at once. And `villager:ate` fires the instant the fruit is picked, so the "Fed" moment is true before anyone has eaten anything.

Two halves: the tree gives up **one** fruit (the one nearest the picker), and the villager **carries it to their mouth** before the event fires.

- [ ] **Step 1: Write the failing tree test.**

```ts
// src/world/objects.test.ts
describe('picking one fruit at a time', () => {
  it('takes only the nearest fruit, and leaves the rest hanging', () => {
    const tree = new Tree('tree-1', 0, 0, 0, new RNG(5))
    tree.growFruit()
    expect(tree.fruitCount).toBe(4)

    expect(tree.pickFruit(0, 0)).toBe(true)

    expect(tree.fruitCount).toBe(3)
    expect(tree.hasFruit).toBe(true)
  })

  it('empties the tree only after the fourth pick', () => {
    const tree = new Tree('tree-1', 0, 0, 0, new RNG(5))
    tree.growFruit()

    for (let i = 0; i < 4; i++) expect(tree.pickFruit(0, 0)).toBe(true)

    expect(tree.fruitCount).toBe(0)
    expect(tree.hasFruit).toBe(false)
    expect(tree.pickFruit(0, 0)).toBe(false)
  })

  it('takes the fruit nearest the picker', () => {
    const tree = new Tree('tree-1', 0, 0, 0, new RNG(5))
    tree.growFruit()

    const crown = tree.group.getObjectByName('tree-crown') as THREE.Group
    const mesh = crown.getObjectByName('tree-fruit') as THREE.InstancedMesh
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    mesh.getMatrixAt(0, matrix)
    position.setFromMatrixPosition(matrix)

    // Stand directly under fruit 0, in the tree's local frame.
    tree.pickFruit(tree.x + position.x, tree.z + position.z)

    // A picked fruit is scaled to nothing; its neighbours are untouched.
    mesh.getMatrixAt(0, matrix)
    expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeLessThan(0.01)
  })
})
```

- [ ] **Step 2: Run and watch fail.**

Run: `npx vitest run src/world/objects.test.ts`
Expected: FAIL — `tree.fruitCount` is undefined.

- [ ] **Step 3: Track the fruit slots on the tree.**

In `growFruit()`, record each fruit's local position as it is placed. Add the field beside `fruit` on `Tree`:

```ts
  /** Local positions of the four fruit slots; `null` once picked. */
  private fruitSlots: (THREE.Vector3 | null)[] = []
```

In `growFruit()`, immediately before `matrix.makeTranslation(...)` (`objects.ts:444`), capture the slot:

```ts
      this.fruitSlots[i] = position.clone()
```

and reset the array when a fresh crop grows — put this right after the `blobs` line (`objects.ts:407`):

```ts
    this.fruitSlots = []
```

- [ ] **Step 4: Rewrite `pickFruit` to take one.**

Replace `pickFruit()` (`objects.ts:459-467`) and `hasFruit` (`objects.ts:455-457`):

```ts
  get hasFruit(): boolean {
    return this.fruitCount > 0
  }

  /** How many fruit are still hanging. */
  get fruitCount(): number {
    return this.fruitSlots.filter(slot => slot !== null).length
  }

  /**
   * A villager takes the one fruit nearest them. Returns false when the tree is
   * bare. The mesh is kept and the taken instance is scaled to nothing, so the
   * remaining fruit stay exactly where they hung.
   */
  pickFruit(x: number, z: number): boolean {
    if (!this.fruit || this.fruitCount === 0) return false

    // The picker's position in the crown's local frame.
    const localX = x - this.x
    const localZ = z - this.z

    let nearest = -1
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < this.fruitSlots.length; i++) {
      const slot = this.fruitSlots[i]
      if (!slot) continue
      const gap = Math.hypot(slot.x - localX, slot.z - localZ)
      if (gap < best) {
        best = gap
        nearest = i
      }
    }
    if (nearest < 0) return false

    this.fruitSlots[nearest] = null
    const matrix = new THREE.Matrix4()
    matrix.makeScale(0, 0, 0)
    this.fruit.setMatrixAt(nearest, matrix)
    this.fruit.instanceMatrix.needsUpdate = true

    // The last fruit takes the mesh with it.
    if (this.fruitCount === 0) {
      this.crown.remove(this.fruit)
      disposeObjectResources(this.fruit)
      this.fruit = null
      this.fruitTime = 0
    }
    return true
  }
```

- [ ] **Step 5: Run the tree tests.**

Run: `npx vitest run src/world/objects.test.ts`
Expected: PASS.

- [ ] **Step 6: Give the villager a fruit to carry.**

In the `Villager` constructor, beside the `rainLeaf` and `rod` rigs (`villager.ts:194`), build a held fruit:

```ts
    this.heldFruit = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 7, 5),
      clayMaterial(PALETTE.smockA),
    )
    this.heldFruit.name = 'held-fruit'
    this.heldFruit.position.set(0.34, 0.78, 0.1)
    this.heldFruit.visible = false
    this.heldFruit.castShadow = !lowFx
```

Declare the field beside `rod` (`villager.ts:94`):

```ts
  private heldFruit: THREE.Mesh
```

and add it to the group (`villager.ts:269`):

```ts
    this.group.add(this.model, this.emoteSprite.sprite, this.rainLeaf, this.rod, this.heldFruit)
```

- [ ] **Step 7: Widen the test harness.**

The existing `ActivityHarness` (`villager.test.ts:128-144`) only models `'sitAtFire' | 'fish'`
and carries no tree, bus, or pose. `harvest` and `drink` need more. Widen it in place —
this same harness is used by Task 6:

```ts
// src/villagers/villager.test.ts
  type ActivityHarness = {
    state: 'sitAtFire' | 'fish' | 'harvest' | 'drink'
    targetPond: Pond | null
    targetTree: Tree | null
    rod: { visible: boolean }
    heldFruit: { visible: boolean; position: THREE.Vector3 }
    eating: number
    arrived: boolean
    actionTimer: number
    thirst: number
    resumeState: string | null
    x: number
    z: number
    bus: EventBus
    model: THREE.Object3D
    head: THREE.Object3D
    arms: THREE.Object3D[]
    group: THREE.Object3D
    emote: ReturnType<typeof vi.fn>
    enter: ReturnType<typeof vi.fn>
    targetDistance(): number
    performActivity(dt: number, ticked: boolean, world: World): void
  }

  function harness(
    state: ActivityHarness['state'],
    targetPond: Pond | null = null,
  ): ActivityHarness {
    const villager = Object.create(Villager.prototype) as ActivityHarness
    const bone = (): THREE.Object3D => new THREE.Object3D()
    villager.state = state
    villager.targetPond = targetPond
    villager.targetTree = null
    villager.rod = { visible: false }
    villager.eating = 0
    villager.arrived = false
    villager.actionTimer = 0
    villager.thirst = 0
    villager.resumeState = null
    villager.x = 0
    villager.z = 0
    villager.model = bone()
    villager.head = bone()
    villager.arms = [bone(), bone()]
    villager.group = bone()
    villager.emote = vi.fn()
    villager.enter = vi.fn()
    // The real rig is built in the constructor, which we deliberately skip.
    const heldFruit = bone() as THREE.Object3D & { visible: boolean }
    heldFruit.name = 'held-fruit'
    heldFruit.visible = false
    villager.heldFruit = heldFruit as unknown as ActivityHarness['heldFruit']
    villager.group.add(heldFruit)
    // Standing on the target: every arrival check passes.
    villager.targetDistance = () => 0
    return villager
  }
```

The two existing `'sitAtFire' | 'fish'` tests keep working — the widened harness is a
superset, and every new field is inert for them.

- [ ] **Step 8: Write the failing eat test.**

```ts
// src/villagers/villager.test.ts
describe('harvesting', () => {
  it('carries the fruit before it eats it, and only then is anyone fed', () => {
    const emit = vi.fn()
    const tree = { x: 0, z: 0, state: 'normal', hasFruit: true, pickFruit: vi.fn(() => true) }
    const villager = harness('harvest')
    villager.bus = { emit } as unknown as EventBus
    villager.targetTree = tree as unknown as Tree
    const world = { ponds: [], trees: [tree] } as unknown as World

    // Reach into the canopy and take one.
    villager.performActivity(1.3, true, world)

    expect(tree.pickFruit).toHaveBeenCalledWith(villager.x, villager.z)
    expect(villager.group.getObjectByName('held-fruit')!.visible).toBe(true)
    // Picked is not eaten.
    expect(emit).not.toHaveBeenCalledWith({ type: 'villager:ate' })

    // Chew.
    villager.performActivity(1.6, true, world)

    expect(emit).toHaveBeenCalledWith({ type: 'villager:ate' })
    expect(villager.group.getObjectByName('held-fruit')!.visible).toBe(false)
  })
})
```

- [ ] **Step 9: Run and watch fail.**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: FAIL — `villager:ate` fires on the pick, and no fruit is held.

- [ ] **Step 10: Split harvest into reach, then eat.**

Add the field beside the other activity fields:

```ts
  private eating = 0
```

Replace the `harvest` branch of `performActivity` (`villager.ts:767-785`):

```ts
      case 'harvest': {
        // Once the fruit is in hand the tree no longer matters — eat it even if
        // the tree burns down mid-chew.
        if (this.eating > 0) {
          this.eating -= dt
          if (ticked) {
            // Raise it to the mouth and lean into the bite.
            this.arms[0].rotation.z = -2.1
            this.heldFruit.position.set(0.16, 1.06, 0.14)
            this.head.rotation.x = -0.12
          }
          if (this.eating <= 0) {
            this.heldFruit.visible = false
            // `EmoteKind` has no 'happy'; the satisfied-sigh glyph is 'sleep'.
            this.emote('sleep')
            this.bus.emit({ type: 'villager:ate' })
            this.enter('wander', world)
          }
          return
        }
        if (!this.targetTree || !this.targetTree.hasFruit) {
          this.enter('wander', world)
          return
        }
        if (distance(this, this.targetTree) <= 1.2) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 1.2
            this.arms[0].rotation.z = -1.5   // reach up into the canopy
          }
          this.actionTimer -= dt
          if (this.actionTimer <= 0) {
            if (this.targetTree.pickFruit(this.x, this.z)) {
              this.heldFruit.visible = true
              this.heldFruit.position.set(0.34, 0.78, 0.1)
              this.eating = 1.6
            } else {
              this.enter('wander', world)
            }
          }
        }
        return
      }
```

Reset it in `enter()` beside the other resets (`villager.ts:860`, next to `this.rod.visible = false`):

```ts
    this.eating = 0
    this.heldFruit.visible = false
```

Note the emit now carries the *eat*, not the pick — which is what the "Fed" moment claims.

- [ ] **Step 11: Run the tests.**

Run: `npx vitest run src/villagers/villager.test.ts src/world/objects.test.ts`
Expected: PASS.

---

## Task 6: The fishing rod points forward, and drinking is visible

**Files:**
- Modify: `src/villagers/villager.ts:194-220`
- Modify: `src/villagers/villager.ts:742-766`
- Test: `src/villagers/villager.test.ts`

Two separate bugs, both about a pose nobody can see.

**The rod is inconsistent with itself.** `CylinderGeometry` is Y-up, so the rod's tip is `+y` in its own frame. `rod.rotation.set(-0.6, 0, -0.5)` pitches it *back* over the villager's shoulder — while the line (`x: 0.62`) and float (`x: 0.71, y: -0.36`) hang out in *front*. The rig is drawn as if the rod pointed forward and down, and then rotated so it doesn't.

**The drink pose never holds.** `enter()` calls `resetPose()` (`villager.ts:860`), and the `drink` branch only writes its pose when `ticked` is true (`villager.ts:755`) — the coarse animation tick, not every frame. Between ticks the pose is whatever `resetPose` left. Worse, thirst requires `>= 25` accumulated seconds *while* in `chopTree`/`buildHut`/`rebuild` *and* `arrived`, which is a narrow enough window that you may simply never have seen one fire.

- [ ] **Step 1: Rebuild the rod rig so it points forward and down.**

Replace `villager.ts:194-220`:

```ts
    this.rod = new THREE.Group()
    this.rod.name = 'fishing-rig'
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 1.3, 5),
      clayMaterial(PALETTE.bark),
    )
    rod.name = 'fishing-rod'
    // The cylinder is Y-up: its tip is +y. Pitch it forward (+z) so the tip
    // leads out over the water, and the butt sits back at the hip.
    rod.position.set(0.3, 0.92, 0.42)
    rod.rotation.set(1.05, 0, -0.18)
    rod.castShadow = !lowFx
    const line = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.62, 4),
      clayMaterial(PALETTE.inkSoft, { flat: true }),
    )
    line.name = 'fishing-line'
    // Hangs straight down from the rod tip.
    line.position.set(0.4, 0.86, 0.98)
    line.castShadow = false
    const float = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 6, 4),
      clayMaterial(PALETTE.smockA, { flat: true }),
    )
    float.name = 'fishing-float'
    // At the waterline, directly below the line.
    float.position.set(0.4, 0.55, 0.98)
    float.castShadow = false
    this.rod.add(rod, line, float)
    this.rod.visible = false
```

- [ ] **Step 2: Verify the rod by eye.**

Run: `npm run dev`, nudge a villager onto a pond, and watch them fish.
Expected: the rod leads *forward*, out over the water, with the line and float hanging below the tip. Nothing points backwards over the shoulder.

- [ ] **Step 3: Write the failing drink test.**

This test imports `MODEL_SCALE` and `THIRST_LIMIT`, which Step 6 exports. It uses the
harness widened in Task 5, Step 7.

```ts
// src/villagers/villager.test.ts — extend the existing import
import { DRINK_TIME, MODEL_SCALE, THIRST_LIMIT, Villager } from './villager'

describe('drinking', () => {
  it('kneels and dips every frame, not only on the animation tick', () => {
    const pond = { x: 0, z: 0, shoreNear: () => ({ x: 0, z: 0 }) }
    const villager = harness('drink')
    villager.targetPond = pond as unknown as Pond
    const world = { ponds: [pond] } as unknown as World

    // Arrive and start drinking on a ticked frame…
    villager.performActivity(0.1, true, world)
    const kneeling = villager.model.scale.y

    // …then run a frame that is NOT an animation tick.
    villager.performActivity(0.1, false, world)

    expect(villager.model.scale.y).toBeCloseTo(kneeling)
    expect(villager.model.scale.y).toBeLessThan(MODEL_SCALE)
  })

  it('gets thirsty enough to actually stop working', () => {
    expect(THIRST_LIMIT).toBeLessThan(20)
  })
})
```

- [ ] **Step 4: Run and watch fail.**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: FAIL — the pose is only written on `ticked`, and `THIRST_LIMIT` is not exported.

- [ ] **Step 5: Make the drink pose hold, and give it a motion.**

Replace the `drink` branch of `performActivity` (`villager.ts:742-766`):

```ts
      case 'drink': {
        if (!this.targetPond || !world.ponds.includes(this.targetPond)) {
          this.resumeState = null
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.25) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = DRINK_TIME
            this.emote('water')
          }
          this.actionTimer -= dt

          // Every frame, not only on `ticked`: `enter()` calls resetPose(), and a
          // pose written once per animation tick is erased in between.
          this.group.rotation.y = Math.atan2(
            this.targetPond.x - this.x,
            this.targetPond.z - this.z,
          )
          // Dip and rise: down to the water, back up to swallow, twice over.
          const progress = 1 - this.actionTimer / DRINK_TIME
          const dip = (Math.sin(progress * Math.PI * 4 - Math.PI / 2) + 1) / 2
          this.model.scale.set(
            MODEL_SCALE,
            MODEL_SCALE * (1 - 0.3 * dip),
            MODEL_SCALE,
          )
          this.head.rotation.x = 0.28 + 0.5 * dip
          this.arms[0].rotation.z = -0.5 - 0.5 * dip
          this.arms[1].rotation.z = 0.5 + 0.5 * dip

          if (this.actionTimer <= 0) {
            const resume = this.resumeState
            this.resumeState = null
            this.enter(resume ?? 'wander', world)
          }
        }
        return
      }
```

- [ ] **Step 6: Make thirst reachable.**

Export the two constants beside `MODEL_SCALE` (`villager.ts:29`) so the test can assert on them and the numbers stop being magic:

```ts
/** Seconds of unbroken labour before a villager wants a drink. */
export const THIRST_LIMIT = 16
/** How long they kneel at the water. Long enough to read as an action. */
export const DRINK_TIME = 2.6
```

Replace the thirst check in `update()` (`villager.ts:307` region) to use it, and to drop the `arrived` gate — a villager should be able to get thirsty on the walk to the job, not only while standing at it:

```ts
    const labouring = this.state === 'chopTree'
      || this.state === 'buildHut'
      || this.state === 'rebuild'
    if (labouring) this.thirst += dt
    if (this.thirst >= THIRST_LIMIT && world.ponds.length > 0) {
      this.thirst = 0
      this.resumeState = this.state
      this.enter('drink', world)
    }
```

Also export `MODEL_SCALE` (`villager.ts:29`) so the test can compare against it:

```ts
export const MODEL_SCALE = 0.75
```

- [ ] **Step 7: Run the tests.**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify by eye.**

Run: `npm run dev`, nudge a villager to chop a tree, and wait.
Expected: partway through the job they break off, walk to the pond, kneel, dip twice, and then **return to the tree**.

---

## Task 7: The fish look like fish

**Files:**
- Modify: `src/ui/tokens.ts`
- Modify: `src/world/objects.ts:1163`

`fishMaterial = clayMaterial(PALETTE.ghost)` — `#e8ecf1`, near-white. Against `--water` (`#6d9dc5`) a floating fish reads as a bone or a bubble. Give it a real tone: a warm salmon that pops against the blue.

- [ ] **Step 1: Add a fish colour to the palette.**

In `src/ui/tokens.ts`, beside the other object colours:

```ts
  fish: '#d98452',   // salmon; reads as a fish against the blue water
```

- [ ] **Step 2: Use it.**

In `src/world/objects.ts:1163`:

```ts
    const fishMaterial = clayMaterial(PALETTE.fish)
```

- [ ] **Step 3: Verify by eye.**

Run: `npm run dev`, lightning a pond.
Expected: the fish that surface are clearly salmon-coloured fish, not white blobs.

---

## Task 8: One nudge, one site

**Files:**
- Modify: `src/world/world.ts:477-498`
- Test: `src/world/world.test.ts`

Nothing stops two ground nudges from founding two sites nobody has built. Task 2's `pendingSite` check keeps `groundNudge` from *choosing* `build` twice — but `foundHutAt` is a public method and should enforce its own invariant rather than trusting every caller.

- [ ] **Step 1: Write the failing test.**

```ts
// src/world/world.test.ts
it('founds only one hut at a time — a second nudge strands no empty site', () => {
  const world = makeWorld()

  expect(world.foundHutAt(6, 0, new RNG(1))).not.toBeNull()
  expect(world.foundHutAt(9, 0, new RNG(1))).toBeNull()
})

it('founds again once the first site is finished', () => {
  const world = makeWorld()
  const hut = world.foundHutAt(6, 0, new RNG(1))!
  hut.state = 'built'

  expect(world.foundHutAt(9, 0, new RNG(1))).not.toBeNull()
})
```

- [ ] **Step 2: Run and watch fail.**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — the second `foundHutAt` returns a hut.

- [ ] **Step 3: Gate on the pending site.**

Add to the top of `foundHutAt` (`world.ts:478`), before the cap check:

```ts
    // One site at a time: a second nudge must not strand an unbuilt shell.
    if (this.pendingSite()) return null
```

- [ ] **Step 4: Run the tests.**

Run: `npx vitest run src/world/world.test.ts`
Expected: PASS.

---

## Task 9: The gather has something to do

**Files:**
- Modify: `src/villagers/villager.ts:786-800`

A villager sent to `gather` walks to the fire and then stands there. If a doused campfire is meant to *draw* the village, they should look like they are doing something when they arrive.

- [ ] **Step 1: Make them crouch and poke at the ashes.**

In the `gather` branch of `performActivity` (`villager.ts:786`), after the arrival check, add a pose driven by `ticked`:

```ts
        if (this.targetDistance() < 0.3) {
          if (!this.arrived) {
            this.arrived = true
            this.emote('question')
          }
          if (ticked && world.campfire) {
            // Face the ashes and stoop over them.
            this.group.rotation.y = Math.atan2(
              world.campfire.x - this.x,
              world.campfire.z - this.z,
            )
            const poke = Math.floor(this.timer * TIMING.fps) % 2 === 0
            this.arms[0].rotation.z = poke ? -1.2 : -0.7
            this.head.rotation.x = 0.24
          }
        }
        return
```

- [ ] **Step 2: Verify by eye.**

Run: `npm run dev`, douse the campfire with rain, and watch.
Expected: idle villagers drift to the dead fire, face it, and stoop to poke at it rather than standing to attention.

---

## Task 10: The Journal teaches

**Files:**
- Modify: `src/discovery/moments.ts`
- Test: `src/discovery/moments.test.ts`

The Journal is a teaching device, not a scoreboard: each entry should name an interaction the player would not otherwise discover. Three entries fail that bar today.

**`Full Harvest` duplicates `Fed`.** Both are "rain grew fruit"; rain fruits several trees at once and villagers harvest immediately, so they unlock seconds apart in one storm. Two entries, one action.

**`Wildfire` watches the wrong field.** It counts `burning >= 5` — a number. But `fire:ignited` already carries `bySpread: boolean`, and *fire jumps tree to tree* is the actual hidden interaction. Nothing watches that flag today.

**`pond:emptied` is emitted and observed by nothing.** A meteor drains a pond, and the Journal never notices — a free, already-wired lesson that terrain is destructible in both directions.

`Ghost Story` keeps its death counter and `Close Call` keeps its simple trigger, as decided.

**The set stays at 15**, so `MOMENTS.length` and every derived counter keep working.

- [ ] **Step 1: Write the failing moment tests.**

```ts
// src/discovery/moments.test.ts
it('has fifteen moments', () => {
  expect(MOMENTS).toHaveLength(15)
})

it('unlocks Wildfire when fire jumps, not when a body count is hit', () => {
  const journal = new Journal(null)

  // A fire you lit yourself teaches nothing, however big it gets.
  expect(journal.observe({
    type: 'fire:ignited', kind: 'tree', bySpread: false, burning: 9,
  })).toBeNull()

  // A fire that spread on its own is the lesson.
  expect(journal.observe({
    type: 'fire:ignited', kind: 'tree', bySpread: true, burning: 2,
  })?.id).toBe('wildfire')
})

it('unlocks Drained when a pond is emptied', () => {
  const journal = new Journal(null)
  expect(journal.observe({ type: 'pond:emptied' })?.id).toBe('drained')
})

it('unlocks Fed when a villager eats', () => {
  const journal = new Journal(null)
  expect(journal.observe({ type: 'villager:ate' })?.id).toBe('fed')
})

it('no longer carries Full Harvest, which only ever duplicated Fed', () => {
  expect(MOMENTS.map(moment => moment.id)).not.toContain('full-harvest')
})
```

- [ ] **Step 2: Run and watch fail.**

Run: `npx vitest run src/discovery/moments.test.ts`
Expected: FAIL — 15 moments, but `full-harvest` is still among them and `drained` is missing.

- [ ] **Step 3: Retire `full-harvest`, add `drained`.**

In `src/discovery/moments.ts`, in the `MomentId` union (line 4): remove `'full-harvest'`, add `'drained'`.

Removing an id is safe: `load()` (line 169) filters every stored id through `MOMENT_IDS`, so a player's saved `full-harvest` is silently dropped rather than crashing. **Do not rename any surviving id** — that would revoke an unlock the player already earned.

Replace the `full-harvest` entry (`moments.ts:40-43`) with:

```ts
  {
    id: 'drained', title: 'Drained',
    hint: 'You made it. You can unmake it.', color: PALETTE.stone,
  },
```

- [ ] **Step 4: Rewrite the three hints that now lie.**

```ts
  {
    id: 'wildfire', title: 'Wildfire',
    hint: "You lit one. It didn't stop at one.", color: PALETTE.ember,
  },
```

```ts
  {
    id: 'fed', title: 'Fed',
    hint: 'Rain, a tree, and someone hungry.', color: PALETTE.leafB,
  },
```

```ts
  {
    id: 'village-grows', title: 'The Village Grows',
    hint: 'Nudge open ground when there is nowhere left to sleep.',
    color: PALETTE.hutClay,
  },
```

`Fed` drops the "You made it rain" claim: with fruit now individually pickable, a villager eats from any fruiting tree, and the player may not have caused it. `Village Grows` gains a hint that names the actual precondition, which was previously invisible.

- [ ] **Step 5: Retarget the matchers.**

In `match()` (`moments.ts:129-158`):

Replace the `fire:ignited` case:

```ts
      // `bySpread` is the lesson: fire jumps from tree to tree on its own.
      // The old `burning >= 5` was a body count, and taught nothing.
      case 'fire:ignited': return event.bySpread ? 'wildfire' : null
```

Add the new case beside the other one-liners:

```ts
      case 'pond:emptied': return 'drained'
```

Delete the `fruit:grown` case entirely (`moments.ts:145-147`) — nothing observes it now:

```ts
      case 'fruit:grown':
        this.state.fruitTrees.add(event.treeId)
        return this.state.fruitTrees.size >= 4 ? 'full-harvest' : null
```

Then drop `fruitTrees` from `MomentState` (`moments.ts:97`), from the initialiser (`moments.ts:103`), and from `reset()` (`moments.ts:125`). Leave the `fruit:grown` **event** in place — `Tree.growFruit` still emits it, and it costs nothing.

- [ ] **Step 6: Run the tests.**

Run: `npx vitest run src/discovery/moments.test.ts`
Expected: PASS.

- [ ] **Step 7: Sweep for a stale count.**

Run: `grep -rn "12\b\|15\b" src/ui/tray.ts src/ui/journal.ts`
Expected: no hard-coded moment total; both derive from `MOMENTS.length`. Fix any that do not.

---

## Task 11: Documentation and verification

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update `docs/architecture.md`.**

Cover, in the existing Stage 3 section:

- **Ground nudge is a weighted, place-aware roll**, not a ladder. Record *why*: a ladder made `build` deterministic, because `capacity() = 2 × built huts` means a starting village is already at capacity. Note the hysteresis (`pendingSite`) and the `NUDGE_SENSE_RADIUS` the nudge "sees" with.
- **Nudge reach vs. weight.** `SUGGESTION_WEIGHT` stays at 30; a nudge feels weak because of reach, so `suggest()` tags 4 villagers within `NUDGE_EARSHOT`. Raising the weight would walk toward coercion and break the "suggest, never command" rule.
- **Fruit is individually pickable.** Four stratified slots on the crown; `pickFruit(x, z)` takes the nearest and scales that instance to nothing; the mesh is disposed only when the last one goes. `villager:ate` fires on the **swallow**, not the pick.
- **`foundHutAt` enforces one pending site**, independent of the resolver.
- **The Journal is a teaching device.** `Wildfire` watches `bySpread` (fire jumps), not a body count. `Full Harvest` was retired as a duplicate of `Fed`. `Drained` picks up the previously-unwatched `pond:emptied`. `MomentId` is persisted — removing an id is safe, renaming one revokes a player's unlock.

- [ ] **Step 2: Verify.**

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass, no trailing whitespace.

---

## Verification

- [ ] `npx vitest run src/villagers/ src/world/ src/powers/ src/discovery/`
- [ ] `npm test`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] Manually verify in the browser:
  - The nudge glyph is a yellow fingertip spark inside a ring, legible at a glance.
  - **Nudging open ground repeatedly does not just build huts.** Nudges near trees tend to send them chopping; nudges by the shore tend to send them fishing; nudges in the open tend to gather.
  - A ground nudge still founds a hut when the village is genuinely full — and **never founds a second while the first site stands unbuilt**.
  - A nudge visibly moves up to four nearby idle villagers, not two.
  - Rain on a tree grows **four fruit spread around the crown**, not clumped on one side.
  - A villager picks **one** fruit; the other three stay hanging. Four separate villagers can eat from one tree.
  - A harvesting villager **carries the fruit to their mouth and eats it** before the Journal says anyone was fed.
  - The fishing rod points **forward over the water**, with the line and float hanging below the tip.
  - A villager mid-job breaks off, kneels at the pond, **visibly dips and drinks**, and returns to the job.
  - Floating fish are **salmon-coloured**, not white.
  - Villagers at a doused campfire stoop and poke at the ashes.
  - The Journal shows **15** moments.
  - **Wildfire** unlocks when a fire *spreads on its own*, not when you light five.
  - **Drained** unlocks when a meteor empties a pond.

## Done When

- Ground nudge varies with the place and the village's needs; it is no longer a hut-building button.
- Only one hut site is ever pending, no matter how fast the player nudges.
- Fruit hangs spread around the crown, is picked one at a time, and is visibly eaten before `villager:ate` fires.
- The rod points forward; the drink is a visible, repeatable action.
- Fish are fish-coloured.
- Every Journal moment teaches an interaction, no two duplicate each other, and the count still derives from `MOMENTS.length`.
- Tests, typecheck, and production build all pass.

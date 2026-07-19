# Wind Power Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fifth power, **Wind** (key `5`, 3-second cooldown): a gust sweeps outward from the island centre through the target, shaking one fruit loose from each fruiting tree in its 6-metre radius, comically tumbling a targeted villager, fanning a lit campfire with a small ember-spread chance, and staging cosmetic leaf/dust streaks, pond ripples, and dust devils — extending the explicit power × target matrix from 28 to 35 cells.

**Architecture:** World gains the persistent consequences (`Tree.dropFruit`/`sway`, a bounded `GroundFruit` record, `dropFruitNear`, `claimGroundFruit`, `emberIgnite`); villagers gain a `tumble` performance and a ground-fruit branch of the existing `harvest` state so dropped fruit feeds the existing held-fruit → `villager:ate` food flow. `PowerId` widens to `'wind'`; the matrix adds `shakeLoose` and `tumble` interaction kinds and makes the `scatter` handler kind-aware. `src/powers/wind.ts` owns the pure gust-direction/config helpers plus the three-beat `Wind` power with its own instanced streak staging (the Rain pattern). Tray, glyph CSS, whoosh audio, and the composition root wire it in.

**Tech Stack:** Vanilla Three.js, TypeScript (strict), Vite 8, Vitest (Node environment — THREE classes are constructible in Node; no DOM/WebGL in tests).

**Spec:** `docs/superpowers/specs/2026-07-18-wind-power-design.md`

## Global Constraints

- Vitest runs in the **Node environment**: tests may construct THREE objects (see `objects.test.ts`, `world.test.ts`, `rain.test.ts` and their `vi.mock('../fx/clayMaterial')` pattern) but never touch DOM/WebGL. `main.ts`, `styles.css`, and `sfx.ts` synthesis are verified by `npm run lint` + `npm run build` + manual QA.
- Hex colors live **only** in `PALETTE` (`src/ui/tokens.ts`) — this feature adds **no new hexes** (streaks use `leafA`/`dirt`, ground fruit uses `smockA` like hanging fruit, ripples use `water`).
- **No new `GameEvent` variants** and **no new journal Moments** — the journal stays at exactly fifteen ids. Ember ignition reuses `fire:ignited` with `bySpread: true`; eaten dropped fruit reuses `villager:ate`.
- Numbers fixed by the spec: radius **6 m**, anticipation **~0.8 s**, gust **~2.5 s**, cooldown **3 s**, ember radius tighter than the gust (**2.5 m**), one low-probability ember roll per cast, one drop per fruiting tree per cast.
- Reduced motion: shorter bounded gust (**1.2 s**), no streak travel (streaks pulse in place), same outcomes. `?lowfx=1` / reduced quality: fewer streak instances, same outcomes.
- Out of scope: wind moving the scene clouds or day/night sky, celebration smoke interaction, new journal Moments.
- Run `npm test && npm run lint` after every task; both must pass before committing.

---

### Task 1: World consequences — dropped fruit, tree sway, ember ignition

**Files:**
- Modify: `src/world/objects.ts`
- Modify: `src/world/world.ts`
- Modify: `src/main.ts` (one tick call)
- Modify: `src/world/objects.test.ts`
- Modify: `src/world/world.test.ts`

**Interfaces:**
- Consumes: existing `Tree` fruit slots, `Grave` bounded-record pattern, `World.bus`, `within()`, `alarmNear()`, private `burningCount()`.
- Produces (later tasks rely on these exact names):
  - `Tree.sway(dirX: number, dirZ: number, seconds: number): void`
  - `Tree.dropFruit(): { x: number; z: number } | null`
  - `class GroundFruit { readonly id: string; x: number; z: number; readonly group: THREE.Group; get expired(): boolean; update(dt: number): void; dispose(): void }` (exported from `objects.ts`)
  - `World.groundFruits: GroundFruit[]`
  - `World.dropFruitNear(x: number, z: number, radius: number, rng: RNG, lowFx?: boolean): number`
  - `World.nearestGroundFruit(x: number, z: number): GroundFruit | null`
  - `World.claimGroundFruit(fruit: GroundFruit): boolean`
  - `World.updateGroundFruit(dt: number): void`
  - `World.emberIgnite(rng: RNG, chance: number, radius: number): boolean`

- [ ] **Step 1: Write the failing tree tests**

Append to `src/world/objects.test.ts` inside the existing `describe('Tree lifecycle', ...)` block (reuses the file's `tree()` and `run()` helpers):

```ts
  it('drops one fruit per call to a landing point near the trunk', () => {
    const subject = tree()
    subject.growFruit()
    expect(subject.fruitCount).toBe(4)

    const landing = subject.dropFruit()
    expect(landing).not.toBeNull()
    expect(Math.hypot(landing!.x, landing!.z)).toBeLessThanOrEqual(2.6)
    expect(subject.fruitCount).toBe(3)

    subject.dropFruit()
    subject.dropFruit()
    subject.dropFruit()
    expect(subject.fruitCount).toBe(0)
    expect(subject.hasFruit).toBe(false)
    expect(subject.dropFruit()).toBeNull() // bare tree just sways
  })

  it('sways its crown along the gust and settles back upright', () => {
    const subject = tree()
    const crown = subject.group.getObjectByName('tree-crown')!
    subject.sway(0, 1, 2.5) // gust blowing toward +z leans the crown on x
    run(subject, 1.2)
    expect(Math.abs(crown.rotation.x)).toBeGreaterThan(0.01)
    run(subject, 2, 1.2)
    expect(crown.rotation.x).toBe(0)
    expect(crown.rotation.z).toBe(0)
  })

  it('ignores sway once felled', () => {
    const subject = tree()
    subject.chop()
    subject.sway(1, 0, 2.5)
    const crown = subject.group.getObjectByName('tree-crown')!
    const before = crown.rotation.z
    run(subject, 0.5)
    expect(crown.rotation.x).toBe(0)
    expect(crown.rotation.z).toBe(before)
  })
```

- [ ] **Step 2: Write the failing world tests**

Append to `src/world/world.test.ts` (reuses `makeWorld()` and `addTree()`; extend the file's `./objects` import with `GroundFruit` if the assertions need the type, and `Campfire` is already imported):

```ts
describe('wind consequences', () => {
  it('shakes one fruit loose per fruiting tree inside the gust', () => {
    const world = makeWorld()
    const near = addTree(world, 'tree-near', 1, 0)
    const far = addTree(world, 'tree-far', 20, 0)
    const bare = addTree(world, 'tree-bare', -1, 0)
    near.growFruit()
    far.growFruit()

    expect(world.dropFruitNear(0, 0, 6, new RNG(3))).toBe(1)
    expect(near.fruitCount).toBe(3) // one drop per tree per cast
    expect(far.fruitCount).toBe(4)
    expect(bare.hasFruit).toBe(false)
    expect(world.groundFruits).toHaveLength(1)
    expect(world.nearestGroundFruit(0, 0)).toBe(world.groundFruits[0]!)
  })

  it('claims each ground fruit exactly once and spoils leftovers', () => {
    const world = makeWorld()
    addTree(world, 'tree-a', 1, 0).growFruit()
    world.dropFruitNear(0, 0, 6, new RNG(3))
    const fruit = world.groundFruits[0]!

    expect(world.claimGroundFruit(fruit)).toBe(true)
    expect(world.claimGroundFruit(fruit)).toBe(false) // someone else got it
    expect(world.groundFruits).toHaveLength(0)

    world.dropFruitNear(0, 0, 6, new RNG(4))
    world.updateGroundFruit(59)
    expect(world.groundFruits).toHaveLength(1)
    world.updateGroundFruit(2)
    expect(world.groundFruits).toHaveLength(0) // spoiled on the fruit clock
  })

  it('rolls one ember: lit campfire plus a close tree may ignite as spread', () => {
    const world = makeWorld()
    world.campfire = new Campfire(0, 0, 0, new RNG(1), false, 'lit')
    const close = addTree(world, 'tree-close', 1.5, 0)
    addTree(world, 'tree-far', 5, 0)
    const events: string[] = []
    world.bus.on(event => {
      if (event.type === 'fire:ignited') events.push(`${event.kind}:${event.bySpread}`)
    })

    expect(world.emberIgnite(new RNG(1), 0, 2.5)).toBe(false) // chance gate
    expect(close.burning).toBe(false)
    expect(world.emberIgnite(new RNG(1), 1, 2.5)).toBe(true)
    expect(close.burning).toBe(true)
    expect(events).toEqual(['tree:true']) // feeds the Wildfire machinery

    const doused = makeWorld()
    doused.campfire = new Campfire(0, 0, 0, new RNG(1), false, 'doused')
    addTree(doused, 'tree-b', 1.5, 0)
    expect(doused.emberIgnite(new RNG(1), 1, 2.5)).toBe(false) // only lit fires
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/world/objects.test.ts src/world/world.test.ts`
Expected: FAIL — `dropFruit`, `sway`, `dropFruitNear`, `emberIgnite` are not functions.

- [ ] **Step 4: Implement `src/world/objects.ts`**

Add fields beside `private shudderTime = 0` in `Tree`:

```ts
  private swayTime = 0
  private swaySeconds = 0
  private swayDir = { x: 1, z: 0 }
```

Add beside `shudder()`:

```ts
  /** A gust bends the whole crown along its direction for `seconds`. */
  sway(dirX: number, dirZ: number, seconds: number): void {
    if (this.state !== 'normal' && this.state !== 'sapling') return
    const length = Math.hypot(dirX, dirZ) || 1
    this.swayDir = { x: dirX / length, z: dirZ / length }
    this.swaySeconds = Math.max(seconds, 0.001)
    this.swayTime = this.swaySeconds
  }
```

Add below `pickFruit()`:

```ts
  /**
   * Wind shakes one fruit out of the crown. Unlike `pickFruit`, the fruit
   * leaves for the ground: the caller receives the island-local landing point
   * and owns the resulting ground fruit. Returns null when the tree is bare.
   */
  dropFruit(): { x: number; z: number } | null {
    if (!this.fruit || this.fruitCount === 0) return null
    const index = this.fruitSlots.findIndex(slot => slot !== null)
    if (index < 0) return null
    const slot = this.fruitSlots[index]!
    this.fruitSlots[index] = null
    const matrix = new THREE.Matrix4()
    matrix.makeScale(0, 0, 0)
    this.fruit.setMatrixAt(index, matrix)
    this.fruit.instanceMatrix.needsUpdate = true
    if (this.fruitCount === 0) {
      this.crown.remove(this.fruit)
      disposeObjectResources(this.fruit)
      this.fruit = null
      this.fruitTime = 0
    }
    // Land under the crown edge on the fruit's own side of the trunk.
    return { x: this.x + slot.x * 1.15, z: this.z + slot.z * 1.15 }
  }
```

In `Tree.update()`, replace the shudder block

```ts
    if (this.shudderTime > 0 && this.state === 'normal') {
      this.shudderTime = Math.max(0, this.shudderTime - dt)
      const amount = this.shudderTime / 0.18
      this.crown.rotation.z = Math.sin(this.shudderTime * 60) * 0.06 * amount
    } else if (this.state === 'normal' && this.crown.rotation.z !== 0) {
      this.crown.rotation.z = 0
    }
```

with a sway-aware version (sway owns both axes while active; shudder keeps its jolt when no sway runs):

```ts
    if (this.swayTime > 0 && (this.state === 'normal' || this.state === 'sapling')) {
      this.swayTime = Math.max(0, this.swayTime - dt)
      const progress = 1 - this.swayTime / this.swaySeconds
      const strength = Math.sin(Math.min(1, progress) * Math.PI)
      const lean = strength * (0.24 + Math.sin(this.phase * 26) * 0.07)
      this.crown.rotation.z = -this.swayDir.x * lean
      this.crown.rotation.x = this.swayDir.z * lean
    } else if (this.crown.rotation.x !== 0) {
      this.crown.rotation.x = 0
    }

    if (this.shudderTime > 0 && this.state === 'normal') {
      this.shudderTime = Math.max(0, this.shudderTime - dt)
      const amount = this.shudderTime / 0.18
      this.crown.rotation.z = Math.sin(this.shudderTime * 60) * 0.06 * amount
    } else if (this.swayTime <= 0 && this.state === 'normal' && this.crown.rotation.z !== 0) {
      this.crown.rotation.z = 0
    }
```

Add the `GroundFruit` class directly below `Grave` (same bounded-record pattern):

```ts
/** A wind-dropped fruit resting on the ground until gathered or spoiled. */
export class GroundFruit {
  readonly group = new THREE.Group()

  private age = 0

  /** Uneaten fruit spoils on the same 60-second clock as fruit in a crown. */
  get expired(): boolean { return this.age >= 60 }

  constructor(
    public readonly id: string,
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    lowFx = false,
  ) {
    this.group.name = 'ground-fruit'
    this.group.position.set(x, y, z)
    const fruit = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.12, 8, 6), rng, 0.018),
      clayMaterial(PALETTE.smockA),
    )
    fruit.name = 'ground-fruit-blob'
    fruit.position.y = 0.1
    fruit.castShadow = !lowFx
    this.group.add(fruit)
  }

  update(dt: number): void { this.age += dt }

  dispose(): void { disposeObjectResources(this.group) }
}
```

- [ ] **Step 5: Implement `src/world/world.ts`**

Extend the `./objects` import with `GroundFruit`. Add the field beside `graves`:

```ts
  groundFruits: GroundFruit[] = []
```

and beside `private villagerSerial = 0`:

```ts
  private groundFruitSerial = 1000
```

Add the methods beside `updateGraves()`:

```ts
  /** Wind shakes one fruit from every fruiting tree inside the gust. */
  dropFruitNear(x: number, z: number, radius: number, rng: RNG, lowFx = false): number {
    let dropped = 0
    for (const tree of this.trees) {
      if (tree.state !== 'normal' || !tree.hasFruit || !within(tree, x, z, radius)) continue
      const landing = tree.dropFruit()
      if (!landing) continue
      const fruit = new GroundFruit(
        `ground-fruit-${this.groundFruitSerial++}`,
        landing.x,
        landing.z,
        this.island.sampleHeight(landing.x, landing.z),
        rng,
        lowFx,
      )
      this.island.group.add(fruit.group)
      this.groundFruits.push(fruit)
      dropped++
    }
    return dropped
  }

  nearestGroundFruit(x: number, z: number): GroundFruit | null {
    return [...this.groundFruits]
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null
  }

  /** A villager picks the fruit up; false when someone else got there first. */
  claimGroundFruit(fruit: GroundFruit): boolean {
    const index = this.groundFruits.indexOf(fruit)
    if (index < 0) return false
    this.groundFruits.splice(index, 1)
    this.island.group.remove(fruit.group)
    fruit.dispose()
    return true
  }

  updateGroundFruit(dt: number): void {
    for (const fruit of [...this.groundFruits]) {
      fruit.update(dt)
      if (fruit.expired) this.claimGroundFruit(fruit)
    }
  }

  /**
   * One mischievous ember roll per wind cast: a lit campfire may ignite the
   * nearest living tree very close to it, as wildfire spread. Recoverable
   * stakes, never guaranteed destruction.
   */
  emberIgnite(rng: RNG, chance: number, radius: number): boolean {
    if (!this.campfire?.lit || !rng.chance(chance)) return false
    const tree = this.trees
      .filter(candidate => (candidate.state === 'normal' || candidate.state === 'sapling')
        && !candidate.burning
        && within(candidate, this.campfire.x, this.campfire.z, radius))
      .sort((a, b) => Math.hypot(a.x - this.campfire.x, a.z - this.campfire.z)
        - Math.hypot(b.x - this.campfire.x, b.z - this.campfire.z))[0]
    if (!tree) return false
    tree.ignite()
    if (!tree.burning) return false
    this.bus.emit({
      type: 'fire:ignited', kind: 'tree', bySpread: true, burning: this.burningCount(),
    })
    this.alarmNear(tree.x, tree.z, 7)
    return true
  }
```

In `reground()`, widen the array so terrain deformation re-grounds resting fruit:

```ts
    const standing: Array<Tree | Hut | Grave | Campfire | GroundFruit> = [
      ...this.trees,
      ...this.huts,
      ...this.graves,
      ...this.groundFruits,
    ]
```

In `src/main.ts`, directly after the existing `world.updateGraves(dt)` line in the simulation callback, add:

```ts
    world.updateGroundFruit(dt)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/world/objects.test.ts src/world/world.test.ts`
Expected: PASS, including all pre-existing tree/world tests.

- [ ] **Step 7: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/world/objects.ts src/world/world.ts src/main.ts src/world/objects.test.ts src/world/world.test.ts
git commit -m "feat: add wind world consequences - dropped fruit, crown sway, ember roll"
```

---

### Task 2: Villager tumble performance

**Files:**
- Modify: `src/villagers/villager.ts`
- Modify: `src/villagers/villager.test.ts`

**Interfaces:**
- Consumes: existing `performance`/`performanceTime`/`performanceFrom` machinery, `wakeFromHut()`, `releaseSleepAssignment()`, `resetPose()`, `enter()`.
- Produces: `Villager.tumble(from: { x: number; z: number }): void` — comic bounded roll away from the gust; refuses while zapped, fleeing, or mourning; wakes sleepers through the existing doorway-restore path; recovers on its own into `wander`.

- [ ] **Step 1: Write the failing tests**

Append to `src/villagers/villager.test.ts`. The `ActivityHarness` type needs four extra declarations for this test — add them at the end of the type:

```ts
  performance: 'none' | 'meteor' | 'startle' | 'cower' | 'flinch' | 'tumble'
  performanceTime: number
  tumble(from: { x: number; z: number }): void
  updatePerformance(
    dt: number,
    qt: number,
    island: { sampleHeight(x: number, z: number): number },
  ): boolean
```

Then append the suite (drive `updatePerformance` with advancing quantized time so poses are written):

```ts
describe('tumble', () => {
  function tumbler(state: ActivityHarness['state'] = 'sitAtFire'): ActivityHarness {
    const villager = activityHarness(state)
    villager.performance = 'none'
    villager.performanceTime = 0
    ;(villager.emoteSprite as { update?: unknown }).update = vi.fn()
    return villager
  }

  it('rolls away from the gust, freezes normal activity, then recovers to wander', () => {
    const villager = tumbler()
    villager.tumble({ x: -2, z: 0 })
    expect(villager.performance).toBe('tumble')
    expect(villager.emote).toHaveBeenCalledWith('alarm')

    expect(villager.updatePerformance(0.5, 1 / 12, villager.island)).toBe(true)
    expect(villager.updatePerformance(0.5, 2 / 12, villager.island)).toBe(true)
    expect(villager.enter).not.toHaveBeenCalled()

    villager.updatePerformance(0.5, 3 / 12, villager.island) // 1.5 s > 1.4 s bound
    expect(villager.performance).toBe('none')
    expect(villager.emote).toHaveBeenCalledWith('question')
    expect(villager.enter).toHaveBeenCalledWith('wander', villager.world)
  })

  it('never interrupts fleeing, mourning, or a zapped villager', () => {
    const fleeing = tumbler('wander')
    fleeing.state = 'flee' as ActivityHarness['state']
    fleeing.tumble({ x: 0, z: 0 })
    expect(fleeing.performance).toBe('none')

    const zapped = tumbler()
    ;(zapped as unknown as { zapTime: number }).zapTime = 0.5
    zapped.tumble({ x: 0, z: 0 })
    expect(zapped.performance).toBe('none')
  })
})
```

(`activityHarness` does not set `zapTime`/`rainTime`/`insideHut` guards for every path — `tumbler()` sets what this suite needs; `zapTime` defaults to `undefined` which fails `>= 0`, so the happy path works, and the zapped case sets it explicitly.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: FAIL — `villager.tumble` is not a function.

- [ ] **Step 3: Implement in `src/villagers/villager.ts`**

Widen the performance union field:

```ts
  private performance: 'none' | 'meteor' | 'startle' | 'cower' | 'flinch' | 'tumble' = 'none'
```

Add the public method beside `zap()`:

```ts
  /** A gust knocks the villager into a comic roll; they recover on their own. */
  tumble(from: Point): void {
    if (!this.alive || this.zapTime >= 0) return
    if (this.state === 'flee' || this.state === 'mourn') return
    this.wakeFromHut()
    this.releaseSleepAssignment()
    if (this.rainTime > 0) {
      this.rainTime = 0
      this.rainLeaf.visible = false
      this.resetPose()
    }
    this.performance = 'tumble'
    this.performanceTime = 1.4
    this.performanceFrom = from
    this.emote('alarm')
  }
```

In `updatePerformance()`, extend the completion branch:

```ts
    if (this.performanceTime <= 0) {
      const wasStartle = this.performance === 'startle'
      const wasTumble = this.performance === 'tumble'
      this.performance = 'none'
      this.resetPose()
      if (wasStartle) this.panic(this.performanceFrom)
      if (wasTumble) {
        this.emote('question')
        this.enter('wander', this.world)
      }
      return false
    }
```

and add a `tumble` pose branch between the `'flinch'` branch and the final `else`:

```ts
    } else if (this.performance === 'tumble') {
      // Blown off their feet: back to the gust, quarter-turn rolls each frame,
      // limbs flailing — hat-and-smock-flapping in claymation terms.
      this.group.rotation.y = Math.atan2(
        this.x - this.performanceFrom.x,
        this.z - this.performanceFrom.z,
      )
      const frame = Math.floor((1.4 - this.performanceTime) * TIMING.fps)
      this.group.rotation.z = (frame % 4) * (Math.PI / 2)
      this.model.scale.set(MODEL_SCALE * 1.05, MODEL_SCALE * 0.85, MODEL_SCALE)
      this.arms[0].rotation.z = frame % 2 === 0 ? -2.4 : -1.1
      this.arms[1].rotation.z = frame % 2 === 0 ? 2.4 : 1.1
    }
```

No other changes: `updatePerformance` already returns `true` while active (freezing the normal state machine, satisfying "interrupt their current state"), sleepers already restore at the doorway via `wakeFromHut()`, and the celebration/zap paths already outrank performances.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: PASS, including all pre-existing performance tests.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/villagers/villager.ts src/villagers/villager.test.ts
git commit -m "feat: add comic wind tumble performance to villagers"
```

---

### Task 3: Villagers gather dropped fruit through the harvest flow

**Files:**
- Modify: `src/villagers/villager.ts`
- Modify: `src/villagers/villager.test.ts`

**Interfaces:**
- Consumes: `GroundFruit`, `World.groundFruits/nearestGroundFruit/claimGroundFruit` (Task 1); existing `heldFruit`/`eating`/`updateHeldFruit` food flow.
- Produces: the `harvest` state transparently targets the nearest ground fruit when it is closer than any fruiting tree (and no explicit harvest suggestion points at a tree); eating it emits the existing `villager:ate`.

- [ ] **Step 1: Write the failing tests**

Add `targetFruit: { x: number; z: number } | null` to the `ActivityHarness` type in `src/villagers/villager.test.ts`, then append:

```ts
describe('ground fruit gathering', () => {
  it('stoops for a dropped fruit and feeds the existing food flow', () => {
    const villager = activityHarness('harvest')
    const fruit = { x: 0.2, z: 0, id: 'ground-fruit-1' }
    const claimGroundFruit = vi.fn(() => true)
    villager.world = {
      groundFruits: [fruit],
      claimGroundFruit,
      submerged: () => false,
    } as unknown as World
    villager.targetFruit = fruit
    const events: string[] = []
    villager.bus = { emit: (event: { type: string }) => events.push(event.type) } as EventBus

    villager.performActivity(0.1, true, villager.world) // arrive, start stooping
    expect(villager.arrived).toBe(true)
    villager.performActivity(1.1, true, villager.world) // pick it up
    expect(claimGroundFruit).toHaveBeenCalledWith(fruit)
    expect(villager.heldFruit.visible).toBe(true)
    expect(villager.eating).toBeCloseTo(1.6)

    villager.updateHeldFruit(1.7, true) // chew and swallow
    expect(events).toContain('villager:ate')
  })

  it('abandons a fruit someone else claimed first', () => {
    const villager = activityHarness('harvest')
    const fruit = { x: 0.2, z: 0, id: 'ground-fruit-1' }
    villager.world = {
      groundFruits: [],
      claimGroundFruit: vi.fn(() => false),
      submerged: () => false,
    } as unknown as World
    villager.targetFruit = fruit

    villager.performActivity(0.1, true, villager.world)
    expect(villager.enter).toHaveBeenCalledWith('wander', villager.world)
  })
})
```

(`activityHarness` mocks `enter`, so the missing-fruit path asserts the recovery without running the real state machine. `updateHeldFruit` is already declared on the harness type.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: FAIL — `targetFruit` is never consumed; the harvest branch bails because `targetTree` is null.

- [ ] **Step 3: Implement in `src/villagers/villager.ts`**

Import the type: extend the existing `../world/objects` type import with `GroundFruit`. Add the field beside `targetTree`:

```ts
  private targetFruit: GroundFruit | null = null
```

In `enter()`'s reset block, add beside `this.targetTree = null`:

```ts
    this.targetFruit = null
```

Replace the `case 'harvest'` block in `enter()`:

```ts
      case 'harvest': {
        this.targetTree = this.selectHarvestTree(world, preferredTree)
        // A wind-dropped fruit on the ground is a gentler harvest than a climb;
        // take it when it is the nearer option and no suggestion names a tree.
        const fruit = this.suggestionForState('harvest')
          ? null
          : world.nearestGroundFruit(this.x, this.z)
        if (fruit && (!this.targetTree
          || distance(this, fruit) <= distance(this, this.targetTree))) {
          this.targetTree = null
          this.targetFruit = fruit
          this.setTarget(fruit)
          return
        }
        if (!this.targetTree) {
          this.cancelSuggestionFor('harvest')
          return this.enter('wander', world)
        }
        this.setTarget(this.targetTree)
        return
      }
```

In `performActivity()`'s `case 'harvest'`, insert the ground-fruit branch directly after the existing `if (this.eating > 0) return` line:

```ts
        if (this.targetFruit) {
          if (!this.world.groundFruits.includes(this.targetFruit)) {
            this.targetFruit = null
            this.enter('wander', world)
            return
          }
          if (distance(this, this.targetFruit) <= 0.55) {
            if (!this.arrived) {
              this.arrived = true
              this.actionTimer = 1
              // Stoop for the fruit at their feet.
              this.arms[0].rotation.z = -1.5
              this.head.rotation.x = 0.3
            }
            this.actionTimer -= dt
            if (this.actionTimer <= 0) {
              const fruit = this.targetFruit
              this.targetFruit = null
              if (world.claimGroundFruit(fruit)) {
                this.heldFruit.visible = true
                this.eating = 1.6
              } else {
                this.enter('wander', world)
              }
            }
          }
          return
        }
```

(The first guard reads `this.world.groundFruits` — the same registry the harness stubs — so a fruit claimed by another villager mid-walk cancels cleanly. Note the existing tree branch below it is unchanged.)

In `context()`, change the `hasFruitTree` line so the FSM can choose `harvest` when only ground fruit exists:

```ts
      hasFruitTree: world.fruitingTree() !== null || world.groundFruits.length > 0,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: PASS, including every pre-existing harvest/suggestion test (tree harvest still wins whenever a suggestion names a tree or the tree is nearer).

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/villagers/villager.ts src/villagers/villager.test.ts
git commit -m "feat: let villagers gather wind-dropped fruit through the harvest flow"
```

---

### Task 4: PowerId, matrix row, outcome handlers, and pure gust helpers

**Files:**
- Modify: `src/core/events.ts`
- Modify: `src/powers/matrix.ts`
- Modify: `src/powers/outcomes.ts`
- Create: `src/powers/wind.ts` (pure helpers only in this task)
- Create: `src/powers/wind.test.ts`
- Modify: `src/powers/matrix.test.ts`
- Modify: `src/ui/tray.ts` (label record — compile ripple)
- Modify: `src/main.ts` (cooldown record — compile ripple)

Widening `PowerId` breaks every `Record<PowerId, …>` at compile time; this task updates all four sites (`MATRIX`, matrix-test `EXPECTED`, tray `POWER_LABELS`, main's tray `cooldowns` record) in one commit so the tree stays green. The tray *slot* and the `Wind` class itself land in Task 5 — until then the label/cooldown entries are inert.

**Interfaces:**
- Consumes: `World.dropFruitNear`/`Villager.tumble` (Tasks 1–2).
- Produces (Task 5 relies on these exact names):
  - `PowerId` includes `'wind'`
  - `InteractionKind` includes `'shakeLoose' | 'tumble'`; wind matrix row `tree: ['shakeLoose']`, `hut: ['scatter']`, `villager: ['tumble']`, `campfire: ['flare']`, `pond/crater/ground: []`
  - `const WIND = { radius: 6, anticipationSeconds: 0.8, gustSeconds: 2.5, reducedGustSeconds: 1.2, cooldown: 3, emberRadius: 2.5, emberChance: 0.18 } as const` (from `./wind`)
  - `function gustDirection(x: number, z: number): { x: number; z: number }` (from `./wind`)

- [ ] **Step 1: Write the failing tests**

In `src/powers/matrix.test.ts`, add `'wind'` to the `POWERS` array and this row to `EXPECTED` (after `nudge`):

```ts
  wind: {
    tree: ['shakeLoose'],
    hut: ['scatter'],
    villager: ['tumble'],
    pond: [],
    campfire: ['flare'],
    crater: [],
    ground: [],
  },
```

Append inside `describe('matrix completeness', ...)`:

```ts
  it('covers all 35 power-target cells explicitly', () => {
    let cells = 0
    for (const power of POWERS) {
      for (const target of TARGETS) {
        expect(Array.isArray(resolveInteraction(power, target))).toBe(true)
        cells++
      }
    }
    expect(cells).toBe(35)
  })
```

Create `src/powers/wind.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { gustDirection, WIND } from './wind'

describe('gustDirection', () => {
  it('points outward from the island centre through the cast point', () => {
    expect(gustDirection(3, 4)).toEqual({ x: 0.6, z: 0.8 })
    expect(gustDirection(-5, 0)).toEqual({ x: -1, z: 0 })
  })

  it('falls back to a fixed direction at the exact centre', () => {
    expect(gustDirection(0, 0)).toEqual({ x: 1, z: 0 })
  })

  it('keeps the spec timing: 6 m radius, 0.8 s + 2.5 s beats, 3 s cooldown', () => {
    expect(WIND.radius).toBe(6)
    expect(WIND.anticipationSeconds).toBeCloseTo(0.8)
    expect(WIND.gustSeconds).toBeCloseTo(2.5)
    expect(WIND.cooldown).toBe(3)
    expect(WIND.emberRadius).toBeLessThan(WIND.radius) // embers reach less far
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/powers/matrix.test.ts src/powers/wind.test.ts`
Expected: FAIL — `'wind'` is not assignable to `PowerId`; `./wind` cannot resolve.

- [ ] **Step 3: Implement**

`src/core/events.ts`:

```ts
export type PowerId = 'meteor' | 'lightning' | 'rain' | 'nudge' | 'wind'
```

Create `src/powers/wind.ts` (Three.js-free in this task; the `Wind` class joins in Task 5):

```ts
/** Wind gust tuning: one source for the module and the outcome handlers. */
export const WIND = {
  radius: 6,
  anticipationSeconds: 0.8,
  gustSeconds: 2.5,
  /** Reduced motion keeps the outcomes but shortens the bounded gust. */
  reducedGustSeconds: 1.2,
  cooldown: 3,
  /** Embers reach much less far than the gust itself. */
  emberRadius: 2.5,
  emberChance: 0.18,
} as const

/** Outward from the island centre through the cast point: weather passing over. */
export function gustDirection(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z)
  if (length < 1e-6) return { x: 1, z: 0 }
  return { x: x / length, z: z / length }
}
```

`src/powers/matrix.ts` — extend the union and list:

```ts
export type InteractionKind =
  | 'ignite'
  | 'destroy'
  | 'kill'
  | 'zap'
  | 'scatter'
  | 'emptyPond'
  | 'steam'
  | 'stunFish'
  | 'flare'
  | 'growFruit'
  | 'grumpy'
  | 'suggest'
  | 'startleVillager'
  | 'shakeLoose'
  | 'tumble'
```

(append `'shakeLoose', 'tumble',` to `INTERACTION_KINDS` too), and add the wind row to `MATRIX` after `nudge`:

```ts
  wind: {
    // The gust's area cosmetics (streaks, sway, ripples, dust devils) are the
    // wind module's own staging, like Rain's shower; these cells are the
    // persistent per-target consequences.
    tree: ['shakeLoose'],
    hut: ['scatter'],
    villager: ['tumble'],
    pond: [],
    campfire: ['flare'],
    crater: [],
    ground: [],
  },
```

`src/powers/outcomes.ts` — import `{ gustDirection, WIND } from './wind'` (the same handler-helper pattern as `groundNudge`), replace the `scatter` handler with a kind-aware version, and add the two new handlers:

```ts
  scatter: (ctx, y0) => {
    if (ctx.kind === 'hut') {
      // Wind rattles the hut: a puff of loose clay bits, no damage.
      ctx.fx.particles.burst({
        x: ctx.x,
        y: y0 + 1.1,
        z: ctx.z,
        n: ctx.lowFx ? 6 : 14,
        color: PALETTE.dirt,
        speed: 1.6,
        gravity: 6,
        size: 0.5,
        life: 0.6,
      })
      return
    }
    ctx.world.scatterCampfire()
  },
```

```ts
  shakeLoose: (ctx) => {
    ctx.world.dropFruitNear(ctx.x, ctx.z, WIND.radius, ctx.rng, ctx.lowFx)
  },
  tumble: (ctx) => {
    const direction = gustDirection(ctx.x, ctx.z)
    ctx.world.villagerAt(ctx.x, ctx.z, 1.2)?.tumble({
      x: ctx.x - direction.x * 2,
      z: ctx.z - direction.z * 2,
    })
  },
```

`src/ui/tray.ts` — add to `POWER_LABELS` (leave `POWER_IDS` alone until Task 5):

```ts
  wind: 'Wind',
```

`src/main.ts` — add to the tray `cooldowns` record (`cooldown01` of an unregistered power is 0, so this is inert until Task 5):

```ts
    wind: powers.cooldown01('wind'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/powers/matrix.test.ts src/powers/wind.test.ts src/powers/outcomes.test.ts`
Expected: PASS — 35 cells, both new kinds handled, `declares no kind the matrix can never emit` still green.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/core/events.ts src/powers/matrix.ts src/powers/outcomes.ts src/powers/wind.ts src/powers/wind.test.ts src/powers/matrix.test.ts src/ui/tray.ts src/main.ts
git commit -m "feat: extend the interaction matrix to 35 cells for wind"
```

---

### Task 5: The Wind power — gust staging, tray slot, whoosh, wiring

**Files:**
- Modify: `src/powers/wind.ts`
- Modify: `src/powers/wind.test.ts`
- Modify: `src/powers/power.ts` (context gains `reducedMotion`)
- Modify: `src/ui/tray.ts` (fifth slot)
- Modify: `src/ui/tray.test.ts`
- Modify: `src/audio/sfx.ts`
- Modify: `src/styles.css`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `WIND`, `gustDirection` (Task 4); `Tree.sway`, `World.emberIgnite` (Task 1); matrix/outcomes (Task 4); existing `Timeline`, `impactContext`, `ParticleBurst` shapes.
- Produces:
  - `PowerContext` gains `reducedMotion(): boolean` (main supplies the same live callback the other systems use)
  - `class Wind extends Power` with `id: 'wind'`, `cooldown: 3`
  - Tray slot five (`POWER_IDS` order `meteor, lightning, rain, nudge, wind`) — key `5` and `aria-keyshortcuts` derive from the index automatically

- [ ] **Step 1: Write the failing wind tests**

Append to `src/powers/wind.test.ts` (mirrors `rain.test.ts`'s mocking and stub-world style):

```ts
import * as THREE from 'three'
import { vi } from 'vitest'
import { EventBus } from '../core/events'
import { RNG } from '../core/rng'
import type { CastCtx } from './power'
import { Wind } from './wind'

vi.mock('../fx/clayMaterial', async () => {
  const actual = await import('three')
  return { clayMaterial: vi.fn(() => new actual.MeshToonMaterial()) }
})

vi.mock('../fx/wobble', () => ({
  wobble: <T>(geometry: T): T => geometry,
}))

type StubTree = { x: number; z: number; sway: ReturnType<typeof vi.fn> }

function castContext(target: string, options: {
  reduced?: boolean
  trees?: StubTree[]
  x?: number
  z?: number
} = {}): {
  ctx: CastCtx
  world: {
    dropFruitNear: ReturnType<typeof vi.fn>
    emberIgnite: ReturnType<typeof vi.fn>
    villagerAt: ReturnType<typeof vi.fn>
  }
  burst: ReturnType<typeof vi.fn>
} {
  const burst = vi.fn()
  const world = {
    trees: options.trees ?? [],
    resolveTarget: vi.fn(() => target),
    dropFruitNear: vi.fn(),
    emberIgnite: vi.fn(() => false),
    villagerAt: vi.fn(() => null),
  }
  const ctx = {
    x: options.x ?? 4,
    z: options.z ?? 0,
    kind: target,
    power: 'wind',
    world,
    island: { sampleHeight: () => 0, group: new THREE.Group() },
    scene: new THREE.Scene(),
    fx: { particles: { burst } },
    bus: new EventBus(),
    rng: new RNG(11),
    lowFx: false,
    reducedMotion: () => options.reduced ?? false,
  } as unknown as CastCtx
  return { ctx, world: world as never, burst }
}

describe('Wind', () => {
  it('resolves the target at impact and shakes fruit loose from a tree', () => {
    const { ctx, world } = castContext('tree')
    const events: string[] = []
    ctx.bus.on(event => events.push(event.type))

    const timeline = new Wind().cast(ctx)
    expect(events).toEqual(['power:anticipate'])
    expect(world.dropFruitNear).not.toHaveBeenCalled()

    timeline.update(0.8)
    expect(events).toEqual(['power:anticipate', 'power:impact'])
    expect(world.dropFruitNear).toHaveBeenCalledWith(4, 0, 6, ctx.rng, false)
  })

  it('sways only trees inside the gust, along the outward direction', () => {
    const inside: StubTree = { x: 5, z: 1, sway: vi.fn() }
    const outside: StubTree = { x: 4, z: 9, sway: vi.fn() }
    const { ctx } = castContext('ground', { trees: [inside, outside] })

    new Wind().cast(ctx).update(0.8)

    expect(inside.sway).toHaveBeenCalledWith(1, 0, 2.5)
    expect(outside.sway).not.toHaveBeenCalled()
  })

  it('shortens the bounded gust under reduced motion, same outcomes', () => {
    const tree: StubTree = { x: 5, z: 1, sway: vi.fn() }
    const { ctx, world } = castContext('tree', { reduced: true, trees: [tree] })

    new Wind().cast(ctx).update(0.8)

    expect(tree.sway).toHaveBeenCalledWith(1, 0, 1.2)
    expect(world.dropFruitNear).toHaveBeenCalled()
  })

  it('rolls the ember only when the resolved target is the campfire', () => {
    const campfire = castContext('campfire')
    new Wind().cast(campfire.ctx).update(0.8)
    expect(campfire.world.emberIgnite).toHaveBeenCalledWith(campfire.ctx.rng, 0.18, 2.5)

    const ground = castContext('ground')
    new Wind().cast(ground.ctx).update(0.8)
    expect(ground.world.emberIgnite).not.toHaveBeenCalled()
  })

  it('keeps cosmetic cells cosmetic: pond and crater stage particles only', () => {
    for (const target of ['pond', 'crater'] as const) {
      const { ctx, world, burst } = castContext(target)
      new Wind().cast(ctx).update(0.8)
      expect(burst).toHaveBeenCalled()
      expect(world.dropFruitNear).not.toHaveBeenCalled()
      expect(world.emberIgnite).not.toHaveBeenCalled()
      expect(world.villagerAt).not.toHaveBeenCalled()
    }
  })

  it('finishes its choreography inside the cooldown-plus-aftermath window', () => {
    const { ctx } = castContext('ground')
    const timeline = new Wind().cast(ctx)
    timeline.update(10)
    expect(timeline.done).toBe(true)
    expect(new Wind().cooldown).toBe(3)
  })
})
```

In `src/ui/tray.test.ts`, append inside `describe('power glyph markup', ...)`:

```ts
  it('gives Wind the same simple decorative span as the destructive powers', () => {
    expect(powerGlyphMarkup('wind')).toBe(
      '<span class="power-glyph" data-glyph="wind" aria-hidden="true"></span>',
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/powers/wind.test.ts src/ui/tray.test.ts`
Expected: FAIL — `Wind` is not exported from `./wind`.

- [ ] **Step 3: Implement the Wind class and staging in `src/powers/wind.ts`**

Prepend the imports and append the actor + class below the Task 4 helpers:

```ts
import * as THREE from 'three'
import { Timeline } from '../core/timeline'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'
import { resolveInteraction } from './matrix'
import { applyInteractions } from './outcomes'
import { impactContext, Power, type CastCtx } from './power'
```

```ts
type GustActor = {
  start(): void
  gust(): void
  settle(): void
  remove(): void
}

/**
 * Leaf and dust streaks racing along the gust line. Owned by the wind module
 * (Rain's shower pattern): two fixed InstancedMeshes whose matrices are
 * rewritten at render time, allocated once per cast and disposed after settle.
 */
function gustField(ctx: CastCtx, reduced: boolean, gustSeconds: number): GustActor {
  const direction = gustDirection(ctx.x, ctx.z)
  const total = ctx.lowFx ? 28 : 84
  const group = new THREE.Group()
  group.name = 'wind-gust'
  group.position.set(ctx.x, 0, ctx.z)
  group.visible = false

  const geometry = wobble(new THREE.SphereGeometry(0.055, 6, 5), ctx.rng, 0.012)
  const leafMaterial = clayMaterial(PALETTE.leafA, { flat: true })
  const dustMaterial = clayMaterial(PALETTE.dirt, { flat: true })
  const leaves = new THREE.InstancedMesh(geometry, leafMaterial, Math.ceil(total * 0.6))
  const dust = new THREE.InstancedMesh(geometry, dustMaterial, Math.floor(total * 0.4))
  leaves.name = 'wind-leaves'
  dust.name = 'wind-dust'
  const dummy = new THREE.Object3D()
  dummy.scale.setScalar(0)
  dummy.updateMatrix()
  for (const mesh of [leaves, dust]) {
    mesh.frustumCulled = false
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, dummy.matrix)
    group.add(mesh)
  }

  // Per-streak lanes: sideways offset from the gust line, phase, speed, height.
  const lane = new Float32Array(total)
  const along = new Float32Array(total)
  const phase = new Float32Array(total)
  const speed = new Float32Array(total)
  const height = new Float32Array(total)
  for (let i = 0; i < total; i++) {
    lane[i] = ctx.rng.range(-WIND.radius * 0.85, WIND.radius * 0.85)
    along[i] = ctx.rng.range(-WIND.radius, WIND.radius)
    phase[i] = ctx.rng.next()
    speed[i] = ctx.rng.range(0.55, 1.05)
    height[i] = ctx.rng.range(0.25, 1.7)
  }

  const perp = { x: -direction.z, z: direction.x }
  let startedAt = Number.POSITIVE_INFINITY
  let gustAt = Number.POSITIVE_INFINITY
  let settleAt = Number.POSITIVE_INFINITY
  let removed = false

  const place = (index: number, streakAlong: number, scale: number): void => {
    const x = direction.x * streakAlong + perp.x * lane[index]!
    const z = direction.z * streakAlong + perp.z * lane[index]!
    const ground = ctx.island.sampleHeight(ctx.x + x, ctx.z + z)
    dummy.position.set(x, ground + height[index]!, z)
    dummy.rotation.set(0, Math.atan2(direction.x, direction.z), 0)
    dummy.scale.set(scale * 0.8, scale * 0.8, scale * (reduced ? 1 : 3.2))
    dummy.updateMatrix()
    if (index < leaves.count) leaves.setMatrixAt(index, dummy.matrix)
    else dust.setMatrixAt(index - leaves.count, dummy.matrix)
  }

  const render = (): void => {
    if (!Number.isFinite(startedAt) || removed) return
    const now = performance.now()
    const anticipation = Math.min(1, (now - startedAt) / (WIND.anticipationSeconds * 1000))
    let strength = anticipation * 0.25
    if (Number.isFinite(gustAt)) {
      const gustProgress = Math.min(1, (now - gustAt) / (gustSeconds * 1000))
      strength = 0.25 + Math.sin(gustProgress * Math.PI) * 0.75
    }
    if (Number.isFinite(settleAt)) {
      strength *= Math.max(0, 1 - (now - settleAt) / 600)
    }
    const travelled = Number.isFinite(gustAt) ? (now - gustAt) / 1000 : 0
    for (let i = 0; i < total; i++) {
      const cycle = (phase[i]! + travelled * speed[i]!) % 1
      // Reduced motion: no streak travel — each streak pulses in place.
      const streakAlong = reduced ? along[i]! : (cycle * 2 - 1) * WIND.radius
      place(i, streakAlong, strength * Math.sin(cycle * Math.PI))
    }
    leaves.instanceMatrix.needsUpdate = true
    dust.instanceMatrix.needsUpdate = true
  }

  leaves.onBeforeRender = render
  ctx.island.group.add(group)

  return {
    start: () => {
      startedAt = performance.now()
      group.visible = true
    },
    gust: () => { gustAt = performance.now() },
    settle: () => { settleAt = performance.now() },
    remove: () => {
      if (removed) return
      removed = true
      ctx.island.group.remove(group)
      geometry.dispose()
      leafMaterial.dispose()
      dustMaterial.dispose()
    },
  }
}

export class Wind extends Power {
  readonly id = 'wind' as const
  readonly cooldown = WIND.cooldown

  cast(ctx: CastCtx): Timeline {
    const reduced = ctx.reducedMotion()
    const gustSeconds = reduced ? WIND.reducedGustSeconds : WIND.gustSeconds
    const direction = gustDirection(ctx.x, ctx.z)
    const actor = gustField(ctx, reduced, gustSeconds)
    const y0 = ctx.island.sampleHeight(ctx.x, ctx.z)
    const gustEnd = WIND.anticipationSeconds + gustSeconds

    return new Timeline()
      .at(0, () => {
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        actor.start()
      })
      .at(WIND.anticipationSeconds, () => {
        const impact = impactContext(ctx)
        actor.gust()
        for (const tree of ctx.world.trees) {
          if (Math.hypot(tree.x - ctx.x, tree.z - ctx.z) <= WIND.radius) {
            tree.sway(direction.x, direction.z, gustSeconds)
          }
        }
        // Fanned flames may fling one ember at a very close tree — the wind
        // module's area consequence, beside the matrix's `flare` cell.
        if (impact.kind === 'campfire') {
          ctx.world.emberIgnite(ctx.rng, WIND.emberChance, WIND.emberRadius)
        }
        if (impact.kind === 'pond') {
          // Ripples race across the surface; fish unaffected.
          ctx.fx.particles.burst({
            x: ctx.x, y: y0 + 0.15, z: ctx.z,
            n: ctx.lowFx ? 8 : 20,
            color: PALETTE.water,
            speed: 2.6, gravity: 2, size: 0.5, life: 0.8,
            shape: 'ring',
          })
        }
        if (impact.kind === 'crater') {
          // A brief dust devil.
          ctx.fx.particles.burst({
            x: ctx.x, y: y0 + 0.2, z: ctx.z,
            n: ctx.lowFx ? 8 : 24,
            color: PALETTE.dirt,
            speed: 1.4, gravity: -0.6, size: 0.8, life: 1.2,
          })
        }
        ctx.bus.emit({
          type: 'power:impact', power: this.id, target: impact.kind, x: ctx.x, z: ctx.z,
        })
        applyInteractions(resolveInteraction(this.id, impact.kind), impact, y0)
      })
      .at(gustEnd, () => actor.settle())
      .at(gustEnd + 1, () => actor.remove())
  }
}
```

- [ ] **Step 4: Wire context, tray, audio, glyph, and composition root**

`src/powers/power.ts` — add to `PowerContext`:

```ts
  reducedMotion(): boolean
```

`src/ui/tray.ts` — the fifth slot (key `5` and `aria-keyshortcuts` follow from the index):

```ts
const POWER_IDS: readonly PowerId[] = ['meteor', 'lightning', 'rain', 'nudge', 'wind']
```

`src/audio/sfx.ts` — in `onEvent()`'s anticipate branch add:

```ts
      if (event.power === 'wind') this.whoosh(3.4)
```

and add the private method beside `rain()` (same looped-noise voice budget and cleanup):

```ts
  private whoosh(seconds: number): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.6
    filter.frequency.setValueAtTime(240, now)
    filter.frequency.exponentialRampToValueAtTime(900, now + 1.1)
    filter.frequency.exponentialRampToValueAtTime(320, now + seconds)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.9)
    gain.gain.setValueAtTime(0.05, now + seconds - 1)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(filter).connect(gain).connect(audio.master)
    source.start(now)
    source.stop(now + seconds)
    this.trackVoice([source], [filter, gain])
  }
```

`src/styles.css` — add after the rain glyph rule:

```css
.power-glyph[data-glyph='wind']::before {
  display: block;
  transform: rotate(-6deg);
  color: var(--ink-soft);
  content: '≋';
  font-size: 26px;
  line-height: 27px;
  text-align: center;
  text-shadow: 1px 2px 0 var(--yellow);
}
```

`src/main.ts`:
- Import `Wind` beside the other powers.
- Register it and pass the live reduced-motion callback:

```ts
const powers = new PowerManager(
  [new Meteor(), new Lightning(), new Rain(), new Nudge(), new Wind()],
  {
    world,
    island,
    scene,
    fx: {
      particles,
      shake,
      flash: (color, seconds) => flash(color, seconds, reducedMotion()),
    },
    bus: world.bus,
    rng,
    lowFx,
    reducedMotion,
  },
)
```

- Extend the id list (`tray.setEnabled`/`setCooldown` loops pick wind up automatically):

```ts
const powerIds: readonly PowerId[] = ['meteor', 'lightning', 'rain', 'nudge', 'wind']
```

(`drag.ts` needs no changes: targeting is power-generic and its labels are target-kind labels.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/powers/wind.test.ts src/ui/tray.test.ts src/powers/rain.test.ts src/powers/impact.test.ts`
Expected: PASS (the other power tests build their contexts with `as unknown as CastCtx`, so the widened `PowerContext` does not disturb them).

- [ ] **Step 6: Full check + commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/powers/wind.ts src/powers/wind.test.ts src/powers/power.ts src/ui/tray.ts src/ui/tray.test.ts src/audio/sfx.ts src/styles.css src/main.ts
git commit -m "feat: add the Wind power - gust staging, tray slot five, whoosh"
```

---

### Task 6: Documentation and manual QA

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Manual QA (`npm run dev`)**

1. Press `5` (and click the fifth tray slot): Wind arms with the shared reticle; targeting, cancel preview, and Escape behave exactly like the other powers; the cooldown ring runs ~3 s.
2. Cast at a stand of fruiting trees: whoosh builds ~0.8 s, streaks race outward from the island centre through the target for ~2.5 s, every tree in the ~6 m radius sways hard, each fruiting tree drops exactly one fruit; a villager later walks over, stoops, picks it up, and eats it (heart emote). A bare tree just sways.
3. Cast directly on a villager: comic roll away from the gust with flailing arms, alarm then question emote, back to normal life; a sleeping villager pops out of the hut doorway first. Never lethal.
4. Cast on the lit campfire repeatedly: flames flare each time; occasionally (roughly one in five casts with a tree within ~2.5 m) an ember ignites that tree — confirm the Wildfire moment can unlock from it and Rain can douse it.
5. Cast on a hut: rattle puff of clay bits, no damage, no state change. Cast on a pond: ripple ring, fish unaffected. Cast on a crater: brief dust devil. Cast on open ground: streaks only.
6. Reduced motion (Settings): outcomes identical, gust visibly shorter, streaks pulse in place instead of travelling.
7. `?lowfx=1`: fewer streaks, same outcomes; ground fruit still appears and is gathered.
8. Cast Wind during the celebration lockout: the tray disables slot five along with the rest; after the show it re-enables.
9. Leave a dropped fruit alone for a minute: it quietly disappears (spoils) without errors; cast near the island rim: streaks and fruit stay on the island.

- [ ] **Step 2: Update `docs/architecture.md`**

- `src/powers/wind.ts` (new bullet): pure `WIND` config and centre-outward `gustDirection`; the three-beat gust (0.8 s anticipation, 2.5 s gust — 1.2 s reduced motion, settle) with module-owned leaf/dust streak staging, area tree sway, the one-per-cast ember roll on a campfire target, and cosmetic pond/crater particle staging.
- `src/powers/matrix.ts` bullet: 5-power × 7-target product (35 cells); new `shakeLoose`/`tumble` kinds; wind's cosmetic cells stay empty because staging lives in the wind module.
- `src/powers/outcomes.ts` bullet: mention the kind-aware `scatter` handler (campfire wreckage vs. hut rattle puff).
- `src/powers/power.ts` / cooldown bullet: manager registers Meteor, Lightning, Rain, Nudge, and Wind at six, three, eight, two, and three seconds; `PowerContext` carries the live `reducedMotion` callback.
- `src/world/world.ts` bullet: ground-fruit registry (`dropFruitNear`, single `claimGroundFruit` consumer path, 60-second spoilage, regrounding) and `emberIgnite`'s `fire:ignited.bySpread` emission.
- `src/world/objects.ts` bullet: `Tree.sway`/`Tree.dropFruit` and the bounded `GroundFruit` record.
- `src/villagers/villager.ts` bullet: the `tumble` performance and the ground-fruit branch of `harvest` feeding the existing held-fruit → `villager:ate` flow; FSM harvest availability includes ground fruit.
- `src/audio/sfx.ts` bullet: synthesized wind whoosh on wind anticipation within the same voice budget.
- `src/ui/tray.ts` bullet: five power slots, Wind on key `5`.
- Classes list: add `Wind` and `GroundFruit`.

- [ ] **Step 3: Full check + commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add docs/architecture.md
git commit -m "docs: describe the wind power across architecture notes"
```

---

## Self-Review Notes

- **Spec coverage:** Form/timeline (T4 `WIND` constants + T5 class: key 5 via tray index, outward gust direction, 0.8/2.5/settle beats, 6 m radius, 3 s cooldown, whoosh through the existing voice budget). Matrix cells (T4: `shakeLoose`, `tumble`, kind-aware `scatter`, `flare` reuse, empty cosmetic cells; T5 stages pond/crater/ground cosmetics with no world mutation — asserted in wind tests). Consequences (T1 one-drop-per-tree + 60 s spoilage + ember-only-lit-campfire-close-tree-low-chance; T3 dropped fruit → held fruit → `villager:ate`; T2 tumble interrupts via the performance machinery, sleepers wake through `wakeFromHut`). Reduced motion / lowfx table (T5: `reducedGustSeconds` + pulse-in-place streaks, `lowFx` instance counts; outcomes asserted identical).
- **Compile-green ordering:** `PowerId` widens only in T4, which updates all four `Record<PowerId, …>` sites in the same commit; the tray slot and `Wind` registration wait for T5, during which the T4 label/cooldown entries are inert. The `outcomes.ts` ↔ `wind.ts` import pair follows the existing `outcomes.ts` ↔ `nudge.ts` circular precedent (pure helpers only at module load).
- **Type consistency:** `tumble(from: {x, z})` (T2) matches the T4 handler; `dropFruitNear(x, z, radius, rng, lowFx)` (T1) matches the T4 handler and T5 test assertion; `sway(dirX, dirZ, seconds)` (T1) matches the T5 gust beat; `emberIgnite(rng, chance, radius)` (T1) matches `emberIgnite(ctx.rng, 0.18, 2.5)` (T5); `GroundFruit` fields consumed in T3 (`x/z/id`, registry membership) all exist on the T1 class; `reducedMotion()` added to `PowerContext` (T5) is supplied by `main.ts` in the same task.
- **Node-only test environment respected:** all new tests follow existing harness patterns (`objects.test.ts` mocks, `world.test.ts` `makeWorld`, `villager.test.ts` `activityHarness`, `rain.test.ts` stub contexts); `styles.css`, sfx synthesis, and `main.ts` wiring are lint/build/manual-QA verified.

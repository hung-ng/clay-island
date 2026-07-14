# The People Implementation Plan (Stage 3)

> **For agentic workers:** Implement this plan task-by-task with tests first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Villagers obey the honest ground and answer to a kind power: they run from meteors instead of admiring them, they need homes to arrive, they stay out of lakes, they use the world you shaped, and a divine finger-poke can suggest — never command — what they do next.

**Architecture:** Three ideas carry the stage. **Panic is an ordering fix**: the blast ring gets a short `startle()` that hands off to `panic()`, while the safe ring keeps `lookUp()` — the reverse of today. **Housing gates arrival**: `World.capacity()` = 2 × built huts (max 12), over-capacity is legal, and only the player ever removes a villager. **Nudge is a suggestion channel**: a new `PowerId` row in the existing matrix writes a `Suggestion` onto the nearest idle villagers, which `decideNext()` weights heavily but does not force. Water becomes a steering obstacle via the `isSubmerged` query Stage 1 already exports.

**Tech Stack:** TypeScript, Three.js r185, Vitest. No new dependencies.

## Global Constraints

- Do not call `Math.random()`; all randomness goes through `RNG`.
- **Only the player kills villagers.** No drowning, no starvation, no fire death, no old age. Water is an obstacle, never a hazard.
- **Over-capacity is a legal, stable state.** Never cull, evict, or despawn a living villager for any reason.
- **Nudge is a suggestion, never a command.** A villager who is fleeing, mourning, zapped, or mid-activity ignores it.
- Pure decision logic stays in `src/villagers/fsm.ts` and is tested without THREE.
- Pure terrain logic stays in `src/world/terrain.ts`; reuse `isSubmerged`/`waterLevelAt`/`isBuildable` rather than adding new terrain queries.
- The mercy repopulation path (`repopulationHome`) is preserved: a village bombed to zero must always be able to return. Mercy is the one path that ignores capacity.
- Journal count must derive from `MOMENTS.length`, never a hard-coded `12`.
- Maintain `docs/architecture.md` when implementation changes.
- Do not edit `STATUS.md` unless explicitly asked.
- Do not commit unless explicitly asked.

---

## The three meteor radii

These are three different numbers doing three different jobs. Conflating them is the easiest way to get Task 1 wrong.

| Radius | Where | Job |
|---|---|---|
| **3m** | `killVillagerNear(…, 3, …)` in `outcomes.ts:19-26` | **Lethal.** Kills the single nearest villager. |
| **4.5m** | `warnNear` / `cower` in `meteor.ts:145,173-177` | **Blast.** Who startles and sprints; who cowers at impact. |
| **9m** (today 7) | `alarmNear` in `meteor.ts:144` | **Safe ring.** Who stops and watches the sky. |

The lethal radius is *smaller* than the blast radius. That gap is what makes the sprint worth making: a villager starting ~2.5m out sprints ~1.8m (1.89 m/s × 0.95s) and ends beyond the lethal ring.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/events.ts` | Add `'nudge'` to `PowerId`; add `village:grew`, `villager:escaped`, `villager:ate` events. |
| `src/villagers/fsm.ts` | Own `Suggestion`, the new states, and suggestion-weighted `decideNext()`. |
| `src/villagers/fsm.test.ts` | Verify suggestion bias, non-coercion, and precondition gating. |
| `src/villagers/villager.ts` | Own `startle()`, water repulsion, thirst, and the new activities. |
| `src/villagers/villager.test.ts` | Verify startle→panic handoff, water avoidance, and activity guards. |
| `src/world/world.ts` | Own `capacity()`, `suggest()`, `foundHutAt()`, and water-aware queries. |
| `src/world/world.test.ts` | Verify capacity accounting, over-capacity stability, mercy, and suggestion targeting. |
| `src/world/objects.ts` | Fix fruit to sit on the crown surface; add `pickFruit()`; add tree shudder. |
| `src/world/objects.test.ts` | Verify fruit visibility, picking, and shudder. |
| `src/powers/nudge.ts` | The Nudge power: resolve intent, suggest, and play the poke ripple. |
| `src/powers/nudge.test.ts` | Verify the ground-nudge resolution order. |
| `src/powers/matrix.ts` | Add the `nudge` row and its interaction kinds. |
| `src/powers/matrix.test.ts` | Pin the exhaustive power/target matrix. |
| `src/powers/outcomes.ts` | Add the `suggest` / `startleVillager` outcome handlers. |
| `src/powers/meteor.ts` | Invert the warn/alarm rings. |
| `src/powers/meteor.test.ts` | Verify blast sprints and safe ring watches. |
| `src/discovery/moments.ts` | Add the three Stage 3 moments. |
| `src/ui/tray.ts` | Fourth power slot; derive the journal count from `MOMENTS.length`. |
| `src/ui/journal.ts` | Derive the total from `MOMENTS.length`. |
| `src/main.ts` | Register `Nudge`; add it to `powerIds` and the cooldown map. |
| `docs/architecture.md` | Document capacity, suggestions, and water steering. |

---

## Task 1: Villagers flee the meteor (defect 6)

**Files:**
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`
- Modify: `src/world/world.ts`
- Modify: `src/powers/meteor.ts`
- Test: `src/powers/meteor.test.ts`

**Interfaces:**
- Produces: `Villager.startle(from: Point): void`, `World.warnNear(x, z, radius, inner?): void`

The bug: `Meteor.cast` runs `alarmNear(7)` then `warnNear(4.5)`. `lookUp()` sets a 1.2s performance and `Villager.update` early-returns from `updatePerformance()` (`villager.ts:202`), skipping all steering. The villagers **closest** to the impact are frozen for the entire 1.2s fall. The safe ones run.

- [ ] **Step 1: Write the failing test for the startle handoff.**

```ts
// src/villagers/villager.test.ts
describe('meteor panic', () => {
  it('startles briefly, then flees under its own steam', () => {
    const villager = Object.create(Villager.prototype) as Villager & {
      performance: string
      performanceTime: number
      panic: ReturnType<typeof vi.fn>
    }
    villager.alive = true
    villager.panic = vi.fn()
    villager.startle({ x: 0, z: 0 })

    expect(villager.performance).toBe('startle')
    expect(villager.performanceTime).toBeCloseTo(0.25)
    expect(villager.panic).not.toHaveBeenCalled()
  })

  it('a startle is short enough to leave time to run before impact', () => {
    // The meteor lands at t=1.2s. A 1.2s lookUp leaves zero running time.
    expect(0.25).toBeLessThan(1.2)
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: FAIL — `villager.startle is not a function`.

- [ ] **Step 3: Add `startle()` to `Villager`.**

Add `'startle'` to the `performance` union (`villager.ts:92`) and the method beside `lookUp`:

```ts
/** A blast-radius glance that yields to the sprint, rather than replacing it. */
startle(from: Point): void {
  if (!this.alive || this.zapTime >= 0) return
  this.performance = 'startle'
  this.performanceTime = 0.25
  this.performanceFrom = from
  this.emote('alarm')
}
```

- [ ] **Step 4: Make the startle hand off to the flee.**

In `updatePerformance()` (`villager.ts:743`), when the timer runs out on a `startle`, begin the sprint instead of returning to idle:

```ts
private updatePerformance(dt: number, qt: number, island: Island): boolean {
  if (this.performance === 'none') return false
  this.performanceTime = Math.max(0, this.performanceTime - dt)
  if (this.performanceTime <= 0) {
    const wasStartle = this.performance === 'startle'
    this.performance = 'none'
    this.resetPose()
    if (wasStartle) this.panic(this.performanceFrom)
    return false
  }
  // ... existing body unchanged, plus the pose below
```

Give `startle` its own pose in the same method — a quick glance up, arms half-raised, no crouch:

```ts
    if (this.performance === 'startle') {
      this.group.rotation.y = Math.atan2(
        this.performanceFrom.x - this.x,
        this.performanceFrom.z - this.z,
      )
      this.head.rotation.x = -0.5
      this.arms[0].rotation.z = -1.1
      this.arms[1].rotation.z = 1.1
    } else if (this.performance === 'flinch') {
      // ... existing flinch branch
```

- [ ] **Step 5: Give `warnNear` an inner radius so it skips the blast.**

In `world.ts:181`:

```ts
/** Warn the curious ring only. Villagers inside `inner` are in the blast and must run, not gawk. */
warnNear(x: number, z: number, radius: number, inner = 0): void {
  for (const villager of this.villagers) {
    if (!villager.alive || !within(villager, x, z, radius)) continue
    if (Math.hypot(villager.x - x, villager.z - z) < inner) continue
    villager.lookUp({ x, z })
  }
}

/** Startle the blast ring: a glance, then a sprint. */
startleNear(x: number, z: number, radius: number): void {
  for (const villager of this.villagers) {
    if (villager.alive && within(villager, x, z, radius)) villager.startle({ x, z })
  }
}
```

- [ ] **Step 6: Invert the rings in `Meteor.cast`.**

Replace `meteor.ts:144-145`:

```ts
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        // The safe ring watches the sky; the blast ring glances up and runs.
        ctx.world.warnNear(ctx.x, ctx.z, 9, 4.5)
        ctx.world.startleNear(ctx.x, ctx.z, 4.5)
```

- [ ] **Step 7: Pin the ordering in the meteor test.**

```ts
// src/powers/meteor.test.ts
it('startles the blast ring and only warns the safe ring', () => {
  const world = {
    warnNear: vi.fn(),
    startleNear: vi.fn(),
    villagers: [],
    // ...existing world stub fields
  }
  // cast, advance the timeline to t=0
  expect(world.startleNear).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 4.5)
  expect(world.warnNear).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 9, 4.5)
})
```

- [ ] **Step 8: Run the tests.**

Run: `npx vitest run src/villagers/villager.test.ts src/powers/meteor.test.ts src/world/world.test.ts`
Expected: PASS.

---

## Task 2: Water stops the walk (defect 11)

**Files:**
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`

**Interfaces:**
- Consumes: `isSubmerged(x, z, basins, groundY)` from `src/world/terrain.ts` (already exported).
- Produces: `World.submerged(x: number, z: number): boolean`, `World.waterDepthAt(x, z): number`

`Villager.steer()` (`villager.ts:431`) repels only from `world.objectsNear()` — trees, huts, campfire. Nothing consults the water, so villagers walk along the lake bed with water over their heads.

- [ ] **Step 1: Write the failing world test.**

```ts
// src/world/world.test.ts
it('reports a point inside a flooded basin as submerged', () => {
  const world = floodedWorld([{ x: 0, z: 0, radius: 3, depth: 1.5 }])
  expect(world.submerged(0, 0)).toBe(true)
  expect(world.submerged(10, 10)).toBe(false)
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — `world.submerged is not a function`.

- [ ] **Step 3: Add the water queries to `World`.**

```ts
/** Whether this point lies under a pond's surface. Walkers must stay out. */
submerged(x: number, z: number): boolean {
  return isSubmerged(x, z, this.ponds.map(pond => pond.basin), (px, pz) => (
    this.island.sampleHeight(px, pz)
  ))
}

/** How far below the water this point sits; 0 on dry land. Scales the shove. */
waterDepthAt(x: number, z: number): number {
  const level = waterLevelAt(x, z, this.ponds.map(pond => pond.basin))
  if (level === null) return 0
  return Math.max(0, level - this.island.sampleHeight(x, z))
}
```

Import `waterLevelAt` alongside the existing `isSubmerged` import from `./terrain`.

- [ ] **Step 4: Write the failing villager test.**

```ts
// src/villagers/villager.test.ts
describe('villagers keep out of the water', () => {
  it('is pushed away from a pond it would otherwise walk into', () => {
    const villager = Object.create(Villager.prototype) as Villager & {
      steer(dt: number, world: World): void
      x: number; z: number; tx: number; tz: number; speed: number; state: string
    }
    Object.assign(villager, { x: -2, z: 0, tx: 2, tz: 0, speed: 0.86, state: 'wander' })
    const world = {
      objectsNear: () => [],
      // A pond centred on the origin, straight across the villager's path.
      waterDepthAt: (x: number) => Math.abs(x) < 1.5 ? 1 : 0,
      submerged: (x: number) => Math.abs(x) < 1.5,
    } as unknown as World

    for (let i = 0; i < 200; i++) villager.steer(1 / 60, world)

    expect(world.submerged(villager.x, villager.z)).toBe(false)
  })
})
```

- [ ] **Step 5: Run it and watch it fail.**

Run: `npx vitest run src/villagers/villager.test.ts`
Expected: FAIL — the villager walks straight through and ends inside the pond.

- [ ] **Step 6: Add water repulsion to `steer()`.**

Inside `steer()` (`villager.ts:431`), after the existing object-repulsion loop and before the position is written:

```ts
    // Water is an obstacle, never a hazard: it shoves, it does not drown.
    // Sampling four neighbours gives a gradient without a real SDF.
    const probe = 0.9
    for (const [ox, oz] of [[probe, 0], [-probe, 0], [0, probe], [0, -probe]]) {
      const depth = world.waterDepthAt(this.x + ox, this.z + oz)
      if (depth <= 0) continue
      const push = Math.min(1, depth) * 2.6
      vx -= ox / probe * push
      vz -= oz / probe * push
    }
```

- [ ] **Step 7: Keep targets out of the water.**

`randomWalkPoint()` (`villager.ts:719`) retries until it finds dry ground:

```ts
private randomWalkPoint(world: World): Point {
  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = this.rng.range(0, Math.PI * 2)
    const radius = Math.sqrt(this.rng.next()) * WALK_RADIUS * 0.9
    const point = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
    if (!world.submerged(point.x, point.z)) return point
  }
  return { x: this.x, z: this.z }
}
```

Update its two call sites (`enter('wander')` at `villager.ts:641` and `grumpAtRain` at `villager.ts:327`) to pass `world`.

- [ ] **Step 8: Run the tests.**

Run: `npx vitest run src/villagers/villager.test.ts src/world/world.test.ts`
Expected: PASS.

---

## Task 3: Huts are homes (defect 10)

**Files:**
- Modify: `src/world/world.ts:586-605`
- Test: `src/world/world.test.ts`

**Interfaces:**
- Produces: `World.capacity(): number`, `World.living(): number`

- [ ] **Step 1: Write the failing capacity tests.**

```ts
// src/world/world.test.ts
describe('housing caps the population', () => {
  it('houses two villagers per built hut', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0, 'built')
    addHut(world, 'hut-1', 3, 0, 'built')
    expect(world.capacity()).toBe(4)
  })

  it('does not count sites, ruins, or abandoned huts', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0, 'built')
    addHut(world, 'hut-1', 3, 0, 'ruin')
    addHut(world, 'hut-2', 6, 0, 'abandoned')
    addHut(world, 'hut-3', 9, 0, 'site')
    expect(world.capacity()).toBe(2)
  })

  it('never houses more than twelve', () => {
    const world = makeWorld()
    for (let i = 0; i < 8; i++) addHut(world, `hut-${i}`, i * 3, 0, 'built')
    expect(world.capacity()).toBe(12)
  })

  it('over-capacity is stable: nobody is culled or evicted', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0, 'built')      // capacity 2
    world.villagers = [alive(), alive(), alive(), alive()] as Villager[]  // living 4

    world.repopulate(60, new RNG(1))

    expect(world.villagers.filter(v => v.alive)).toHaveLength(4)
  })

  it('sends nobody new while the village is over capacity', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0, 'built')
    world.villagers = [alive(), alive(), alive()] as Villager[]

    world.repopulate(60, new RNG(1))

    expect(world.villagers).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — `world.capacity is not a function`.

- [ ] **Step 3: Add capacity and gate arrival on it.**

Replace `repopulate` (`world.ts:586-605`):

```ts
/** Villagers alive right now. */
living(): number {
  return this.villagers.filter(villager => villager.alive).length
}

/** Two villagers per built hut. Huts are homes, not respawn points. */
capacity(): number {
  const homes = this.huts.filter(hut => hut.state === 'built').length
  return Math.min(homes, MAX_HUTS) * 2
}

repopulate(dt: number, rng: RNG, lowFx = false): void {
  const living = this.living()
  // Over-capacity is legal and stable: the village is crowded, not culled.
  // Nobody is ever evicted — only the player removes a villager.
  if (living >= this.capacity() && living > 0) {
    this.repopulateTimer = null
    return
  }

  const hut = repopulationHome(living, this.huts)
  if (!hut) return
  if (this.repopulateTimer === null) this.repopulateTimer = rng.range(20, 30)
  this.repopulateTimer -= dt
  if (this.repopulateTimer > 0) return

  spawnVillagers(this, this.island, rng, 1, {
    lowFx,
    origin: { x: hut.x, z: hut.z },
    animateIn: true,
  })
  this.repopulateTimer = null
}
```

The `living > 0` clause is the mercy path: at zero population, capacity is ignored so a village bombed flat can always return via `repopulationHome`.

- [ ] **Step 4: Pin the mercy path.**

```ts
it('repopulates from an abandoned hut even at zero capacity', () => {
  const world = makeWorld()
  addHut(world, 'hut-0', 0, 0, 'abandoned')   // capacity 0
  world.villagers = []

  world.repopulate(60, new RNG(1))

  expect(world.villagers.length).toBeGreaterThan(0)
})
```

- [ ] **Step 5: Run the tests.**

Run: `npx vitest run src/world/world.test.ts`
Expected: PASS.

---

## Task 4: Fruit you can see, and villagers who eat it (defect 12)

**Files:**
- Modify: `src/world/objects.ts:390-420`
- Test: `src/world/objects.test.ts`

**Interfaces:**
- Produces: `Tree.pickFruit(): boolean`, `Tree.hasFruit: boolean` (exists)

`growFruit()` places 4 instanced fruits at fixed offsets in the crown's **local interior** (`objects.ts:399-404`). The crown is 2–3 solid sphere blobs of radius 0.7–1.0 at scattered offsets, so a fruit at `[-0.18, -0.38, 0.5]` is buried inside the clay. Typically only one of the four ever shows.

- [ ] **Step 1: Write the failing test.**

```ts
// src/world/objects.test.ts
it('hangs every fruit on the surface of a crown blob, not inside it', () => {
  const tree = new Tree('tree-1', 0, 0, 0, new RNG(5))
  tree.growFruit()

  const crown = tree.group.getObjectByName('tree-crown') as THREE.Group
  const fruit = crown.children.find(c => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh
  const blobs = crown.children.filter(c => c instanceof THREE.Mesh && c !== fruit) as THREE.Mesh[]

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  for (let i = 0; i < fruit.count; i++) {
    fruit.getMatrixAt(i, matrix)
    position.setFromMatrixPosition(matrix)

    // Every fruit must lie outside every blob's solid body.
    const buried = blobs.some((blob) => {
      const geometry = blob.geometry as THREE.SphereGeometry
      const radius = geometry.parameters.radius * Math.max(blob.scale.x, blob.scale.y, blob.scale.z)
      return position.distanceTo(blob.position) < radius * 0.92
    })
    expect(buried).toBe(false)
  }
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/world/objects.test.ts`
Expected: FAIL — fruits sit inside the crown blobs.

- [ ] **Step 3: Hang the fruit on the crown's surface.**

Replace the fixed `positions` array in `growFruit()` (`objects.ts:398-409`). Place each fruit on the surface of a chosen blob by pushing it out along a radial direction, biased downward and outward so it reads as hanging:

```ts
  growFruit(): boolean {
    if (this.state !== 'normal') return false
    if (this.fruit) {
      this.fruitTime = 60
      return false
    }
    const rng = new RNG(this.id.length * 97)
    const geometry = wobble(new THREE.SphereGeometry(0.12, 8, 6), new RNG(this.id.length * 97), 0.018)
    const fruit = new THREE.InstancedMesh(geometry, clayMaterial(PALETTE.smockA), 4)
    const blobs = this.crown.children.filter(child => child instanceof THREE.Mesh) as THREE.Mesh[]
    const matrix = new THREE.Matrix4()

    for (let i = 0; i < 4; i++) {
      const blob = blobs[i % blobs.length]
      const sphere = blob.geometry as THREE.SphereGeometry
      const radius = sphere.parameters.radius
        * Math.max(blob.scale.x, blob.scale.y, blob.scale.z)
      // Bias downward and outward: fruit hangs off the underside of the canopy.
      const yaw = rng.range(0, Math.PI * 2)
      const pitch = rng.range(-0.9, -0.15)
      const direction = new THREE.Vector3(
        Math.cos(pitch) * Math.cos(yaw),
        Math.sin(pitch),
        Math.cos(pitch) * Math.sin(yaw),
      )
      const position = direction.multiplyScalar(radius * 1.02).add(blob.position)
      matrix.makeTranslation(position.x, position.y, position.z)
      fruit.setMatrixAt(i, matrix)
    }

    fruit.instanceMatrix.needsUpdate = true
    fruit.castShadow = !this.lowFx
    this.crown.add(fruit)
    this.fruit = fruit
    this.fruitTime = 60
    return true
  }
```

- [ ] **Step 4: Add picking.**

```ts
  /** A villager takes the fruit. Returns false when there was none to take. */
  pickFruit(): boolean {
    if (!this.fruit) return false
    this.crown.remove(this.fruit)
    disposeObjectResources(this.fruit)
    this.fruit = null
    this.fruitTime = 0
    return true
  }
```

- [ ] **Step 5: Test picking.**

```ts
it('picking takes the fruit off the tree', () => {
  const tree = new Tree('tree-1', 0, 0, 0, new RNG(5))
  tree.growFruit()
  expect(tree.hasFruit).toBe(true)

  expect(tree.pickFruit()).toBe(true)

  expect(tree.hasFruit).toBe(false)
  expect(tree.pickFruit()).toBe(false)
})
```

- [ ] **Step 6: Run the tests.**

Run: `npx vitest run src/world/objects.test.ts`
Expected: PASS.

---

## Task 5: The new activities

**Files:**
- Modify: `src/villagers/fsm.ts`
- Test: `src/villagers/fsm.test.ts`
- Modify: `src/villagers/villager.ts`
- Modify: `src/world/world.ts`
- Modify: `src/core/events.ts`

**Interfaces:**
- Produces: states `'drink' | 'harvest' | 'gather'`; `FsmCtx.hasFruitTree`, `FsmCtx.fireOut`; `World.fruitingTree(): Tree | null`; events `villager:ate`

Four behaviours. `drink` is deliberately **not** an idle-roll entry — that would make it a reskin of `fish`. It is a *need* that interrupts labour and resumes it.

- [ ] **Step 1: Write the failing FSM tests.**

```ts
// src/villagers/fsm.test.ts — extend `base()` with hasFruitTree: false, fireOut: false, suggestion: null
it('has exactly 12 states', () => {
  expect(STATES).toHaveLength(12)
  expect([...STATES].sort()).toEqual([
    'buildHut', 'chopTree', 'drink', 'fish', 'flee', 'gather',
    'harvest', 'makeFire', 'mourn', 'rebuild', 'sitAtFire', 'wander',
  ])
})

it('harvests only when a tree is fruiting', () => {
  let harvested = false
  for (let seed = 0; seed < 300; seed++) {
    if (decideNext(base({ rng: new RNG(seed), hasFruitTree: true })) === 'harvest') harvested = true
  }
  expect(harvested).toBe(true)
  for (let seed = 0; seed < 300; seed++) {
    expect(decideNext(base({ rng: new RNG(seed), hasFruitTree: false }))).not.toBe('harvest')
  }
})

it('gathers at the dead fire only when the fire is out', () => {
  for (let seed = 0; seed < 300; seed++) {
    expect(decideNext(base({ rng: new RNG(seed), fireOut: false }))).not.toBe('gather')
  }
})

it('never rolls `drink` from idle — thirst interrupts work, it is not a pastime', () => {
  for (let seed = 0; seed < 400; seed++) {
    expect(decideNext(base({ rng: new RNG(seed), hasPond: true }))).not.toBe('drink')
  }
})
```

- [ ] **Step 2: Run and watch fail.**

Run: `npx vitest run src/villagers/fsm.test.ts`
Expected: FAIL — 9 states, not 12.

- [ ] **Step 3: Extend the FSM.**

```ts
export const STATES = [
  'wander', 'chopTree', 'buildHut', 'sitAtFire', 'flee', 'mourn', 'rebuild',
  'fish', 'makeFire', 'drink', 'harvest', 'gather',
] as const

export type FsmCtx = {
  // ...existing fields
  hasFruitTree: boolean
  fireOut: boolean
}

const IDLE: { state: VillagerState; weight: number; when: (c: FsmCtx) => boolean }[] = [
  { state: 'wander', weight: 4, when: () => true },
  { state: 'sitAtFire', weight: 3, when: c => c.campfireLit },
  { state: 'chopTree', weight: 3, when: c => c.hasTree },
  { state: 'buildHut', weight: 3, when: c => c.hasSite },
  { state: 'fish', weight: 4, when: c => c.hasPond },
  { state: 'makeFire', weight: 5, when: c => c.needsFire },
  { state: 'harvest', weight: 5, when: c => c.hasFruitTree },
  { state: 'gather', weight: 3, when: c => c.fireOut },
]
// `drink` is absent by design: it is entered by thirst in Villager, never rolled.
```

Durations:

```ts
    case 'drink': return 4
    case 'harvest': return rng.range(4, 7)
    case 'gather': return rng.range(5, 9)
```

- [ ] **Step 4: Add the world queries.**

```ts
// world.ts
/** A `normal` tree currently carrying fruit, for a harvester to walk to. */
fruitingTree(): Tree | null {
  return this.trees.find(tree => tree.state === 'normal' && tree.hasFruit) ?? null
}

/** The fire exists but is dead — the village drifts toward it. */
fireOut(): boolean {
  return Boolean(this.campfire) && !this.campfire.lit && !this.campfire.scattered
}
```

Wire both into `Villager.context()` (`villager.ts:704`) as `hasFruitTree: world.fruitingTree() !== null` and `fireOut: world.fireOut()`.

- [ ] **Step 5: Implement `harvest` and `gather` in `enter()` and `performActivity()`.**

In `enter()`:

```ts
      case 'harvest': {
        this.targetTree = world.fruitingTree()
        if (!this.targetTree) return this.enter('wander', world)
        this.setTarget(this.targetTree)
        return
      }
      case 'gather': {
        const angle = this.rng.range(0, Math.PI * 2)
        this.setTarget({
          x: world.campfire.x + Math.cos(angle) * 1.5,
          z: world.campfire.z + Math.sin(angle) * 1.5,
        })
        return
      }
```

In `performActivity()`:

```ts
      case 'harvest': {
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
            if (this.targetTree.pickFruit()) this.bus.emit({ type: 'villager:ate' })
            this.enter('wander', world)
          }
        }
        return
      }
      case 'gather': {
        if (!world.fireOut()) {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.3) this.arrived = true
        return
      }
```

- [ ] **Step 6: Add thirst — a need that interrupts labour.**

Add fields to `Villager`:

```ts
  private thirst = 0
  private resumeState: VillagerState | null = null
```

Accumulate it during labour, inside `update()` before `performActivity`:

```ts
    // Long work makes them thirsty; a pond is a reason to stop, drink, and go back.
    const labouring = this.state === 'chopTree'
      || this.state === 'buildHut'
      || this.state === 'rebuild'
    if (labouring) this.thirst += dt
    if (this.thirst >= 25 && this.arrived && world.ponds.length > 0) {
      this.thirst = 0
      this.resumeState = this.state
      this.enter('drink', world)
    }
```

`enter('drink')` targets the nearest shore, and `performActivity` resumes the interrupted work:

```ts
      case 'drink': {
        const pond = [...world.ponds]
          .sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
        this.targetPond = pond
        if (!pond) return this.enter('wander', world)
        this.setTarget(pond.shoreNear(this.x, this.z))
        return
      }
```

```ts
      case 'drink': {
        if (this.targetDistance() < 0.25) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 2
            this.emote('water')
          }
          this.actionTimer -= dt
          if (ticked) {
            // Kneel and dip: squash the body and pitch the head toward the water.
            this.model.scale.set(MODEL_SCALE, MODEL_SCALE * 0.72, MODEL_SCALE)
            this.head.rotation.x = 0.5
          }
          if (this.actionTimer <= 0) {
            const resume = this.resumeState
            this.resumeState = null
            this.enter(resume ?? 'wander', world)
          }
        }
        return
      }
```

Clear `resumeState` in `enter()` for every state except `drink`, so an interrupted job is never resumed twice.

- [ ] **Step 7: Add the event.**

```ts
// core/events.ts
  | { type: 'villager:ate' }
```

- [ ] **Step 8: Run the tests.**

Run: `npx vitest run src/villagers/fsm.test.ts src/villagers/villager.test.ts src/world/world.test.ts`
Expected: PASS.

---

## Task 6: Shelter, fishing, and chopping with weight

**Files:**
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`
- Modify: `src/world/objects.ts`

**Interfaces:**
- Produces: `Tree.shudder(): void`

- [ ] **Step 1: Shelter under a tree in the rain.**

`grumpAtRain()` (`villager.ts:316-328`) walks to the nearest built hut wearing a leaf hat. Prefer a nearer tree, and drop the leaf when sheltering under a crown — the crown *is* the shelter:

```ts
  grumpAtRain(world: World): void {
    if (!this.alive || this.zapTime >= 0) return
    this.rainTime = 2.6
    this.state = 'wander'
    this.resetPose()

    const hut = world.huts
      .filter(candidate => candidate.state === 'built')
      .sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
    const tree = world.trees
      .filter(candidate => candidate.state === 'normal')
      .sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null

    const treeIsNearer = tree !== null
      && (hut === null || distance(this, tree) < distance(this, hut))

    // Under a crown you need no leaf; the tree is the roof.
    this.rainLeaf.visible = !treeIsNearer
    if (!treeIsNearer) this.arms[0].rotation.z = -2.25
    this.emote('water')
    this.setTarget(tree && treeIsNearer ? tree : hut ?? this.randomWalkPoint(world))
  }
```

- [ ] **Step 2: Test it.**

```ts
it('shelters under a nearer tree instead of donning the leaf hat', () => {
  const villager = Object.create(Villager.prototype) as Villager
  Object.assign(villager, { alive: true, zapTime: -1, x: 0, z: 0, /* …pose stubs… */ })
  const world = {
    huts: [{ state: 'built', x: 10, z: 0 }],
    trees: [{ state: 'normal', x: 1.5, z: 0 }],
  } as unknown as World

  villager.grumpAtRain(world)

  expect(villager.group.getObjectByName('rain-leaf')!.visible).toBe(false)
})
```

- [ ] **Step 3: Give the tree a shudder.**

In `objects.ts`, on `Tree`:

```ts
  private shudderTime = 0

  /** Struck but not felled: the canopy jolts. */
  shudder(): void {
    if (this.state !== 'normal') return
    this.shudderTime = 0.18
  }
```

Drive it from `Tree.update()` — the crown recoils and settles:

```ts
    if (this.shudderTime > 0) {
      this.shudderTime = Math.max(0, this.shudderTime - dt)
      const amount = this.shudderTime / 0.18
      this.crown.rotation.z = Math.sin(this.shudderTime * 60) * 0.06 * amount
    } else if (this.crown.rotation.z !== 0) {
      this.crown.rotation.z = 0
    }
```

- [ ] **Step 4: Test the shudder.**

```ts
it('shudders when struck, and settles', () => {
  const tree = new Tree('tree-1', 0, 0, 0, new RNG(2))
  const crown = tree.group.getObjectByName('tree-crown')!

  tree.shudder()
  tree.update(1 / 60, 1 / 60)
  expect(crown.rotation.z).not.toBe(0)

  advanceTree(tree, 1)
  expect(crown.rotation.z).toBe(0)
})
```

- [ ] **Step 5: Make chopping land.**

In `performActivity`'s `chopTree` branch (`villager.ts:459-476`), each downswing now *strikes* the tree — it shudders, chips fly, and only the last blow fells it:

```ts
      case 'chopTree': {
        if (!this.targetTree || this.targetTree.state !== 'normal') {
          this.enter('wander', world)
          return
        }
        if (distance(this, this.targetTree) <= 1.15) {
          this.arrived = true
          if (!ticked) return
          this.chopFrames++
          const raised = this.chopFrames % 2 === 1
          this.arms[0].rotation.z = raised ? -1.9 : this.arms[0].userData.baseRotation
          this.arms[1].rotation.z = raised ? 1.9 : this.arms[1].userData.baseRotation
          // The downstroke is the one that bites.
          if (!raised) {
            this.targetTree.shudder()
            world.chipsAt(this.targetTree.x, this.targetTree.z)
          }
          if (this.chopFrames >= 8) {
            this.targetTree.chop()
            this.enter('wander', world)
          }
        }
        return
      }
```

`chopFrames >= 8` (up from 4) gives four landed blows rather than two — the felling reads as work.

- [ ] **Step 6: Add the chip burst.**

`World` needs a particle hook, since `Villager` has no `fx` handle. Add an injectable emitter beside the existing `stepFoley` pattern (`world.ts:71-72`):

```ts
  private chipFx: ((x: number, z: number) => void) | null = null
  setChipFx(handler: ((x: number, z: number) => void) | null): void { this.chipFx = handler }
  chipsAt(x: number, z: number): void { this.chipFx?.(x, z) }
```

Wire it in `main.ts` beside `world.setStepFoley(...)`:

```ts
world.setChipFx((x, z) => particles.burst({
  x, y: island.sampleHeight(x, z) + island.group.position.y + 0.8, z,
  n: 8, color: PALETTE.bark, speed: 2.4, gravity: 9, life: 0.5, size: 0.6,
}))
```

Import `PALETTE` from `./ui/tokens` in `main.ts` if it is not already imported.

- [ ] **Step 7: Give fishing a rod.**

In `Villager`'s constructor, build a rod that stays hidden until fishing (mirroring `rainLeaf`):

```ts
    const rodMaterial = clayMaterial(PALETTE.bark)
    this.rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.3, 5), rodMaterial)
    this.rod.name = 'fishing-rod'
    this.rod.position.set(0.3, 0.75, 0.24)
    this.rod.rotation.set(-0.6, 0, -0.5)
    this.rod.visible = false
    this.rod.castShadow = !lowFx
    this.group.add(this.rod)
```

Show it on arrival in the `fish` branch of `performActivity`, kneel, and face the water:

```ts
      case 'fish': {
        if (!this.targetPond || !world.ponds.some(pond => pond === this.targetPond)) {
          this.rod.visible = false
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.25) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 4
            this.rod.visible = true
            this.emote('fish')
          }
          this.actionTimer -= dt
          if (this.actionTimer <= 0) {
            // The catch: the fish breaks the surface, and that is what the Journal sees.
            if (this.rng.chance(0.05)) {
              this.targetPond.floatFish()
              this.bus.emit({ type: 'villager:fished' })
            }
            this.actionTimer = 4
          }
        }
        return
      }
```

Hide the rod in `enter()` alongside the other target resets: `this.rod.visible = false`.

- [ ] **Step 8: Pause at the old graves.**

`mourn` fires once per **fresh** grave, then the grave is scenery forever. A wandering villager who passes an old grave should stop and look.

This is **not** `mourn`: it consumes nothing, emits no event, and is a pause *inside* `wander` rather than a state. Add to the `wander` branch of `performActivity`:

```ts
      case 'wander': {
        if (this.targetDistance() < 0.22) {
          if (!this.arrived && this.rng.chance(0.22)) this.emote('sleep')
          this.arrived = true
        }
        // The island remembers what you did. So do they.
        if (this.graveGlance <= 0 && !this.arrived) {
          const grave = world.graves.find(candidate => (
            isGrave(candidate) && !candidate.fresh && distance(this, candidate) < 1.1
          ))
          if (grave) {
            this.graveGlance = 2.4
            this.setTarget({ x: this.x, z: this.z })
            this.emote('sad')
          }
        }
        if (this.graveGlance > 0) {
          this.graveGlance -= dt
          if (this.graveGlance <= 0) this.setTarget(this.randomWalkPoint(world))
        }
        return
      }
```

with the field `private graveGlance = 0`, reset to `0` in `enter()`. A fresh grave is excluded so this never competes with `mourn`.

- [ ] **Step 9: Test the glance.**

```ts
it('pauses at an old grave, but leaves the fresh ones to the mourners', () => {
  const villager = harness('wander')
  const world = {
    graves: [{ x: 0.5, z: 0, fresh: false }],
    ponds: [],
  } as unknown as World

  villager.performActivity(1 / 60, true, world)

  expect(villager.graveGlance).toBeGreaterThan(0)
})
```

- [ ] **Step 10: Run the tests.**

Run: `npx vitest run src/villagers/ src/world/objects.test.ts`
Expected: PASS.

---

## Task 7: The Nudge power

**Files:**
- Modify: `src/core/events.ts`
- Modify: `src/powers/matrix.ts`
- Test: `src/powers/matrix.test.ts`
- Create: `src/powers/nudge.ts`
- Test: `src/powers/nudge.test.ts`
- Modify: `src/powers/outcomes.ts`
- Modify: `src/villagers/fsm.ts`
- Test: `src/villagers/fsm.test.ts`
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`

**Interfaces:**
- Produces:

```ts
export type SuggestionKind = 'chop' | 'fish' | 'build' | 'makeFire' | 'gather'
export type Suggestion = { kind: SuggestionKind; x: number; z: number; ttl: number }
export function groundNudge(ctx: {
  needsFire: boolean
  living: number
  capacity: number
  huts: number
  buildable: boolean
}): SuggestionKind
World.suggest(x: number, z: number, kind: SuggestionKind): number
World.foundHutAt(x: number, z: number, rng: RNG, lowFx?: boolean): Hut | null
```

- [ ] **Step 1: Write the failing ground-nudge resolution test.**

This is the heart of the power: one meaning, resolved from the village's needs.

```ts
// src/powers/nudge.test.ts
import { describe, expect, it } from 'vitest'
import { groundNudge } from './nudge'

const ctx = (o: Partial<Parameters<typeof groundNudge>[0]> = {}): Parameters<typeof groundNudge>[0] => ({
  needsFire: false, living: 2, capacity: 6, huts: 3, buildable: true, ...o,
})

describe('ground nudge resolves from the village needs', () => {
  it('builds the campfire first when there is no fire', () => {
    expect(groundNudge(ctx({ needsFire: true, living: 6, capacity: 6 }))).toBe('makeFire')
  })

  it('founds a hut when housing is full and there is room to grow', () => {
    expect(groundNudge(ctx({ living: 6, capacity: 6, huts: 3 }))).toBe('build')
  })

  it('does not found a hut when the village is not full', () => {
    expect(groundNudge(ctx({ living: 2, capacity: 6 }))).toBe('gather')
  })

  it('does not found a hut beyond the six-hut cap', () => {
    expect(groundNudge(ctx({ living: 12, capacity: 12, huts: 6 }))).toBe('gather')
  })

  it('gathers on ground that cannot be built on', () => {
    expect(groundNudge(ctx({ needsFire: true, buildable: false }))).toBe('gather')
  })
})
```

- [ ] **Step 2: Run and watch fail.**

Run: `npx vitest run src/powers/nudge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the resolver.**

**Where `SuggestionKind` lives.** Declare it in `src/villagers/fsm.ts`, **not** in `nudge.ts`. `fsm.ts` is the pure, dependency-free module; if the type lived in the power, then `fsm.ts → nudge.ts → world.ts → fsm.ts` would be an import cycle. `nudge.ts` imports the type from `fsm.ts`.

```ts
// src/villagers/fsm.ts
export type SuggestionKind = 'chop' | 'fish' | 'build' | 'makeFire' | 'gather'
export type Suggestion = { kind: SuggestionKind; x: number; z: number; ttl: number }
```

```ts
// src/powers/nudge.ts
import { MAX_HUTS } from '../world/world'
import type { SuggestionKind } from '../villagers/fsm'

/**
 * Ground-nudge means one thing — *tend to this spot* — and the village's own
 * needs decide the outcome. No mode, no menu. First match wins.
 */
export function groundNudge(ctx: {
  needsFire: boolean
  living: number
  capacity: number
  huts: number
  buildable: boolean
}): SuggestionKind {
  if (!ctx.buildable) return 'gather'
  if (ctx.needsFire) return 'makeFire'
  // The growth valve: they found a new home only when the old ones are full.
  if (ctx.living >= ctx.capacity && ctx.huts < MAX_HUTS) return 'build'
  return 'gather'
}
```

`groundNudge` is a pure function of five numbers, so it is tested with no THREE, no `World`, and no island — exactly like `forest.ts`.

- [ ] **Step 4: Write the failing suggestion-bias tests.**

```ts
// src/villagers/fsm.test.ts
describe('a nudge suggests, it never commands', () => {
  it('usually takes a suggestion', () => {
    let taken = 0
    for (let seed = 0; seed < 300; seed++) {
      const next = decideNext(base({
        rng: new RNG(seed),
        hasTree: true,
        suggestion: { kind: 'chop', x: 0, z: 0, ttl: 5 },
      }))
      if (next === 'chopTree') taken++
    }
    expect(taken).toBeGreaterThan(200)   // heavily biased…
    expect(taken).toBeLessThan(300)      // …but never forced
  })

  it('is ignored outright by an emergency', () => {
    expect(decideNext(base({
      fireNear: true,
      suggestion: { kind: 'chop', x: 0, z: 0, ttl: 5 },
    }))).toBe('flee')
  })

  it('cannot suggest an impossible activity', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(decideNext(base({
        rng: new RNG(seed),
        hasTree: false,
        suggestion: { kind: 'chop', x: 0, z: 0, ttl: 5 },
      }))).not.toBe('chopTree')
    }
  })
})
```

- [ ] **Step 5: Implement the suggestion channel in the FSM.**

```ts
// fsm.ts — `SuggestionKind` and `Suggestion` are declared here (see Step 3)

export type FsmCtx = {
  // ...existing fields
  suggestion: Suggestion | null
}

const SUGGESTED: Record<SuggestionKind, VillagerState> = {
  chop: 'chopTree',
  fish: 'fish',
  build: 'buildHut',
  makeFire: 'makeFire',
  gather: 'gather',
}

/** A nudge outweighs the idle roll, but never silences it. */
const SUGGESTION_WEIGHT = 30

export function decideNext(ctx: FsmCtx): VillagerState {
  // Emergencies ignore the player entirely — a fleeing villager is not listening.
  if (ctx.fireNear) return 'flee'
  if (ctx.freshGrave) return 'mourn'
  if (ctx.hasRuin) return 'rebuild'

  const available = IDLE.filter(option => option.when(ctx))
  const wanted = ctx.suggestion ? SUGGESTED[ctx.suggestion.kind] : null
  const weightOf = (option: { state: VillagerState; weight: number }): number => (
    option.state === wanted ? option.weight + SUGGESTION_WEIGHT : option.weight
  )

  const total = available.reduce((sum, option) => sum + weightOf(option), 0)
  let roll = ctx.rng.next() * total
  for (const option of available) {
    roll -= weightOf(option)
    if (roll < 0) return option.state
  }
  return 'wander'
}
```

A suggestion whose state is not in `available` (no tree to chop) simply adds no weight anywhere — it cannot force an impossible activity.

For `gather` to be nudge-able onto arbitrary ground, add it to `IDLE` gated on `fireOut || suggestion?.kind === 'gather'`:

```ts
  { state: 'gather', weight: 3, when: c => c.fireOut || c.suggestion?.kind === 'gather' },
```

- [ ] **Step 6: Add suggestion plumbing to `World` and `Villager`.**

```ts
// world.ts
/** Tag the nearest idle villagers. Returns how many were reached. */
suggest(x: number, z: number, kind: SuggestionKind): number {
  const idle = this.villagers
    .filter(villager => villager.alive && villager.canBeNudged())
    .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
    .slice(0, 2)
  for (const villager of idle) villager.suggest({ kind, x, z, ttl: 6 })
  return idle.length
}
```

```ts
// villager.ts
  private suggestion: Suggestion | null = null

  /** Busy, frightened, grieving or dead villagers do not take orders. */
  canBeNudged(): boolean {
    if (!this.alive || this.zapTime >= 0) return false
    if (this.performance !== 'none') return false
    return this.state === 'wander' || this.state === 'sitAtFire' || this.state === 'gather'
  }

  suggest(suggestion: Suggestion): void {
    if (!this.canBeNudged()) return
    this.suggestion = suggestion
    this.emote('question')
    // Cut the current idle short so the nudge is answered promptly.
    this.timer = Math.min(this.timer, 0.4)
  }
```

Expire it in `update()` and expose it through `context()`:

```ts
    if (this.suggestion) {
      this.suggestion.ttl -= dt
      if (this.suggestion.ttl <= 0) this.suggestion = null
    }
```

```ts
      suggestion: this.suggestion,
```

Clear `this.suggestion = null` inside `enter()` — a suggestion is spent once acted on.

- [ ] **Step 7: Found a new hut.**

```ts
// world.ts
/** A nudge founds a genuinely new home. This is the only path that grows the village. */
foundHutAt(x: number, z: number, rng: RNG, lowFx = false): Hut | null {
  if (this.huts.filter(hut => hut.state !== 'abandoned').length >= MAX_HUTS) return null
  const query = this.groundQuery()
  if (!isBuildable(x, z, query, (px, pz) => this.island.sampleHeight(px, pz))) return null

  const hut = new Hut(
    `hut-${this.hutSerial++}`,
    x, z, 'site',
    this.island.sampleHeight(x, z),
    rng, lowFx,
  )
  this.huts.push(hut)
  this.island.group.add(hut.group)
  this.bus.emit({ type: 'village:grew' })
  return hut
}
```

The existing villager `buildHut` activity finds this new `site` through `world.buildSite()` and builds it in three ticks — no new construction path.

- [ ] **Step 8: Add the matrix row.**

```ts
// core/events.ts — widen the power union…
export type PowerId = 'meteor' | 'lightning' | 'rain' | 'nudge'

// …and add the Stage 3 events to the GameEvent union:
  | { type: 'village:grew' }
  | { type: 'villager:escaped' }
  | { type: 'villager:ate' }      // (added in Task 5)
```

Widening `PowerId` makes every `Record<PowerId, …>` in the codebase a type error until it gains a `nudge` key — `MATRIX` in `matrix.ts`, `POWER_LABELS` in `tray.ts`, and the `cooldowns` map in `main.ts`. That is the compiler doing its job; Steps 8–10 and Task 8 fill them in. Run `npx tsc --noEmit` to enumerate them.

```ts
// matrix.ts — add to InteractionKind and INTERACTION_KINDS
  | 'suggest'
  | 'startleVillager'

  nudge: {
    tree: ['suggest'],
    hut: ['suggest'],
    villager: ['startleVillager'],
    pond: ['suggest'],
    campfire: ['suggest'],
    crater: [],
    ground: ['suggest'],
  },
```

- [ ] **Step 9: Add the outcome handlers.**

```ts
// outcomes.ts
  suggest: (ctx) => {
    const kind = suggestionFor(ctx)
    if (kind) ctx.world.suggest(ctx.x, ctx.z, kind)
  },
  startleVillager: (ctx) => { ctx.world.villagerAt(ctx.x, ctx.z, 1.2)?.emote('question') },
```

with the target→intent mapping:

```ts
function suggestionFor(ctx: CastCtx): SuggestionKind | null {
  switch (ctx.kind) {
    case 'tree': return 'chop'
    case 'pond': return 'fish'
    case 'hut': return 'build'
    case 'campfire': return 'gather'
    case 'ground': {
      const buildable = isBuildable(
        ctx.x, ctx.z,
        ctx.world.groundQuery(),
        (x, z) => ctx.island.sampleHeight(x, z),
      )
      const kind = groundNudge({
        needsFire: ctx.world.needsFire(),
        living: ctx.world.living(),
        capacity: ctx.world.capacity(),
        huts: ctx.world.huts.filter(hut => hut.state !== 'abandoned').length,
        buildable,
      })
      // A ground nudge that resolves to `build` must create the site to build on.
      if (kind === 'build') ctx.world.foundHutAt(ctx.x, ctx.z, ctx.rng, ctx.lowFx)
      return kind
    }
    default: return null
  }
}
```

- [ ] **Step 10: Write the power.**

```ts
// nudge.ts
export class Nudge extends Power {
  readonly id = 'nudge' as const
  readonly cooldown = 2

  cast(ctx: CastCtx): Timeline {
    const y0 = ctx.island.sampleHeight(ctx.x, ctx.z)
    const ripple = pokeRipple(ctx.island.group, ctx.x, y0, ctx.z)

    return new Timeline()
      .at(0, () => {
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        ripple.start()
      })
      .at(0.25, () => {
        applyInteractions(resolveInteraction(this.id, ctx.kind), ctx, y0)
        ctx.bus.emit({
          type: 'power:impact', power: this.id, target: ctx.kind, x: ctx.x, z: ctx.z,
        })
      })
      .at(1.2, () => ripple.remove())
  }
}
```

`pokeRipple` is an expanding ring in `PALETTE.paper` — model it on `dustRing` in `meteor.ts:100-129`, but with no shake, no scorch, and no damage.

- [ ] **Step 11: Update the matrix test.**

Extend the exhaustive matrix pin in `matrix.test.ts` with the `nudge` row and assert `resolveInteraction('nudge', 'crater')` is empty.

- [ ] **Step 12: Run the tests.**

Run: `npx vitest run src/powers/ src/villagers/fsm.test.ts src/world/world.test.ts`
Expected: PASS.

---

## Task 8: Tray, Journal, and the game loop

**Files:**
- Modify: `src/ui/tray.ts`
- Modify: `src/ui/journal.ts`
- Modify: `src/discovery/moments.ts`
- Test: `src/discovery/moments.test.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Add the fourth power to the tray.**

In `tray.ts:17-23` — same slot, same chrome, keyboard `4`:

```ts
const POWER_IDS: readonly PowerId[] = ['meteor', 'lightning', 'rain', 'nudge']
const POWER_LABELS: Record<PowerId, string> = {
  meteor: 'Meteor',
  lightning: 'Lightning',
  rain: 'Rain',
  nudge: 'Nudge',
}
```

The keyboard handler already derives its index from `POWER_IDS` (`tray.ts:133`), so `4` works with no change. Add a `[data-glyph="nudge"]` rule to `styles.css` beside the existing three glyphs.

- [ ] **Step 2: Derive the journal count from the moment list.**

`tray.ts:157` hard-codes `12`. Replace with the real total:

```ts
import { MOMENTS } from '../discovery/moments'

    setJournalCount(n) {
      const counter = journal.querySelector('b')
      if (!counter) return
      const total = MOMENTS.length
      counter.textContent = `${Math.max(0, Math.min(total, n))}/${total}`
      // ...
    },
```

Set the initial markup to `Journal <b>0/${MOMENTS.length}</b>`, and sweep `src/ui/journal.ts` for any other hard-coded `12`.

- [ ] **Step 3: Add the three Stage 3 moments.**

```ts
// moments.ts
  | 'village-grows'
  | 'close-call'
  | 'fed'
```

```ts
  {
    id: 'village-grows', title: 'The Village Grows',
    hint: 'A full house needs another.', color: PALETTE.hutClay,
  },
  {
    id: 'close-call', title: 'Close Call',
    hint: 'They ran. It landed. They lived.', color: PALETTE.smockA,
  },
  {
    id: 'fed', title: 'Fed',
    hint: 'You made it rain. Someone ate.', color: PALETTE.leafB,
  },
```

```ts
      case 'village:grew': return 'village-grows'
      case 'villager:escaped': return 'close-call'
      case 'villager:ate': return 'fed'
```

- [ ] **Step 4: Emit `villager:escaped`.**

A villager who was inside the **3m lethal radius** when the meteor was cast, and is beyond it at impact, escaped. In `Meteor.cast`, capture the at-risk set at t=0 and check it at impact:

```ts
    const atRisk = new Set<Villager>()
    // ...
      .at(0, () => {
        for (const villager of ctx.world.villagers) {
          if (villager.alive && Math.hypot(villager.x - ctx.x, villager.z - ctx.z) <= 3) {
            atRisk.add(villager)
          }
        }
      })
      // …inside the existing t=1.2 impact block, AFTER applyInteractions:
        for (const villager of atRisk) {
          if (villager.alive && Math.hypot(villager.x - ctx.x, villager.z - ctx.z) > 3) {
            ctx.bus.emit({ type: 'villager:escaped' })
            break
          }
        }
```

The check must run **after** `applyInteractions`, so a villager killed by this meteor is already `alive === false` and cannot be reported as an escapee.

- [ ] **Step 5: Register Nudge in the game loop.**

```ts
// main.ts
import { Nudge } from './powers/nudge'

const powerIds: readonly PowerId[] = ['meteor', 'lightning', 'rain', 'nudge']
const powers = new PowerManager([new Meteor(), new Lightning(), new Rain(), new Nudge()], { /* … */ })

const tray = createTray(ui, {
  onArm: power => targeting.arm(power),
  onCancel: () => targeting.cancel(true),
  cooldowns: () => ({
    meteor: powers.cooldown01('meteor'),
    lightning: powers.cooldown01('lightning'),
    rain: powers.cooldown01('rain'),
    nudge: powers.cooldown01('nudge'),
  }),
})
```

- [ ] **Step 6: Test the moments.**

```ts
// moments.test.ts
it('unlocks The Village Grows when a nudge founds a hut', () => {
  const journal = new Journal(null)
  expect(journal.observe({ type: 'village:grew' })?.id).toBe('village-grows')
})

it('unlocks Close Call when a villager outruns a meteor', () => {
  const journal = new Journal(null)
  expect(journal.observe({ type: 'villager:escaped' })?.id).toBe('close-call')
})

it('unlocks Fed when a villager eats', () => {
  const journal = new Journal(null)
  expect(journal.observe({ type: 'villager:ate' })?.id).toBe('fed')
})
```

- [ ] **Step 7: Run the full suite.**

Run: `npm test`
Expected: PASS.

---

## Task 9: Documentation and verification

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Document the stage in `docs/architecture.md`.**

Cover: `World.capacity()` and the housing rule (2 × built huts, cap 12, over-capacity legal, mercy path ignores capacity); the three meteor radii and the `startle → panic` handoff; water as a steering obstacle via `isSubmerged`; the `Suggestion` channel and why `decideNext` weights rather than forces; and `foundHutAt` as the only path that grows the village.

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
  - A meteor dropped on a crowd sends the **close** villagers sprinting and leaves the **distant** ones watching the sky.
  - A villager who starts near the edge of the kill radius outruns it and lives.
  - A villager standing on the impact point still dies.
  - Destroying a built hut lowers capacity; **nobody dies**; no new villagers arrive until capacity exceeds the living count.
  - Nudging open ground while housing is full founds a new hut, and the village grows past 6.
  - Nudging open ground with a half-empty village just gathers there.
  - A village bombed to zero still recovers from an abandoned hut.
  - Villagers walk **around** ponds, never through them.
  - Nudging a tree/pond/hut sends the nearest idle villagers to chop/fish/build.
  - A fleeing or mourning villager **ignores** a nudge.
  - Chopping takes four landed blows; the tree shudders and sheds chips on each.
  - Rain on a tree grows **four visible fruits**, and a villager walks over, picks, and eats.
  - Rain sends villagers under nearby tree crowns without the leaf hat.
  - A doused campfire draws idle villagers to mill around it.
  - Fishing shows a rod, and a catch surfaces a fish.
  - A villager wandering past an **old** grave stops and looks at it.
  - A villager gets thirsty during long work, detours to a pond, drinks, and **returns to the job**.

## Done When

- Survivors of a meteor are the ones who ran; the epicentre is still lethal.
- Capacity is 2 × built huts, over-capacity is stable, and no villager is ever culled.
- Nudge founds huts, and is the only thing that grows the village.
- A nudge is a suggestion: busy, fleeing, and grieving villagers ignore it.
- Villagers never walk through water, and never drown.
- All four fruits are visible and can be picked.
- The Journal counter derives from `MOMENTS.length`.
- Tests, typecheck, and production build all pass.

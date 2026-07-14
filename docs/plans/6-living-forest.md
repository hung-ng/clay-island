# Living Forest Implementation Plan (Stage 2)

> **For agentic workers:** Implement this plan task-by-task with tests first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trees grow back somewhere new, while each kind of tree death leaves an intuitive temporary visual consequence: chopping leaves a stump, fire leaves a charred fallen log, and a meteor annihilates the tree without wooden remains.

**Architecture:** `TreeState` describes visual pose, while a private cause marker (`'chop' | 'fire' | null`) selects the correct remnant without multiplying state names. Both lightning and spreading fire share one lifecycle: the tree burns upright, then topples into a charred felled log. `World` owns removal from its registries and scene when temporary trees, abandoned huts, or scattered campfires are replaced or expire. Replacement construction uses an invisible world-owned reservation: abandoned remains persist while villagers travel, then the old materials disappear and the new site appears atomically when the first builder arrives.

**Tech Stack:** TypeScript, Three.js r185, Vitest. No new dependencies.

## Global Constraints

- Do not call `Math.random()`; all randomness goes through `RNG`.
- Pure forest placement logic stays in `src/world/forest.ts` and is tested without THREE.
- `Charring` remains the only material-color path for tree and hut fire damage.
- Only standing `sapling`, `normal`, and `burning` trees are forest population and fuel.
- Dead or dying poses (`toppling`, `felled`, `stump`) neither burn nor count toward the 13-tree cap.
- A meteor-hit tree is removed from the world immediately. The crater, particles, and ground scorch are its persistent consequence.
- A chopped stump and a fire-felled log are temporary; expired tree objects must be removed from targeting, collision/build occupancy, the Three.js scene, and the `World.trees` registry.
- An abandoned hut does not create a visible replacement site when work is selected. Its foundation stones remain while villagers travel to invisibly reserved valid ground.
- A scattered campfire follows the same rule: its displaced stones and logs remain until the first builder reaches the reserved replacement ground.
- Never remove abandoned remains before a valid new site is found. A failed placement attempt leaves the old remains and replacement opportunity intact.
- Replacement is one-for-one. Abandonment creates construction work; it does not authorize expansion up to `MAX_HUTS`.
- When no villagers remain, an abandoned hut may anchor the existing 20–30-second mercy repopulation so deferred construction cannot deadlock the village.
- Maintain `docs/architecture.md` when implementation changes.
- Do not edit `STATUS.md` unless explicitly asked.
- Do not commit unless explicitly asked.

---

## Approved Lifecycles and Timings

### Growth

```text
sapling --40s--> normal
```

- A sapling begins at 25% scale and grows its trunk, crown, and low-FX shadow together.
- Only a `normal` tree can grow fruit. Fruit lasts 60 seconds.

### Chop

```text
normal
  --axe--> toppling + visible stump
  --0.6s--> felled log + visible stump
  --30s--> log fades for 2s
  --> stump alone
  --30s--> stump fades for 2s
  --> removed
```

- The stump appears at the cut when the trunk begins to fall, not after the log disappears.
- The trunk and crown move smoothly in the fall direction; the felled trunk finishes about 0.9 metres from the root so the log lies beside the stump instead of through it.
- The crown remains attached during the 0.6-second fall and disappears when the tree becomes a felled log.
- The stump is the last visible consequence, but it is not permanent.

### Lightning and spreading fire

```text
normal or sapling
  --ignite--> burning upright
  --12s--> toppling while fully charred
  --0.6s--> charred felled log
  --30s--> log fades for 2s
  --> removed
```

- Direct lightning and fire spread call the same `Tree.ignite()` method with no split flag.
- There is no `snag` state.
- Rain during the 12-second upright burn restores the exact clean pre-fire state. A doused sapling resumes its interrupted growth rather than becoming a small `normal` tree.
- Once the 12-second burn completes and toppling begins, rain cannot reverse the death.
- A fire-caused fall never shows a stump.

### Meteor

```text
any tree state --direct meteor impact--> removed immediately
```

- The directly hit tree is neither ignited nor converted to a stump or log.
- The meteor's later area ignition may still set eligible neighboring trees alight.

### Shared visual durations

| Phase | Duration |
|---|---:|
| Sapling growth | 40s |
| Upright tree burn | 12s |
| Toppling | 0.6s |
| Felled log hold | 30s |
| Felled log fade | 2s |
| Stump-only hold | 30s |
| Stump fade | 2s |

---

## State Vocabulary and Accounting

```ts
export type TreeState =
  | 'sapling'
  | 'normal'
  | 'burning'
  | 'toppling'
  | 'felled'
  | 'stump'
```

`TreeState` is pose vocabulary. The cause is deliberately separate:

```ts
type TreeFallCause = 'chop' | 'fire' | null
```

| State | Passed to fire simulation | Counts toward `MAX_TREES` | Can parent a seed |
|---|---:|---:|---:|
| `sapling` | yes | yes | yes |
| `normal` | yes | yes | yes |
| `burning` | yes | yes | yes |
| `toppling` | no | no | no |
| `felled` | no | no | no |
| `stump` | no | no | no |

`isLiving()` and `holdsPlace()` remain separate named policies even though the approved lifecycle currently gives them the same three states. This keeps fire filtering and population accounting explicit at their call sites.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/world/charring.ts` | Capture material base colors and apply one scorch amount to every registered material. |
| `src/world/charring.test.ts` | Verify interpolation, clamping, restoration, and late material registration. |
| `src/world/forest.ts` | Own `TreeState`, `MAX_TREES`, population/fuel predicates, and pure seed placement. |
| `src/world/forest.test.ts` | Verify state accounting, survivor-based spreading, and the mercy seed. |
| `src/world/objects.ts` | Own cause-aware tree poses, visual timers, expiry/disposal, and hut charring. |
| `src/world/objects.test.ts` | Drive the tree, hut, and campfire lifecycles through public methods and `update()`. |
| `src/world/world.ts` | Bridge fire events, claim deferred construction sites, remove replaced/expired objects, reseed, and filter fuel. |
| `src/world/world.test.ts` | Verify registry removal, deferred construction claims, power outcomes, fire bridging, and reseeding. |
| `src/villagers/fsm.ts` | Offer hut/campfire construction when existing sites or abandoned remains create work. |
| `src/villagers/fsm.test.ts` | Verify deferred construction remains reachable without treating it as immediate world mutation. |
| `src/villagers/villager.ts` | Claim sites on activity entry and drive staged hut/campfire construction after arrival. |
| `src/powers/matrix.ts` | Keep meteor-on-tree as `['destroy']` and lightning-on-tree as `['ignite']`. |
| `src/powers/matrix.test.ts` | Pin the exhaustive power/target matrix. |
| `src/powers/meteor.test.ts` | Verify direct meteor impact never calls tree ignition. |
| `src/main.ts` | Drive `World.updateTrees()` and `World.reseedForest()` from the game loop. |
| `docs/architecture.md` | Document the final pose/cause model and temporary-remnant cleanup. |

---

## Task 1: One charring value for every owned material

**Files:**
- Create: `src/world/charring.ts`
- Test: `src/world/charring.test.ts`
- Modify: `src/world/objects.ts`

**Interfaces:**

```ts
export class Charring {
  constructor(materials: readonly THREE.MeshToonMaterial[])
  set(amount: number): void
  get amount(): number
  add(...materials: THREE.MeshToonMaterial[]): void
}
```

- [x] Test that amount `0` preserves each material's base color.
- [x] Test that amount `1` drives every registered material to `PALETTE.scorch`.
- [x] Test interpolation and clamping.
- [x] Test that returning to `0` exactly restores all base colors.
- [x] Test materials registered after construction.
- [x] Register every tree trunk/crown material and every hut body/door/knob material.
- [x] Run `npx vitest run src/world/charring.test.ts src/world/objects.test.ts`.

---

## Task 2: Pure forest vocabulary and reseeding

**Files:**
- Create: `src/world/forest.ts`
- Test: `src/world/forest.test.ts`
- Modify: `src/world/objects.ts`

**Interfaces:**

```ts
export const MAX_TREES = 13
export type Seedling = { x: number; z: number; state: TreeState }
export function isLiving(state: TreeState): boolean
export function holdsPlace(state: TreeState): boolean
export function seedSite(
  trees: readonly Seedling[],
  query: GroundQuery,
  groundY: (x: number, z: number) => number,
  rng: RNG,
): { x: number; z: number } | null
```

- [x] Replace the old state union with the approved six-state union; remove `snag`.
- [x] Make both `isLiving()` and `holdsPlace()` true only for `sapling`, `normal`, and `burning`.
- [x] Test that `toppling`, `felled`, and `stump` are neither fuel nor population.
- [x] Keep seed distance at 2.5–5 metres from one randomly selected eligible parent.
- [x] Keep candidates within `WALK_RADIUS - 1` and require `isBuildable()` ground.
- [x] Keep the zero-parent mercy rule: up to 60 island-wide buildable-site attempts.
- [x] Keep 24 placement attempts around a chosen parent; a failed attempt waits for the next reseed timer.
- [x] Run `npx vitest run src/world/forest.test.ts`.

---

## Task 3: Cause-aware tree lifecycle and temporary remnants

**Files:**
- Modify: `src/world/objects.ts`
- Test: `src/world/objects.test.ts`

**Public API:**

```ts
export class Tree {
  state: TreeState
  burning: boolean
  burnt: boolean
  burnTime: number
  readonly expired: boolean

  chop(): void
  ignite(): void
  extinguish(): void
  setBurnt(): void
  obliterate(): void
  update(dt: number, qt: number): void
  dispose(): void

  get living(): boolean
  get holdsPlace(): boolean
}
```

**Internal model:**

```ts
type TreeFallCause = 'chop' | 'fire' | null

private fallCause: TreeFallCause = null
private fireStarted = false
private phase = 0
private expiredValue = false
private preFireState: 'sapling' | 'normal' | null = null
private preFirePhase = 0
```

- [x] Name the visual groups/meshes `tree-trunk`, `tree-crown`, and `tree-stump` so tests can assert visibility.
- [x] Write a test that `chop()` enters `toppling`, records the chop path, and reveals the stump immediately.
- [x] Write a test that chopping produces a felled log after 0.6 seconds, a stump after the 30+2-second log phase, and expiry after the 30+2-second stump phase.
- [x] Write a test that `ignite()` leaves the tree upright in `burning` regardless of caller.
- [x] Write a test that `setBurnt()` changes an upright burning tree to fire-caused `toppling`, never `snag`.
- [x] Write a test that the fire-caused toppling tree becomes a charred felled log with no stump, then expires after 30+2 seconds.
- [x] Write a test that extinguishing restores `normal`, clears scorch, and resets the fire timer.
- [x] Write a test that extinguishing a burning sapling restores `sapling` with its interrupted growth progress.
- [x] Write a test that `obliterate()` expires the tree immediately without entering `stump` or `felled`.
- [x] Make `chop()` accept only `normal`; dying, burning, and dead poses ignore another chop.
- [x] Make `ignite()` accept only `sapling` or `normal`, while still supporting FireSystem's pre-marked `burning = true` bridge through `fireStarted`.
- [x] Make `setBurnt()` valid only from upright `burning`; it sets full char, records cause `fire`, and begins toppling.
- [x] During chop-caused `toppling` and `felled`, show both the stump and the falling/felled trunk.
- [x] During fire-caused `toppling` and `felled`, never show the stump.
- [x] At the end of a chop-caused felled phase, hide the trunk and enter `stump`; fade the stump after its hold.
- [x] At the end of a fire-caused felled phase, mark the tree expired immediately after the log fade.
- [x] `obliterate()` marks the tree expired and hides its group immediately.
- [x] `dispose()` releases every geometry and material below the tree group.
- [x] Run `npx vitest run src/world/objects.test.ts`.

---

## Task 4: Honest hut charring and deferred hut replacement

**Files:**
- Modify: `src/world/objects.ts`
- Test: `src/world/objects.test.ts`
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`
- Modify: `src/villagers/villager.ts`
- Modify: `src/villagers/fsm.ts`
- Test: `src/villagers/fsm.test.ts`

The hut state union remains:

```ts
export type HutState = 'site' | 'building' | 'built' | 'burning' | 'ruin' | 'abandoned'
```

- [x] Keep `site → building → built`, `built → burning → ruin`, and `ruin → building` behavior unchanged.
- [x] Register the body, door, and roof knob with one `Charring` instance.
- [x] Drive charring at 0.5 per second while burning.
- [x] Keep hut burn duration at 16 seconds in `FIRE_CONFIG`.
- [x] Extinguishing returns the hut to clean `built` immediately.
- [x] The first rebuild tick clears full scorch and advances progress by 0.34.
- [x] Three total work ticks complete a hut.
- [x] Add `Hut.dispose()` so a claimed abandoned foundation can leave the registry and scene without leaking geometry or materials.
- [x] Change `relocateDrownedRuins()` to set an invalid ruin to `abandoned` without creating a replacement `site`.
- [x] Keep an abandoned hut's five foundation stones visible while it waits for a villager commitment.
- [x] Expose a world query that reports hut work when either an existing `site`/`building` or an `abandoned` hut exists.
- [x] When a villager enters `buildHut`, first use an existing `site`/`building`; otherwise attempt to find valid ground for one abandoned hut.
- [x] If no valid ground exists, keep the abandoned hut unchanged and return the villager to `wander`.
- [x] If valid ground exists, remove and dispose exactly one abandoned hut, create exactly one `site`, and give it to the committing villager as the target.
- [x] The `site` remains visible while the villager walks to it. The first work tick changes it to `building`, and three total ticks complete it.
- [x] Allow multiple villagers to work on the same claimed site rather than creating multiple replacements for one abandoned hut.
- [x] Keep normal ruin rebuilding a hard FSM priority; deferred replacement of an abandoned hut remains a weighted `buildHut` activity.
- [x] When living population is zero and no usable hut remains, allow an abandoned hut to anchor mercy repopulation. The arriving villager can then commit to the deferred replacement.
- [x] Run the hut tests in `npx vitest run src/world/objects.test.ts`.

---

## Task 5: Explicit campfire construction and deferred replacement

**Files:**
- Modify: `src/world/objects.ts`
- Test: `src/world/objects.test.ts`
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`
- Modify: `src/villagers/villager.ts`
- Modify: `src/villagers/fsm.ts`
- Test: `src/villagers/fsm.test.ts`

**State vocabulary:**

```ts
export type CampfireState = 'site' | 'building' | 'lit' | 'doused' | 'scattered'
```

- [x] Replace the independent public `lit`/`scattered` mutation model with an explicit `CampfireState`; retain read-only `lit` and `scattered` getters for existing consumers.
- [x] Construct the initial campfire in `lit`.
- [x] `site` shows the six-stone ring but hides the logs, flames, and light.
- [x] `building` keeps the stones visible and grows the crossed logs continuously from zero to full scale.
- [x] `lit` shows full stones, logs, flames, and eligible fire light.
- [x] `doused` shows the intact stones and logs with no flames or light.
- [x] `scattered` keeps the existing displaced-stone and displaced-log wreckage until replacement is claimed.
- [x] Add `Campfire.buildTick(amount: number)`; the first positive tick changes `site` to `building`, accumulates clamped progress, and changes to `lit` at progress 1.
- [x] Keep total construction work at 2.5 seconds for one villager by applying `dt / 2.5` per simulation update. Multiple builders may accelerate the shared progress.
- [x] Keep relighting an intact `doused` campfire as a 2.5-second action in place; it does not create a site or enter `building`.
- [x] When a villager enters `makeFire` for a missing or `scattered` campfire, find valid ground before removing anything.
- [x] If placement fails, keep the scattered wreckage and return the villager to `wander`.
- [x] If placement succeeds, remove and dispose the old scattered campfire, create a new `site`, and make it the villager's target.
- [x] The new site remains visible during travel; arrival begins the continuous `building` stage.
- [x] Other villagers may target the same `site`/`building`, but they must not create duplicate campfires.
- [x] Keep `needsFire()` true for `site`, `building`, `doused`, `scattered`, or a missing campfire, and false only for `lit`.
- [x] Test every state's visible stones/logs/flames and the continuous construction transition.
- [x] Run `npx vitest run src/world/objects.test.ts src/world/world.test.ts src/villagers/fsm.test.ts`.

---

## Task 6: World-owned tree removal, fire bridging, and reseeding

**Files:**
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`

**New world API:**

```ts
updateTrees(dt: number, qt: number): void
```

- [x] Write a test that `updateTrees()` removes an expired fire-felled tree from `World.trees`, removes its group from the island, and disposes its resources.
- [x] Write a test that `updateTrees()` removes an expired chopped stump by the same path.
- [x] Add one private `removeTree(tree: Tree)` helper used by lifecycle expiry and meteor destruction.
- [x] `updateTrees()` updates every tree, then removes every tree whose `expired` getter is true.
- [x] Change direct tree lightning to call `tree.ignite()` with no split flag; direct and spread ignition must both leave the tree in upright `burning`.
- [x] Change direct meteor destruction to call `tree.obliterate()` and `removeTree(tree)` immediately.
- [x] Assert that a meteor-hit tree is absent from `World.trees` and never enters `stump`.
- [x] Keep meteor-on-tree matrix behavior as `['destroy']`; nearby blast fire remains a separate `igniteNear()` step.
- [x] Filter tree flammables through `tree.living`, which now excludes all falling and remnant poses.
- [x] Count only `tree.holdsPlace` toward `MAX_TREES`.
- [x] Keep reseeding delay at 25–40 seconds while under the cap.
- [x] Verify a chopped stump does not count toward the cap and is not fuel while it remains visible.
- [x] Verify complete removal frees its former location from `groundQuery().occupied`.
- [x] Run `npx vitest run src/world/world.test.ts src/world/fire.test.ts`.

---

## Task 7: Power matrix, game loop, and documentation

**Files:**
- Modify: `src/powers/matrix.ts`
- Modify: `src/powers/matrix.test.ts`
- Modify: `src/powers/meteor.test.ts`
- Modify: `src/main.ts`
- Modify: `docs/architecture.md`

- [x] Keep `meteor.tree` equal to `['destroy']`.
- [x] Keep `lightning.tree` equal to `['ignite']`, now sharing the upright-fire path with spread.
- [x] Keep the meteor test asserting that direct impact calls `destroyTarget()` and never `igniteTarget()`.
- [x] Replace the direct `for (const tree) tree.update(...)` render-loop call with `world.updateTrees(dt, clock.quantizedTime)` so expiry cannot leave invisible registry entries.
- [x] Keep `world.reseedForest(dt, rng, lowFx)` on the fixed simulation step.
- [x] Update `docs/architecture.md` to remove `snag` and permanent-stump claims, document the pose/cause split, and document world-owned disposal.
- [x] Document villager-committed hut and campfire sites, abandoned-remains disposal, explicit `CampfireState`, and the 2.5-second campfire build.
- [x] Do not edit `STATUS.md`.

---

## Task 8: Offset felled logs and reveal replacement sites on arrival

**Files:**
- Modify: `src/world/objects.ts`
- Test: `src/world/objects.test.ts`
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`
- Modify: `docs/architecture.md`

**World API:**

```ts
claimBuildSite(rng: RNG, lowFx?: boolean): Hut | null
commitBuildSite(site: Hut): boolean
claimCampfireSite(rng: RNG, lowFx?: boolean): Campfire | null
commitCampfireSite(site: Campfire): boolean
isCampfireBuildTarget(site: Campfire): boolean
```

- [x] **Step 1: Pin the felled-log placement.** Add an object test that advances a chopped tree through toppling and asserts that `tree-trunk.position.x` changes continuously and finishes about `0.9` metres from `tree-stump.position.x`.
- [x] **Step 2: Verify the tree test fails.** Run `npx vitest run src/world/objects.test.ts`; expect the new separation assertion to fail because the trunk currently remains at local `x = 0`.
- [x] **Step 3: Animate the offset.** During the existing 0.6-second toppling phase, apply the same eased fall progress to a `0.9`-metre trunk offset and move the attached crown farther along the same local direction. Preserve the final offsets in `felled` for both chop- and fire-caused falls.
- [x] **Step 4: Pin invisible hut and campfire reservations.** Change the world tests so `claimBuildSite()` and `claimCampfireSite()` return hidden targets without removing old remains, adding the target to the registry, or adding its group to the scene. Assert that `commitBuildSite()` and `commitCampfireSite()` perform the atomic old-remains removal/new-site reveal.
- [x] **Step 5: Cover reservation failure and sharing.** Test that repeated claims share one hidden target, that pending hut/campfire targets appear in placement occupancy, and that a site invalidated before arrival is disposed while the old remains stay visible.
- [x] **Step 6: Verify the world tests fail.** Run `npx vitest run src/world/world.test.ts`; expect immediate-removal assertions or missing commit APIs to fail.
- [x] **Step 7: Implement two-phase world claims.** Store one private pending hut reservation and one private pending campfire reservation. Include their hidden site objects in placement occupancy, return the same target to additional builders, revalidate ground on commit while excluding the reservation itself, and only then dispose old remains and add the new site to its registry and scene.
- [x] **Step 8: Commit on villager arrival.** Let villagers walk toward hidden reserved objects. Immediately before the first hut work tick or campfire `buildTick(dt / 2.5)`, call the corresponding commit method; abandon the activity if revalidation fails. Existing visible sites/buildings and intact doused campfires keep their current behavior.
- [x] **Step 9: Update architecture and verify.** Document the smooth felled-log offset and two-phase invisible reservations, then run `npm test`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.

---

## Verification

- [x] `npx vitest run src/world/charring.test.ts src/world/forest.test.ts src/world/objects.test.ts src/world/world.test.ts src/world/fire.test.ts src/powers/matrix.test.ts src/powers/meteor.test.ts`
- [x] `npm test`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [ ] Manually verify in the browser:
  - A chopped tree reveals a stump at the instant the trunk starts falling.
  - The felled log lies beside the stump instead of intersecting it.
  - Its log fades first; its stump remains for another 30 seconds and then fades.
  - Lightning and spreading fire both burn a tree upright for 12 seconds.
  - A burned-out tree falls as a fully charred tree, becomes a charred log, and disappears without a stump.
  - A direct meteor removes the tree immediately and leaves only meteor effects.
  - Rain restores an upright burning tree, including a partially grown sapling.
  - Expired trees no longer block targeting, construction, or reseeding.
  - An invalid hut ruin remains as abandoned stones while a villager walks to reserved replacement ground.
  - A scattered campfire remains visible while a villager walks to reserved replacement ground.
  - The new site appears only when the first builder arrives and begins work.
  - Old hut/campfire remains disappear exactly when the new site appears.
  - Hut sites use three work ticks; campfire sites use a continuous 2.5-second building animation.
  - Failed placement leaves the abandoned remains intact and retryable.

## Done When

- `snag` no longer exists in code, tests, or architecture documentation.
- Direct lightning and spreading fire have one identical tree lifecycle.
- Fire burns upright for 12 seconds before the tree falls.
- Chopping displays a stump from the moment of the cut through a temporary stump-only phase.
- Fire-felled trees never show a stump.
- Direct meteor impact leaves no wooden remnant.
- Temporary logs and stumps are removed cleanly from the scene and all world queries.
- Forest reseeding still reaches a cap of 13 on valid ground near surviving trees, with a zero-tree mercy seed.
- Hut charring and ordinary ruin rebuilding remain correct.
- Abandoned huts and scattered campfires keep their remains visible while builders travel; replacement sites appear only on builder arrival.
- Old remains are disposed only after valid replacement ground is secured.
- Campfires visibly progress through `site → building → lit`; intact doused campfires are relit in place.
- Focused tests, full tests, typecheck, and production build all pass.

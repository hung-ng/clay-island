# The Living Forest (Stage 2)

Stage 2 of `2026-07-13-honest-world-design.md`. Stage 1 made the ground true; this
makes the forest true.

One idea:

> **A tree that dies stays dead. The forest recovers by growing somewhere else.**

Today every tree state is the same visual trick — scale the crown down — so a
growing tree and a chopped tree are indistinguishable, and a chopped tree quietly
regrows in place after two minutes as though nothing happened. The island has no
memory. This stage gives it one.

Fixes defects 1, 2, 7, 8 and 9 of the honest-world spec.

---

## 1. What is wrong now

| # | Defect | Cause |
|---|---|---|
| 1 | A chopped tree is a full-height trunk with a shrunken bush, and its shadow never changes. | `Tree.chop()` only scales `crown` to 0.15. `addBlobShadow` bakes a constant radius in at construction. |
| 2 | Growth is invisible — a growing tree looks exactly like a chopped one. | Both are "crown scaled down"; `update()` lerps the same crown scale for `chopped` and `burnt`. |
| 7 | A rebuilt hut stays charcoal-black forever. | `Hut.buildTick()` never restores `base.material.color`. Only `extinguish()` does. |
| 8 | A burning hut has a charred body and a cheerful clay roof knob. | Only `base` is scorched. `door` and `roofKnob` are separate materials that never char. |
| 9 | A meteor on a tree both ignites *and* destroys it. | `MATRIX.meteor.tree = ['ignite', 'destroy']` — set alight *and* instantly incinerated. |

Defects 7 and 8 are the same defect: scorch colour is applied ad hoc, per material,
per state, so some materials are missed and some states leak a stale colour.

---

## 2. Trees have a life

`TreeState` becomes a real lifecycle. Trunk and crown are controlled separately,
which is what makes the states distinguishable at a glance.

```ts
export type TreeState =
  | 'sapling'   // thin trunk, small crown, both inflating
  | 'normal'    // full
  | 'toppling'  // trunk rotating down, ~0.6s
  | 'felled'    // lying on the grass as a log, ~30s, then fades
  | 'stump'     // short and jagged, no crown. PERMANENT.
  | 'burning'   // charring, still standing
  | 'snag'      // charred trunk, no crown, still standing — topples in time
```

| State | Trunk | Crown | Blob shadow |
|---|---|---|---|
| `sapling` → `normal` | thin, thickening | small, inflating | grows with it |
| `normal` | full | full | full (r ≈ 1.05) |
| `toppling` | rotating down | rotating with it | full |
| `felled` | lying on the ground | gone | long, under the log |
| `stump` | short, jagged | **none** | small (r ≈ 0.35) |
| `burning` | charring | charring | full |
| `snag` | charred, standing | **none** | narrow (r ≈ 0.5) |

The crown is **removed**, not scaled to 0.15. That removal is what makes the state
honest: a stump has no crown at all, so it can never be confused with a sapling,
which has a small one.

### 2.1 Chopping

The villager swings — the existing four-frame chop, unchanged. Then:

1. The tree enters `toppling`. The whole trunk rotates down over ~0.6s, with a
   thump at the end.
2. It lies as a `felled` log for ~30s, then fades out (material opacity → 0).
3. A **permanent `stump`** remains at the spot.

### 2.2 Burning

A burning tree chars (see §3), and when the fire consumes it, it becomes a `snag`:
a charred standing trunk with no crown. The snag topples in its own time, through
the same `toppling` → `felled` → `stump` path.

A tree ignited by **lightning** is the exception, and the one place the two powers
differ on trees: the strike **splits** it, so it enters `toppling` at once and burns
on the ground rather than standing as a snag. Fire that reaches a tree by *spread*
(from a burning neighbour) leaves it standing to become a snag, as above. A direct
strike fells; a spreading fire consumes.

### 2.3 The shadow tracks the tree

`addBlobShadow(group, radius, lowFx)` currently bakes the radius in at
construction, so a chopped tree keeps a full-size shadow forever. The tree keeps a
handle to its shadow and resizes it as the state changes. The shadow becomes a
property of the tree's real size, not a constant.

---

## 3. `Charring` — one value, every material

Both `Tree` and `Hut` get a single **`charAmount` (0–1)**, which is the *only* thing
that drives scorch colour, applied to **every** material the object owns.

Extracted into a small shared helper, because the bug came from duplicating this
logic per class and per material:

```ts
/** One scorch value driving every material an object owns. */
export class Charring {
  /** Captures each material's base colour at construction. */
  constructor(materials: readonly THREE.MeshToonMaterial[])
  /** 0 = pristine, 1 = fully scorched. Applied to ALL registered materials. */
  set(amount: number): void
  get amount(): number
}
```

- Burning raises it.
- Extinguishing lowers it.
- **Rebuilding drives it to 0.**

The hut registers `base`, `door` **and** `roofKnob` — the door and knob currently
never char at all. The tree registers its crown materials **and** its trunk
material, which it needs now that the trunk is separately controlled.

One value, one code path. No state can leak a stale colour. This fixes defect 7
(rebuilt huts stay black) and defect 8 (cheerful roof knob on a burning hut) at the
class level rather than patching each escape.

It also earns its keep structurally: `objects.ts` is already 999 lines, and this
moves char logic out of both classes.

---

## 4. The forest reseeds and drifts

**Trees no longer regrow in place.** The forest recovers by sprouting saplings
*near surviving trees*, which is what makes forests move.

A new pure module, `src/world/forest.ts`:

```ts
export const MAX_TREES = 13

/** Where the next sapling should sprout, or null if there is nowhere good. */
export function seedSite(
  trees: readonly { x: number; z: number; state: TreeState }[],
  query: GroundQuery,
  groundY: (x: number, z: number) => number,
  rng: RNG,
): { x: number; z: number } | null
```

The rule:

1. Pick a random **standing** tree — one that `holdsPlace` (see §5.2). A tree mid-fall
   sows nothing, and neither does a stump.
2. Try points **2.5–5m** from it, gated by Stage 1's `isBuildable`, so a sapling
   never sprouts in a lake, in a crater, off the island, or on top of a hut.
3. If **nothing is left standing**, fall back to any buildable spot on the island —
   the **mercy rule**. Total deforestation is recoverable, but slow.

`World.reseedForest(dt, rng, lowFx)` runs this on a **25–40s timer** whenever the
count of trees that `holdsPlace` is below **13**. Stumps and snags do **not** count
toward the cap: they are scenery, not forest. It is called from the game loop beside
`repopulate` and `relocateDrownedRuins`.

The consequence is the point of the whole stage: **forests move.** Clear the north
woods and they creep back from the south, growing around your stumps. The island
keeps a memory of what you did to it.

Two existing call sites already agree with this and need **no change**:
`World.choppableTree()` and the FSM's `hasTree` both test `state === 'normal'`, so
villagers already decline to chop saplings and stumps. And `scatter()` seeds 12
trees against a cap of 13 — the island deliberately starts one below cap, so a
thirteenth grows in on its own early on. That is intended, not an off-by-one.

---

## 5. Power × target, corrected

|  | Now | After |
|---|---|---|
| **Meteor on tree** | `['ignite', 'destroy']` — lit *and* incinerated, incoherent | **`['destroy']` — obliterated.** Splinter burst, no fire. A **stump** remains, like any other dead tree. Neighbours still catch fire from the blast radius, as they already do. |
| **Lightning on tree** | `['ignite']` — the crown slowly turns orange | **`['ignite']`, but ignite now splits and topples it burning.** The trunk goes over and burns on the ground. |

A meteor annihilates what it lands on. Fire is what happens to the neighbours.

`destroyTarget('tree', …)` stops calling `setBurnt()` and calls a new
`Tree.obliterate()`, which goes straight to `stump` with a splinter burst.

Telling a strike from a spreading fire needs one flag, not a new state:
`Tree.ignite(split = false)`. `igniteTarget` — the direct-hit path, which lightning
uses — passes `true`, so the tree topples as it burns. `igniteNear` (the blast) and
`FireSystem`'s spread events pass nothing, so those trees stand and burn into snags.
`Hut.ignite()` is unaffected.

### 5.1 Dead wood does not burn

`FireSystem` mutates `item.burning` **directly** on the flammable and only then does
`World.updateFire` call `object.ignite()` — so `ignite()` must keep its early-return
when already burning, and the `split` flag must be decided by the *caller*. It can
never be inferred inside `Tree`.

This also means **`World.flammables()` must stop passing every tree.** It currently
passes all of them; once trees can be dead, only the living ones may burn:

```ts
// Only a living tree is fuel. A stump, a felled log and a snag are not.
...this.trees.filter(tree => tree.living)
```

Without this, a `stump` reports `burning: false, burnt: false` — `healthy()` by
`fire.ts`'s test — and a clearing full of stumps becomes a tinderbox. The hut list is
already filtered this way (`state === 'built' | 'burning' | 'ruin'`); trees now need
the same treatment.

`Tree.burnt` must be `true` for `snag`, `felled` and `stump`, so a tree that leaves
the fuel list mid-burn cannot be re-ignited by a lingering spread event in the same
frame.

### 5.2 Two predicates, not one

"Is it fuel" and "does it count against the 13-tree cap" look like the same question
and are not. They differ on exactly one state — `toppling` — and conflating them is
a real bug:

| | `sapling` | `normal` | `burning` | `toppling` | `felled` | `stump` | `snag` |
|---|---|---|---|---|---|---|---|
| `isLiving` — is it fuel? | ✓ | ✓ | ✓ | **✓** | ✗ | ✗ | ✗ |
| `holdsPlace` — does it count? | ✓ | ✓ | ✓ | **✗** | ✗ | ✗ | ✗ |

A **lightning split leaves a tree both `toppling` and `burning`.** If `toppling` were
not fuel, that tree would drop out of `flammables()` mid-fall and its fire would
never resolve — it would lie on the grass burning forever. But it is also on its way
out, so the forest should be free to seed its replacement now rather than waiting out
its 30-second log.

Both live in `forest.ts`, so the fuel rule and the population rule cannot drift apart.

`matrix.test.ts` pins `tree: ['ignite', 'destroy']`. That assertion exists precisely
to make this a conscious change, and **must be updated to `['destroy']`**.

---

## 6. Explicitly out of scope

- **No resources.** Chopping still produces no wood; there is no inventory.
- **No fire spreading through grass.** Fire remains a per-object system.
- **Stumps never re-sprout.** A dead tree stays dead in that spot. Recovery is
  reseeding, not healing.
- **No change to the villager FSM.** `chopTree` keeps its existing four-frame swing;
  only what the tree *does* in response changes.

---

## 7. Testing

- `forest.ts` is pure and unit-tested directly: the cap is respected, seeds land
  near a parent, never on bad ground, the mercy sapling appears at zero trees, and
  the whole thing is deterministic under `RNG`.
- `Charring` is arithmetic over a material list, tested with stub materials.
- The `Tree` state machine's timings — topple ~0.6s, felled ~30s, growth ~40s — are
  tested by driving `update(dt, qt)` with `vi.fn()` stubs, as `world.test.ts`
  already does. No real `Island`, no real THREE scene.
- All randomness goes through `RNG` (`src/core/rng.ts`). Never `Math.random()`.
- The 190 existing tests must stay green, except `matrix.test.ts`'s meteor-on-tree
  assertion, whose change is the deliberate fix for defect 9.

---

## 8. Done when

- A chopped tree **topples**, lies as a log, fades, and leaves a **permanent stump**
  with a small shadow.
- A **sapling** is visibly a sapling: thin trunk, small crown, both growing.
- A rebuilt hut is **clay-coloured**, and a burning hut's door and roof knob **char
  with the rest of it**.
- A meteor on a tree **obliterates** it — splinters, no fire, a stump left behind.
- Clearing one side of the island lets the forest **creep back from the other**,
  growing around the stumps.
- `npm test` green, `npx tsc --noEmit` clean, `npm run build` succeeds.
- Stage 3 (the people) remains untouched and unblocked.

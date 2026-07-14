# The Honest World

A redesign of the game's interactions, built on one idea:

> **Make the ground true, and make everything obey it.**

Nearly every defect below is the same defect — an object ignoring the terrain it
stands on. Huts rebuild inside lakes because nothing asks the ground whether it is
dry. Ponds clip through each other because each crater owns a private water
surface. Chopped trees keep a full-size shadow because the shadow is a constant.
Fix the ground, and most of the list follows.

The game stays a toy: no resources, no economy, no menus. The player is weather
and suggestion, never a foreman.

---

## 1. Current defects

Verified against the code, not assumed.

| # | Defect | Cause |
|---|---|---|
| 1 | A chopped tree is a full-height trunk with a shrunken bush, and its shadow never changes. | `Tree.chop()` (`objects.ts:244`) only scales the crown to 0.15. `addBlobShadow` uses a fixed radius. |
| 2 | Tree growth is invisible — a growing tree is indistinguishable from a chopped one. | Both are "crown scaled down." `update()` lerps the same crown scale for `chopped` and `burnt`. |
| 3 | Two overlapping meteors make two clipping water discs at different heights. | `fillCratersNear` (`world.ts:219`) creates one `Pond` per crater, each a flat `CircleGeometry` at `depth * 0.48`. |
| 4 | Huts rebuild in place — including inside a pond. Exactly 3, forever. | `placeSites` fixes 3 huts at startup; `Hut.setRuin()` preserves x/z; nothing consults the ground. |
| 5 | Once scattered, the campfire is gone forever. | `Campfire` is a singleton (`world.campfire`); `scattered = true` permanently blocks `ignite()`/`flare()`. |
| 6 | Villagers stand still and stare while a meteor falls on them. | `Meteor.cast` calls `warnNear` → `lookUp()`, a 1.2s performance that returns early from `update()`, overriding the flee that `alarmNear` just set. |
| 7 | A rebuilt hut stays charcoal-black forever. | `Hut.buildTick()` never restores `base.material.color`. Only `extinguish()` does. |
| 8 | A burning hut has a charred body and a cheerful clay roof knob. | Only `base` is scorched. `door` and `roofKnob` are separate materials that never char. |
| 9 | A meteor on a tree both ignites *and* destroys it. | `MATRIX.meteor.tree = ['ignite', 'destroy']` — incoherent: set alight *and* instantly incinerated. |
| 10 | Huts have no relationship to population. | `World.repopulate` caps at 6 and needs only one built hut. Huts are respawn points, not homes. |

---

## 2. The world

### 2.1 Terrain becomes queryable

A new module, `src/world/terrain.ts`, owns the questions everything else needs to
ask. It is the single source of truth about the ground.

```ts
waterLevelAt(x, z): number | null   // water surface height here, or null if dry
isSubmerged(x, z): boolean          // is the ground below the water?
isBuildable(x, z): boolean          // dry, on-island, not in a crater bowl,
                                    // not too steep, clear of other objects
```

`isBuildable` is the gate. Huts, campfires, saplings and fishing spots all pass
through it. "Don't rebuild in the lake" becomes one call, not special-cased logic
in three places.

### 2.2 Craters merge into basins

`Pond[]` is replaced by `Basin[]`. A basin is a **connected group of overlapping
craters sharing one water level** — the lowest point on the merged rim.

Its surface is built from the actual terrain grid: every vertex whose height is
below the water level is submerged. It is not a disc. A lake is the shape of the
hole that was dug.

```
NOW:     disc A  ─────           (y = -0.62)
         disc B    ─────         (y = -0.71)   ← intersecting pancakes

AFTER:   ───────────────         one surface, one height
         \_____   _____/         terrain below it is water
               \_/
```

This makes the terrain loop work:

- **Meteor on ground** → crater.
- **Rain over craters** → they flood. Adjacent craters merge into one lake.
- **Meteor into a lake** → steam burst; the basin is blown open and drains; the
  terrain is re-cratered deeper.
- **Rain again** → refills, larger.

Fish settle only in water left undisturbed for a while, so a lake that keeps being
bombed never becomes a fishery.

---

## 3. The forest

### 3.1 Trees have a life

Trunk and crown become separately controlled, and the states become honest.

| State | Trunk | Crown | Shadow |
|---|---|---|---|
| `sapling` → `growing` | thin, thickening | small, inflating | grows with it |
| `normal` | full | full | full (r ≈ 1.05) |
| `felled` | lying on the ground | gone | long, from the fallen log |
| `stump` | short, jagged | **none** | small (r ≈ 0.35) |
| `burning` | charring | charring | full |
| `snag` (burnt) | charred, standing | gone | full |

The blob shadow becomes a property tracking the tree's real size, not a constant.

**Chopping:** the villager swings, the trunk **topples** — rotating down over
~0.6s with a thump — and lies on the ground as a felled log for ~30s before fading
into the grass. A **permanent stump** remains at the spot.

**Burning:** the tree becomes a charred **snag**, which eventually topples too.

A tree that dies stays dead in that spot. Stumps are scenery — clay markers of
what has been done to the island.

### 3.2 The forest reseeds and drifts

Saplings sprout **near surviving trees** (a few metres from a healthy one, on
`isBuildable` ground) and grow visibly. Population is capped around **13**, with a
mercy rule: even at zero trees, a lone sapling eventually appears, so total
deforestation is recoverable but slow.

The consequence is that **forests move**. Clear the north woods and they creep back
from the south, growing around your stumps. The island keeps a memory of what you
did to it.

---

## 4. The village

### 4.1 Huts are homes

Population is gated by housing:

> **Capacity = 2 × (built huts).** Cap: **6 huts / 12 villagers.**

At rest that is 3 huts and 6 villagers — today's game, unchanged. It diverges only
under player action, which is the point:

| Event | Consequence |
|---|---|
| A hut is destroyed or abandoned | Capacity falls. Growth stalls until it is rebuilt. **Nobody dies.** |
| It is rebuilt | Capacity returns; villagers arrive again. |
| Nudge open ground, all huts full | A **new** hut. Capacity rises. The village genuinely grows. |
| Every hut destroyed | Capacity 0. Survivors linger and eventually rebuild one on their own. Bleak, recoverable, honest. |

**Over-capacity is a legal, stable state.** If huts are destroyed (or abandoned to a
flood) while villagers live, the population may exceed capacity. Nothing is culled
and nobody is evicted — the village is simply *crowded*, and **no new villagers
arrive until capacity again exceeds the living population**. The only thing that
ever removes a villager is the player.

A new villager arrives when `living < capacity`, on the existing 20–30s timer,
emerging from a built hut.

This replaces the current rule, under which huts are merely respawn points and a
population of zero respawns from a ruin.

### 4.2 Buildings respect the ground

A ruin whose ground has become a crater or a lake is **abandoned**. It remains as a
sunken monument, and the villagers choose a new valid site near the village and
build there instead. **The village drifts as it is bombed.**

### 4.3 The campfire is no longer a singleton

If the fire has been out or scattered for ~30s, a villager enters a new `makeFire`
state, walks to a valid dry spot near the huts, and builds a new one. The world
heals itself, exactly as it already does for huts.

---

## 5. The villagers

### 5.1 They flee meteors

Behaviour is decided by distance from the impact:

```
        blast (r < 4.5)        safe (r 4.5 – 9)
  t=0   quick glance up        stop, look up, point
  t=.25 SPRINT away            keep watching
  t=1.2 impact                 flinch / cower
```

Survivors are the ones who ran. Villagers outside the blast keep the existing
sky-watching pose, because they are safe and curious.

This is an ordering fix: `lookUp`'s performance currently overrides the flee that
`alarmNear` sets on the same tick.

### 5.2 They use the world

Small behaviours that make the sim feel observed rather than scripted:

- Drink at a pond.
- Shelter under a tree when it rains, if one is nearer than a hut (instead of the
  leaf hat).
- Gather at the fire when it is out.

### 5.3 Only the player kills them

Villagers are immortal except to meteor and lightning. **Every grave on the island
is one you made.** No fire death, no drowning, no old age.

---

## 6. Power × target, corrected

|  | Tree | Hut |
|---|---|---|
| **Meteor** | **Obliterate.** Splinters, no fire. Neighbours catch fire from the blast, as they already do. (Replaces the incoherent `ignite`+`destroy`.) | Flattened to a ruin. |
| **Lightning** | **Splits and topples it, burning.** Replaces "slowly turns orange." | Ignites; fire spreads down; ruins it unless rain saves it. |

A meteor annihilates what it lands on. Fire is what happens to the neighbours.

---

## 7. The char bug, fixed at the class level

Both `Tree` and `Hut` get a single **`charAmount` (0–1)** which is the *only* thing
that drives scorch colour, applied to **every** material the object owns — including
the hut's door and roof knob, which currently never char at all.

- Burning raises it.
- Extinguishing lowers it.
- **Rebuilding drives it to 0.**

One value, one code path. No state can leak a stale colour. This fixes both defect
7 (rebuilt huts stay black) and defect 8 (cheerful roof knob on a burning hut).

---

## 8. Nudge — the fourth power

A divine finger-poke. It occupies a new `PowerId` row in the existing
`PowerId × TargetKind` matrix, so it reuses the drag-targeting, reticle and keyboard
paths with no new input system.

| Nudge on… | They tend to… |
|---|---|
| **Tree** | go chop it |
| **Pond** | go fish there |
| **Ruin / site** | build there |
| **Ground** | **tend to this spot** — see the resolution order below |
| **Villager** | startle them |

**Ground-nudge has one meaning — *tend to this spot* — and the village's own needs
decide the outcome.** It never asks the player to learn a mode or pick from a menu.
The spot must be `isBuildable`; if it is not, the nudge resolves to *gather*.

Resolution order, first match wins:

1. **No campfire** (none exists, or it is scattered/out) → **build the campfire here.**
2. **Housing is full** (`living >= capacity`) **and** `huts < 6` → **build a hut here.**
3. Otherwise → **gather here.**

Rule 2 is the growth valve. Villagers found a new home only when the existing ones
are full — so a village you have been kind to expands, while a half-empty one just
gathers where you pointed. It is not circular with §4.1: capacity is *created* by
huts, and the test for founding one is a *population* test.

**It is a suggestion, never a command.** It biases the next FSM decision of the one
or two nearest **idle** villagers. A villager who is fleeing, mourning or busy will
ignore it. The player is a god making a suggestion, not a foreman issuing an order.

Short cooldown, no cost.

---

## 9. Explicitly out of scope

Cut to keep this "a fun small real-world sim":

- **No resources.** Chopping produces no wood; there is no inventory, no counters.
- **No fire spreading through grass.** Fire remains a per-object system.
- **No natural death.** No starvation, drowning, or old age.
- **No build menu.** Ground-nudge resolves intent from the village's needs.

---

## 10. Delivery

Three independently playable stages.

**Stage 1 — Honest ground**
Terrain queries (`terrain.ts`); crater→basin merging with a single water level;
`isBuildable` gating; hut relocation away from bad ground; the self-rebuilding
campfire. *Fixes defects 3, 4, 5.*

**Stage 2 — The living forest**
Tree lifecycle (sapling → normal → felled/snag → stump); toppling; correct shadows;
reseeding and drift; the `charAmount` fix; corrected meteor/lightning on trees.
*Fixes defects 1, 2, 7, 8, 9.*

**Stage 3 — The people**
Meteor panic ordering; housing-capped population; world-use behaviours; the Nudge
power. *Fixes defects 6, 10.*

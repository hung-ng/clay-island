# The People — Stage 3

Stage 3 of [The Honest World](2026-07-13-honest-world-design.md). Stages 1 and 2
made the ground true and the forest alive. This stage makes the **villagers**
obey both, and gives the player one kind power.

> **Make the ground true, and make everything obey it.**

Stage 1 made terrain queryable. Stage 2 made trees obey it. Stage 3 finishes the
sentence: **the villagers obey it too.** They stop walking through lakes, they
shelter under the trees you grew, they pick the fruit you rained down, and they
run from the meteor instead of admiring it.

It also closes the loop the roadmap left open. Today nothing in the game can
found a *new* hut — `placeSites` fixes three at startup and villagers only ever
rebuild ruins. So housing capacity can only ever fall. **Nudge** is the growth
valve that makes a housing cap mean something, which is why the two ship together.

---

## 1. Defects this stage fixes

Verified against the code, not assumed.

| # | Defect | Cause |
|---|---|---|
| 6 | Villagers stand still and stare while a meteor falls on them. | `Meteor.cast` runs `alarmNear(7)` then `warnNear(4.5)`. `lookUp()` sets a 1.2s performance, and `Villager.update` early-returns from `updatePerformance()`, skipping all steering. The villagers *closest* to the impact are frozen for the entire fall. |
| 10 | Huts have no relationship to population. | `World.repopulate` caps living at 6 and needs only one built hut. Huts are respawn points, not homes. |
| 11 | **Villagers walk across ponds along the lake bed, water over their heads.** | `Villager.steer()` repels only from `world.objectsNear()` — trees, huts, campfire. Nothing consults the water. *(Not in the original roadmap; found while specifying this stage.)* |
| 12 | **Only one of a tree's four fruits is visible.** | `Tree.growFruit()` places 4 instanced fruits at fixed offsets in the crown's **local interior** (`objects.ts:399-404`). Fruits with a small radial offset are buried inside the solid crown blob. *(Not in the original roadmap.)* |

---

## 2. Villagers flee meteors (defect 6)

Behaviour is decided by distance from the impact:

```
        blast (r < 4.5)        safe (r 4.5 – 9)
  t=0    quick glance up       stop, look up, point
  t=0.25 SPRINT away           keep watching
  t=1.2  impact                flinch / cower
```

**Survivors are the ones who ran.** Villagers outside the blast keep the existing
sky-watching pose, because they are safe and curious.

### 2.1 The ordering fix

`warnNear` gains an inner radius so it warns only the **safe ring**, never the
blast. Blast-radius villagers instead get a short **startle** — a ~0.25s glance
that *hands off* to `panic()` rather than blocking `update()` for the full 1.2s.

| Ring | Before | After |
|---|---|---|
| `r < 4.5` (blast) | `lookUp()` — frozen 1.2s, dies | `startle()` → `panic()` at 0.25s — sprints |
| `r 4.5 – 9` (safe) | `panic()` — runs pointlessly | `lookUp()` — watches |

- `startle(from)` is a new short performance: a glance toward the sky, then it
  yields control. It must **not** swallow `update()` the way `lookUp()` does.
- A villager already fleeing, zapped, or mourning is not re-startled.
- The existing `cower()` sweep at impact (r ≤ 4.5) is unchanged.

**Three radii, three jobs — do not conflate them:**

| Radius | Constant | What it does |
|---|---|---|
| **3m** | `killVillagerNear(…, 3, …)` in `outcomes.ts` | **Lethal.** Kills the single nearest villager. |
| **4.5m** | `warnNear` / `cower` in `meteor.ts` | **Blast.** Who startles and sprints; who cowers at impact. |
| **9m** *(currently 7)* | `alarmNear` in `meteor.ts` | **Safe ring.** Who stops and watches the sky. |

The lethal radius is *smaller* than the blast radius, which is what makes the sprint
worth making.
### 2.2 Can they actually escape?

The flee must be able to *matter*, or the fix is theatre. Doing the arithmetic
against the current constants:

- Villager speed is `0.86`; `flee` multiplies velocity by `2.2` → **1.89 m/s**.
- The meteor falls for **1.2s**; the startle costs **0.25s** → **0.95s of sprinting**
  → about **1.8m of travel**.

So a villager standing **on the impact point cannot escape a 4.5m blast**, but one
near its edge can. This is the honest outcome and we keep it: *drop a meteor
directly on someone and they die.* What changes is that the villagers on the
fringe — who today are frozen and killed — now run and live.

If playtesting shows nobody ever survives, the lever to tune is the **startle
duration** (shorter = more escape time), not the blast radius. Do not raise the flee
speed to the point where villagers outrun a meteor from the epicentre; the player's
aim should still be lethal.

---

## 3. Huts are homes (defect 10)

Population is gated by housing:

> **Capacity = 2 × (built huts).** Cap: **6 huts / 12 villagers.**

At rest that is 3 huts and 6 villagers — today's game, unchanged. It diverges
only under player action, which is the point.

| Event | Consequence |
|---|---|
| A hut is destroyed or abandoned | Capacity falls. Growth stalls until it is rebuilt. **Nobody dies.** |
| It is rebuilt | Capacity returns; villagers arrive again. |
| Nudge open ground, all huts full | A **new** hut. Capacity rises. The village genuinely grows. |
| Every hut destroyed | Capacity 0. Survivors linger and eventually rebuild one on their own. |

### 3.1 Over-capacity is a legal, stable state

If huts are destroyed while villagers live, the population may exceed capacity.
**Nothing is culled and nobody is evicted** — the village is simply *crowded*, and
no new villagers arrive until capacity again exceeds the living population.

**The only thing that ever removes a villager is the player.** No fire death, no
drowning, no old age. Every grave on the island is one you made.

### 3.2 Rules

- `capacity()` = `2 × huts.filter(state === 'built').length`, clamped to
  `2 × MAX_HUTS` = 12.
- A villager arrives on the existing 20–30s timer only while `living < capacity`.
- The existing zero-population mercy path (`repopulationHome`) is **preserved**:
  with no villagers and no usable hut, an abandoned hut may still anchor a
  respawn, so the village cannot deadlock. Mercy repopulation is the one path
  that ignores capacity — otherwise a village bombed to zero could never return.
- Capacity is *created* by huts; the test for founding one (§5.2) is a
  *population* test. These are not circular.

---

## 4. The villagers use the world

### 4.1 Water blocks the walk (defect 11)

Villagers must stop treating a lake as a floor.

- `Villager.steer()` gains **water repulsion**, reusing the same push it already
  applies to trees and huts, with strength scaled by how deep the villager would
  be. `terrain.ts` already exports `isSubmerged(x, z, basins, groundY)` and
  `waterLevelAt` — no new terrain module is needed.
- `randomWalkPoint()` and `fleeTarget()` never select a submerged point.
- **Repulsion, not a hard wall.** A panicked villager can brush the shallows
  rather than wedging against a shoreline and grinding there. This matters
  because §2 requires a flee that cannot get cornered.
- **Nobody drowns.** Water is an obstacle, never a hazard (§3.1).

### 4.2 Real fishing

`fish` today is: walk to the shore, show a fish emote, stand there.

After: the villager **kneels at the shore facing the water**, casts a line — a thin
clay rod with a line reaching into the pond and a float resting on the surface —
and waits. On a catch, a fish comes up on the line.

- The existing `villager:fished` roll (5% per 4s tick) becomes the moment the fish
  **visibly surfaces**, so the "Gone Fishing" moment fires on something the player
  can see.
- The float rests on `waterLevelAt`, not on a constant — the same honesty the
  ponds themselves now have.
- **No swimming.** Swimming needs a whole locomotion mode (buoyancy, wading depth,
  exiting water) and a villager bobbing in a pond reads oddly against the stiff
  clay-toy style. Deferred indefinitely; §4.1 makes water something they stay out of.

### 4.3 Drink is a need, not a hobby

Drinking is **not** an idle-roll entry — that would make it a reskin of fishing
(walk to shore, play animation, idle).

Instead: a thirst timer runs during long labour (`chopTree`, `buildHut`,
`rebuild`). When it trips and a pond is reachable, the villager **detours** to the
shore, kneels, drinks (~2s), and **resumes the activity they interrupted**.

Different rhythm, different meaning: fishing is leisure, drinking is need. It makes
ponds read as infrastructure rather than scenery.

### 4.4 Shelter under a tree in the rain

`grumpAtRain()` currently walks the villager to the nearest **built hut** wearing a
leaf hat.

After: if a `normal` tree is nearer than a hut, the villager **huddles under its
crown** instead — and **drops the leaf**, because the crown is the shelter. The
leaf hat remains only when neither a tree nor a hut is near.

This makes the trees you grew into useful objects, not scenery.

### 4.5 Gather at the dead fire

`huddleAtCampfire()` already tightens the sit radius after a death.

Extend it: when the campfire is `doused` or `scattered`, idle villagers **drift
toward it and mill about** while one of them goes to rebuild it. The campfire reads
as the village's heart, and its going out is felt by everyone, not just the builder.

### 4.6 Pause at old graves

`mourn` fires once per **fresh** grave, then the grave is scenery forever.

Add: a wandering villager passing near an **old** grave stops and looks at it
briefly. The island already keeps a memory of what you did — stumps, craters,
graves. This makes the villagers keep it too.

- This is not `mourn`. It does not consume the grave, emits no event, and is a
  brief pause inside `wander`, not a state.

### 4.7 Chopping has weight

`chopTree` today is 4 quantized frames of arms waving up and down, then
`tree.chop()` fires and Stage 2's 0.6s topple plays.

After: the villager **carries an axe**, winds up, and **each strike makes the tree
shudder**, with a bark-chip particle burst and a thud. Several strikes fell it.

Stage 2's topple becomes the **payoff of visible labour** rather than the whole
event. Felling a tree should read as *work*.

### 4.8 Fruit is visible, and gets picked (defect 12)

**The bug:** `growFruit()` places 4 instanced fruits at fixed offsets in the
crown's local **interior**. Fruits with a small radial offset are buried inside the
solid crown blob, so typically only one is visible.

**Fix:** place the fruits on the crown's **surface**, so all four read.

**Then close the loop:** add a `harvest` activity — a villager walks to a fruiting
tree, **picks the fruit, it disappears, and they eat it**.

Rain-on-tree → fruit already exists and is fully implemented, but it is invisible:
the player must aim rain *directly at a tree*, and most of the fruit is buried. Both
halves of this fix make an existing feature legible for the first time — you notice
the fruit because **someone reacts to it**.

---

## 5. Nudge — the fourth power

A divine finger-poke. It occupies a new `PowerId` row in the existing
`PowerId × TargetKind` matrix, so it **reuses the tray button, keyboard shortcut
`4`, drag-targeting and reticle with no new input system**.

It is presented in the tray exactly like the other three — same glyph/label/cooldown
chrome, fourth slot. Its difference comes across in what it *does*, not in how it is
styled.

| Nudge on… | They tend to… |
|---|---|
| **Tree** | go chop it |
| **Pond** | go fish there |
| **Ruin / site** | build there |
| **Ground** | **tend to this spot** — see the resolution order |
| **Villager** | startle them |
| **Campfire** | gather at it |
| **Crater** | *(nothing)* |

### 5.1 It is a suggestion, never a command

It **biases the next FSM decision** of the one or two nearest **idle** villagers.
A villager who is fleeing, mourning, zapped, or mid-activity **ignores it**.

**The player is a god making a suggestion, not a foreman issuing an order.**

- `world.suggest(x, z, kind)` tags the nearest idle villagers with a suggestion.
- `FsmCtx` gains a `suggestion` field. `decideNext()` **weights it heavily but does
  not force it** — a nudged villager usually complies, sometimes doesn't.
- A suggestion expires if not taken up within a short window.
- Short cooldown, no cost. `Nudge.cast()` is a brief timeline: a finger-poke ripple
  at the target. No shake, no damage, no scorch.

### 5.2 Ground-nudge resolves from the village's needs

**Ground-nudge has one meaning — *tend to this spot*.** It never asks the player to
learn a mode or pick from a menu. The spot must be `isBuildable`; if it is not, the
nudge resolves to *gather*.

Resolution order, **first match wins**:

1. **No campfire** (none exists, or it is scattered/out) → **build the campfire here.**
2. **Housing is full** (`living >= capacity`) **and** `huts < MAX_HUTS` → **build a hut here.**
3. Otherwise → **gather here.**

**Rule 2 is the growth valve.** Villagers found a new home only when the existing
ones are full — so a village you have been kind to expands, while a half-empty one
just gathers where you pointed.

This is what makes §3's housing cap mean something: without it, capacity can only
ever fall.

### 5.3 Founding a new hut

A nudge that resolves to *build a hut* creates a **new** `site` at the nudged spot —
it does not relocate an existing one. It reuses Stage 2's villager-committed
construction: the site is claimed, a villager walks to it, and the first work tick
begins `building`. Three ticks complete it, and capacity rises by 2.

The hut count may not exceed `MAX_HUTS` (6).

---

## 6. The Journal

Stage 3 creates genuinely new discoveries. Add moments for them, and **derive the
counter from `MOMENTS.length`** instead of the hard-coded `12` in `tray.ts:157` and
`journal.ts`.

Candidate moments (final wording during implementation):

| Moment | Unlocks when |
|---|---|
| The village grows | A nudge founds a new hut — the first time capacity ever *rises*. |
| Close call | A villager who was inside the **kill radius** (3m) when the meteor was cast survives it by running clear. Reachable: a villager starting ~2.5m out sprints ~1.8m and ends beyond the lethal ring. |
| Fed | A villager eats fruit that the player's rain grew. |

---

## 7. Explicitly out of scope

- **No swimming.** §4.2. Water is something they stay out of.
- **No drowning, no starvation, no old age.** Only the player kills villagers.
- **No resources.** Chopping produces no wood; fruit feeds nobody in a hunger system.
- **No build menu.** Ground-nudge resolves intent from the village's needs.
- **No villager pathfinding.** Water repulsion (§4.1) is steering, not A*.

---

## 8. Done when

- A meteor dropped on a crowd sends the **close** villagers sprinting and leaves the
  **distant** ones watching. Survivors are the ones who ran.
- Destroying a hut lowers capacity; nobody dies; no new villagers arrive until
  capacity exceeds the living population again.
- Nudging open ground while housing is full **founds a new hut**, and the village
  grows past 6 for the first time.
- A village bombed to zero still recovers.
- Villagers do not walk through ponds.
- Villagers fish with a rod at the shore, drink when thirsty, shelter under trees in
  the rain, gather at the dead fire, pause at old graves, and chop with visible effort.
- All four of a tree's fruits are visible, and villagers pick and eat them.
- Nudge is a suggestion — a busy or fleeing villager ignores it.
- Tests, typecheck, and production build all pass.

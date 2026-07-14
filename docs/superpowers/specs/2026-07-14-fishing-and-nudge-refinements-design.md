# Fishing and Nudge Refinements Design

**Date:** 2026-07-14

**Status:** Approved

## Goal

Make ponds read as small living habitats with a finite, visible fish population, make villager fishing respect that population, and make Nudge communicate and persist as a suggestion to complete one action. Correct the fishing-rod and held-fruit poses while keeping the existing theatrical, low-complexity simulation style.

## Design principles

- Fish are a tiny visual resource, not an economy or HUD statistic.
- A villager never performs an activity whose required world object is unavailable.
- Lightning reveals and stuns existing fish; it never creates or consumes them.
- Rain restores life inside its existing area of effect.
- A Nudge asks reached villagers to complete one meaningful action. It is not an arbitrary timer and danger may still interrupt it.
- Keep fish state inside `Pond`; do not introduce a global fish system or independent simulation entities.

## Pond fish model

Each `Pond` owns a population capped at three fish. It exposes a read-only `fishCount` and `hasFish`, plus three state-changing operations:

- `catchFish()` succeeds only when a fish remains, hides exactly one fish, decrements the count, and returns whether a catch occurred.
- `restoreFish()` returns the pond to three fish, makes all fish available below the surface, clears any stun, and reports whether the population changed.
- `stunFish()` starts a two-second surface performance for all remaining fish without changing the count. It is a no-op when the pond is empty.

New ponds begin with three fish. When crater basins merge, the remaining populations of absorbed ponds are summed and capped at three. Rebuilding an unchanged basin preserves both its pond object and population. Removing a pond disposes its fish resources with the rest of the pond.

There is no passive fish regeneration. An empty pond remains empty until Rain reaches it.

## Fish presentation

The three reusable fish visuals are present from pond creation. Live fish swim in slow, staggered elliptical routes below the water surface. Their phases and route variation come from the pond's seeded RNG, and movement remains quantized with the game's shared animation clock.

Fish routes must remain inside submerged pond space. Their local depth is chosen below the surface and constrained by the sampled pond floor so fish neither break the surface during ordinary swimming nor clip through shallow terrain. Removed fish are hidden rather than disposed, allowing Rain to restore the existing meshes without allocation.

During Lightning stun, every remaining fish rises to the surface and performs a small staggered bob. After two seconds the fish dive back to their underwater routes. Repeated Lightning refreshes the same stun rather than stacking animations. Lightning on an empty pond has no fish reaction.

When Rain restores a depleted or partly depleted pond, the returned fish appear below the surface with the Rain field's existing ripples covering the transition. They do not pop into view above the water.

## Fishing and drinking behavior

Autonomous fishing is eligible only when at least one pond is stocked. Entering the fishing state selects a stocked pond, preferring the nearest one unless a Nudge supplied a location.

At the bank, a villager completes one four-second casting cycle and then calls `catchFish()`. A successful catch removes exactly one fish and emits the existing `villager:fished` event. The current five-percent catch roll is removed: reaching the end of a completed casting cycle is the success condition.

Races are resolved at the pond boundary. If two villagers attempt to take the final fish, only the first `catchFish()` succeeds. A villager whose selected pond becomes empty before their catch switches to one drinking cycle at that pond. If the pond itself is removed, the villager abandons the activity safely and wanders.

Drinking does not require fish and does not enter the ordinary weighted idle roll. It remains a need-driven activity and can additionally be requested by Nudge.

## Nudge behavior

`drink` becomes a valid suggestion kind without becoming a random idle action.

- Nudging a stocked pond suggests fishing.
- Nudging an empty pond suggests drinking.
- A ground Nudge near water adds fishing to its weighted options when a stocked pond is nearby; if nearby ponds are empty, it adds drinking instead.
- Existing tree, building, fire, and gathering resolution remains unchanged.

World queries distinguish `pondNear` from `stockedPondNear`, and the FSM context distinguishes any pond from a pond that can support fishing. The existing four-nearest-villager reach and suggestion weight remain unchanged.

A reached villager retains the Nudge until one meaningful action finishes:

- fish: catch one fish, or drink if the selected pond is depleted first;
- drink: finish one drinking cycle;
- chop: finish felling the selected tree;
- build: finish the selected building action;
- make fire: finish restoring or building the fire;
- gather: finish one complete gathering performance.

The suggestion is not cleared merely because the villager enters a state. Danger, mourning, and other higher-priority safety behavior may interrupt it; when the override ends, the pending suggestion resumes. A suggestion is cleared if its target is removed or the requested action becomes impossible. A depleted fishing target converts to drinking rather than becoming a failed no-op.

## Lightning and Rain integration

The power matrix keeps Lightning-on-pond as its distinct pond interaction, but the outcome is renamed conceptually from floating/removing fish to stunning fish. The existing `fish:floated` event still fires when at least one fish is actually stunned for compatibility with any event consumers. The Fishing Hole Journal moment remains driven by the normal Lightning-on-pond power impact. No fish event fires for an empty pond's no-op reaction, but the normal Lightning impact event still occurs.

Rain restoration is radius-wide, matching Rain's existing dousing, crater filling, fruit growth, blooming, and grump effects. The first Rain impact calls a new idempotent `World.restoreFishNear(x, z, radius)` after crater filling. A pond is reached when its basin radius intersects the shower radius, rather than only when the shower contains the pond's center. This order ensures a newly created pond is stocked and an existing reached pond is restored, while avoiding repeated replenishment between catches during the same six-second shower. No new discovery event is required.

## Prop and UI corrections

The complete fishing rig moves slightly lower. Its float height is derived from the target pond's actual water level relative to the villager rather than relying solely on a fixed local Y coordinate. The rod remains forward-facing and the line continues to hang from its tip.

The carried fruit becomes a child of the carrying arm near the capsule tip instead of a separate group-level prop. Raising and rotating the arm carries the fruit naturally from hand to mouth, eliminating the two independent high Y positions. The fruit remains visible from a successful pick until the swallow and `villager:ate` event.

The Nudge tray glyph becomes a small clay pointing finger pressing toward a dimple. It uses the existing palette and DOM/CSS glyph approach rather than an emoji or external asset. The world-space cast ripple stays brief; persistence is communicated through villager behavior and emotes, not a long-lived ground marker.

## Error handling and invariants

- `0 <= fishCount <= 3` at all times.
- `catchFish()` cannot underflow and `restoreFish()` cannot overfill.
- Stun never changes population and safely ends if fish are caught during it.
- Repeated Rain and Lightning effects are idempotent and do not allocate new fish meshes.
- Pond merging cannot exceed three fish and cannot resurrect fish unless a newly wetted basin is created or Rain restores the result.
- Fishing eligibility, target selection, and catch execution all check stock so stale decisions cannot produce phantom catches.
- Pending suggestions survive temporary priority overrides but cannot retain references to removed targets.

## Verification

Automated tests will cover:

- new ponds begin with three visible, underwater fish;
- one successful catch removes one fish, three catches empty the pond, and further catches fail;
- Rain restores partial and empty populations to three without overfilling;
- Lightning preserves population, enters stun, and returns fish underwater after the stun;
- Lightning on an empty pond is a safe no-op;
- basin merging combines surviving populations and caps them at three;
- Rain restores only ponds inside its effect radius;
- autonomous fishing is unavailable without stocked ponds;
- a pond Nudge resolves to fish when stocked and drink when empty;
- ground Nudge weighting uses stocked versus empty pond availability;
- a completed casting cycle emits `villager:fished` only after a successful catch;
- a stale fisher switches to drinking when another villager takes the last fish;
- suggestions survive safety overrides, clear on completion, and cancel safely when their target disappears;
- held fruit follows the arm and remains present until `villager:ate`;
- power-matrix completeness and existing Journal triggers remain intact.

Manual in-game verification will check:

- swimming fish remain visibly below the surface and inside shallow and deep ponds;
- Lightning raises only the remaining fish and they visibly recover;
- Rain restoration reads naturally under the rain ripples;
- each catch removes one visible fish;
- empty ponds attract drinkers rather than fishers after a Nudge;
- the rod, line, and float align with the water from multiple banks;
- fruit sits in the hand and reaches the mouth without floating above the villager;
- the pointing-hand glyph reads clearly at tray size and in cooldown/disabled states;
- low-FX and reduced-motion paths remain coherent.

`docs/architecture.md` must be updated with the counted pond population, Rain restoration, Lightning stun, fish-aware FSM availability, and completion-based Nudge contract. `STATUS.md` remains unchanged unless the user explicitly requests the wrap flow.

## Out of scope

- Fish breeding, hunger, species, economy, inventory, or a resource HUD.
- Independent pathfinding or collision between fish.
- New powers, Journal moments, audio systems, or persistent save data for pond populations.
- Refactoring unrelated villager or power behavior.

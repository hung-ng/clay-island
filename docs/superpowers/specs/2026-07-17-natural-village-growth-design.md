# Natural Village Growth — Design

Date: 2026-07-17
Status: Approved

## Goal

Let a healthy full village grow by itself without making housing meaningless or
removing the player's role in expanding the settlement. A full village may gain
one pioneer beyond its current housing capacity. The resulting overcrowding is
the prompt for the player to found another hut with Nudge.

The existing recovery behavior remains responsible for replacing losses and
filling newly built housing. The existing **The Village Grows** Moment remains
responsible for teaching the player how to expand housing.

## Population model

Population has two distinct arrival modes:

- **Recovery:** while living population is below housing capacity, wait a seeded
  10–18 seconds and spawn one villager. Repeat one villager at a time until the
  available housing is full.
- **Growth:** while living population exactly equals a positive housing capacity,
  wait a seeded 45–75 seconds and spawn one pioneer. This puts the village
  exactly one villager above capacity.

Housing capacity remains two villagers per built hut, with six huts and twelve
villagers as the hard maximum. A village above capacity never admits another
villager and never culls or evicts anyone.

Natural growth is eligible only when all of the following are true:

- living population exactly equals capacity;
- capacity is greater than zero and less than twelve;
- at least one built hut exists;
- no new hut is reserved, at a site, or under construction.

If the player founds a hut before the growth countdown finishes, the countdown
is discarded. Once the hut is built, recovery mode fills the new vacancies. If
the pioneer arrives first, the village stays one over capacity until a hut is
built; that hut then creates one remaining vacancy for recovery to fill.

At six built huts and twelve villagers, growth mode is permanently ineligible.

## Timer state and transitions

`World` replaces the untyped `repopulateTimer` number with an explicit timer:

```ts
type PopulationTimer = {
  kind: 'recovery' | 'growth'
  remaining: number
}
```

`World.repopulate()` keeps its current public entry point. On every simulation
step it derives the currently eligible mode from living population, housing,
pending construction, and the availability of a valid arrival origin:

- If no mode is eligible, clear the timer.
- If the eligible mode differs from the active timer's kind, discard the old
  timer and roll the full range for the new mode.
- If the mode matches, subtract `dt`.
- When the timer expires, spawn exactly one villager and clear it. A later
  simulation step may start the next eligible countdown.

Keeping the mode in the timer prevents elapsed growth time from leaking into a
replacement. For example, if a villager dies near the end of a growth countdown,
the old countdown is discarded and recovery receives a fresh 10–18 seconds.
Housing destruction, new construction, reaching the hard cap, and becoming
over-capacity likewise clear an inapplicable timer instead of preserving stale
elapsed time.

## Arrival and fallback behavior

Both modes use the existing animated arrival presentation: one villager spawns
at a built hut and scales in over four quantized animation frames. The existing
`lowFx` behavior and monotonic villager ids are unchanged.

The zero-population mercy path remains recovery, not growth. When nobody and no
built hut survives, it may spawn one villager from a visible site or building
hut, a rebuildable ruin, or finally an abandoned foundation. Once that survivor
exists, further arrivals require rebuilt housing as they do today. With no hut
or foundation record at all, no arrival is possible.

The timers remain runtime-only. Because `World.repopulate()` already runs in the
fixed simulation callback, recovery and growth both advance during hidden-tab
gameplay and pause outside gameplay. Neither persists across page reloads.

## Discovery contract

Natural arrival does not emit `village:grew` and adds no new discovery event.
`World.foundHutAt()` remains the sole emitter of `village:grew`, so **The Village
Grows** still unlocks only when the player successfully founds a hut site.

The existing hint remains accurate and becomes literal:

> Nudge open ground when there is nowhere left to sleep.

The pioneer is the villager with nowhere to sleep. Autonomous hut founding is
deliberately excluded so the Moment cannot unlock without the player performing
the interaction it teaches.

## Testing

World tests will verify:

- recovery still waits 10–18 seconds and fills one vacancy at a time;
- a full, sub-maximum village waits 45–75 seconds before one pioneer arrives;
- no second pioneer arrives while the population is over capacity;
- pending hut work suppresses growth and discards its countdown;
- a full six-hut/twelve-person village suppresses growth;
- a death during growth starts a fresh recovery timer rather than reusing time;
- completing a hut after a pioneer creates one vacancy that recovery fills;
- destroyed housing never culls an over-capacity population;
- the zero-population mercy path retains its current origin priority;
- natural arrival does not emit `village:grew`;
- founding a hut remains the event that unlocks **The Village Grows**.

A loop integration test will drive `World.repopulate()` through background-mode
elapsed time to confirm the same growth countdown advances without rendering.
The full test suite and production build remain the completion gate.

## Out of scope

- Child models, pregnancy, couples, family trees, or explicit reproduction.
- Autonomous hut founding.
- More than one villager of temporary overflow.
- Raising the limits of six huts or twelve villagers.
- Population persistence across reloads.
- Changing the **The Village Grows** Moment, hint, or stored id.

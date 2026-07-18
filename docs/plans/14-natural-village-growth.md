# Natural Village Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a full village admit one slow natural pioneer above housing capacity while preserving player-founded huts, recovery arrivals, and **The Village Grows** Moment.

**Architecture:** `World.repopulate()` remains the population entry point but replaces its single numeric timer with a tagged `recovery | growth` timer so elapsed time cannot leak between modes. Recovery continues to fill housing after 10–18 seconds; eligible full villages below the twelve-person maximum gain exactly one pioneer after 45–75 seconds, then stop until housing catches up. The existing fixed-step `GameLoop` drives both modes in foreground and background simulation.

**Tech Stack:** TypeScript 6, Three.js, Vitest 4, Vite 8

## Global Constraints

- Housing remains two villagers per built hut, capped at six huts and twelve villagers.
- Recovery remains one arrival per seeded 10–18-second countdown.
- Natural growth remains one pioneer per seeded 45–75-second countdown.
- Natural growth requires `living === capacity`, positive capacity below twelve, a built hut, and no reserved, visible, or building hut site.
- Population may exceed capacity by at most one through natural growth; over-capacity villages never admit another villager and are never culled.
- Zero-population mercy recovery and its origin priority remain unchanged.
- `World.foundHutAt()` remains the sole emitter of `village:grew`; natural arrival emits no discovery event.
- **The Village Grows** id, title, and hint remain unchanged.
- Population timers remain runtime-only and advance through the existing gameplay simulation callback, including hidden-tab gameplay.
- Add no dependencies, child models, reproduction system, autonomous hut founding, persistence, or higher population limits.
- Update `docs/architecture.md` with the final population rules.
- Do not create a branch or commit unless the user explicitly requests it during implementation.

---

## File Structure

- Modify `src/world/world.ts`: own the tagged population timer, derive the active population mode, enforce soft-overflow eligibility, and treat an invisible replacement-site reservation as pending hut work.
- Modify `src/world/world.test.ts`: cover timer bounds, one-pioneer overflow, mode switching, construction boundaries, discovery isolation, mercy preservation, and background-loop integration.
- Modify `docs/architecture.md`: document recovery versus growth timing, the one-person soft cap, construction gating, and the unchanged Moment boundary.
- Reference `docs/superpowers/specs/2026-07-17-natural-village-growth-design.md`: approved behavior contract; do not modify unless implementation reveals a contradiction requiring user review.

---

### Task 1: Tagged recovery and growth timers

**Files:**
- Modify: `src/world/world.test.ts:54-58,970-1020`
- Modify: `src/world/world.ts:26-31,51-65,847-878`

**Interfaces:**
- Consumes: `World.living(): number`, `World.capacity(): number`, `World.pendingSite(): boolean`, `repopulationHome(living: number, huts: Hut[]): Hut | null`, and `spawnVillagers(...)`.
- Produces: private `PopulationTimerKind`, private `PopulationTimer`, private `POPULATION_DELAYS`, and mode-safe behavior through the existing `World.repopulate(dt: number, rng: RNG, lowFx?: boolean): void` signature.

- [x] **Step 1: Add a concise living-population test helper**

Insert after `idleVillagerAt` in `src/world/world.test.ts`:

```ts
function setLiving(world: World, count: number): void {
  world.villagers = Array.from({ length: count }, (_, index) => ({
    id: `existing-${index}`,
    alive: true,
  })) as Villager[]
}
```

- [x] **Step 2: Write failing tests for one-pioneer growth and timer mode isolation**

Append this block after `housing caps the population` in `src/world/world.test.ts`:

```ts
describe('natural population growth', () => {
  it('admits one pioneer after 45–75 seconds and no second overflow arrival', () => {
    const world = makeWorld()
    const rng = new RNG(1)
    addHut(world, 'hut-0', 0, 0)
    setLiving(world, 2)

    world.repopulate(44, rng)
    expect(world.living()).toBe(2)

    world.repopulate(31, rng)
    expect(world.living()).toBe(3)

    world.repopulate(75, rng)
    expect(world.living()).toBe(3)
  })

  it('does not grow beyond the twelve-person hard maximum', () => {
    const world = makeWorld()
    for (let index = 0; index < 6; index++) {
      addHut(world, `hut-${index}`, index * 3, 0)
    }
    setLiving(world, 12)

    world.repopulate(75, new RNG(1))

    expect(world.living()).toBe(12)
  })

  it('starts a fresh recovery countdown when a death interrupts growth', () => {
    const world = makeWorld()
    const rng = new RNG(1)
    addHut(world, 'hut-0', 0, 0)
    setLiving(world, 2)

    world.repopulate(44, rng)
    world.villagers.pop()

    world.repopulate(9, rng)
    expect(world.living()).toBe(1)

    world.repopulate(9, rng)
    expect(world.living()).toBe(2)
  })
})
```

- [x] **Step 3: Run the focused tests and confirm the new growth tests fail**

Run:

```bash
npx vitest run src/world/world.test.ts
```

Expected: the existing recovery tests pass, while the first natural-growth test fails because a full village currently clears `repopulateTimer` and remains at two villagers.

- [x] **Step 4: Define the tagged timer types and delay ranges**

Insert below `type Position` in `src/world/world.ts`:

```ts
type PopulationTimerKind = 'recovery' | 'growth'

type PopulationTimer = {
  kind: PopulationTimerKind
  remaining: number
}

const POPULATION_DELAYS: Record<
  PopulationTimerKind,
  readonly [minimum: number, maximum: number]
> = {
  recovery: [10, 18],
  growth: [45, 75],
}
```

Replace the `repopulateTimer` field in `World`:

```ts
  private populationTimer: PopulationTimer | null = null
```

- [x] **Step 5: Replace `World.repopulate()` with mode-safe recovery and growth**

Replace the current method in `src/world/world.ts` with:

```ts
  repopulate(dt: number, rng: RNG, lowFx = false): void {
    const living = this.living()
    const capacity = this.capacity()
    const home = repopulationHome(living, this.huts)
    let kind: PopulationTimerKind | null = null

    if (home && (living < capacity || living === 0)) {
      kind = 'recovery'
    } else if (
      home?.state === 'built'
      && living === capacity
      && capacity > 0
      && capacity < MAX_HUTS * 2
      && !this.pendingSite()
    ) {
      kind = 'growth'
    }

    // Crowding, missing shelter, construction, and the hard maximum all cancel
    // stale elapsed time. A later eligible mode always gets its full delay.
    if (!kind || !home) {
      this.populationTimer = null
      return
    }

    if (!this.populationTimer || this.populationTimer.kind !== kind) {
      const [minimum, maximum] = POPULATION_DELAYS[kind]
      this.populationTimer = {
        kind,
        remaining: rng.range(minimum, maximum),
      }
    }

    this.populationTimer.remaining -= dt
    if (this.populationTimer.remaining > 0) return

    spawnVillagers(this, this.island, rng, 1, {
      lowFx,
      origin: { x: home.x, z: home.z },
      animateIn: true,
    })
    this.populationTimer = null
  }
```

- [x] **Step 6: Run the focused tests and confirm Task 1 passes**

Run:

```bash
npx vitest run src/world/world.test.ts
```

Expected: exit 0; the existing capacity/recovery behavior and all three new natural-growth tests pass.

---

### Task 2: Construction gating and discovery preservation

**Files:**
- Modify: `src/world/world.test.ts:900-940` and the `natural population growth` block from Task 1
- Modify: `src/world/world.ts:378-381`

**Interfaces:**
- Consumes: the tagged timer behavior from Task 1, `World.claimBuildSite(rng, lowFx?)`, `World.pendingSite()`, and the existing `World.bus`.
- Produces: `World.pendingSite(): boolean` that returns true for an invisible `pendingHutSite` reservation as well as visible `site | building` huts. No new `GameEvent` is produced.

- [x] **Step 1: Write tests for visible construction, invisible reservations, housing catch-up, and Moment isolation**

Append these tests inside `describe('natural population growth', ...)`:

```ts
  it('suppresses growth while a visible hut site is pending', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0)
    addHut(world, 'hut-1', 4, 0, 'site')
    setLiving(world, 2)

    world.repopulate(75, new RNG(1))

    expect(world.living()).toBe(2)
  })

  it('discards elapsed growth time when hut construction starts', () => {
    const world = makeWorld()
    const rng = new RNG(1)
    addHut(world, 'hut-0', 0, 0)
    setLiving(world, 2)
    world.repopulate(44, rng)

    const site = addHut(world, 'hut-1', 4, 0, 'site')
    world.repopulate(1, rng)
    world.huts.splice(world.huts.indexOf(site), 1)

    world.repopulate(44, rng)
    expect(world.living()).toBe(2)

    world.repopulate(31, rng)
    expect(world.living()).toBe(3)
  })

  it('treats an invisible replacement-site reservation as pending work', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0)
    addHut(world, 'hut-1', 4, 0, 'abandoned')
    setLiving(world, 2)
    vi.spyOn(world, 'findBuildSite').mockReturnValue({ x: 7, z: 0 })

    expect(world.claimBuildSite(new RNG(2))).not.toBeNull()
    expect(world.pendingSite()).toBe(true)

    world.repopulate(75, new RNG(1))
    expect(world.living()).toBe(2)
  })

  it('uses recovery to fill the vacancy after a pioneer gains a new hut', () => {
    const world = makeWorld()
    const rng = new RNG(1)
    addHut(world, 'hut-0', 0, 0)
    setLiving(world, 2)

    world.repopulate(75, rng)
    expect(world.living()).toBe(3)

    addHut(world, 'hut-1', 4, 0)
    world.repopulate(9, rng)
    expect(world.living()).toBe(3)

    world.repopulate(9, rng)
    expect(world.living()).toBe(4)
  })

  it('does not unlock village growth when the pioneer arrives', () => {
    const world = makeWorld()
    const events: string[] = []
    world.bus.on(event => events.push(event.type))
    addHut(world, 'hut-0', 0, 0)
    setLiving(world, 2)

    world.repopulate(75, new RNG(1))

    expect(world.living()).toBe(3)
    expect(events).not.toContain('village:grew')
  })

  it('keeps the zero-population mercy arrival and stops again without housing', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0, 'ruin')

    world.repopulate(18, new RNG(1))
    expect(world.living()).toBe(1)

    world.repopulate(75, new RNG(1))
    expect(world.living()).toBe(1)
  })
```

The existing `founds a buildable hut site and emits village growth` test remains unchanged and continues to prove that `World.foundHutAt()` owns the Moment event.

- [x] **Step 2: Run the focused tests and confirm the reservation test fails**

Run:

```bash
npx vitest run src/world/world.test.ts
```

Expected: the invisible-reservation test fails at `expect(world.pendingSite()).toBe(true)` because `pendingSite()` currently checks only registered visible huts.

- [x] **Step 3: Make invisible replacement reservations count as pending hut work**

Replace `World.pendingSite()` with:

```ts
  /** A hut reserved, founded, or under construction. Growth stays serial. */
  pendingSite(): boolean {
    return this.pendingHutSite !== null
      || this.huts.some(hut => hut.state === 'site' || hut.state === 'building')
  }
```

This also prevents a ground Nudge from founding a second site while another villager is travelling toward an invisible abandoned-hut replacement reservation.

- [x] **Step 4: Run world and discovery tests**

Run:

```bash
npx vitest run src/world/world.test.ts src/discovery/moments.test.ts
```

Expected: exit 0; pending construction suppresses natural growth, the pioneer is housed through ordinary recovery, natural arrival emits no `village:grew`, and the existing Moment matcher still unlocks only from that event.

---

### Task 3: Hidden-tab population integration

**Files:**
- Modify: `src/world/world.test.ts:1-8` and the `natural population growth` block

**Interfaces:**
- Consumes: `GameLoop(onSim, onRender, simDt?, now?)`, `GameLoop.setBackground(active)`, `GameLoop.backgroundTick()`, and `World.repopulate()` from Tasks 1–2.
- Produces: an integration test proving wall-clock background drains advance natural growth without invoking rendering.

- [x] **Step 1: Add loop-test imports and global cleanup**

Change the Vitest import and add the `GameLoop` import at the top of `src/world/world.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameLoop } from '../core/loop'
```

Insert after the imports:

```ts
afterEach(() => vi.unstubAllGlobals())
```

- [x] **Step 2: Write the background integration test**

Append inside `describe('natural population growth', ...)`:

```ts
  it('advances the growth countdown through background simulation without rendering', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let now = 0
    const world = makeWorld()
    const rng = new RNG(1)
    const render = vi.fn()
    addHut(world, 'hut-0', 0, 0)
    setLiving(world, 2)

    const loop = new GameLoop(
      dt => world.repopulate(dt, rng),
      render,
      1 / 30,
      () => now,
    )
    loop.start()
    loop.setBackground(true)

    for (const elapsed of [30_000, 30_000, 15_000]) {
      now += elapsed
      loop.backgroundTick()
    }

    expect(world.living()).toBe(3)
    expect(render).not.toHaveBeenCalled()
    loop.stop()
  })
```

Three drains are intentional: `GameLoop.MAX_CATCH_UP` admits at most thirty simulated seconds per background tick, while the maximum growth delay is seventy-five seconds.

- [x] **Step 3: Run the integration and loop suites**

Run:

```bash
npx vitest run src/world/world.test.ts src/core/core.test.ts
```

Expected: exit 0; the integration reaches one pioneer after 75 seconds of background time, render remains untouched, and the existing background accumulator tests still pass.

---

### Task 4: Architecture and completion verification

**Files:**
- Modify: `docs/architecture.md:41,111`
- Verify: `docs/superpowers/specs/2026-07-17-natural-village-growth-design.md`

**Interfaces:**
- Consumes: completed behavior and tests from Tasks 1–3.
- Produces: architecture documentation aligned with the code and a fully verified working tree.

- [x] **Step 1: Update the `World` ownership summary**

In the `src/world/world.ts` bullet near line 41 of `docs/architecture.md`, retain the existing responsibilities and replace its population sentences with:

```md
`capacity()` grants two places per built hut up to 12. `World.repopulate()` owns an explicit `recovery | growth` timer: recovery fills vacancies after a seeded 10–18 seconds, while a full sub-maximum village with no pending hut work gains one pioneer after 45–75 seconds. That pioneer may put the village exactly one over capacity; crowding is otherwise stable and never culls villagers. Invisible replacement reservations count as pending hut work, and the zero-population `repopulationHome` mercy path remains the only other capacity exception.
```

- [x] **Step 2: Replace the detailed population invariant paragraph**

Replace the population paragraph near line 111 with:

```md
- Population is housing-gated and self-healing. Below capacity, `World.repopulate()` waits a seeded 10–18 seconds before spawning one replacement at a built hut, repeating one villager at a time until two places per built hut are filled, capped at 12. At exact capacity below 12, with a built hut and no reserved, visible, or building hut site, a separate seeded 45–75-second growth countdown admits one pioneer; the resulting one-person overflow blocks every further arrival until the player founds and villagers complete another hut. Changing between recovery and growth discards elapsed time so a death cannot inherit a nearly finished growth countdown. `World.foundHutAt()` remains the sole `village:grew` emitter, preserving **The Village Grows** as the player-taught Nudge interaction. Destroying housing can create a stable over-capacity village but never culls or evicts anyone. If no villager and no built hut survive, a site, in-progress build, rebuildable ruin, or finally an abandoned foundation becomes the last-resort mercy origin and ignores capacity so deferred construction cannot deadlock. Population timers advance in hidden gameplay through the same fixed simulation callback and remain runtime-only.
```

- [x] **Step 3: Run focused verification**

Run:

```bash
npx vitest run src/world/world.test.ts src/core/core.test.ts src/discovery/moments.test.ts
```

Expected: exit 0; all focused population, background-loop, and discovery tests pass.

- [x] **Step 4: Run the full automated gate**

Run:

```bash
npx vitest run
npm run build
git diff --check
```

Expected: Vitest exits 0 with every test passing; `tsc && vite build` exits 0 and produces the production bundle; `git diff --check` exits 0 with no whitespace errors.

- [ ] **Step 5: Perform live behavioral QA**

Run `npm run dev`, open the game, and verify this sequence in a fresh session:

1. Remove `localStorage['clayisland.moments']`, reload, and begin gameplay with the initial six villagers and three built huts.
2. Leave the full village undisturbed for up to 75 simulated seconds; confirm exactly one pioneer scales in and the population does not continue growing.
3. Repeat ground Nudge on buildable open ground if another eligible suggestion wins the weighted roll; confirm a hut site appears and **The Village Grows** unlocks from that player action.
4. Let villagers finish the hut; confirm ordinary recovery supplies only the remaining eighth villager after 10–18 seconds.
5. In a second fresh session, hide the tab during the full-village growth countdown, wait through the countdown, return, and confirm the pioneer is present without replayed rendering or hidden-tab foley.

Expected: the visible sequence is `6/6 → 7/6 → hut founded → 7/8 → 8/8`; no step produces a second overflow villager, and the Moment does not unlock before the hut site is founded.

- [x] **Step 6: Review the final working tree without committing**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the approved spec, this plan, `src/world/world.ts`, `src/world/world.test.ts`, and `docs/architecture.md` are changed. Report verification results and wait for an explicit user instruction before committing.

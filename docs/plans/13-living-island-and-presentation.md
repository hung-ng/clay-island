# Living Island & Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the simulation alive while the tab is hidden, retune and extend the villager FSM with four new social/idle states, and ship a real favicon and a composed og-image.

**Architecture:** `GameLoop` gains a hidden-tab drive fed by a Web Worker ticker that advances the fixed-step sim by real elapsed wall-clock time (capped per drain); all simulation-state updates move from the render callback into `onSim` so background time is honest. The FSM gains `chat`, `watchSea`, `dance`, `nap`, a no-immediate-repeat rule, a crowd-spreading penalty, and per-villager personality multipliers, following the existing weighted-idle-table pattern.

**Tech Stack:** TypeScript, Three.js, Vite, Vitest, DOM/CSS UI.

**Design reference:** `docs/superpowers/specs/2026-07-17-living-island-and-presentation-design.md`

## Global Constraints

- Do not create a git commit unless the user explicitly requests one. Every task must finish with passing targeted tests and leave changes in the working tree.
- No new runtime dependencies. One-off CLI tools via `npx` are allowed for asset generation only (Tasks 11–12).
- `flee`, `mourn`, and `rebuild` remain absolute priorities; no new state may preempt or outrank them.
- Background simulation only runs while `simulatesGameplay(flow)` is true — never during title or prologue.
- Rendering, particles, camera, and celebration choreography never run while the tab is hidden.
- Per-drain sim catch-up is capped at 30 simulated seconds; surplus backlog is dropped.
- New states get no new `SuggestionKind`; the suggestion table is unchanged.
- `nap` lasts 12–18 seconds and rotates the complete villager model 90° onto its side; waking or interruption restores the default model transform.
- The favicon is a transparent, low horizontal clay cloud with the asymmetric wobble and warm directional shading of the ambient clouds in `src/scene.ts`, not the earlier island-and-tree or blue-badge sketches.
- `public/og.png` stays 1200×630 at the same path; `index.html` og meta tags are unchanged.
- `STATUS.md` remains unchanged unless the user explicitly requests the wrap flow.
- Run targeted tests per task; full `npm test` + `npm run build` happen in Task 13.

---

## File Structure

- `src/villagers/fsm.ts` — states, weights, durations, `decideNext` variety rules (Task 1)
- `src/villagers/fsm.test.ts` — FSM unit tests (Task 1)
- `src/villagers/villager.ts` — context plumbing, personality, wander pause, four new state behaviors (Tasks 2–7)
- `src/villagers/villager.test.ts` — villager behavior tests (Tasks 2–7)
- `src/villagers/model.ts`, `src/villagers/model.test.ts` — prone-pose reset contract (Task 4)
- `src/world/world.ts` — repopulation interval, foley mute flag (Tasks 8–9)
- `src/world/world.test.ts` — repopulation timing tests (Task 8)
- `src/main.ts` — sim/render callback split, visibility wiring (Tasks 9–10)
- `src/core/loop.ts` — `GameLoop` background mode (Task 10)
- `src/core/backgroundTicker.ts` — NEW: worker-driven hidden-tab ticker (Task 10)
- `src/core/core.test.ts` — loop background-mode tests (Task 10)
- `public/favicon.svg`, `public/favicon-32.png`, `public/apple-touch-icon.png`, `index.html` — favicon (Task 11)
- `public/og.png` — composed og-image (Task 12)
- `docs/architecture.md` — updated at the end (Task 13)

---

### Task 1: FSM — new states, retuned weights, variety rules

**Files:**
- Modify: `src/villagers/fsm.ts`
- Test: `src/villagers/fsm.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `STATES` including `'chat' | 'watchSea' | 'dance' | 'nap'`; `FsmCtx` gains required fields `hasChatPartner: boolean`, `stateCounts: Partial<Record<VillagerState, number>>`, `personality: Partial<Record<VillagerState, number>>`. `decideNext(ctx)` applies personality × crowd-penalty weighting and never re-picks `ctx.state` unless suggested or it is the only option. `stateDuration` covers the four new states.

- [ ] **Step 1: Write the failing tests**

In `src/villagers/fsm.test.ts`, update the `base` helper to include the new required fields, update the shape test, and add variety-rule tests:

```ts
const base = (o: Partial<FsmCtx> = {}): FsmCtx => ({
  state: 'wander', fireNear: false, freshGrave: false, hasRuin: false,
  hasSite: false, hasPond: false, hasTree: true, campfireLit: true,
  hasFishPond: false, canChopAutomatically: true,
  needsFire: false, hasFruitTree: false, fireOut: false,
  hasChatPartner: false, stateCounts: {}, personality: {},
  suggestion: null, rng: new RNG(3), ...o,
})
```

Replace the `FSM shape` expectation:

```ts
describe('FSM shape', () => {
  it('has exactly 16 states', () => {
    expect(STATES).toHaveLength(16)
    expect([...STATES].sort()).toEqual(
      [
        'buildHut', 'chat', 'chopTree', 'dance', 'drink', 'fish', 'flee',
        'gather', 'harvest', 'makeFire', 'mourn', 'nap', 'rebuild',
        'sitAtFire', 'wander', 'watchSea',
      ],
    )
  })
})
```

Append a new describe block:

```ts
describe('variety rules', () => {
  it('never re-picks the current state when alternatives exist', () => {
    for (let seed = 0; seed < 300; seed++) {
      const next = decideNext(base({
        state: 'fish', hasPond: true, hasFishPond: true, rng: new RNG(seed),
      }))
      expect(next).not.toBe('fish')
    }
  })
  it('repeats the current state when it is the only option', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(decideNext(base({
        state: 'wander', hasTree: false, campfireLit: false,
        // watchSea and nap are always available, so exclude them via personality 0
        personality: { watchSea: 0, nap: 0 },
        rng: new RNG(seed),
      }))).toBe('wander')
    }
  })
  it('a suggestion may re-pick the current state', () => {
    let repicked = 0
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({
        state: 'chopTree', hasTree: true,
        suggestion: { kind: 'chop', x: 0, z: 0 },
        rng: new RNG(seed),
      })) === 'chopTree') repicked++
    }
    expect(repicked).toBeGreaterThan(200)
  })
  it('crowded activities lose appeal', () => {
    const picks = (counts: Partial<Record<VillagerState, number>>): number => {
      let n = 0
      for (let seed = 0; seed < 400; seed++) {
        if (decideNext(base({
          hasFruitTree: true, stateCounts: counts, rng: new RNG(seed),
        })) === 'harvest') n++
      }
      return n
    }
    expect(picks({ harvest: 9 })).toBeLessThan(picks({}) / 2)
  })
  it('personality multipliers create habits', () => {
    let naps = 0
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({
        personality: { nap: 100 }, rng: new RNG(seed),
      })) === 'nap') naps++
    }
    expect(naps).toBeGreaterThan(250)
  })
})

describe('new states', () => {
  it('chats only when a partner is available', () => {
    let chatted = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({ hasChatPartner: true, rng: new RNG(seed) })) === 'chat') {
        chatted = true
      }
      expect(decideNext(base({ hasChatPartner: false, rng: new RNG(seed) }))).not.toBe('chat')
    }
    expect(chatted).toBe(true)
  })
  it('dances only by a lit fire', () => {
    let danced = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({ campfireLit: true, rng: new RNG(seed) })) === 'dance') danced = true
      expect(decideNext(base({ campfireLit: false, rng: new RNG(seed) }))).not.toBe('dance')
    }
    expect(danced).toBe(true)
  })
  it('watchSea and nap are always available', () => {
    const picked = new Set<string>()
    for (let seed = 0; seed < 500; seed++) {
      picked.add(decideNext(base({
        hasTree: false, campfireLit: false, rng: new RNG(seed),
      })))
    }
    expect(picked.has('watchSea')).toBe(true)
    expect(picked.has('nap')).toBe(true)
  })
  it('gives the new states their designed durations', () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = new RNG(seed)
      const chat = stateDuration('chat', new RNG(seed))
      expect(chat).toBeGreaterThanOrEqual(4)
      expect(chat).toBeLessThanOrEqual(7)
      expect(stateDuration('watchSea', rng)).toBeGreaterThanOrEqual(6)
      expect(stateDuration('dance', rng)).toBeLessThanOrEqual(8)
      const nap = stateDuration('nap', rng)
      expect(nap).toBeGreaterThanOrEqual(12)
      expect(nap).toBeLessThanOrEqual(18)
      const wander = stateDuration('wander', new RNG(seed))
      expect(wander).toBeGreaterThanOrEqual(4)
      expect(wander).toBeLessThanOrEqual(9)
      const fish = stateDuration('fish', new RNG(seed))
      expect(fish).toBeGreaterThanOrEqual(4)
      expect(fish).toBeLessThanOrEqual(6)
    }
  })
})
```

Note: the existing test `only ever returns states whose preconditions hold` expects `['wander', 'sitAtFire']` — with `watchSea` and `nap` always available it must be updated to `['wander', 'sitAtFire', 'watchSea', 'nap']`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/villagers/fsm.test.ts`
Expected: FAIL — `STATES` has no `chat`, `FsmCtx` misses fields (type errors), duration cases missing.

- [ ] **Step 3: Implement in `src/villagers/fsm.ts`**

```ts
export const STATES = [
  'wander', 'chopTree', 'buildHut', 'sitAtFire', 'flee', 'mourn', 'rebuild',
  'fish', 'makeFire', 'drink', 'harvest', 'gather',
  'chat', 'watchSea', 'dance', 'nap',
] as const
```

Add to `FsmCtx` (after `fireOut`):

```ts
  hasChatPartner: boolean
  /** Living villagers other than the decider currently in each state. */
  stateCounts: Partial<Record<VillagerState, number>>
  /** Per-villager habit multipliers rolled at spawn; missing entries mean 1. */
  personality: Partial<Record<VillagerState, number>>
```

Retune and extend the `IDLE` table (`wander` 4→7, `fish` 4→2, `harvest` 5→3, four new rows):

```ts
const IDLE: { state: VillagerState; weight: number; when: (c: FsmCtx) => boolean }[] = [
  { state: 'wander', weight: 7, when: () => true },
  { state: 'sitAtFire', weight: 3, when: c => c.campfireLit },
  {
    state: 'chopTree',
    weight: 3,
    when: c => c.hasTree
      && (c.canChopAutomatically || c.suggestion?.kind === 'chop'),
  },
  { state: 'buildHut', weight: 3, when: c => c.hasSite },
  { state: 'fish', weight: 2, when: c => c.hasFishPond },
  {
    state: 'drink',
    weight: 0,
    when: c => c.hasPond && c.suggestion?.kind === 'drink',
  },
  { state: 'makeFire', weight: 5, when: c => c.needsFire },
  { state: 'harvest', weight: 3, when: c => c.hasFruitTree },
  { state: 'gather', weight: 3, when: c => c.fireOut || c.suggestion?.kind === 'gather' },
  { state: 'chat', weight: 3, when: c => c.hasChatPartner },
  { state: 'watchSea', weight: 2, when: () => true },
  { state: 'dance', weight: 3, when: c => c.campfireLit },
  { state: 'nap', weight: 2, when: () => true },
]
```

Rewrite `decideNext`:

```ts
export function decideNext(ctx: FsmCtx): VillagerState {
  if (ctx.fireNear) return 'flee'
  if (ctx.freshGrave) return 'mourn'
  if (ctx.hasRuin) return 'rebuild'

  const wanted = ctx.suggestion ? SUGGESTED[ctx.suggestion.kind] : null
  let available = IDLE.filter(option => option.when(ctx))
  // Variety: never re-roll the current state, unless a suggestion asks for it
  // or nothing else is on offer.
  const fresh = available.filter(option => option.state !== ctx.state || option.state === wanted)
  if (fresh.length > 0) available = fresh
  const weightOf = (option: { state: VillagerState; weight: number }): number => {
    const habit = ctx.personality[option.state] ?? 1
    const crowd = 1 + (ctx.stateCounts[option.state] ?? 0)
    const weight = option.weight * habit / crowd
    return option.state === wanted ? weight + SUGGESTION_WEIGHT : weight
  }
  const total = available.reduce((sum, option) => sum + weightOf(option), 0)
  let roll = ctx.rng.next() * total
  for (const option of available) {
    roll -= weightOf(option)
    if (roll < 0) return option.state
  }
  return 'wander'
}
```

Extend `stateDuration` (change `fish` and `wander`, add four cases):

```ts
    case 'fish': return rng.range(4, 6)
    case 'wander': return rng.range(4, 9)
    case 'chat': return rng.range(4, 7)
    case 'watchSea': return rng.range(6, 10)
    case 'dance': return rng.range(4, 8)
    case 'nap': return rng.range(12, 18)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers/fsm.test.ts`
Expected: PASS. Note `src/villagers/villager.test.ts` and `villager.ts` will not typecheck yet (missing ctx fields) — that is Task 2; do not run the full suite here.

### Task 2: Villager context plumbing — personality, crowd counts, chat availability

**Files:**
- Modify: `src/villagers/villager.ts`
- Modify: `src/villagers/model.ts`
- Test: `src/villagers/villager.test.ts`
- Test: `src/villagers/model.test.ts`

**Interfaces:**
- Consumes: `FsmCtx` fields from Task 1.
- Produces: `Villager` private methods `othersByState(world): Partial<Record<VillagerState, number>>`, `findChatPartner(world): Villager | null`, `canJoinChat(): boolean`; private field `personality: Partial<Record<VillagerState, number>>`; private field `chatPartner: Villager | null` (behavior wired in Task 7). `context(world)` supplies all three new `FsmCtx` fields.

- [ ] **Step 1: Write the failing tests**

Append to `src/villagers/villager.test.ts` (reuse the file's existing world-stub patterns; the harness below follows the `Object.create(Villager.prototype)` style used by `activityHarness`):

```ts
describe('FSM context plumbing', () => {
  type ContextHarness = {
    state: string
    alive: boolean
    x: number
    z: number
    zapTime: number
    rainTime: number
    performance: string
    celebration: null
    suggestion: null
    personality: Record<string, number>
    chatPartner: null
    othersByState(world: World): Partial<Record<string, number>>
    findChatPartner(world: World): Villager | null
    canJoinChat(): boolean
  }

  const contextHarness = (o: Partial<ContextHarness> = {}): ContextHarness => {
    const villager = Object.create(Villager.prototype) as ContextHarness
    villager.state = 'wander'
    villager.alive = true
    villager.x = 0
    villager.z = 0
    villager.zapTime = -1
    villager.rainTime = 0
    villager.performance = 'none'
    villager.celebration = null
    villager.suggestion = null
    villager.personality = {}
    villager.chatPartner = null
    return Object.assign(villager, o)
  }

  it('counts other living villagers by state, excluding itself', () => {
    const me = contextHarness({ state: 'fish' })
    const world = {
      villagers: [
        me,
        contextHarness({ state: 'fish' }),
        contextHarness({ state: 'wander' }),
        contextHarness({ state: 'wander', alive: false }),
      ],
    } as unknown as World
    expect(me.othersByState(world)).toEqual({ fish: 1, wander: 1 })
  })

  it('finds the nearest interruptible chat partner within range', () => {
    const me = contextHarness()
    const near = contextHarness({ x: 2, z: 0 })
    const nearer = contextHarness({ x: 1, z: 0, state: 'sitAtFire' })
    const busy = contextHarness({ x: 0.5, z: 0, state: 'fish' })
    const far = contextHarness({ x: 30, z: 0 })
    const world = { villagers: [me, near, nearer, busy, far] } as unknown as World
    expect(me.findChatPartner(world)).toBe(nearer)
  })

  it('refuses chat while busy, frightened, celebrating, or nudged', () => {
    expect(contextHarness().canJoinChat()).toBe(true)
    expect(contextHarness({ state: 'fish' }).canJoinChat()).toBe(false)
    expect(contextHarness({ alive: false }).canJoinChat()).toBe(false)
    expect(contextHarness({ zapTime: 0.5 }).canJoinChat()).toBe(false)
    expect(contextHarness({ rainTime: 1 }).canJoinChat()).toBe(false)
    expect(contextHarness({ performance: 'cower' }).canJoinChat()).toBe(false)
    expect(contextHarness({
      suggestion: { kind: 'fish', x: 0, z: 0 } as never,
    }).canJoinChat()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/villagers/villager.test.ts -t 'FSM context plumbing'`
Expected: FAIL — `othersByState` / `findChatPartner` / `canJoinChat` are not functions.

- [ ] **Step 3: Implement in `src/villagers/villager.ts`**

Module-level, after the existing constants:

```ts
/** Activities that develop per-villager habits. Emergencies stay uniform. */
const PERSONALITY_STATES: VillagerState[] = [
  'wander', 'sitAtFire', 'chopTree', 'buildHut', 'fish', 'harvest',
  'gather', 'chat', 'watchSea', 'dance', 'nap',
]
/** How far two villagers will spot each other for a chat. */
const CHAT_RANGE = 7
```

New private fields next to `celebration`:

```ts
  private chatPartner: Villager | null = null
  private readonly personality: Partial<Record<VillagerState, number>> = {}
```

In the constructor, just before `this.enter('wander', world)`:

```ts
    for (const state of PERSONALITY_STATES) this.personality[state] = rng.range(0.7, 1.3)
```

New private methods (near `context`):

```ts
  private othersByState(world: World): Partial<Record<VillagerState, number>> {
    const counts: Partial<Record<VillagerState, number>> = {}
    for (const other of world.villagers) {
      if (other === this || !other.alive) continue
      counts[other.state] = (counts[other.state] ?? 0) + 1
    }
    return counts
  }

  /** Free enough to be pulled into a conversation. */
  private canJoinChat(): boolean {
    return this.alive
      && this.zapTime < 0
      && this.rainTime <= 0
      && this.performance === 'none'
      && this.celebration === null
      && this.suggestion === null
      && (this.state === 'wander' || this.state === 'sitAtFire')
  }

  private findChatPartner(world: World): Villager | null {
    let best: Villager | null = null
    for (const other of world.villagers) {
      if (other === this || !other.canJoinChat()) continue
      const d = distance(this, other)
      if (d > CHAT_RANGE) continue
      if (!best || d < distance(this, best)) best = other
    }
    return best
  }
```

Extend `context(world)` with the three new fields:

```ts
      hasChatPartner: this.findChatPartner(world) !== null,
      stateCounts: this.othersByState(world),
      personality: this.personality,
```

In `enter()`, add to the reset block (after `this.gatheringBySuggestion = false`):

```ts
    this.chatPartner = null
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers/villager.test.ts src/villagers/fsm.test.ts`
Expected: PASS. Then `npx vitest run src/villagers` — the whole villagers folder must be green (existing tests unaffected). Note: until Tasks 4–7 add `enter`/`performActivity` cases, the new states are reachable but behave as no-ops; TypeScript may flag non-exhaustive switches in `villager.ts` — if it does, add temporary `case 'chat': case 'watchSea': case 'dance': case 'nap': return` arms to `enter` and `performActivity` switches (replaced in Tasks 4–7) and a `stateDuration` already covers durations.

### Task 3: Wander — mid-stroll pause and look-around

**Files:**
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`
- Modify: `src/villagers/model.ts`
- Test: `src/villagers/model.test.ts`

**Interfaces:**
- Consumes: `stateDuration('wander')` now 4–9s (Task 1).
- Produces: private fields `wanderPauseAt: number`, `lookAround: number`; behavior only.

- [ ] **Step 1: Write the failing test**

Append to `src/villagers/villager.test.ts`. Extend the existing `activityHarness` union type with `'wander'` (`state: 'sitAtFire' | 'fish' | ... | 'wander'`) and add `wanderPauseAt: number`, `lookAround: number`, `setTarget(p: { x: number; z: number }): void`, and `tx: number`, `tz: number` to the `ActivityHarness` type and initializer (`wanderPauseAt = -1`, `lookAround = 0`, `tx = 0`, `tz = 0`) if not already present.

```ts
describe('wander pause', () => {
  it('stops mid-stroll when the pause moment arrives, then resumes', () => {
    const villager = activityHarness('wander')
    villager.x = 1; villager.z = 1
    villager.tx = 5; villager.tz = 5
    villager.arrived = false
    villager.timer = 3
    villager.wanderPauseAt = 4 // timer already past the pause moment
    const world = {
      graves: [],
      submerged: () => false,
    } as unknown as World

    villager.performActivity(0.1, true, world)
    // Paused: target snapped to the current position, pause consumed.
    expect(villager.tx).toBe(1)
    expect(villager.tz).toBe(1)
    expect(villager.wanderPauseAt).toBe(-1)
    expect(villager.lookAround).toBeGreaterThan(0)

    // Look-around runs down, then a new stroll target is chosen.
    villager.performActivity(2, true, world)
    expect(villager.lookAround).toBeLessThanOrEqual(0)
    expect(villager.tx !== 1 || villager.tz !== 1).toBe(true)
  })
})
```

The harness needs `rng` for `randomWalkPoint`: add `villager.rng = new RNG(5)` to the harness initializer (field exists on `Villager`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/villagers/villager.test.ts -t 'wander pause'`
Expected: FAIL — pause fields undefined / target unchanged.

- [ ] **Step 3: Implement**

New private fields:

```ts
  private wanderPauseAt = -1
  private lookAround = 0
```

In `enter()`'s reset block: `this.wanderPauseAt = -1` and `this.lookAround = 0`.
In `enter()`'s `case 'wander':`:

```ts
      case 'wander':
        // Half of all strolls include a stop to look around partway through.
        this.wanderPauseAt = this.rng.chance(0.5)
          ? this.timer * this.rng.range(0.35, 0.65)
          : -1
        this.setTarget(this.randomWalkPoint(world))
        return
```

In `performActivity`'s `case 'wander':`, insert before the existing `graveGlance` logic:

```ts
        if (this.wanderPauseAt > 0 && this.timer <= this.wanderPauseAt && !this.arrived) {
          this.wanderPauseAt = -1
          this.lookAround = 1.4
          this.setTarget({ x: this.x, z: this.z })
        }
        if (this.lookAround > 0) {
          this.lookAround -= dt
          if (ticked) {
            this.head.rotation.y = Math.floor(this.timer * TIMING.fps / 3) % 2 === 0
              ? 0.55
              : -0.55
          }
          if (this.lookAround <= 0) {
            this.head.rotation.y = 0
            this.setTarget(this.randomWalkPoint(world))
          }
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers`
Expected: PASS, including all pre-existing wander tests.

### Task 4: `nap` behavior

**Files:**
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`

**Interfaces:**
- Consumes: `stateDuration('nap')` (Task 1).
- Produces: `enter`/`performActivity` `case 'nap'`; the shared tick block excludes `nap` from the standard model-scale write; `VillagerModel.resetPose()` restores its group position and rotation so waking and interruption cannot preserve a prone transform.

- [ ] **Step 1: Write the failing test**

Extend `activityHarness`'s state union with `'nap'`. Append:

```ts
describe('nap', () => {
  it('lies fully on its side in place and breathes through its chest axis', () => {
    const villager = activityHarness('nap')
    villager.x = 2; villager.z = 3
    villager.tx = 2; villager.tz = 3
    villager.timer = 15
    const world = {} as unknown as World

    villager.performActivity(0.1, true, world)
    expect(villager.arrived).toBe(true)
    expect(villager.model.rotation.z).toBeCloseTo(-Math.PI / 2)
    expect(villager.model.position.y).toBeCloseTo(0.27)
    expect(villager.model.scale.x).toBeGreaterThanOrEqual(MODEL_SCALE)
    expect(villager.model.scale.x).toBeLessThanOrEqual(MODEL_SCALE * 1.04)
    expect(villager.model.scale.y).toBeCloseTo(MODEL_SCALE)
    expect(villager.head.rotation.x).toBeCloseTo(0.18)
  })
})
```

In `src/villagers/model.test.ts`, add the reset regression:

```ts
it('restores the model transform after a prone pose', () => {
  const subject = new VillagerModel('villager-1', 7, false)
  subject.group.rotation.z = -Math.PI / 2
  subject.group.position.y = 0.27

  subject.resetPose()

  expect(subject.group.rotation.toArray()).toEqual([0, 0, 0, 'XYZ'])
  expect(subject.group.position.toArray()).toEqual([0, 0, 0])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/villagers/villager.test.ts -t 'nap'`
Expected: FAIL — the current nap only squashes vertically, and `resetPose()` does not restore model position/rotation.

- [ ] **Step 3: Implement**

`enter()` case:

```ts
      case 'nap': {
        this.setTarget({ x: this.x, z: this.z })
        this.emote('sleep')
        return
      }
```

`performActivity()` case:

```ts
      case 'nap': {
        if (this.targetDistance() < 0.3) this.arrived = true
        if (this.arrived && ticked) {
          // Roll the complete rig onto its side. Scaling local X becomes a
          // subtle chest rise after the quarter-turn instead of a sitting squash.
          const breathe = Math.floor(this.timer * TIMING.fps / 2) % 2 === 0 ? 1.04 : 1
          this.model.rotation.z = -Math.PI / 2
          this.model.position.y = 0.27
          this.model.scale.set(MODEL_SCALE * breathe, MODEL_SCALE, MODEL_SCALE)
          this.head.rotation.x = 0.18
          this.arms[0].rotation.z = -0.55
          this.arms[1].rotation.z = 0.85
        }
        return
      }
```

At the start of `VillagerModel.resetPose()` in `src/villagers/model.ts`, restore the complete model transform:

```ts
    this.group.position.set(0, 0, 0)
    this.group.rotation.set(0, 0, 0)
```

In `update()`, the standard scale write (`if (this.state !== 'drink') this.model.scale.set(...)`) must also skip `nap`:

```ts
    if (this.state !== 'drink' && this.state !== 'nap') {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers`
Expected: PASS, including the horizontal nap, 12–18 second duration, and prone-pose reset regressions.

### Task 5: `watchSea` behavior

**Files:**
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`

**Interfaces:**
- Consumes: `WALK_RADIUS` from `../world/island` (already imported).
- Produces: `enter`/`performActivity` `case 'watchSea'`; the `sitting` squash list and the arrived-facing overrides in `update()` include `watchSea`.

- [ ] **Step 1: Write the failing test**

Extend `activityHarness`'s state union with `'watchSea'`. Append:

```ts
describe('watchSea', () => {
  it('targets the shoreline in the villager’s outward direction', () => {
    const villager = activityHarness('watchSea')
    villager.x = 3; villager.z = 4 // radius 5, direction (0.6, 0.8)
    villager.rng = new RNG(2)
    // enter() is mocked in the harness; call the real one.
    const enter = Villager.prototype['enter'] as (
      this: unknown, state: string, world: World,
    ) => void
    const world = { submerged: () => false } as unknown as World
    enter.call(villager, 'watchSea', world)
    const radius = Math.hypot(villager.tx, villager.tz)
    expect(radius).toBeCloseTo(WALK_RADIUS, 1)
    expect(villager.tx / radius).toBeCloseTo(0.6, 1)
    expect(villager.tz / radius).toBeCloseTo(0.8, 1)
  })

  it('sits once it reaches the shore', () => {
    const villager = activityHarness('watchSea')
    villager.x = 10; villager.z = 0
    villager.tx = 10; villager.tz = 0
    villager.performActivity(0.1, true, {} as unknown as World)
    expect(villager.arrived).toBe(true)
  })
})
```

Note: calling the real `enter` requires the harness fields it touches (`resumeState`, `rod`, `heldFruit`, `axe` via `rig`, `timer`, `suggestion`, targets) — the existing `activityHarness` already initializes these; add any missing ones (`targetHut = null`, `targetGrave = null`, `targetMourningPond = null`, `targetCampfire = null`, `rebuildingRuin = false`, `graveGlance = 0`) to the initializer. If wiring the real `enter` proves brittle, instead assert via a focused unit on the target math by extracting it (see Step 3's `shorePoint`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/villagers/villager.test.ts -t 'watchSea'`
Expected: FAIL — no `watchSea` case; target stays at spawn.

- [ ] **Step 3: Implement**

`enter()` case:

```ts
      case 'watchSea': {
        let angle = Math.atan2(this.z, this.x)
        if (Math.hypot(this.x, this.z) < 0.5) angle = this.rng.range(0, Math.PI * 2)
        this.setTarget({
          x: Math.cos(angle) * WALK_RADIUS,
          z: Math.sin(angle) * WALK_RADIUS,
        })
        return
      }
```

`performActivity()` case:

```ts
      case 'watchSea': {
        if (this.targetDistance() < 0.35 && !this.arrived) {
          this.arrived = true
          this.emote('sleep')
        }
        return
      }
```

In `update()`'s tick block:
1. Extend the `sitting` squash: `const sitting = this.arrived && (this.state === 'sitAtFire' || this.state === 'fish' || this.state === 'drink' || this.state === 'watchSea')`.
2. Add an arrived-facing override to the existing `if (this.arrived && this.targetPond ...) { ... } else if (mourn) { ... }` chain:

```ts
    } else if (this.arrived && this.state === 'watchSea') {
      // Face out to sea: away from the island centre.
      this.group.rotation.y = Math.atan2(this.x, this.z)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers`
Expected: PASS.

### Task 6: `dance` behavior

**Files:**
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`

**Interfaces:**
- Consumes: `world.campfire.lit`.
- Produces: `enter`/`performActivity` `case 'dance'`; arrived-facing override toward the fire and an on-beat hop in `update()`'s tick block.

- [ ] **Step 1: Write the failing test**

Extend `activityHarness`'s state union with `'dance'`. Append:

```ts
describe('dance', () => {
  const world = (lit: boolean): World => ({
    campfire: { x: 0, z: 0, lit },
  } as unknown as World)

  it('bounces by the lit fire with arms raised', () => {
    const villager = activityHarness('dance')
    villager.x = 1.7; villager.z = 0
    villager.tx = 1.7; villager.tz = 0
    villager.timer = 5
    villager.performActivity(0.1, true, world(true))
    expect(villager.arrived).toBe(true)
    expect(Math.abs(villager.arms[0].rotation.z)).toBeGreaterThan(1)
  })

  it('stops when the fire goes out', () => {
    const villager = activityHarness('dance')
    villager.performActivity(0.1, true, world(false))
    expect(villager.enter).toHaveBeenCalledWith('wander', expect.anything())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/villagers/villager.test.ts -t 'dance'`
Expected: FAIL — no `dance` case.

- [ ] **Step 3: Implement**

`enter()` case:

```ts
      case 'dance': {
        if (!world.campfire?.lit) return this.enter('wander', world)
        // Outside the sitters' ring (1.25) so dancers weave between them.
        const angle = this.rng.range(0, Math.PI * 2)
        this.setTarget({
          x: world.campfire.x + Math.cos(angle) * 1.7,
          z: world.campfire.z + Math.sin(angle) * 1.7,
        })
        return
      }
```

`performActivity()` case:

```ts
      case 'dance': {
        if (!world.campfire?.lit) {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.25) {
          this.arrived = true
          if (ticked) {
            const frame = Math.floor(this.timer * TIMING.fps) % 4
            const lift = frame < 2 ? 2.05 : 1.2
            this.arms[0].rotation.z = -lift
            this.arms[1].rotation.z = lift
          }
        }
        return
      }
```

In `update()`'s tick block:
1. Facing override in the arrived-facing chain:

```ts
    } else if (this.arrived && this.state === 'dance') {
      this.group.rotation.y = Math.atan2(
        world.campfire.x - this.x,
        world.campfire.z - this.z,
      )
    }
```

2. On-beat hop, next to the existing walking bob (`this.group.position.y += !this.arrived && frame % 2 === 0 ? 0.03 : 0`):

```ts
    if (this.arrived && this.state === 'dance' && frame % 2 === 0) {
      this.group.position.y += 0.1
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers`
Expected: PASS.

### Task 7: `chat` behavior — pairing handshake

**Files:**
- Modify: `src/villagers/villager.ts`
- Test: `src/villagers/villager.test.ts`

**Interfaces:**
- Consumes: `findChatPartner` / `canJoinChat` / `chatPartner` from Task 2.
- Produces: public method `joinChat(initiator: Villager, duration: number): void`; `enter` gains a fifth optional parameter `chatWith: Villager | null = null`; `enter`/`performActivity` `case 'chat'`; arrived-facing override toward the partner.

- [ ] **Step 1: Write the failing tests**

Extend `activityHarness`'s state union with `'chat'` and add `chatPartner` to its type/initializer. Append:

```ts
describe('chat', () => {
  it('drops back to wander when the partner is lost', () => {
    const villager = activityHarness('chat')
    const partner = activityHarness('chat')
    villager.chatPartner = partner as unknown as Villager
    partner.chatPartner = villager as unknown as Villager
    partner.alive = false
    villager.performActivity(0.1, true, {} as unknown as World)
    expect(villager.enter).toHaveBeenCalledWith('wander', expect.anything())
  })

  it('drops back to wander when the partner changed activity', () => {
    const villager = activityHarness('chat')
    const partner = activityHarness('fish')
    villager.chatPartner = partner as unknown as Villager
    villager.performActivity(0.1, true, {} as unknown as World)
    expect(villager.enter).toHaveBeenCalledWith('wander', expect.anything())
  })

  it('bobs once both have met', () => {
    const villager = activityHarness('chat')
    const partner = activityHarness('chat')
    villager.chatPartner = partner as unknown as Villager
    partner.chatPartner = villager as unknown as Villager
    partner.alive = true
    villager.x = 1; villager.z = 0
    villager.tx = 1; villager.tz = 0
    villager.timer = 5
    villager.performActivity(0.1, true, {} as unknown as World)
    expect(villager.arrived).toBe(true)
    expect(villager.emote).toHaveBeenCalledWith('question')
  })
})
```

The harness fields `alive` and `chatPartner` must exist on `ActivityHarness` (add `alive: boolean` initialized `true`, `chatPartner: unknown` initialized `null`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/villagers/villager.test.ts -t 'chat'`
Expected: FAIL — no `chat` case in `performActivity`.

- [ ] **Step 3: Implement**

Change `enter`'s signature:

```ts
  private enter(
    state: VillagerState,
    world: World,
    preferredPond: Pond | null = null,
    preferredTree: Tree | null = null,
    chatWith: Villager | null = null,
  ): void {
```

Public pairing method (near `suggest`):

```ts
  /** Pulled into a conversation by an initiator who has already chosen us. */
  joinChat(initiator: Villager, duration: number): void {
    if (!this.canJoinChat()) return
    this.enter('chat', this.world, null, null, initiator)
    this.timer = duration
  }
```

Helper (near `findChatPartner`):

```ts
  /** A spot just short of the partner, so the pair stand face to face. */
  private meetingPoint(partner: Villager): Point {
    const dx = partner.x - this.x
    const dz = partner.z - this.z
    const length = Math.hypot(dx, dz)
    if (length <= 0.7) return { x: this.x, z: this.z }
    return {
      x: partner.x - dx / length * 0.7,
      z: partner.z - dz / length * 0.7,
    }
  }
```

`enter()` case:

```ts
      case 'chat': {
        this.chatPartner = chatWith ?? this.findChatPartner(world)
        if (!this.chatPartner) return this.enter('wander', world)
        if (chatWith) {
          // The joiner waits where they are; the initiator walks over.
          this.setTarget({ x: this.x, z: this.z })
          return
        }
        this.chatPartner.joinChat(this, this.timer)
        if (this.chatPartner.state !== 'chat') {
          this.chatPartner = null
          return this.enter('wander', world)
        }
        this.setTarget(this.meetingPoint(this.chatPartner))
        return
      }
```

`performActivity()` case:

```ts
      case 'chat': {
        const partner = this.chatPartner
        if (!partner || !partner.alive || partner.state !== 'chat') {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.3) {
          if (!this.arrived) {
            this.arrived = true
            this.emote('question')
          }
          if (ticked) {
            // Nodding along: head bows on the beat, one arm gestures.
            const frame = Math.floor(this.timer * TIMING.fps) % 4
            this.head.rotation.x = frame < 2 ? 0.18 : -0.06
            this.arms[0].rotation.z = frame === 1
              ? -0.9
              : this.arms[0].userData.baseRotation
          }
        }
        return
      }
```

Arrived-facing override in `update()`'s chain:

```ts
    } else if (this.arrived && this.state === 'chat' && this.chatPartner) {
      this.group.rotation.y = Math.atan2(
        this.chatPartner.x - this.x,
        this.chatPartner.z - this.z,
      )
    }
```

Remove any temporary no-op arms left from Task 2.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/villagers`
Expected: PASS — all villagers-folder tests green.

### Task 8: Faster arrivals

**Files:**
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts`

**Interfaces:**
- Consumes/Produces: `World.repopulate` unchanged in shape; interval 20–30s → 10–18s.

- [ ] **Step 1: Write the failing test**

Find the existing repopulation describe block in `src/world/world.test.ts` (around the `world.repopulate(60, new RNG(1))` call) and add alongside, reusing that block's world setup:

```ts
  it('arrives within eighteen seconds and never before ten', () => {
    // Reuse the surrounding block's world with spare capacity.
    const before = world.living()
    world.repopulate(9, new RNG(1))
    expect(world.living()).toBe(before) // interval floor is 10s
    world.repopulate(9, new RNG(1))    // 18s elapsed ≥ interval ceiling
    expect(world.living()).toBe(before + 1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/world/world.test.ts -t 'eighteen'`
Expected: FAIL — with a 20–30s interval, 18s elapsed spawns nobody.

- [ ] **Step 3: Implement**

In `World.repopulate`, change:

```ts
    if (this.repopulateTimer === null) this.repopulateTimer = rng.range(10, 18)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/world/world.test.ts`
Expected: PASS, including pre-existing repopulation tests (they use 60s steps, comfortably above both intervals).

### Task 9: Move simulation state out of the render callback

**Files:**
- Modify: `src/main.ts`
- Modify: `src/world/world.ts` (foley mute flag)

**Interfaces:**
- Consumes: existing update methods.
- Produces: the sim callback owns `clock.advance`, `powers.update`, `world.updateTrees`, hut updates, `world.campfire.update`, `world.updatePonds`; `World` gains public field `foleyMuted: boolean` respected by `playStepFoley`.

- [ ] **Step 1: Rearrange the loop callbacks in `src/main.ts`**

The sim callback becomes:

```ts
  (dt) => {
    if (!simulatesGameplay(flow)) return
    clock.advance(dt)
    powers.update(dt)
    world.updateFire(dt, fireRng)
    world.updateGraves(dt)
    world.relocateDrownedRuins(rng, lowFx)
    world.updateTrees(dt, clock.quantizedTime)
    for (const hut of world.huts) hut.update(dt, clock.quantizedTime)
    world.campfire.update(dt, clock.quantizedTime)
    world.updatePonds(dt, clock.quantizedTime)
    for (const villager of world.villagers) {
      villager.update(dt, clock.quantizedTime, world, island)
    }
    world.repopulate(dt, rng, lowFx)
    world.reseedForest(dt, rng, lowFx)
  },
```

In the render callback's `if (gameplayActive)` block, delete the moved lines (`clock.advance(dt)`, `world.updateTrees(...)`, the hut loop, `world.campfire.update(...)`, `world.updatePonds(...)`, `powers.update(dt)`), keeping `targeting.update()`, `celebration?.update(dt)`, `particles.update(dt)`, the `tray.setCooldown` loop, and `world.updateFireLights(camera.position)`. Celebration deliberately stays render-driven: it choreographs camera and fireworks, so a queued celebration waits for the player's return.

Run `grep -n 'clock\.' src/main.ts` afterwards and confirm every remaining `clock.quantizedTime`/`clock.ticked` consumer still makes sense with the clock advanced in sim.

- [ ] **Step 2: Add the foley mute flag in `src/world/world.ts`**

```ts
  /** Hidden tabs simulate silently; footsteps would leak into other tabs. */
  foleyMuted = false
```

and change `playStepFoley`:

```ts
  playStepFoley(): void { if (!this.foleyMuted) this.stepFoley?.() }
```

- [ ] **Step 3: Verify**

Run: `npx vitest run` (full suite) and `npm run build`.
Expected: all tests pass; build clean. Then launch `npm run dev`, play past Begin, and confirm trees still grow, fires still burn down, power cooldown rings still drain, and villagers behave — this step moves update call sites, so a live sanity check is required.

### Task 10: GameLoop background mode + worker ticker + visibility wiring

**Files:**
- Modify: `src/core/loop.ts`
- Create: `src/core/backgroundTicker.ts`
- Modify: `src/main.ts`
- Test: `src/core/core.test.ts`

**Interfaces:**
- Consumes: `simulatesGameplay(flow)`, `world.foleyMuted` (Task 9).
- Produces: `GameLoop.setBackground(active: boolean): void`, `GameLoop.backgroundTick(): void`, `GameLoop` constructor gains optional `now: () => number` (ms, defaults to `performance.now()`), static `GameLoop.MAX_CATCH_UP = 30`; `createBackgroundTicker(onTick: () => void, intervalMs = 500): { start(): void; stop(): void }`.

- [ ] **Step 1: Write the failing tests**

In `src/core/core.test.ts`, next to the existing `GameLoop lifecycle` block (follow its rAF stubbing pattern; the code below assumes `vi.stubGlobal`):

```ts
describe('GameLoop background mode', () => {
  const stubRaf = () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  }

  it('advances sim by wall-clock elapsed while hidden, capped per drain', () => {
    stubRaf()
    let time = 0
    let steps = 0
    const loop = new GameLoop(() => { steps++ }, () => {}, 1 / 30, () => time)
    loop.start()
    loop.setBackground(true)

    time += 2_000 // 2s hidden
    loop.backgroundTick()
    expect(steps).toBe(60)

    time += 120_000 // 2min hidden in one throttled tick
    loop.backgroundTick()
    expect(steps).toBe(60 + 900) // capped at 30 sim-seconds per drain

    loop.stop()
    vi.unstubAllGlobals()
  })

  it('banks elapsed time when returning to visible without any tick', () => {
    stubRaf()
    let time = 0
    let steps = 0
    const loop = new GameLoop(() => { steps++ }, () => {}, 1 / 30, () => time)
    loop.start()
    loop.setBackground(true)
    time += 10_000 // frozen tab: worker never fired
    loop.setBackground(false)
    expect(steps).toBe(300) // 10s caught up on return
    loop.stop()
    vi.unstubAllGlobals()
  })

  it('ignores background ticks while visible', () => {
    stubRaf()
    let steps = 0
    let time = 0
    const loop = new GameLoop(() => { steps++ }, () => {}, 1 / 30, () => time)
    loop.start()
    time += 5_000
    loop.backgroundTick()
    expect(steps).toBe(0)
    loop.stop()
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/core.test.ts -t 'background'`
Expected: FAIL — `setBackground` / `backgroundTick` are not functions.

- [ ] **Step 3: Implement `GameLoop` background mode in `src/core/loop.ts`**

```ts
export class GameLoop {
  /** Longest stretch of sim time drained in one visible frame or hidden tick. */
  static readonly MAX_CATCH_UP = 30

  private acc = 0; private last = 0; private raf = 0; private running = false
  private background = false
  constructor(
    private onSim: (dt: number) => void,
    private onRender: (dt: number) => void,
    private simDt = 1 / 30,
    private now: () => number = () => performance.now(),
  ) {}

  start(): void {
    if (this.running) return
    this.running = true; this.last = this.now(); this.acc = 0
    this.scheduleFrame()
  }

  /** Hidden tabs swap the rAF drive for external ticks; sim time keeps flowing. */
  setBackground(active: boolean): void {
    if (!this.running || this.background === active) return
    // A fully-frozen tab may never have ticked: bank the elapsed time before
    // switching drives so the catch-up happens on return.
    if (!active) this.backgroundTick()
    this.background = active
    cancelAnimationFrame(this.raf)
    this.last = this.now()
    if (!active) this.scheduleFrame()
  }

  /** One hidden-tab tick: advance sim by real elapsed time, render nothing. */
  backgroundTick(): void {
    if (!this.running || !this.background) return
    const now = this.now()
    this.acc += (now - this.last) / 1000
    this.last = now
    this.drainSim()
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.raf) }

  private scheduleFrame(): void {
    const frame = (now: number) => {
      if (!this.running || this.background) return
      const dt = Math.min((now - this.last) / 1000, 0.1)
      this.last = now; this.acc += dt
      this.drainSim()
      if (!this.running) return
      this.onRender(dt)
      if (this.running && !this.background) this.raf = requestAnimationFrame(frame)
    }
    this.raf = requestAnimationFrame(frame)
  }

  private drainSim(): void {
    this.acc = Math.min(this.acc, GameLoop.MAX_CATCH_UP)
    while (this.running && this.acc >= this.simDt) {
      this.onSim(this.simDt)
      this.acc -= this.simDt
    }
  }
}
```

`QuantizedClock` is unchanged. Note the visible-path behavior is identical to before (0.1s frame clamp), except leftover background accumulation drains on the first visible frame — that is the return catch-up.

- [ ] **Step 4: Create `src/core/backgroundTicker.ts`**

```ts
/**
 * Ticks from a Web Worker so hidden tabs keep receiving them: page timers
 * throttle to once a minute in the background, worker timers far less. The
 * loop measures real elapsed time itself, so sparse ticks only batch the
 * catch-up — they never lose time.
 */
export function createBackgroundTicker(
  onTick: () => void,
  intervalMs = 500,
): { start(): void; stop(): void } {
  let worker: Worker | null = null
  let workerUrl: string | null = null
  let fallback = 0
  return {
    start(): void {
      if (worker || fallback) return
      try {
        const source = `setInterval(() => postMessage(0), ${intervalMs})`
        workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        worker = new Worker(workerUrl)
        worker.onmessage = () => onTick()
      } catch {
        fallback = window.setInterval(onTick, intervalMs)
      }
    },
    stop(): void {
      worker?.terminate()
      worker = null
      if (workerUrl) URL.revokeObjectURL(workerUrl)
      workerUrl = null
      if (fallback) clearInterval(fallback)
      fallback = 0
    },
  }
}
```

- [ ] **Step 5: Wire visibility in `src/main.ts`**

After `loop.start()`:

```ts
const backgroundTicker = createBackgroundTicker(() => loop.backgroundTick())
document.addEventListener('visibilitychange', () => {
  world.foleyMuted = document.hidden
  if (document.hidden && simulatesGameplay(flow)) {
    loop.setBackground(true)
    backgroundTicker.start()
  } else {
    backgroundTicker.stop()
    loop.setBackground(false)
  }
})
```

Import `createBackgroundTicker` from `./core/backgroundTicker`.

- [ ] **Step 6: Run tests and verify live**

Run: `npx vitest run src/core` then `npm run build`. Expected: PASS, clean build.
Live check with `npm run dev`: begin the game, note villager positions, switch to another tab for ~60 seconds, return — villagers must have moved/acted and any grown saplings advanced, with no console errors and no audio while hidden. Confirm the title screen does NOT simulate while hidden (visit title, hide 30s, return — orbit resumes without a jump).

### Task 11: Favicon — transparent in-game clay cloud

**Files:**
- Create: `public/favicon.svg`
- Create: `public/favicon-32.png`
- Create: `public/apple-touch-icon.png`
- Modify: `index.html`

- [ ] **Step 1: Generate three scratchpad SVG candidates without changing `public/`**

Create these candidates under `/private/tmp/clay-island-favicon-candidates/`:

- `ambient.svg` — four merged, irregular puffs in the low silhouette of the normal scene cloud, with a continuous cream-to-peach vertical gradient.
- `toon.svg` — four irregular puffs with three distinct lighting bands, echoing `clayMaterial()`'s toon ramp.
- `procedural.svg` — four dominant flattened puffs joined by a low front mass, closest to the literal `src/scene.ts` construction.

Each SVG uses `viewBox="0 0 64 64"`, has no background element, keeps at least four units of transparent margin, uses `#fffaf2` for the brightest clay, and contains no outline, cast shadow, island, weather mark, or small decorative detail.

Use these exact candidate sources:

```svg
<!-- ambient.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="clay" x1="0.28" y1="0.08" x2="0.62" y2="1">
      <stop offset="0" stop-color="#fffaf2"/>
      <stop offset="0.48" stop-color="#f6e9d8"/>
      <stop offset="0.73" stop-color="#e7c8aa"/>
      <stop offset="1" stop-color="#c99470"/>
    </linearGradient>
    <radialGradient id="light" cx="0.28" cy="0.12" r="0.78">
      <stop offset="0" stop-color="#fffdf8" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#fffdf8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path fill="url(#clay)" d="M5 36c.4-6 4.5-10.2 10.4-10.5C17 19.9 21.8 16.9 27 18c3-5.4 11.6-6 15.1-.8 1.5 2.1 1.8 4.1 1.5 6.2 6.8-1.2 12.7 2.4 14.7 7.9 2.7 7.6-3.8 15-12.6 16.4-8.6 1.4-25 1.3-32.7-1.1C7.5 44.9 4.7 41 5 36Z"/>
  <path fill="url(#light)" d="M9 33c2-4.4 5.3-6.1 9.7-5.7 1-4.6 4.7-7.3 9.5-6.4 3-4.7 9.9-4.8 13-.5 1.2 1.6 1.6 3.5 1.3 5.5 4.6-.7 8.8 1 11.5 4.5-8.7-2.6-15.7 1.1-23.8.8-7.7-.3-13.6-1.8-21.2 1.8Z"/>
</svg>
```

```svg
<!-- toon.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <clipPath id="silhouette">
      <path d="M5 37c.1-5.9 4-10.4 10.1-10.8.6-6.8 6.6-10.7 12.2-8 3.8-6.4 13.6-5.4 15.8 1.6.5 1.5.6 3 .3 4.5 7.6-1.2 14.6 3.7 15.5 10.8.9 7.4-5.1 12.5-13.4 13.6-10.2 1.4-25.4 1-32.9-1.4C7.5 45.7 4.9 41.8 5 37Z"/>
    </clipPath>
  </defs>
  <g clip-path="url(#silhouette)">
    <rect x="4" y="12" width="56" height="22" fill="#fffaf2"/>
    <path fill="#f0dcc6" d="M3 31c9-4 16-1 23 .1 10 1.6 19-4.4 36-.4v12H3Z"/>
    <path fill="#c99673" d="M3 41c9-3 17 1.8 27 .3 11-1.7 18-4.3 32-.7v13H3Z"/>
  </g>
</svg>
```

```svg
<!-- procedural.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="puff" x1="0.25" y1="0.08" x2="0.7" y2="1">
      <stop offset="0" stop-color="#fffaf2"/>
      <stop offset="0.58" stop-color="#f0dac4"/>
      <stop offset="1" stop-color="#c28d69"/>
    </linearGradient>
    <linearGradient id="front" x1="0.3" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#fffdf8"/>
      <stop offset="0.62" stop-color="#f3e0cb"/>
      <stop offset="1" stop-color="#d2a17e"/>
    </linearGradient>
  </defs>
  <path fill="url(#puff)" d="M5 37c0-5.7 3.5-9.5 8.7-9.8 5.1-.3 9.2 3.2 9.4 8.5.2 5.2-3.3 9.5-8.5 10.1C9 46.4 5 42.8 5 37Z"/>
  <path fill="url(#puff)" d="M14 30c.2-7 4.7-11.5 11.2-11.2 6.4.3 10 5.2 9.6 11.7-.3 6.2-4.7 10.3-10.8 10.3-6.3 0-10.2-4.4-10-10.8Z"/>
  <path fill="url(#front)" d="M25 24.5c.4-7.7 5.4-12.1 12.2-11.4 6.6.7 10.4 5.7 9.5 12.8-.8 6.8-5.8 10.8-12.3 10.2-6.6-.6-9.8-5.1-9.4-11.6Z"/>
  <path fill="url(#puff)" d="M40 31c.4-6.6 4.9-10.3 10.7-9.6 5.7.7 9 5.4 8.2 11.5-.8 5.9-5.2 9.5-10.8 8.8-5.7-.6-8.5-4.7-8.1-10.7Z"/>
  <path fill="url(#front)" d="M12 38c.2-6.3 5-10.4 11.6-10 6.1.4 10.2 3 14.2 2.8 5.8-.3 11.7-2 16.5 2.5 5.3 5 1.5 12.1-5.5 14.1-8.2 2.3-25.3 2-32.3-.5-4.4-1.6-4.7-5.5-4.5-8.9Z"/>
</svg>
```

- [ ] **Step 2: Rasterize and present the candidates**

For each candidate, generate 180×180, 32×32, and 16×16 PNGs using the explicitly approved `sharp-cli`. Build `/private/tmp/clay-island-favicon-candidates/comparison.svg` with a transparent checkerboard preview, three labeled 180px renders, and each candidate's 32px and 16px samples. Rasterize it to `comparison.png` and show it to the user.

Use `<image href="ambient.svg">`, `<image href="toon.svg">`, and `<image href="procedural.svg">` in three 276×300 checkerboard cards within a 900×340 SVG. Label the cards `A · Ambient`, `B · Toon`, and `C · Procedural`; show the 180px image at `(48, 42)`, the 32px sample at `(170, 250)`, and the 16px sample at `(218, 258)` in each card's local coordinates.

Expected: all three retain an irregular, modeled clay silhouette at 16px. `file` reports the exact requested dimensions. `public/favicon.svg`, `public/favicon-32.png`, and `public/apple-touch-icon.png` are unchanged during this step.

- [ ] **Step 3: User approval gate**

Ask the user to choose Ambient, Toon, or Procedural, or request a revision. Do not replace any file under `public/` before that approval.

- [ ] **Step 4: Install the approved candidate and generate production rasters**

Copy the approved SVG source to `public/favicon.svg`. The user explicitly approved downloading and executing the unverified third-party `sharp-cli` package despite its supply-chain risk. Run:

```bash
npx --yes --package=sharp-cli sharp -i public/favicon.svg -o public/favicon-32.png resize 32 32
npx --yes --package=sharp-cli sharp -i public/favicon.svg -o public/apple-touch-icon.png resize 180 180
```

Expected: both commands exit 0; `file` reports 32×32 and 180×180 PNG images.

- [ ] **Step 5: Link in `index.html`** (inside `<head>`, before the stylesheet link)

```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

- [ ] **Step 6: Verify the installed favicon**

Run `npm run dev`, open the game, confirm the approved transparent cloud appears as the tab icon, and compare it with the approved 16px and 32px samples.

### Task 12: OG image — staged scene with title

**Files:**
- Modify: `public/og.png` (replace, same 1200×630)
- Scratchpad: capture + overlay intermediates (do not commit)

Depends on Tasks 1–10 being merged into the working tree so the staged scene shows the livelier island (dancing, chatting).

- [ ] **Step 1: Stage and capture**

Run `npm run dev`. Use browser automation (cmux-browser skill) at 2400×1260 viewport: begin the game, let the sim run until the campfire is lit and villagers are visibly mid-activity (dance/fish/build), frame a three-quarter view with the fire circle as focal point, and screenshot to the scratchpad as `og-scene.png`. Take several candidates; pick the sharpest, liveliest one.

- [ ] **Step 2: Compose the overlay**

Write `og-overlay.svg` (2400×1260) in the scratchpad — bottom-anchored scrim plus type in the UI font stack (`ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif`, per `src/styles.css`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1260">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.55" stop-color="#2b2118" stop-opacity="0"/>
      <stop offset="1" stop-color="#2b2118" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <rect width="2400" height="1260" fill="url(#scrim)"/>
  <text x="120" y="1060" font-family="Arial Rounded MT Bold, Trebuchet MS, sans-serif"
        font-size="150" font-weight="700" fill="#f6ead8">Clay Island</text>
  <text x="124" y="1150" font-family="Arial Rounded MT Bold, Trebuchet MS, sans-serif"
        font-size="56" fill="#e8d9c0">Make a mess. Watch the tiny clay villagers cope.</text>
</svg>
```

The user's `sharp-cli` supply-chain approval is scoped to the favicon, so the
OG workflow must not execute it. Compose the candidate with browser-native
Canvas in a scratchpad HTML file instead: draw the chosen screenshot crop into
a 1200×630 canvas, add the same bottom scrim and text at half the coordinates
and font sizes above, and center that canvas in the browser surface. Capture
the rendered surface, then use the built-in macOS image tool to extract the
centered canvas:

```bash
sips --cropToHeightWidth 630 1200 --cropOffset 471 36 \
  og-browser-screenshot.png --out og-candidate.png
```

The offsets assume the verified 1272×1572 cmux surface. Re-query the screenshot
dimensions and recalculate centered offsets if the surface changes. The
contract remains scene + scrim + title at exactly 1200×630.

- [ ] **Step 3: User approval gate**

Show `og-candidate.png` to the user. Iterate on framing/typography until approved. Only then copy over `public/og.png`.

- [ ] **Step 4: Verify**

`npm run build` and confirm `dist/og.png` ships the new image; view `index.html` meta tags unchanged.

### Task 13: Architecture doc, full verification

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update `docs/architecture.md`**

Document: the 16-state FSM (new states, variety rules: no-repeat, crowd penalty, personality), the 12–18 second side-lying nap and reset contract, the sim/render callback split (which updates are simulation-state vs presentation), and the background drive (`GameLoop.setBackground`/`backgroundTick`, worker ticker, 30s catch-up cap, foley mute).

- [ ] **Step 2: Full verification**

Run: `npx vitest run` — expected: all tests pass.
Run: `npm run build` — expected: clean TypeScript + Vite build.
Live pass with `npm run dev`: watch the island for ~3 minutes and confirm the new texture of life — villagers strolling with pauses, a chat pair, a shore-sitter, fire-side dancing, napping, no pile-ons at the pond/fruit trees, arrivals faster after building huts. Then the hidden-tab round trip from Task 10 Step 6 once more.

- [ ] **Step 3: Report**

Summarize results to the user, list changed files, and remind that nothing has been committed.

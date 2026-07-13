# Tiny God Game — Finishing Plan (Matrix, Discovery, Clay Book, Audio, Ship)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes:** Tasks 16–19 of `docs/plans/1-tiny-god-game.md`. That document's Tasks 0–15 are **done and shipped** — treat them as the existing codebase, not as work. Its **Global Constraints** and **"Deliberately not in this plan"** sections still bind this plan in full; they are restated below.

**Spec:** `docs/superpowers/specs/2026-07-12-tiny-god-game-design.md`

**Goal:** Finish the toy — make every power × target cell do something distinct, give the player a reason to keep playing (12 discoverable Moments in a clay book), give it a voice (synthesized foley), give it an opening (a cold open), give the villagers a performance, and ship it.

**Architecture:** The event bus already carries every signal the remaining systems need, so both new consumers — `Journal` (discovery) and `Sfx` (audio) — are *pure subscribers to the existing `EventBus`*. Nothing new needs to be emitted for them. The interaction matrix replaces three hand-rolled `applyXOutcome` dispatchers with one pure data table plus a completeness test. The journal's clay book is a real Three.js clay mesh rendered in a **second scissored viewport on the existing renderer** (one GL context, not two), with an invisible DOM layer over it carrying focus and keyboard.

**Tech Stack:** Existing — Vite, TypeScript (strict), three, postprocessing, Vitest. No new dependencies.

## Why this plan differs from the old Tasks 16–19

Three assumptions in the old plan died when Tasks 0–15 shipped. Read this before starting, or you will do work that is already done:

1. **The event bus is complete.** `world.ts` and `villager.ts` already emit every event the 12 Moments need, including the fiddly ones: `fruit:grown` carries `treeId` (for the distinct-tree count), `fire:doused` carries `burning` (for Firefighter/Wildfire), and `crater:created`/`pond:created` carry `x`/`z` (for the spatial Watering Hole match). **Do not add events.** Discovery is a consumer, not a producer.
2. **Audio already exists, badly.** `src/powers/meteor.ts` and `src/powers/lightning.ts` each construct a module-level `AudioContext` and synthesize inline. Task 5 *deletes* that code and re-triggers those sounds from bus events. Audio is an extraction, not a greenfield build.
3. **The tray already has the hooks.** `src/ui/tray.ts` ships an inert `#journal-btn` (with `aria-haspopup="dialog"` and a `0/12` counter) and an inert `#mute-btn`. Wire them; don't rebuild them.

Two things are **added** that the old plan lacked, both serving priorities the old plan itself declared:
- A **cold open** (Task 6) — serves the old plan's priority #1, "the idle scene must be beautiful before any power exists." The page currently just starts.
- A **villager performance layer** (Task 6) — serves priority #3, "reactions are the content." The meteor's growing shadow already hangs over the island for 1.2 s and *not one villager reacts to it*. That is the single biggest missed beat in the toy.

One thing is **changed**: the clay book is no longer an object lying on the ground beside the island (a category error — the island *floats*, there is no table in the world). It lives with the controls, as the old plan's own Task 0 originally intended: *"the UI is the stuff sitting on the table next to the model: three lumps of clay in a tray, and a notebook."*

## Global Constraints

Copied from `docs/plans/1-tiny-god-game.md`; they bind every task here.

- TypeScript `strict: true`; ESM; Vite layout.
- **No asset files.** No models, no image textures, no audio files. Canvas-generated textures are allowed (the toon ramp already is one). WebAudio synthesis only. No web fonts.
- **Villager FSM is hard-capped at exactly 8 states** (`wander, chopTree, buildHut, sitAtFire, flee, mourn, rebuild, fish`). Task 6 adds *performance*, not states. Do not add a 9th state.
- Pure-logic modules (marked **(pure)**) must not import `three`. They get unit tests. Visual modules are verified by running the app.
- Villager/object animation is quantized to 12 fps via `QuantizedClock`; camera, particles, and post run at display rate. **Never smooth the villagers.**
- **Every color comes from `src/ui/tokens.ts`.** No hex literal appears anywhere else.
- **Accessibility floor** (non-negotiable):
  - `prefers-reduced-motion: reduce` → no screen shake, no white flash (fade instead), no camera auto-rotate, no animated grain, no cold-open camera move, no book page-turn (cross-fade instead).
  - Every power and the journal is fully keyboard-reachable. Drag is the primary affordance, not the only one.
  - The journal is a focus-trapped dialog; `Esc` closes it and returns focus to `#journal-btn`.
- Performance: 60 fps on a mid-range laptop. `?lowfx=1` → no shadow map, no post stack, DPR 1, and (new) no book viewport.
- Seedable RNG everywhere — no `Math.random()` outside `RNG`.
- Conventional commits after every task.
- Dev server `npm run dev`; tests `npm test`. **Baseline at the start of this plan: 82 tests passing.**

## Deliberately not in this plan

Restated from the old plan so no task quietly reintroduces them: day/night cycle, resources/economy, villager dialogue, **pathfinding**, **villager memory or inter-villager coordination**, a flood power, multiple islands, eras, mobile-first layout. Desktop-first.

## File Structure

```
src/powers/matrix.ts        (pure, NEW)  — power × target table → declarative Interaction[]
src/powers/outcomes.ts      (NEW)        — Interaction kind → world side-effect handler map
src/discovery/moments.ts    (pure, NEW)  — the 12 Moment defs + Journal (storage injected)
src/ui/journal.ts           (NEW)        — DOM skeleton: button, dialog, focus trap, toasts, counter
src/ui/book.ts              (NEW)        — the 3D clay book: second scene + scissored viewport
src/audio/sfx.ts            (NEW)        — one AudioContext, master gain, voice cap, bus subscriber
src/intro.ts                (NEW)        — the cold open timeline
src/fx/emotes.ts            (MODIFY)     — add the 'cower' emote kind
src/villagers/villager.ts   (MODIFY)     — performance layer: lookUp/cower/flinch
src/powers/power.ts         (MODIFY)     — CastCtx gains `power: PowerId`
src/powers/meteor.ts        (MODIFY)     — delete whistle() + applyMeteorOutcome()
src/powers/lightning.ts     (MODIFY)     — delete crack/rumble synth + applyLightningOutcome()
src/powers/rain.ts          (MODIFY)     — ADD the matrix call; KEEP the area effect intact
src/main.ts                 (MODIFY)     — compose Journal, Sfx, book, intro
```

---

### Task 1: The interaction matrix (pure)

Small task, high leverage. The *behavior* is already correct and tested — this converts two hand-rolled `if`-ladders into one data table whose real value is the **completeness test**: it becomes impossible to add a matrix outcome and forget to implement it.

**Read this before you start, or you will introduce two regressions:**

1. **Lightning does not kill.** `applyLightningOutcome` calls `world.villagerAt(x, z, 1.2)?.zap()` — the *comic zap*, which is a gag, not a death. Only the meteor calls `killVillagerNear`. The old plan's table said `lightning: { villager: ['kill'] }`, and it was **wrong about the shipped behavior**. The matrix below therefore has a separate `zap` kind. Do not collapse `zap` into `kill`; you would turn a joke into a corpse.
2. **Rain is area-of-effect, not target-dispatched.** `rain.ts` has *no* `applyRainOutcome` and no `ctx.kind` branching. It applies douse + fillCraters + growFruit + bloom + grump over `RAIN_RADIUS` unconditionally, every cast (`src/powers/rain.ts:248–255`). That is correct and it is what makes rain feel like *weather* rather than like a targeted spell. **Do not route rain through the per-target matrix** — doing so would mean rain aimed at a tree stops dousing fires, which is a bad bug and a worse design. Rain's row in the matrix describes only the *extra, target-specific* flourish layered on top of its area effect; its area effect stays exactly where it is.

**Files:**
- Create: `src/powers/matrix.ts` **(pure)**, `src/powers/outcomes.ts`
- Test: `src/powers/matrix.test.ts`
- Modify: `src/powers/power.ts` (add `power` to `CastCtx`), `src/powers/meteor.ts` (delete `applyMeteorOutcome`), `src/powers/lightning.ts` (delete `applyLightningOutcome`), `src/powers/rain.ts` (add the matrix call *alongside* its existing area effect; delete nothing)

**Interfaces:**
- Consumes: `PowerId`, `TargetKind` from `src/core/events.ts`; `CastCtx` from `src/powers/power.ts`.
- Produces:
  - `type InteractionKind = 'ignite' | 'destroy' | 'kill' | 'zap' | 'scatter' | 'emptyPond' | 'steam' | 'floatFish' | 'flare' | 'growFruit' | 'grumpy'`
  - `type Interaction = { kind: InteractionKind }`
  - `resolveInteraction(power: PowerId, target: TargetKind): Interaction[]` **(pure)**
  - `INTERACTION_KINDS: readonly InteractionKind[]` — the exhaustive list, for the completeness test.
  - `applyInteractions(interactions: Interaction[], ctx: CastCtx, y0: number): void` — from `outcomes.ts`; dispatches each kind to a handler.
  - `OUTCOME_HANDLERS: Record<InteractionKind, (ctx: CastCtx, y0: number) => void>` — exported so the test can assert completeness.
  - `CastCtx` gains `power: PowerId` (see Step 4).

Note there is **no `douse`, `fillPond`, or `bloom` kind**: those are rain's *area* effects, which already exist in `rain.ts` and stay there. The matrix only carries per-target interactions.

- [ ] **Step 1: Write the failing test** — `src/powers/matrix.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { PowerId, TargetKind } from '../core/events'
import { INTERACTION_KINDS, resolveInteraction, type InteractionKind } from './matrix'
import { OUTCOME_HANDLERS } from './outcomes'

const POWERS: PowerId[] = ['meteor', 'lightning', 'rain']
const TARGETS: TargetKind[] = ['ground', 'tree', 'hut', 'villager', 'pond', 'crater', 'campfire']

// The shipped behavior, transcribed. This is the product, so assert it literally.
// NOTE: lightning ZAPS a villager (a gag), it does not KILL one. Only the meteor kills.
// NOTE: rain's row is only its per-target flourish — its douse/fillPond/bloom area
// effect lives in rain.ts and fires on every cast regardless of what was targeted.
const EXPECTED: Record<PowerId, Record<TargetKind, InteractionKind[]>> = {
  meteor: {
    tree: ['ignite', 'destroy'],
    hut: ['destroy'],
    villager: ['kill'],
    pond: ['emptyPond', 'steam'],
    campfire: ['scatter'],
    crater: [],
    ground: [],
  },
  lightning: {
    tree: ['ignite'],
    hut: ['ignite'],
    villager: ['zap'],
    pond: ['floatFish'],
    campfire: ['flare'],
    crater: [],
    ground: [],
  },
  rain: {
    tree: ['growFruit'],
    hut: [],
    villager: ['grumpy'],
    pond: [],
    campfire: [],
    crater: [],
    ground: [],
  },
}

describe('resolveInteraction', () => {
  for (const power of POWERS) {
    for (const target of TARGETS) {
      it(`${power} on ${target}`, () => {
        expect(resolveInteraction(power, target).map(i => i.kind)).toEqual(EXPECTED[power][target])
      })
    }
  }

  it('returns an array for every pair, never undefined', () => {
    for (const power of POWERS) {
      for (const target of TARGETS) {
        expect(Array.isArray(resolveInteraction(power, target))).toBe(true)
      }
    }
  })
})

describe('matrix completeness', () => {
  // The point of this whole task: you cannot add an outcome to the table
  // and forget to implement it. This test fails loudly if you try.
  it('every kind the matrix can emit has a handler', () => {
    const emitted = new Set<InteractionKind>()
    for (const power of POWERS) {
      for (const target of TARGETS) {
        for (const i of resolveInteraction(power, target)) emitted.add(i.kind)
      }
    }
    for (const kind of emitted) {
      expect(OUTCOME_HANDLERS[kind], `no handler for '${kind}'`).toBeTypeOf('function')
    }
  })

  it('every declared kind has a handler', () => {
    for (const kind of INTERACTION_KINDS) {
      expect(OUTCOME_HANDLERS[kind], `no handler for '${kind}'`).toBeTypeOf('function')
    }
  })

  it('declares no kind the matrix can never emit', () => {
    const emitted = new Set<InteractionKind>()
    for (const power of POWERS) {
      for (const target of TARGETS) {
        for (const i of resolveInteraction(power, target)) emitted.add(i.kind)
      }
    }
    expect([...INTERACTION_KINDS].sort()).toEqual([...emitted].sort())
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- matrix`
Expected: FAIL — `Cannot find module './matrix'`.

- [ ] **Step 3: Implement the table** — `src/powers/matrix.ts` (pure; **no `three` import**):

```ts
import type { PowerId, TargetKind } from '../core/events'

export type InteractionKind =
  | 'ignite' | 'destroy' | 'kill' | 'zap' | 'scatter' | 'emptyPond'
  | 'steam' | 'floatFish' | 'flare' | 'growFruit' | 'grumpy'

export type Interaction = { kind: InteractionKind }

export const INTERACTION_KINDS: readonly InteractionKind[] = [
  'ignite', 'destroy', 'kill', 'zap', 'scatter', 'emptyPond',
  'steam', 'floatFish', 'flare', 'growFruit', 'grumpy',
] as const

// The 21 cells. This table IS the product — "reactions are the content".
//
// Empty arrays are meaningful, not gaps:
//  - meteor/ground and meteor/crater still crater, scorch and shake — that is the
//    power's own staging (every meteor craters), not a target interaction.
//  - rain's empty cells are covered by its AREA effect (douse + fillCraters + bloom
//    over RAIN_RADIUS, in rain.ts), which fires on every cast no matter what was hit.
//    Rain aimed at a hut still douses it; that douse just isn't a matrix cell.
const MATRIX: Record<PowerId, Record<TargetKind, InteractionKind[]>> = {
  meteor: {
    tree: ['ignite', 'destroy'],
    hut: ['destroy'],
    villager: ['kill'],
    pond: ['emptyPond', 'steam'],
    campfire: ['scatter'],
    crater: [],
    ground: [],
  },
  lightning: {
    tree: ['ignite'],
    hut: ['ignite'],
    villager: ['zap'],        // the comic zap — lightning does NOT kill
    pond: ['floatFish'],
    campfire: ['flare'],
    crater: [],
    ground: [],
  },
  rain: {
    tree: ['growFruit'],      // the flourish; the area effect is rain.ts's job
    hut: [],
    villager: ['grumpy'],
    pond: [],
    campfire: [],
    crater: [],
    ground: [],
  },
}

export function resolveInteraction(power: PowerId, target: TargetKind): Interaction[] {
  return MATRIX[power][target].map(kind => ({ kind }))
}
```

- [ ] **Step 4: Add `power` to `CastCtx`** — `src/powers/power.ts`.

`CastCtx` does not currently carry which power is casting, and `kill` needs it to pick the right `DeathCause`. Two one-line changes:

```ts
// in src/powers/power.ts
export type CastCtx = PowerContext & {
  x: number
  z: number
  kind: TargetKind
  power: PowerId        // ← add
}

// in PowerManager.cast(), the existing line:
//   this.timelines.push(power.cast({ ...this.context, x, z, kind }))
// becomes:
this.timelines.push(power.cast({ ...this.context, x, z, kind, power: id }))
```

- [ ] **Step 5: Implement the handlers** — `src/powers/outcomes.ts`. Every body below is lifted **verbatim** from the existing `applyMeteorOutcome` / `applyLightningOutcome`. Do not redesign behavior in this task; a refactor that changes behavior is not a refactor.

```ts
import { PALETTE } from '../ui/tokens'
import type { CastCtx } from './power'
import type { Interaction, InteractionKind } from './matrix'

export const OUTCOME_HANDLERS: Record<
  InteractionKind,
  (ctx: CastCtx, y0: number) => void
> = {
  ignite: (ctx) => {
    if (ctx.kind === 'tree' || ctx.kind === 'hut') ctx.world.igniteTarget(ctx.kind, ctx.x, ctx.z)
  },
  destroy: (ctx) => {
    if (ctx.kind === 'tree' || ctx.kind === 'hut') ctx.world.destroyTarget(ctx.kind, ctx.x, ctx.z)
  },
  // Only the meteor kills. `power` is on CastCtx solely so DeathCause is honest.
  kill: (ctx) => {
    ctx.world.killVillagerNear(ctx.x, ctx.z, 3, ctx.power === 'meteor' ? 'meteor' : 'lightning')
  },
  // Lightning's villager hit is a GAG, not a death. Keep it that way.
  zap: (ctx) => { ctx.world.villagerAt(ctx.x, ctx.z, 1.2)?.zap() },
  scatter: (ctx) => { ctx.world.scatterCampfire() },
  emptyPond: (ctx) => { ctx.world.emptyPondAt(ctx.x, ctx.z) },
  steam: (ctx, y0) => {
    ctx.fx.particles.burst({
      x: ctx.x, y: y0 + ctx.island.group.position.y, z: ctx.z,
      n: 36, color: PALETTE.cloud, speed: 2.2, gravity: -0.35, size: 1.8, life: 1.5,
    })
  },
  floatFish: (ctx) => {
    const pond = ctx.world.pondAt(ctx.x, ctx.z)
    if (pond?.floatFish()) ctx.bus.emit({ type: 'fish:floated' })
  },
  flare: (ctx) => {
    ctx.world.campfire.flare(2, 3)
    ctx.bus.emit({ type: 'campfire:flared' })
  },
  growFruit: (ctx) => { ctx.world.growFruitNear(ctx.x, ctx.z, 4) },
  grumpy: (ctx) => { ctx.world.grumpNear(ctx.x, ctx.z, 4) },
}

export function applyInteractions(interactions: Interaction[], ctx: CastCtx, y0: number): void {
  for (const interaction of interactions) OUTCOME_HANDLERS[interaction.kind](ctx, y0)
}
```

The `fish:floated` and `campfire:flared` emits are load-bearing — Task 2's *Fishing Hole* and *Flash Fry* Moments depend on them. Do not drop them while moving the code.

- [ ] **Step 6: Wire the three powers**

In **`meteor.ts`** and **`lightning.ts`**, replace the `applyMeteorOutcome(ctx, y0)` / `applyLightningOutcome(ctx)` call in the impact beat with:

```ts
applyInteractions(resolveInteraction(this.id, ctx.kind), ctx, y0)
```

then **delete** those two functions.

In **`rain.ts`**, *add* the same line to the impact beat, **immediately after** the existing area effect (the `douseNear` / `fillCratersNear` / `growFruitNear` / `bloomNear` / `grumpNear` block at `src/powers/rain.ts:248–255`). **Delete nothing from `rain.ts`.** Rain keeps watering the whole radius on every cast; the matrix only adds its per-target flourish on top.

Leave every power's *staging* alone — the meteor still craters and scorches on every cast; those are not target interactions.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS. Test count rises from **82** to ~107 (21 cell assertions + 4 completeness/shape tests). No previously-passing test regresses — `src/powers/meteor.test.ts`, `src/powers/rain.test.ts`, and `src/powers/power.test.ts` must still pass untouched. If `power.test.ts` breaks, it is because `CastCtx` grew a required field; fix the test's fixture, not the type.

- [ ] **Step 8: Verify by hand — play all 21 cells**

Run `npm run dev`. Cast each power at each target type and tick it off. **A cell that produces no visible reaction is a product bug, not just a code bug.**

Two specific regressions to check for, because they are the ones this refactor can silently cause:
- **Lightning on a villager must still be the comic zap** — a stunned, smoking, *alive* villager. If someone dies, you collapsed `zap` into `kill`.
- **Rain aimed at a hut must still put out a fire in that hut.** If it only grows fruit and leaves the fire burning, you routed rain's area effect through the matrix. Revert that.

The intentionally-empty cells must still produce the power's own staging: a meteor on bare ground still craters, scorches, and shakes.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: power × target interaction matrix with completeness test"
```

---

### Task 2: Discovery — the 12 Moments (pure)

Pure logic only. No book yet — this task ends with working toasts and a live counter in the tray, which is independently shippable.

**Files:**
- Create: `src/discovery/moments.ts` **(pure)**, `src/ui/journal.ts`
- Test: `src/discovery/moments.test.ts`
- Modify: `src/ui/tray.ts` (expose the counter for updating), `src/main.ts` (compose)

**Interfaces:**
- Consumes: `GameEvent`, `EventBus` from `src/core/events.ts`. **Emits nothing.**
- Produces:
  - `type MomentId` — a union of the 12 string ids.
  - `type Moment = { id: MomentId; title: string; hint: string; color: string }`
  - `const MOMENTS: readonly Moment[]` — exactly 12, in book order.
  - `interface JournalStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }` — injected, so this module stays pure and headlessly testable.
  - `class Journal { constructor(storage?: JournalStorage); readonly unlocked: ReadonlySet<MomentId>; observe(e: GameEvent): Moment | null; has(id: MomentId): boolean; count(): number; reset(): void }`
  - `createJournalUI(ui: HTMLElement, journal: Journal, opts): { toast(m: Moment): void; setCount(n: number): void }` from `src/ui/journal.ts`.

- [ ] **Step 1: Write the failing tests** — `src/discovery/moments.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { GameEvent } from '../core/events'
import { Journal, MOMENTS, type JournalStorage } from './moments'

function memoryStorage(initial: Record<string, string> = {}): JournalStorage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
  }
}

const lightningPond: GameEvent = { type: 'power:impact', power: 'lightning', target: 'pond', x: 0, z: 0 }

describe('MOMENTS', () => {
  it('has exactly 12 moments with unique ids', () => {
    expect(MOMENTS).toHaveLength(12)
    expect(new Set(MOMENTS.map(m => m.id)).size).toBe(12)
  })
  it('every moment has a title and a hint', () => {
    for (const m of MOMENTS) {
      expect(m.title.length).toBeGreaterThan(0)
      expect(m.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('Journal.observe', () => {
  it('unlocks fishing-hole on lightning + pond', () => {
    const j = new Journal(memoryStorage())
    expect(j.observe(lightningPond)?.id).toBe('fishing-hole')
    expect(j.has('fishing-hole')).toBe(true)
    expect(j.count()).toBe(1)
  })

  it('does not unlock fishing-hole on lightning + tree', () => {
    const j = new Journal(memoryStorage())
    const e: GameEvent = { type: 'power:impact', power: 'lightning', target: 'tree', x: 0, z: 0 }
    expect(j.observe(e)).toBeNull()
    expect(j.count()).toBe(0)
  })

  it('unlocking twice is a no-op and returns null the second time', () => {
    const j = new Journal(memoryStorage())
    expect(j.observe(lightningPond)).not.toBeNull()
    expect(j.observe(lightningPond)).toBeNull()
    expect(j.count()).toBe(1)
  })

  it('ghost-story needs three deaths, not two', () => {
    const j = new Journal(memoryStorage())
    const died: GameEvent = { type: 'villager:died', cause: 'meteor' }
    expect(j.observe(died)).toBeNull()
    expect(j.observe(died)).toBeNull()
    expect(j.observe(died)?.id).toBe('ghost-story')
  })

  it('full-harvest needs four DISTINCT trees', () => {
    const j = new Journal(memoryStorage())
    // The same tree four times must not unlock it — this is why the event carries treeId.
    for (let i = 0; i < 4; i++) {
      expect(j.observe({ type: 'fruit:grown', treeId: 'tree-1' })).toBeNull()
    }
    expect(j.observe({ type: 'fruit:grown', treeId: 'tree-2' })).toBeNull()
    expect(j.observe({ type: 'fruit:grown', treeId: 'tree-3' })).toBeNull()
    expect(j.observe({ type: 'fruit:grown', treeId: 'tree-4' })?.id).toBe('full-harvest')
  })

  it('wildfire needs five burning at once', () => {
    const j = new Journal(memoryStorage())
    const ignite = (burning: number): GameEvent =>
      ({ type: 'fire:ignited', kind: 'tree', bySpread: true, burning })
    expect(j.observe(ignite(4))).toBeNull()
    expect(j.observe(ignite(5))?.id).toBe('wildfire')
  })

  it('firefighter needs a douse while three or more were burning', () => {
    const j = new Journal(memoryStorage())
    expect(j.observe({ type: 'fire:doused', byRain: true, burning: 2 })).toBeNull()
    expect(j.observe({ type: 'fire:doused', byRain: true, burning: 3 })?.id).toBe('firefighter')
  })

  it('new-pond needs a pond created where a crater was, not anywhere', () => {
    const j = new Journal(memoryStorage())
    j.observe({ type: 'crater:created', x: 5, z: 5 })
    // A pond far from the crater is not a watering hole.
    expect(j.observe({ type: 'pond:created', x: -8, z: -8 })).toBeNull()
    expect(j.observe({ type: 'pond:created', x: 5.4, z: 4.7 })?.id).toBe('new-pond')
  })

  it('unlocks the simple one-shot moments from their own event', () => {
    const cases: [GameEvent, string][] = [
      [{ type: 'flower:bloomed' }, 'first-bloom'],
      [{ type: 'villager:fished' }, 'gone-fishing'],
      [{ type: 'burnt', kind: 'hut' }, 'homewrecker'],
      [{ type: 'hut:rebuilt' }, 'they-rebuild'],
      [{ type: 'villager:mourned' }, 'respects-paid'],
      [{ type: 'campfire:flared' }, 'flash-fry'],
    ]
    for (const [event, id] of cases) {
      const j = new Journal(memoryStorage())
      expect(j.observe(event)?.id, `${event.type} should unlock ${id}`).toBe(id)
    }
  })

  it('burnt tree does not unlock homewrecker', () => {
    const j = new Journal(memoryStorage())
    expect(j.observe({ type: 'burnt', kind: 'tree' })).toBeNull()
  })
})

describe('Journal persistence', () => {
  it('persists unlocks to storage and reloads them', () => {
    const storage = memoryStorage()
    const a = new Journal(storage)
    a.observe(lightningPond)
    const b = new Journal(storage)
    expect(b.has('fishing-hole')).toBe(true)
    expect(b.count()).toBe(1)
  })

  it('survives a corrupt stored value without throwing', () => {
    const j = new Journal(memoryStorage({ 'tinygod.moments': '{{{not json' }))
    expect(j.count()).toBe(0)
    expect(() => j.observe(lightningPond)).not.toThrow()
  })

  it('survives a stored value of the wrong shape', () => {
    const j = new Journal(memoryStorage({ 'tinygod.moments': '{"nope":true}' }))
    expect(j.count()).toBe(0)
  })

  it('ignores unknown ids in storage', () => {
    const j = new Journal(memoryStorage({ 'tinygod.moments': '["fishing-hole","not-a-moment"]' }))
    expect(j.count()).toBe(1)
    expect(j.has('fishing-hole')).toBe(true)
  })

  it('reset clears everything', () => {
    const storage = memoryStorage()
    const j = new Journal(storage)
    j.observe(lightningPond)
    j.reset()
    expect(j.count()).toBe(0)
    expect(new Journal(storage).count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- moments`
Expected: FAIL — `Cannot find module './moments'`.

- [ ] **Step 3: Implement** — `src/discovery/moments.ts` (pure; **no `three` import**, and **no `localStorage` reference** — storage is injected):

```ts
import type { GameEvent } from '../core/events'
import { PALETTE } from '../ui/tokens'

export type MomentId =
  | 'fishing-hole' | 'flash-fry' | 'first-bloom' | 'ghost-story'
  | 'full-harvest' | 'new-pond' | 'gone-fishing' | 'wildfire'
  | 'firefighter' | 'homewrecker' | 'they-rebuild' | 'respects-paid'

export type Moment = { id: MomentId; title: string; hint: string; color: string }

// Hints tease; they never instruct. Titles are the one place the toy is allowed a joke.
export const MOMENTS: readonly Moment[] = [
  { id: 'fishing-hole', title: 'Fishing Hole', hint: 'Electricity and water. What could go wrong.', color: PALETTE.water },
  { id: 'flash-fry', title: 'Flash Fry', hint: 'The fire was already lit. It could be more lit.', color: PALETTE.flame },
  { id: 'first-bloom', title: 'First Bloom', hint: 'Something grows where nothing happened.', color: PALETTE.bloom },
  { id: 'ghost-story', title: 'Ghost Story', hint: 'They keep coming back. Sort of.', color: PALETTE.ghost },
  { id: 'full-harvest', title: 'Full Harvest', hint: 'Rain on an orchard.', color: PALETTE.leafA },
  { id: 'new-pond', title: 'Watering Hole', hint: 'Make a hole. Then fill it.', color: PALETTE.water },
  { id: 'gone-fishing', title: 'Gone Fishing', hint: 'Give them a pond and see what happens.', color: PALETTE.smockB },
  { id: 'wildfire', title: 'Wildfire', hint: 'It got away from you.', color: PALETTE.ember },
  { id: 'firefighter', title: 'Firefighter', hint: 'Second thoughts.', color: PALETTE.skyHigh },
  { id: 'homewrecker', title: 'Homewrecker', hint: "That was somebody's house.", color: PALETTE.hutClay },
  { id: 'they-rebuild', title: 'They Rebuild', hint: 'You broke it. They fixed it.', color: PALETTE.smockC },
  { id: 'respects-paid', title: 'Respects Paid', hint: 'Someone remembers.', color: PALETTE.stone },
] as const

const KEY = 'tinygod.moments'
const IDS = new Set<string>(MOMENTS.map(m => m.id))

export interface JournalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Running counters the matchers need. Reset only by `reset()`. */
type MomentState = {
  deaths: number
  fruitTrees: Set<string>
  craters: { x: number; z: number }[]
}

const CRATER_MATCH_RADIUS = 2.5

export class Journal {
  private readonly set = new Set<MomentId>()
  private readonly state: MomentState = { deaths: 0, fruitTrees: new Set(), craters: [] }

  constructor(private readonly storage: JournalStorage | null = null) {
    this.load()
  }

  get unlocked(): ReadonlySet<MomentId> { return this.set }
  has(id: MomentId): boolean { return this.set.has(id) }
  count(): number { return this.set.size }

  /** Returns the newly-unlocked Moment, or null. At most one unlock per event. */
  observe(event: GameEvent): Moment | null {
    const id = this.match(event)
    if (!id || this.set.has(id)) return null
    this.set.add(id)
    this.save()
    return MOMENTS.find(m => m.id === id) ?? null
  }

  reset(): void {
    this.set.clear()
    this.state.deaths = 0
    this.state.fruitTrees.clear()
    this.state.craters.length = 0
    this.save()
  }

  /** Accumulates state, then decides. Returns an id even if already unlocked; observe() filters. */
  private match(event: GameEvent): MomentId | null {
    switch (event.type) {
      case 'power:impact':
        if (event.power === 'lightning' && event.target === 'pond') return 'fishing-hole'
        return null
      case 'campfire:flared': return 'flash-fry'
      case 'flower:bloomed': return 'first-bloom'
      case 'villager:fished': return 'gone-fishing'
      case 'hut:rebuilt': return 'they-rebuild'
      case 'villager:mourned': return 'respects-paid'
      case 'burnt': return event.kind === 'hut' ? 'homewrecker' : null
      case 'villager:died':
        this.state.deaths++
        return this.state.deaths >= 3 ? 'ghost-story' : null
      case 'fruit:grown':
        this.state.fruitTrees.add(event.treeId)
        return this.state.fruitTrees.size >= 4 ? 'full-harvest' : null
      case 'fire:ignited':
        return event.burning >= 5 ? 'wildfire' : null
      case 'fire:doused':
        return event.burning >= 3 ? 'firefighter' : null
      case 'crater:created':
        this.state.craters.push({ x: event.x, z: event.z })
        return null
      case 'pond:created': {
        // "Watering Hole" is a SPATIAL match: a pond where a crater was.
        const near = this.state.craters.some(
          c => Math.hypot(c.x - event.x, c.z - event.z) <= CRATER_MATCH_RADIUS,
        )
        return near ? 'new-pond' : null
      }
      default:
        return null
    }
  }

  private load(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return       // wrong shape → empty journal, not a crash
      for (const id of parsed) {
        if (typeof id === 'string' && IDS.has(id)) this.set.add(id as MomentId)
      }
    } catch {
      // A corrupt value gets the player an empty journal, never a white screen.
    }
  }

  private save(): void {
    if (!this.storage) return
    try {
      this.storage.setItem(KEY, JSON.stringify([...this.set]))
    } catch {
      // Private-mode / quota-exceeded: play on, just don't persist.
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- moments`
Expected: PASS — all ~17 new tests green.

- [ ] **Step 5: Toasts and the counter** — `src/ui/journal.ts`. A clay tag slides in at the top: the Moment's title and its hint, for 3 s. Under `prefersReducedMotion()` it **fades** instead of sliding. The tray's `#journal-btn` counter updates `0/12 → 1/12` with a 2-frame pop.

Modify `src/ui/tray.ts` to return a `setJournalCount(n: number): void` alongside the existing `setCooldown`/`setEnabled`, writing into the existing `<b>` inside `#journal-btn`. Do not rebuild the button.

Style the toast in `src/styles.css` using existing custom properties only (`--paper`, `--ink`, `--terracotta`). Add no new hex values.

- [ ] **Step 6: Compose in `main.ts`**

```ts
const journal = new Journal(localStorage)
const journalUI = createJournalUI(ui, journal, { /* ... */ })
tray.setJournalCount(journal.count())   // reflect a reloaded journal immediately
world.bus.on((event) => {
  const unlocked = journal.observe(event)
  if (!unlocked) return
  journalUI.toast(unlocked)
  tray.setJournalCount(journal.count())
})
```

Note `new Journal(localStorage)` — the real `Storage` satisfies the `JournalStorage` interface structurally, which is exactly why the interface is shaped that way.

- [ ] **Step 7: Verify by hand**

Run `npm run dev`. Lightning a pond → toast appears reading "Fishing Hole", counter goes `0/12 → 1/12`. Reload the page → still `1/12`. Run `localStorage.clear()` in the console and reload → back to `0/12`, no errors. Set OS reduce-motion → the toast fades rather than sliding.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: discovery moments, unlock toasts, journal counter"
```

---

### Task 3: The clay book — viewport, mesh, and open/close

The signature element. **Sequenced so that a working book with no tiles is still a shippable increment** — if the page-turn fights you, Task 4 slips without blocking the ship.

**The one rule that matters:** the book is a real clay mesh made of the *same* `clayMaterial` as the island, rendered in a **second scissored viewport on the existing renderer**. It is not a second `WebGLRenderer` and not a second `<canvas>` — two GL contexts means two shader caches, two copies of the toon ramp, and browsers hard-cap live contexts (Chrome discards the oldest past ~16). One context, two scenes.

**Files:**
- Create: `src/ui/book.ts`
- Modify: `src/ui/journal.ts` (the DOM skeleton + focus trap), `src/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: `clayMaterial` from `src/fx/clayMaterial.ts`; `wobble` from `src/fx/wobble.ts`; `QuantizedClock` from `src/core/loop.ts`; `Timeline` from `src/core/timeline.ts`; `prefersReducedMotion` from `src/core/motion.ts`; `PALETTE`/`TIMING` from `src/ui/tokens.ts`; the `renderer` and `lowFx` from `createScene()`.
- Produces:
  - `class ClayBook { constructor(renderer: THREE.WebGLRenderer, opts: { lowFx: boolean }); open(): void; close(): void; readonly isOpen: boolean; setRect(rect: DOMRect): void; update(dt: number, qt: number): void; render(): void; dispose(): void }`

- [ ] **Step 1: The second scene**

`ClayBook` owns a private `THREE.Scene` and an orthographic camera. It holds: a book body (a wobbled `BoxGeometry`, `clayMaterial(PALETTE.hutClay)`), a front cover (a thin wobbled box, hinged at its spine via a parent `Group` so rotation pivots on the edge, not the centre), and a pages block (`clayMaterial(PALETTE.cloud, { flat: true })` — recall from tokens that clay is *never* pure white). Light it with a single `DirectionalLight(PALETTE.keyLight)` and an `AmbientLight(PALETTE.fillSky)` so it reads as the same material under the same softbox as the island.

- [ ] **Step 2: Render it in a scissored viewport**

The book draws **after** the world's composer pass, into a rect derived from the DOM. In `render()`:

```ts
render(): void {
  if (this.lowFx || this.rect.width < 1) return
  const r = this.renderer
  // Convert DOM rect (top-left origin) to GL viewport (bottom-left origin).
  const y = r.domElement.clientHeight - this.rect.bottom
  r.setScissorTest(true)
  r.setViewport(this.rect.left, y, this.rect.width, this.rect.height)
  r.setScissor(this.rect.left, y, this.rect.width, this.rect.height)
  r.autoClear = false          // do NOT wipe the world we just composited
  r.clearDepth()               // but DO clear depth, or the book z-fights the island
  r.render(this.scene, this.camera)
  r.setScissorTest(false)
  r.autoClear = true
  r.setViewport(0, 0, r.domElement.clientWidth, r.domElement.clientHeight)
}
```

The three traps here, all of which will produce a black screen or an invisible book if you get them wrong: **(a)** `EffectComposer` renders to the canvas and resets viewport state, so the book pass must come *after* `composer.render()` in the loop, not before; **(b)** `autoClear` must be false or the book pass erases the world; **(c)** `clearDepth()` is still required, or the book renders behind the island's depth values and vanishes.

- [ ] **Step 3: The DOM drives the rect**

The book renders exactly over the bounding box of a DOM element, so DOM and 3D can never drift. Closed, that element is the existing `#journal-btn` in the tray. Open, it is a large centered `<dialog>`-role element. Each frame (or on resize/open/close), `main.ts` calls `book.setRect(el.getBoundingClientRect())`.

This is the whole accessibility trick: **to a screen reader and to the keyboard, the book is a `<button>` and then a focus-trapped dialog. To the eye, it is a lump of clay.** The 3D is skin; the DOM is skeleton.

- [ ] **Step 4: Open/close choreography, quantized**

`open()` starts a `Timeline` (~600 ms): the book scales up and rotates to face the viewer while the DOM dialog element expands beneath it. The **cover swing is quantized to 12 fps** — drive it from `qt` (the `QuantizedClock`'s `quantizedTime`, already threaded through `main.ts`'s render loop), giving ~7 discrete frames of page-turn.

**This stutter is the entire point.** A smooth 60 fps page-turn instantly reads as "web UI". A 12 fps one reads as "stop-motion prop", which is the only reason this is worth building in 3D at all. Do not smooth it.

Under `prefersReducedMotion()`: no scale-up, no rotation, no page-turn — the open spread cross-fades in over 140 ms. Still fully usable.

- [ ] **Step 5: Focus trap and `Esc`**

In `src/ui/journal.ts`: opening moves focus into the dialog, `Tab` cycles within it, `Esc` closes it, and focus returns to `#journal-btn`. Clicking the backdrop closes it. The dialog carries `role="dialog"` and `aria-modal="true"` and is labelled by its heading. While open, the tray's power buttons are `inert` (or `aria-hidden` + `tabindex="-1"`) so `Tab` cannot escape into the game behind the book.

- [ ] **Step 6: `?lowfx=1` fallback**

When `lowFx` is true, `ClayBook.render()` returns immediately and the DOM skeleton gets a `.lowfx` class that styles it as a flat, visible clay-cream panel using existing custom properties. **The toy stays fully playable and the journal fully readable on a weak machine.** Verify this explicitly — it is a real user, not a checkbox.

- [ ] **Step 7: Wire into the loop** — `src/main.ts`, inside the existing `onRender`, **after** `composer.render()`:

```ts
composer.render()
book.setRect(journalUI.rect())
book.update(dt, clock.quantizedTime)
book.render()
```

- [ ] **Step 8: Verify by hand**

Run `npm run dev`. The closed book sits in the tray as a real clay object — same grain, same toon bands, same fingerprint dents as the island; it should look *molded*, not *modelled*. Click it: it swings open with a visible 12 fps stutter. `Esc` closes it and focus lands back on the journal button. Tab from the tray reaches the book and cannot tab past it into the game while open. Confirm the world still renders correctly behind/around it (no black frame, no z-fighting). Check `renderer.info.render.calls` — the book should add well under 10 draw calls. Load `?lowfx=1` → flat panel, no 3D book, everything still works.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: 3D clay book in a scissored UI viewport with 12fps page-turn"
```

---

### Task 4: The clay book — the 12 pressed-thumbprint tiles

**Files:**
- Modify: `src/ui/book.ts`, `src/ui/journal.ts`

**Interfaces:**
- Consumes: `MOMENTS`, `Journal` from `src/discovery/moments.ts` (Task 2); `ClayBook` from Task 3.
- Produces: `ClayBook.setUnlocked(unlocked: ReadonlySet<MomentId>): void` — repaints the tiles.

- [ ] **Step 1: The tiles**

A 3×4 grid of small clay slabs on the open spread, one per Moment, in `MOMENTS` order.

- **Locked:** grey clay (`PALETTE.stone`), *undimpled* — a blank, unpressed slab.
- **Unlocked:** the Moment's `color`, with a real thumbprint dimple pressed into it (reuse `wobble()` with a centred falloff, so the dimple is a genuine vertex deformation, not a texture).

The plan's original language is worth honoring exactly: *locked tiles are not greyed-out text; they are unpressed clay.*

- [ ] **Step 2: The stamped titles**

An unlocked tile's title is a **canvas-generated texture** stamped onto its face — allowed by the zero-asset rule (the toon ramp is already a `CanvasTexture`). Draw the title with `TYPE.display`, small, at a slight rotation, in `PALETTE.ink`, like a label pressed by hand into the clay. Cache one canvas per Moment; do not regenerate per frame.

- [ ] **Step 3: Hints on hover/focus**

Hovering or focusing a *locked* tile shows its `hint`. Render the hint in the DOM layer (it is text; text belongs in the DOM where it is selectable and screen-readable), positioned over the tile.

- [ ] **Step 4: Keyboard grid**

The invisible DOM buttons from Task 3 sit over the tile positions and are the real focus targets. Arrow keys move within the 3×4 grid (left/right wrap within a row, up/down move between rows). Each button's accessible name is the Moment's title when unlocked, and something like "Locked moment: <hint>" when not — a screen-reader user gets the *hint*, which is the actual content, rather than the word "locked" twelve times.

- [ ] **Step 5: Live updates**

When Task 2's bus subscription unlocks a Moment while the book is *open*, the tile presses in immediately, with a 2-frame pop at 12 fps.

- [ ] **Step 6: Verify by hand**

Run `npm run dev`. Open the book cold: 12 blank grey slabs. Hover one: its hint appears. Lightning a pond, then open the book: the *Fishing Hole* tile is now colored, dimpled, and titled; the other 11 are still unpressed clay. Reload: it stays pressed. Tab through all 12 tiles with the keyboard and confirm the arrow-key grid works and every tile announces something useful. Then, with the book open, cast a power that unlocks a Moment and watch the tile press in live.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: 12 pressed-thumbprint moment tiles in the clay book"
```

---

### Task 5: Audio — one mixer, and delete the ad-hoc synths

**This task removes code.** `src/powers/meteor.ts` and `src/powers/lightning.ts` currently each construct a module-level `AudioContext` and synthesize inline. That is three bugs: contexts are never `close()`d (browsers allow ~6), there is no master gain so `#mute-btn` cannot work, and there is no voice cap so a spreading fire stacks unbounded hiss.

After this task, **powers make no sound at all.** `Sfx` subscribes to the `EventBus` and plays foley in response to the `power:anticipate` / `power:impact` / `fire:*` events the powers already emit. Sound becomes a pure consumer of the event stream — exactly like discovery. That is the architecture win, and it is why this is a rewrite rather than a patch.

**Files:**
- Create: `src/audio/sfx.ts`
- Modify: `src/powers/meteor.ts` (delete `whistle()` and its `whistleContext`), `src/powers/lightning.ts` (delete its synth and context), `src/ui/tray.ts` (wire `#mute-btn`), `src/main.ts`

**Interfaces:**
- Consumes: `GameEvent`, `EventBus`. Emits nothing.
- Produces: `class Sfx { constructor(opts?: { storage?: Pick<Storage, 'getItem' | 'setItem'> }); attach(bus: EventBus): () => void; unlock(): void; setMuted(m: boolean): void; get muted(): boolean; step(): void; dispose(): void }`

- [ ] **Step 1: One context, created on the first gesture**

Browsers block audio until a user gesture. Create the `AudioContext` **lazily on the first `pointerdown`/`keydown`** and never before. **Never show a "click to enable sound" modal** — the toy simply becomes audible the moment the player touches it.

Chain: `voice → voiceGain → masterGain → destination`. `#mute-btn` drives `masterGain.gain`; the state persists to `localStorage['tinygod.muted']`, wrapped in try/catch (private mode must not break the toy).

- [ ] **Step 2: The foley kit** — all synthesized, no files:

- **Squish** (villager step): a short lowpassed noise burst with a fast pitch-drop — a thumb pressing clay. **Randomize pitch ±15% per step**, or six villagers walking becomes a machine gun.
- **Whistle** (meteor anticipation, on `power:anticipate` where `power === 'meteor'`): a sine sweeping over 1.2 s — matched exactly to the fall, because the fall is 1.2 s.
- **Thud** (meteor impact): a 60 Hz sine with a hard exponential decay plus a noise transient. Felt more than heard.
- **Crack** (lightning): a ~20 ms white-noise burst, bandpassed, into a short bright decay.
- **Hiss** (douse, on `fire:doused`): filtered noise, ~0.8 s, opening then closing — steam.
- **Pop** (flower/fruit/emote): a tiny sine blip, pitched up. Comedic.
- **Thump** (moment unlocked): a soft, warm, low pop. **The reward sound is the quietest thing in the mix** — it is an acknowledgement, not a fanfare. Resist the urge to make it a sting.
- **Ambient bed**: a slow filtered-noise wind plus two detuned sines at very low gain, always running. This is what makes the silence feel like a *place* rather than like a muted tab.

- [ ] **Step 3: Mixing**

Hard-cap concurrent voices at **6** (drop the oldest). Duck the ambient bed by 6 dB during a power's impact beat and restore it over ~400 ms. Every voice must `disconnect()` on `ended` — otherwise nodes accumulate for the whole session.

- [ ] **Step 4: Weld the footsteps to the stutter**

`Sfx.step()` is called from `Villager.update()` **only on a quantized tick** (when the villager's waddle frame actually changes), never on a timer. This single detail is what makes it read as *foley* rather than as *game audio*: the sound is locked to the 12 fps stutter you can see.

- [ ] **Step 5: Delete the old audio**

Remove `whistleContext` and `whistle()` from `src/powers/meteor.ts`, and the equivalent synth and context from `src/powers/lightning.ts`. Grep to confirm: `grep -rn "AudioContext" src/` must return **only** `src/audio/sfx.ts`.

- [ ] **Step 6: Verify by hand — with your eyes closed**

Run `npm run dev`. **Close your eyes and play.** You should be able to tell a meteor from a lightning strike from rain without looking. Open your eyes: villager footsteps must land visibly *on* the 12 fps waddle frames, not float free of them. Mute; reload; it is still muted. Start a large fire and confirm the hiss does not turn into a wall of noise (the voice cap holds). Nothing clips.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: synthesized foley and ambient bed, event-driven; remove ad-hoc power audio"
```

---

### Task 6: The cold open and the villager performance layer

The two additions. Both serve priorities the original plan itself declared and then never funded.

**Files:**
- Create: `src/intro.ts`
- Modify: `src/fx/emotes.ts` (add `'cower'`), `src/villagers/villager.ts`, `src/powers/meteor.ts` (announce the shadow), `src/main.ts`

**Interfaces:**
- Consumes: `Timeline`, `prefersReducedMotion`, the `createScene()` bundle, `World`.
- Produces:
  - `class Intro { constructor(opts: { camera, controls, tray: HTMLElement, world: World }); update(dt: number): void; skip(): void; readonly done: boolean }`
  - `Villager.lookUp(from: Point): void`, `Villager.cower(): void`, `Villager.flinch(): void`
  - `World.warnNear(x: number, z: number, radius: number): void` — tells villagers a shadow is growing over them.

**The FSM does not change.** It stays sealed at exactly 8 states. This is *performance*, not AI: no memory, no coordination, no pathfinding. Adding a 9th state is a plan violation.

- [ ] **Step 1: `Villager.lookUp` / `cower` / `flinch`**

Add to `src/fx/emotes.ts`: extend `EmoteKind` with `'cower'` and add its glyph to the `GLYPHS` map (the existing kinds are `alarm | question | water | sleep | fish | sad`).

In `src/villagers/villager.ts`, add three *pose* methods that do not touch `state`:
- `lookUp(from)` — head tilts up toward the incoming threat, body freezes mid-step.
- `cower()` — arms over head, crouched. Held while the threat is overhead.
- `flinch()` — a single 12 fps frame of recoil. One frame. That is what makes it funny.

- [ ] **Step 2: They see the meteor coming**

This is the beat the toy is missing. `growingShadow()` in `src/powers/meteor.ts` already hangs a shadow over the island **for 1.2 seconds** and **not one villager reacts to it**.

Add `World.warnNear(x, z, radius)` and call it from the meteor's anticipation beat (t=0, alongside the existing `alarmNear`). Villagers inside the shadow radius `lookUp()` then `cower()`. Villagers near the rim `panic()` (which already exists) and scatter. When the meteor lands, the cower releases into the existing `flee`.

The meteor already has 1.2 s of pure dread built into it. Right now nobody is acting in it. Now they are.

- [ ] **Step 3: They flinch at the lightning**

On the lightning strike, every villager on the island — not just those nearby — plays a single-frame `flinch()`. A whole island of clay people twitching in unison on one frame is worth more than any particle effect.

- [ ] **Step 4: They huddle after a death**

Villagers in `sitAtFire` bias their sitting position inward after a `villager:died` event. **No new state, no memory** — just a position offset applied while in an existing state, decaying over time.

- [ ] **Step 5: The cold open** — `src/intro.ts`

The page currently just *starts*. Instead, on load (after the splash lifts), a ~4 s `Timeline`:
- The camera begins slightly wider and lower than its resting position and eases in.
- The island rotates gently.
- The villagers **wake up**: idle, then one stands, then another. The campfire catches.
- No UI is visible. At ~4 s the tray and book slide in from the edge of the table.

It is a title sequence for a thing with no title, and it directly serves the old plan's priority #1 — *"the idle scene must be beautiful before any power exists."*

**Any input skips it instantly** (`skip()` snaps everything to the end state — never trap someone in a cutscene). Under `prefersReducedMotion()`: no camera move at all, a static hold, and the UI simply fades in.

- [ ] **Step 6: Verify by hand**

Run `npm run dev` with a hard reload. The opening should make you want to keep watching *before* you have touched anything. Click during it → it skips instantly and cleanly, with the tray fully interactive. Then cast a meteor and **watch the villagers, not the meteor**: they must look up, cower, and scatter during the 1.2 s fall. Cast lightning and watch the whole island flinch on one frame. Confirm reduced-motion gives a static open with no camera move.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: cold open and villager performance layer"
```

---

### Task 7: Performance, accessibility, ship

**Files:**
- Modify: `vite.config.ts`, `index.html`, `README.md`, `docs/architecture.md`, `STATUS.md`

- [ ] **Step 1: Performance pass**

Profile in the devtools performance panel during the worst case: a fire spreading *and* a meteor landing *and* the book open (the book is a second render pass — this combination is new in this plan and is the one that can regress).

- Draw calls < 120. Check `renderer.info.render.calls`. The book should add < 10.
- Fire point lights capped at 3. Verify the cap holds during a large fire.
- `renderer.info.memory.geometries` **stable over 5 minutes of play.** If it climbs, something is leaking — the book's tile textures, the bolts, the droplets, and the particles are the suspects. `dispose()` or pool them.
- Confirm DPR stays capped and `?lowfx=1` genuinely bypasses the composer **and the book viewport**.
- Confirm `grep -rn "AudioContext" src/` still returns only `src/audio/sfx.ts` (no power has grown a new one).

- [ ] **Step 2: The accessibility checklist** — each of these is a real person, not a checkbox:

- **Full keyboard playthrough, mouse untouched:** arm each power, target it, fire it, open the book, arrow through the tiles, read a hint, close it with `Esc`, and confirm focus lands back on `#journal-btn`.
- **OS reduce-motion on:** no shake, no strobe, no auto-orbit, no ambient bob, no cold-open camera move, no page-turn. The powers still read clearly. The toy is still fun.
- Focus is visible on every interactive element, including the 12 tiles.
- The `aria-live` reticle announcements say something useful.
- `?lowfx=1` is fully playable and the journal fully readable.

- [ ] **Step 3: The five-second test**

The spec's actual acceptance criterion for the whole project. Load the page cold on a machine that has never seen it. **Within 5 seconds, is the idle scene screenshot-worthy?** Then watch someone else's first 30 seconds and *say nothing*. Where their hand hesitates is the bug. Fix that, not the thing you were planning to fix.

- [ ] **Step 4: Ship**

`npm run build`, then deploy the static output. Add:
- An **OG share image**: a real screenshot of the best moment — a meteor mid-fall, shadow blooming, villagers scattering — **not a logo**.
- A `<title>` and one-line meta description written like the toy, not like a product.
- A `README.md` with a GIF, the tech, and what is actually interesting here: the 12 fps quantization, procedural everything, zero asset files.

- [ ] **Step 5: Update the docs**

Update `docs/architecture.md` (the new modules, the `Interaction` type, the `Journal`/`Sfx` bus consumers, the two-scene render pass) and `STATUS.md`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: performance pass, accessibility pass, ship"
```

---

## Definition of done

- Every one of the 21 power × target cells produces a visible reaction — either a matrix interaction, or the power's own staging (meteor always craters; rain always waters the radius). No cell is a no-op.
- Lightning on a villager is still a comic zap, not a death. Rain on a hut still douses it.
- All 12 Moments are unlockable, persist across reload, and survive a corrupt `localStorage` value.
- The clay book opens with a visible 12 fps page-turn, is fully keyboard-operable, and is made of the same clay as the island.
- You can tell the three powers apart with your eyes closed.
- The villagers react to the meteor *while it is falling*.
- `grep -rn "AudioContext" src/` returns exactly one file.
- Reduced-motion and `?lowfx=1` are both fully playable.
- 60 fps holds with a fire spreading, a meteor landing, and the book open.

# Day/Night Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ~6-minute automatic day/night cycle driving lighting, sky, stars, fireflies, and villager schedules, with a Settings Auto/Day/Night override.

**Architecture:** A pure, Three.js-free `DayClock` in `src/core/` advances with the fixed 30 Hz simulation and interpolates keyframed looks (colors, light position, star/firefly levels). `scene.ts` applies the sampled look each gameplay frame; the villager FSM reads the discrete phase kind to bias weights (dusk gathering, night sleepers/owls). Settings persists a `clayisland.timeOfDay` mode.

**Tech Stack:** Vanilla Three.js, TypeScript (strict), Vite 8, Vitest (Node environment — no DOM/WebGL in tests; only pure exports are unit-tested, matching `tray.test.ts` style).

**Spec:** `docs/superpowers/specs/2026-07-18-day-night-cycle-design.md`

## Global Constraints

- Vitest runs in the **Node environment** (`vite.config.ts`): tests may only import pure exports. THREE/DOM-touching code is verified by `npm run lint` + `npm run build` + manual QA.
- Hex colors live **only** in `PALETTE` in `src/ui/tokens.ts`.
- No runtime assets: everything procedural.
- The cycle ticks **only** when `simulatesGameplay(flow)` is true; title/prologue/replay keep the canonical golden hour.
- Reduced motion: overrides snap instead of glide; stars don't twinkle; fireflies don't drift. Reduced quality / `?lowfx=1`: no sun-arc position changes (shadows are bypassed anyway), fewer stars, no fireflies.
- The current golden-hour look is the late-day keyframe; gameplay starts the clock there so there is no visual pop after the prologue.
- Run `npm test` and `npm run lint` after every task; both must pass before committing.

---

### Task 1: DayClock pure module + palette tokens

**Files:**
- Create: `src/core/dayClock.ts`
- Create: `src/core/dayClock.test.ts`
- Modify: `src/ui/tokens.ts` (append new PALETTE entries)

**Interfaces:**
- Consumes: `PALETTE` from `src/ui/tokens.ts`.
- Produces (later tasks rely on these exact names):
  - `type DayKind = 'dawn' | 'day' | 'dusk' | 'night'`
  - `type TimeOfDayMode = 'auto' | 'day' | 'night'`
  - `type DayParams = { kind: DayKind; t: number; keyColor: string; keyIntensity: number; keyX: number; keyY: number; keyZ: number; fillSky: string; fillGround: string; fillIntensity: number; skyHigh: string; skyLow: string; cloudTint: string; starOpacity: number; fireflyLevel: number }`
  - `const DAY_PERIOD = 360`, `const GOLDEN_T = 225`
  - `function sampleAt(t: number): DayParams` (pure)
  - `function kindAt(t: number): DayKind` (pure)
  - `class DayClock { constructor(reducedMotion: () => boolean, startT?: number); tick(dt: number): void; sample(): DayParams; get kind(): DayKind; get time(): number; get mode(): TimeOfDayMode; setMode(mode: TimeOfDayMode): void; requestHold(kind: 'night'): void; releaseHold(): void }`

- [ ] **Step 1: Add night/dawn/dusk/day hexes to PALETTE**

Append inside the `PALETTE` object in `src/ui/tokens.ts` (before the `// ui` group):

```ts
  // day/night cycle
  dawnSkyHigh: '#8fb8d8',
  dawnSkyLow: '#ffb499',
  dawnKeyLight: '#ffc9a3',
  daySkyHigh: '#9edcf7',
  daySkyLow: '#d9f0fa',
  dayKeyLight: '#fff3dc',
  duskSkyHigh: '#7b6f9e',
  duskSkyLow: '#ff9b6b',
  duskKeyLight: '#ffb37e',
  nightSkyHigh: '#141e33',
  nightSkyLow: '#2c3a58',
  nightKeyLight: '#a8c0e8',
  nightFillSky: '#31406b',
  nightFillGround: '#232633',
  nightCloud: '#5a6580',
```

(These are Three.js-consumed only; per the file's comment, do NOT add matching CSS custom properties — none of these are used by styles.css.)

- [ ] **Step 2: Write the failing tests**

Create `src/core/dayClock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PALETTE } from '../ui/tokens'
import {
  DAY_PERIOD,
  DayClock,
  GOLDEN_T,
  kindAt,
  sampleAt,
} from './dayClock'

describe('kindAt', () => {
  it('maps the timeline segments', () => {
    expect(kindAt(0)).toBe('dawn')
    expect(kindAt(24.9)).toBe('dawn')
    expect(kindAt(25)).toBe('day')
    expect(kindAt(224.9)).toBe('day')
    expect(kindAt(225)).toBe('dusk')
    expect(kindAt(249.9)).toBe('dusk')
    expect(kindAt(250)).toBe('night')
    expect(kindAt(359.9)).toBe('night')
  })
})

describe('sampleAt', () => {
  it('reproduces the exact current golden-hour look at GOLDEN_T', () => {
    const p = sampleAt(GOLDEN_T)
    expect(p.keyColor).toBe(PALETTE.keyLight)
    expect(p.keyIntensity).toBeCloseTo(3.2)
    expect([p.keyX, p.keyY, p.keyZ]).toEqual([18, 24, 10])
    expect(p.fillSky).toBe(PALETTE.fillSky)
    expect(p.fillGround).toBe(PALETTE.fillGround)
    expect(p.fillIntensity).toBeCloseTo(1.1)
    expect(p.skyHigh).toBe(PALETTE.skyHigh)
    expect(p.skyLow).toBe(PALETTE.skyLow)
    expect(p.cloudTint).toBe(PALETTE.cloud)
    expect(p.starOpacity).toBe(0)
    expect(p.fireflyLevel).toBe(0)
  })

  it('is continuous across keyframe boundaries', () => {
    for (const boundary of [12, 25, 200, 225, 238, 250]) {
      const before = sampleAt(boundary - 1e-4)
      const after = sampleAt(boundary + 1e-4)
      expect(after.keyIntensity).toBeCloseTo(before.keyIntensity, 2)
      expect(after.keyY).toBeCloseTo(before.keyY, 1)
      expect(after.starOpacity).toBeCloseTo(before.starOpacity, 2)
    }
  })

  it('wraps: just before DAY_PERIOD matches just after 0', () => {
    const before = sampleAt(DAY_PERIOD - 1e-4)
    const after = sampleAt(0)
    expect(after.keyIntensity).toBeCloseTo(before.keyIntensity, 2)
  })

  it('shows stars only at night and dusk edges, never at midday', () => {
    expect(sampleAt(112).starOpacity).toBe(0)
    expect(sampleAt(300).starOpacity).toBeGreaterThan(0.8)
    expect(sampleAt(300).fireflyLevel).toBeGreaterThan(0.8)
  })
})

describe('DayClock', () => {
  const noReduced = () => false
  const reduced = () => true

  it('starts at GOLDEN_T and free-runs with wrap', () => {
    const clock = new DayClock(noReduced)
    expect(clock.time).toBe(GOLDEN_T)
    clock.tick(DAY_PERIOD + 5)
    expect(clock.time).toBeCloseTo(GOLDEN_T + 5)
    expect(clock.mode).toBe('auto')
  })

  it('glides forward to the day anchor and holds', () => {
    const clock = new DayClock(noReduced, 300)
    clock.setMode('day')
    for (let i = 0; i < 30 * 10; i++) clock.tick(1 / 30)
    expect(clock.time).toBeCloseTo(112, 1)
    expect(clock.kind).toBe('day')
    clock.tick(60)
    expect(clock.time).toBeCloseTo(112, 1) // held, not free-running
  })

  it('snaps instead of gliding under reduced motion', () => {
    const clock = new DayClock(reduced, 100)
    clock.setMode('night')
    clock.tick(1 / 30)
    expect(clock.time).toBeCloseTo(305, 1)
  })

  it('auto resumes free-running from the held phase', () => {
    const clock = new DayClock(reduced, 100)
    clock.setMode('night')
    clock.tick(1 / 30)
    clock.setMode('auto')
    clock.tick(2)
    expect(clock.time).toBeCloseTo(307, 0)
  })

  it('night hold works in auto mode and releases back to the captured phase', () => {
    const clock = new DayClock(reduced, 100)
    clock.requestHold('night')
    clock.tick(1 / 30)
    expect(clock.kind).toBe('night')
    clock.releaseHold()
    clock.tick(1 / 30)
    expect(clock.time).toBeCloseTo(100, 0)
    clock.tick(5)
    expect(clock.time).toBeCloseTo(105, 0) // free-running again
  })

  it('a user-selected mode wins over a hold request', () => {
    const clock = new DayClock(reduced, 100)
    clock.setMode('day')
    clock.tick(1 / 30)
    clock.requestHold('night')
    clock.tick(1 / 30)
    expect(clock.kind).toBe('day')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/core/dayClock.test.ts`
Expected: FAIL — cannot resolve `./dayClock`.

- [ ] **Step 4: Implement `src/core/dayClock.ts`**

```ts
import { PALETTE } from '../ui/tokens'

export type DayKind = 'dawn' | 'day' | 'dusk' | 'night'
export type TimeOfDayMode = 'auto' | 'day' | 'night'

export type DayParams = {
  kind: DayKind
  t: number
  keyColor: string
  keyIntensity: number
  keyX: number
  keyY: number
  keyZ: number
  fillSky: string
  fillGround: string
  fillIntensity: number
  skyHigh: string
  skyLow: string
  cloudTint: string
  starOpacity: number
  fireflyLevel: number
}

type DayLook = Omit<DayParams, 'kind' | 't'>

/** One full day+night in seconds of simulation time. */
export const DAY_PERIOD = 360
/** The pre-cycle golden-hour look lives here; gameplay starts at this phase. */
export const GOLDEN_T = 225
const DAY_START = 25
const DUSK_START = 225
const NIGHT_START = 250
/** Where the Day / Night overrides park the clock. */
export const DAY_ANCHOR = 112
export const NIGHT_ANCHOR = 305
/** Override transitions take this long at full motion. */
const GLIDE_SECONDS = 3

const GOLDEN: DayLook = {
  keyColor: PALETTE.keyLight, keyIntensity: 3.2, keyX: 18, keyY: 24, keyZ: 10,
  fillSky: PALETTE.fillSky, fillGround: PALETTE.fillGround, fillIntensity: 1.1,
  skyHigh: PALETTE.skyHigh, skyLow: PALETTE.skyLow, cloudTint: PALETTE.cloud,
  starOpacity: 0, fireflyLevel: 0,
}

const DAY: DayLook = {
  ...GOLDEN,
  keyColor: PALETTE.dayKeyLight, keyIntensity: 3.4, keyX: 4, keyY: 32, keyZ: 10,
  skyHigh: PALETTE.daySkyHigh, skyLow: PALETTE.daySkyLow,
}

const DAWN: DayLook = {
  ...GOLDEN,
  keyColor: PALETTE.dawnKeyLight, keyIntensity: 2.4, keyX: -26, keyY: 9, keyZ: 10,
  skyHigh: PALETTE.dawnSkyHigh, skyLow: PALETTE.dawnSkyLow,
  fireflyLevel: 0.2,
}

const DUSK: DayLook = {
  ...GOLDEN,
  keyColor: PALETTE.duskKeyLight, keyIntensity: 2.2, keyX: 26, keyY: 10, keyZ: 10,
  skyHigh: PALETTE.duskSkyHigh, skyLow: PALETTE.duskSkyLow,
  starOpacity: 0.25, fireflyLevel: 0.5,
}

const NIGHT: DayLook = {
  keyColor: PALETTE.nightKeyLight, keyIntensity: 0.55, keyX: -18, keyY: 26, keyZ: -8,
  fillSky: PALETTE.nightFillSky, fillGround: PALETTE.nightFillGround, fillIntensity: 0.5,
  skyHigh: PALETTE.nightSkyHigh, skyLow: PALETTE.nightSkyLow, cloudTint: PALETTE.nightCloud,
  starOpacity: 1, fireflyLevel: 1,
}

/**
 * The whole cycle is these keyframes; sample() smoothsteps between neighbours.
 * The last segment (NIGHT_START..DAY_PERIOD) wraps to the t=0 keyframe.
 */
const KEYFRAMES: { t: number; look: DayLook }[] = [
  { t: 0, look: NIGHT },
  { t: 12, look: DAWN },
  { t: DAY_START, look: DAY },
  { t: 200, look: DAY },
  { t: DUSK_START, look: GOLDEN },
  { t: 238, look: DUSK },
  { t: NIGHT_START, look: NIGHT },
]

export function kindAt(t: number): DayKind {
  const wrapped = wrap(t)
  if (wrapped < DAY_START) return 'dawn'
  if (wrapped < DUSK_START) return 'day'
  if (wrapped < NIGHT_START) return 'dusk'
  return 'night'
}

function wrap(t: number): number {
  return ((t % DAY_PERIOD) + DAY_PERIOD) % DAY_PERIOD
}

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u)
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

function lerpHex(a: string, b: string, u: number): string {
  const parse = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  const channel = (from: number, to: number): string =>
    Math.round(lerp(from, to, u)).toString(16).padStart(2, '0')
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`
}

export function sampleAt(t: number): DayParams {
  const wrapped = wrap(t)
  let from = KEYFRAMES[KEYFRAMES.length - 1]!
  let to = { t: DAY_PERIOD, look: KEYFRAMES[0]!.look }
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (wrapped >= KEYFRAMES[i]!.t && wrapped < KEYFRAMES[i + 1]!.t) {
      from = KEYFRAMES[i]!
      to = KEYFRAMES[i + 1]!
      break
    }
  }
  const span = to.t - from.t
  const u = span > 0 ? smoothstep((wrapped - from.t) / span) : 0
  const a = from.look
  const b = to.look
  return {
    kind: kindAt(wrapped),
    t: wrapped,
    keyColor: lerpHex(a.keyColor, b.keyColor, u),
    keyIntensity: lerp(a.keyIntensity, b.keyIntensity, u),
    keyX: lerp(a.keyX, b.keyX, u),
    keyY: lerp(a.keyY, b.keyY, u),
    keyZ: lerp(a.keyZ, b.keyZ, u),
    fillSky: lerpHex(a.fillSky, b.fillSky, u),
    fillGround: lerpHex(a.fillGround, b.fillGround, u),
    fillIntensity: lerp(a.fillIntensity, b.fillIntensity, u),
    skyHigh: lerpHex(a.skyHigh, b.skyHigh, u),
    skyLow: lerpHex(a.skyLow, b.skyLow, u),
    cloudTint: lerpHex(a.cloudTint, b.cloudTint, u),
    starOpacity: lerp(a.starOpacity, b.starOpacity, u),
    fireflyLevel: lerp(a.fireflyLevel, b.fireflyLevel, u),
  }
}

export class DayClock {
  private t: number
  private modeValue: TimeOfDayMode = 'auto'
  private holdKind: 'night' | null = null
  private holdResumeT: number | null = null
  private glideTarget: number | null = null
  private glideSpeed = 0
  /** After a glide lands (or a hold), the clock parks until circumstances change. */
  private parked = false

  constructor(private readonly reducedMotion: () => boolean, startT = GOLDEN_T) {
    this.t = wrap(startT)
  }

  get time(): number { return this.t }
  get mode(): TimeOfDayMode { return this.modeValue }
  get kind(): DayKind { return kindAt(this.t) }

  sample(): DayParams { return sampleAt(this.t) }

  setMode(mode: TimeOfDayMode): void {
    if (mode === this.modeValue) return
    this.modeValue = mode
    if (mode === 'auto') {
      this.parked = false
      this.glideTarget = null
      // An active hold keeps its claim when the user returns to auto.
      if (this.holdKind) this.beginGlide(NIGHT_ANCHOR)
    } else {
      this.beginGlide(mode === 'day' ? DAY_ANCHOR : NIGHT_ANCHOR)
    }
  }

  requestHold(kind: 'night'): void {
    if (this.holdKind) return
    this.holdKind = kind
    this.holdResumeT = this.t
    if (this.modeValue === 'auto') this.beginGlide(NIGHT_ANCHOR)
  }

  releaseHold(): void {
    if (!this.holdKind) return
    this.holdKind = null
    const resume = this.holdResumeT
    this.holdResumeT = null
    if (this.modeValue !== 'auto') return // user mode kept control throughout
    this.parked = false
    if (resume !== null) this.beginGlide(resume, /* parkAfter */ false)
  }

  tick(dt: number): void {
    if (this.glideTarget !== null) {
      if (this.reducedMotion()) {
        this.t = this.glideTarget
        this.finishGlide()
        return
      }
      const remaining = wrap(this.glideTarget - this.t)
      const step = this.glideSpeed * dt
      if (step >= remaining) {
        this.t = this.glideTarget
        this.finishGlide()
      } else {
        this.t = wrap(this.t + step)
      }
      return
    }
    if (this.parked) return
    this.t = wrap(this.t + dt)
  }

  private beginGlide(target: number, parkAfter = true): void {
    this.glideTarget = wrap(target)
    const distance = wrap(this.glideTarget - this.t)
    this.glideSpeed = distance > 0 ? distance / GLIDE_SECONDS : 0
    this.parkAfterGlide = parkAfter
  }

  private parkAfterGlide = true

  private finishGlide(): void {
    this.glideTarget = null
    this.parked = this.parkAfterGlide
      && (this.modeValue !== 'auto' || this.holdKind !== null)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/dayClock.test.ts`
Expected: PASS. If the continuity test fails at boundary 250 or wrap, check the last-segment handling in `sampleAt` (NIGHT→NIGHT across the wrap must hold constant values).

- [ ] **Step 6: Full check + commit**

Run: `npm test && npm run lint`
Expected: all suites pass, no type errors.

```bash
git add src/core/dayClock.ts src/core/dayClock.test.ts src/ui/tokens.ts
git commit -m "feat: add pure day/night clock with keyframed looks"
```

---

### Task 2: Preferences — `clayisland.timeOfDay`

**Files:**
- Modify: `src/core/preferences.ts`
- Modify: `src/core/preferences.test.ts`

**Interfaces:**
- Consumes: `type TimeOfDayMode` from `src/core/dayClock.ts`.
- Produces: `PreferencesSnapshot.timeOfDay: TimeOfDayMode`; `Preferences.setTimeOfDay(mode: TimeOfDayMode): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/preferences.test.ts`, following that file's existing fake-storage helper pattern (reuse whatever fake `Storage` the file already defines; the assertions below are what matter):

```ts
describe('timeOfDay preference', () => {
  it('defaults to auto when nothing is stored', () => {
    const prefs = new Preferences(null, '')
    expect(prefs.snapshot.timeOfDay).toBe('auto')
  })

  it('accepts only day and night as stored overrides', () => {
    const storage = fakeStorage({ 'clayisland.timeOfDay': 'night' })
    expect(new Preferences(storage, '').snapshot.timeOfDay).toBe('night')
    const invalid = fakeStorage({ 'clayisland.timeOfDay': 'noon' })
    expect(new Preferences(invalid, '').snapshot.timeOfDay).toBe('auto')
  })

  it('persists the mode and stays session-local when storage throws', () => {
    const storage = fakeStorage({})
    const prefs = new Preferences(storage, '')
    prefs.setTimeOfDay('day')
    expect(storage.getItem('clayisland.timeOfDay')).toBe('day')
    const blocked = new Preferences(null, '')
    blocked.setTimeOfDay('night')
    expect(blocked.snapshot.timeOfDay).toBe('night')
  })
})
```

(`fakeStorage` here stands for the file's existing test-storage helper — use its actual name and shape.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/preferences.test.ts`
Expected: FAIL — `timeOfDay` missing from snapshot.

- [ ] **Step 3: Implement**

In `src/core/preferences.ts`:

```ts
import type { TimeOfDayMode } from './dayClock'
```

Add `timeOfDay: TimeOfDayMode` to `PreferencesSnapshot`. Add the key constant beside the others:

```ts
const TIME_OF_DAY_KEY = 'clayisland.timeOfDay'
```

In the class: private field, constructor read, snapshot entry, setter — mirroring `setAutoRotate` exactly:

```ts
  private timeOfDayValue: TimeOfDayMode
```

Constructor (after `introSeenValue`):

```ts
    const timeOfDay = read(storage, TIME_OF_DAY_KEY)
    this.timeOfDayValue = timeOfDay === 'day' || timeOfDay === 'night' ? timeOfDay : 'auto'
```

Snapshot: `timeOfDay: this.timeOfDayValue,`

Setter:

```ts
  setTimeOfDay(mode: TimeOfDayMode): void {
    this.timeOfDayValue = mode
    try { this.storage?.setItem(TIME_OF_DAY_KEY, mode) } catch { /* session-only */ }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/core/preferences.ts src/core/preferences.test.ts
git commit -m "feat: persist time-of-day preference"
```

---

### Task 3: FSM — `sleep` state and day-phase weighting

**Files:**
- Modify: `src/villagers/fsm.ts`
- Modify: `src/villagers/fsm.test.ts`

**Interfaces:**
- Consumes: `type DayKind` from `src/core/dayClock.ts`.
- Produces: `'sleep'` in `STATES`/`VillagerState`; `FsmCtx` gains `dayKind: DayKind`, `nightRole: 'sleeper' | 'owl'`, `hasBuiltHut: boolean`; `stateDuration('sleep')` defined. Task 4 relies on all three field names exactly.

- [ ] **Step 1: Extend existing test contexts**

`fsm.test.ts` builds `FsmCtx` literals (directly or via a helper). Add the three new required fields with daytime defaults to the shared helper — or to every literal if there is no helper:

```ts
  dayKind: 'day',
  nightRole: 'sleeper',
  hasBuiltHut: false,
```

- [ ] **Step 2: Write the failing tests**

Append to `src/villagers/fsm.test.ts` (reusing its ctx helper; shown here as `baseCtx(overrides)` — adapt to the file's actual helper name, or inline full literals):

```ts
describe('day-phase scheduling', () => {
  it('sends night sleepers with a built hut to sleep almost always', () => {
    let sleeps = 0
    for (let seed = 0; seed < 50; seed++) {
      const ctx = baseCtx({
        dayKind: 'night', nightRole: 'sleeper', hasBuiltHut: true,
        rng: new RNG(seed),
      })
      if (decideNext(ctx) === 'sleep') sleeps++
    }
    expect(sleeps).toBeGreaterThan(40)
  })

  it('never offers sleep during the day or to night owls', () => {
    for (let seed = 0; seed < 50; seed++) {
      const day = baseCtx({ dayKind: 'day', hasBuiltHut: true, rng: new RNG(seed) })
      expect(decideNext(day)).not.toBe('sleep')
      const owl = baseCtx({
        dayKind: 'night', nightRole: 'owl', hasBuiltHut: true, rng: new RNG(seed),
      })
      expect(decideNext(owl)).not.toBe('sleep')
    }
  })

  it('lets a sleeper keep sleeping across re-rolls', () => {
    const ctx = baseCtx({
      state: 'sleep', dayKind: 'night', nightRole: 'sleeper', hasBuiltHut: true,
      rng: new RNG(1),
    })
    expect(decideNext(ctx)).toBe('sleep')
  })

  it('keeps night owls off daytime work states', () => {
    for (let seed = 0; seed < 60; seed++) {
      const ctx = baseCtx({
        dayKind: 'night', nightRole: 'owl',
        hasTree: true, canChopAutomatically: true, hasSite: true,
        hasFruitTree: true, campfireLit: true, hasFishPond: true,
        rng: new RNG(seed),
      })
      const next = decideNext(ctx)
      expect(['chopTree', 'buildHut', 'harvest', 'dance']).not.toContain(next)
    }
  })

  it('a sleeper without a hut naps instead of freezing', () => {
    const ctx = baseCtx({
      dayKind: 'night', nightRole: 'sleeper', hasBuiltHut: false, rng: new RNG(3),
    })
    expect(decideNext(ctx)).not.toBe('sleep')
  })

  it('gives sleep a bounded duration', () => {
    const duration = stateDuration('sleep', new RNG(1))
    expect(duration).toBeGreaterThanOrEqual(20)
    expect(duration).toBeLessThanOrEqual(30)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/villagers/fsm.test.ts`
Expected: FAIL — `'sleep'` not in the state union / ctx fields missing.

- [ ] **Step 4: Implement in `src/villagers/fsm.ts`**

Add the import at the top:

```ts
import type { DayKind } from '../core/dayClock'
```

Append `'sleep'` to `STATES` (keep it last):

```ts
export const STATES = [
  'wander', 'chopTree', 'buildHut', 'sitAtFire', 'flee', 'mourn', 'rebuild',
  'fish', 'makeFire', 'drink', 'harvest', 'gather',
  'chat', 'watchSea', 'dance', 'nap', 'sleep',
] as const
```

Add to `FsmCtx` (after `hasChatPartner`):

```ts
  dayKind: DayKind
  nightRole: 'sleeper' | 'owl'
  hasBuiltHut: boolean
```

Add the sleep candidate to `IDLE` (after the `nap` entry):

```ts
  {
    state: 'sleep',
    weight: 60,
    when: c => c.dayKind === 'night' && c.nightRole === 'sleeper' && c.hasBuiltHut,
  },
```

Add the phase multiplier tables and helper above `decideNext`:

```ts
/** Dusk pulls everyone toward the fire; night mutes daytime work. Missing = 1. */
const DUSK_WEIGHTS: Partial<Record<VillagerState, number>> = {
  sitAtFire: 2.5, dance: 2, chat: 1.6,
}
const NIGHT_WEIGHTS: Partial<Record<VillagerState, number>> = {
  chopTree: 0, buildHut: 0, harvest: 0, dance: 0,
  wander: 0.5, nap: 0.5,
  sitAtFire: 3, fish: 2.5, watchSea: 2.5,
}

function dayFactor(state: VillagerState, ctx: FsmCtx): number {
  if (ctx.dayKind === 'dusk') return DUSK_WEIGHTS[state] ?? 1
  if (ctx.dayKind === 'night') return NIGHT_WEIGHTS[state] ?? 1
  return 1
}
```

In `decideNext`, exempt `sleep` from the variety filter and apply the factor:

```ts
  const fresh = available.filter(option => (
    option.state !== ctx.state || option.state === wanted || option.state === 'sleep'
  ))
```

```ts
    const weight = option.weight * habit * dayFactor(option.state, ctx) / crowd
```

Add to `stateDuration`:

```ts
    case 'sleep': return rng.range(20, 30)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/villagers/fsm.test.ts`
Expected: PASS.

- [ ] **Step 6: Full check + commit**

Run: `npm test && npm run lint`
Expected: `villager.test.ts` and `world.test.ts` still pass — if they construct `FsmCtx` anywhere, extend those literals with the Step 1 defaults too.

```bash
git add src/villagers/fsm.ts src/villagers/fsm.test.ts
git commit -m "feat: add sleep state and day-phase FSM weighting"
```

---

### Task 4: Villager sleep behavior + world night roles

**Files:**
- Modify: `src/villagers/villager.ts`
- Modify: `src/world/world.ts`
- Modify: `src/world/world.test.ts`

**Interfaces:**
- Consumes: `'sleep'` state, `FsmCtx` fields from Task 3.
- Produces: `World.dayKind: DayKind` (public, default `'day'`); `World.assignNightRoles(rng: RNG): void`; `World.nearestBuiltHut(x: number, z: number): Hut | null`; `Villager.nightRole: 'sleeper' | 'owl'` (public, default `'sleeper'`). Task 5's wiring relies on these exact names.

- [ ] **Step 1: Write the failing world tests**

Append to `src/world/world.test.ts` (using that file's existing world-construction helper):

```ts
describe('night roles', () => {
  it('assigns one or two owls among the living and sleepers otherwise', () => {
    const world = buildTestWorld() // adapt to the file's helper
    world.assignNightRoles(new RNG(5))
    const living = world.villagers.filter(v => v.alive)
    const owls = living.filter(v => v.nightRole === 'owl')
    expect(owls.length).toBeGreaterThanOrEqual(1)
    expect(owls.length).toBeLessThanOrEqual(2)
    expect(living.every(v => v.nightRole === 'owl' || v.nightRole === 'sleeper')).toBe(true)
  })

  it('rotates owls between nights', () => {
    const world = buildTestWorld()
    const picks = new Set<string>()
    for (let seed = 0; seed < 12; seed++) {
      world.assignNightRoles(new RNG(seed))
      for (const v of world.villagers) if (v.nightRole === 'owl') picks.add(v.id)
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  it('finds the nearest built hut and ignores others', () => {
    const world = buildTestWorld()
    const built = world.huts.filter(h => h.state === 'built')
    if (built.length === 0) return // blueprint-dependent guard
    const target = built[0]!
    const found = world.nearestBuiltHut(target.x, target.z)
    expect(found).toBe(target)
  })
})
```

(If villagers have no public `id`, use object identity in the rotation test instead: collect villager references in the Set.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — `assignNightRoles` not a function.

- [ ] **Step 3: Implement world side (`src/world/world.ts`)**

Add import `import type { DayKind } from '../core/dayClock'` and public members:

```ts
  /** Set by the composition root each simulation tick; 'day' outside gameplay. */
  dayKind: DayKind = 'day'

  /** Roll fresh night duty: 1 owl normally, sometimes 2 in a larger village. */
  assignNightRoles(rng: RNG): void {
    const living = this.villagers.filter(v => v.alive)
    for (const villager of living) villager.nightRole = 'sleeper'
    if (living.length === 0) return
    const owlCount = living.length >= 4 && rng.chance(0.5) ? 2 : 1
    for (let i = 0; i < owlCount; i++) {
      const sleepers = living.filter(v => v.nightRole === 'sleeper')
      const pick = sleepers[rng.int(0, sleepers.length - 1)]
      if (pick) pick.nightRole = 'owl'
    }
  }

  nearestBuiltHut(x: number, z: number): Hut | null {
    let best: Hut | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const hut of this.huts) {
      if (hut.state !== 'built') continue
      const d = Math.hypot(hut.x - x, hut.z - z)
      if (d < bestDistance) { best = hut; bestDistance = d }
    }
    return best
  }
```

(Match the file's actual import for `Hut` and `RNG`; both are already used there.)

- [ ] **Step 4: Implement villager side (`src/villagers/villager.ts`)**

Public field near the other public state:

```ts
  nightRole: 'sleeper' | 'owl' = 'sleeper'
```

Extend `context(world)` (after `hasChatPartner`):

```ts
      dayKind: world.dayKind,
      nightRole: this.nightRole,
      hasBuiltHut: world.nearestBuiltHut(this.x, this.z) !== null,
```

In the `enter` switch (beside `case 'nap'`):

```ts
      case 'sleep': {
        const hut = world.nearestBuiltHut(this.x, this.z)
        if (!hut) return this.enter('nap', world)
        // Huts face the island centre; bed down just outside the doorway.
        const away = Math.hypot(hut.x, hut.z) || 1
        this.setTarget({
          x: hut.x - (hut.x / away) * 1.5,
          z: hut.z - (hut.z / away) * 1.5,
        })
        return
      }
```

In the state `update` switch (beside `case 'nap'`, which sets the breathing nap pose):

```ts
      case 'sleep': {
        if (this.targetDistance() < 0.3 && !this.arrived) {
          this.arrived = true
          this.emote('sleep', Number.POSITIVE_INFINITY)
        }
        if (this.arrived && ticked) {
          const breathe = Math.floor(this.timer * TIMING.fps / 2) % 2 === 0 ? 1.04 : 1
          this.rig.setNapPose(breathe)
        }
        return
      }
```

Extend the nap-pose scale guard (currently `if (this.state !== 'drink' && this.state !== 'nap')` around line 490):

```ts
    if (this.state !== 'drink' && this.state !== 'nap' && this.state !== 'sleep') {
```

`'sleep'` is deliberately NOT added to `PERSONALITY_STATES` — it is scheduled, not a habit.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/world/world.test.ts src/villagers/villager.test.ts`
Expected: PASS.

- [ ] **Step 6: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/villagers/villager.ts src/world/world.ts src/world/world.test.ts
git commit -m "feat: villagers sleep at huts with rotating night owls"
```

---

### Task 5: Stars and fireflies (`fx/nightSky.ts`)

**Files:**
- Create: `src/fx/nightSky.ts`
- Create: `src/fx/nightSky.test.ts`

**Interfaces:**
- Consumes: `RNG` from `src/core/rng.ts`, `PALETTE` from `src/ui/tokens.ts`.
- Produces:
  - `function starPositions(count: number, radius: number, seed: number): Float32Array` (pure, testable)
  - `function fireflyBasePositions(count: number, seed: number): Float32Array` (pure, testable)
  - `class NightSky { constructor(scene: THREE.Scene, stageRoot: THREE.Object3D, lowFx: boolean); setLevels(starOpacity: number, fireflyLevel: number): void; update(dt: number, reducedMotion: boolean): void }`
  Task 6's wiring relies on these names.

- [ ] **Step 1: Write the failing tests** (pure generators only — no THREE in tests)

Create `src/fx/nightSky.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fireflyBasePositions, starPositions } from './nightSky'

describe('starPositions', () => {
  it('is deterministic for a seed and sized 3 floats per star', () => {
    const a = starPositions(300, 90, 4242)
    const b = starPositions(300, 90, 4242)
    expect(a).toEqual(b)
    expect(a.length).toBe(900)
  })

  it('places every star on the upper hemisphere at the given radius', () => {
    const positions = starPositions(120, 90, 7)
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!]
      expect(y).toBeGreaterThan(4) // never below the horizon glow
      expect(Math.hypot(x, y, z)).toBeCloseTo(90, 0)
    }
  })
})

describe('fireflyBasePositions', () => {
  it('keeps fireflies in a low ring around the village', () => {
    const positions = fireflyBasePositions(14, 11)
    expect(positions.length).toBe(42)
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!]
      const r = Math.hypot(x, z)
      expect(r).toBeGreaterThanOrEqual(3)
      expect(r).toBeLessThanOrEqual(8)
      expect(y).toBeGreaterThanOrEqual(0.5)
      expect(y).toBeLessThanOrEqual(2.5)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/fx/nightSky.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/fx/nightSky.ts`**

```ts
import * as THREE from 'three'
import { RNG } from '../core/rng'
import { PALETTE } from '../ui/tokens'

/** Deterministic dome of stars on the upper hemisphere (y kept off the horizon). */
export function starPositions(count: number, radius: number, seed: number): Float32Array {
  const rng = new RNG(seed)
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const azimuth = rng.range(0, Math.PI * 2)
    // sin distribution biases stars away from the horizon band the clouds occupy.
    const elevation = Math.asin(rng.range(0.08, 1))
    positions[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * radius
    positions[i * 3 + 1] = Math.sin(elevation) * radius
    positions[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius
  }
  return positions
}

/** Home points for firefly drift: a low ring between village and forest edge. */
export function fireflyBasePositions(count: number, seed: number): Float32Array {
  const rng = new RNG(seed)
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2)
    const radius = rng.range(3, 8)
    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = rng.range(0.5, 2.5)
    positions[i * 3 + 2] = Math.sin(angle) * radius
  }
  return positions
}

const STAR_COUNT = 300
const STAR_COUNT_LOWFX = 120
const FIREFLY_COUNT = 14

export class NightSky {
  private readonly stars: THREE.Points
  private readonly starMaterial: THREE.PointsMaterial
  private readonly fireflies: THREE.Points | null = null
  private readonly fireflyMaterial: THREE.PointsMaterial | null = null
  private readonly fireflyBase: Float32Array | null = null
  private readonly fireflyPhases: number[] = []
  private starLevel = 0
  private fireflyLevel = 0
  private elapsed = 0

  constructor(scene: THREE.Scene, stageRoot: THREE.Object3D, lowFx: boolean) {
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(
      starPositions(lowFx ? STAR_COUNT_LOWFX : STAR_COUNT, 90, 4242), 3,
    ))
    this.starMaterial = new THREE.PointsMaterial({
      color: PALETTE.cloud,
      size: 0.7,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.stars = new THREE.Points(starGeometry, this.starMaterial)
    this.stars.visible = false
    scene.add(this.stars)

    if (!lowFx) {
      this.fireflyBase = fireflyBasePositions(FIREFLY_COUNT, 11)
      const fireflyGeometry = new THREE.BufferGeometry()
      fireflyGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(this.fireflyBase.slice(), 3),
      )
      this.fireflyMaterial = new THREE.PointsMaterial({
        color: PALETTE.ember,
        size: 0.28,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      this.fireflies = new THREE.Points(fireflyGeometry, this.fireflyMaterial)
      this.fireflies.visible = false
      const rng = new RNG(23)
      for (let i = 0; i < FIREFLY_COUNT; i++) this.fireflyPhases.push(rng.range(0, Math.PI * 2))
      stageRoot.add(this.fireflies)
    }
  }

  setLevels(starOpacity: number, fireflyLevel: number): void {
    this.starLevel = starOpacity
    this.fireflyLevel = fireflyLevel
  }

  update(dt: number, reducedMotion: boolean): void {
    this.elapsed += dt

    const twinkle = reducedMotion ? 1 : 0.9 + Math.sin(this.elapsed * 1.7) * 0.1
    this.starMaterial.opacity = this.starLevel * twinkle
    this.stars.visible = this.starLevel > 0.01

    if (!this.fireflies || !this.fireflyMaterial || !this.fireflyBase) return
    const pulse = 0.55 + Math.sin(this.elapsed * 2.3) * 0.45
    this.fireflyMaterial.opacity = this.fireflyLevel * pulse
    this.fireflies.visible = this.fireflyLevel > 0.01
    if (!reducedMotion && this.fireflies.visible) {
      const attribute = this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        const phase = this.fireflyPhases[i]!
        attribute.setX(i, this.fireflyBase[i * 3]! + Math.sin(this.elapsed * 0.6 + phase) * 0.6)
        attribute.setY(i, this.fireflyBase[i * 3 + 1]! + Math.sin(this.elapsed * 0.9 + phase * 2) * 0.3)
        attribute.setZ(i, this.fireflyBase[i * 3 + 2]! + Math.cos(this.elapsed * 0.5 + phase) * 0.6)
      }
      attribute.needsUpdate = true
    }
  }
}
```

(Check `RNG`'s actual constructor/method names against `src/core/rng.ts` — `range(min, max)` is used throughout the codebase.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/fx/nightSky.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run lint`

```bash
git add src/fx/nightSky.ts src/fx/nightSky.test.ts
git commit -m "feat: add deterministic star dome and firefly drift"
```

---

### Task 6: Scene applies the sampled look

**Files:**
- Modify: `src/scene.ts`

**Interfaces:**
- Consumes: `type DayParams` from `src/core/dayClock.ts`.
- Produces: the `createScene` bundle gains `applyDay(params: DayParams, dt: number): void`. Task 8's wiring relies on that name.

No unit test — `scene.ts` is WebGL/DOM code outside the Node test environment (it has no test today). Verification is `npm run lint` + `npm run build` + Task 8's manual QA.

- [ ] **Step 1: Keep the sky canvas redrawable**

Replace `createSkyTexture()` so the canvas/context are reusable:

```ts
function createSky(): { texture: THREE.CanvasTexture; redraw(high: string, low: string): void } {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const redraw = (high: string, low: string): void => {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, high)
    gradient.addColorStop(1, low)
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    texture.needsUpdate = true
  }
  redraw(PALETTE.skyHigh, PALETTE.skyLow)
  return { texture, redraw }
}
```

In `createScene`, replace `scene.background = createSkyTexture()` with:

```ts
  const sky = createSky()
  scene.background = sky.texture
```

- [ ] **Step 2: Add `applyDay`**

Import the type: `import type { DayParams } from './core/dayClock'`.

Below `updateSky`, add (closing over `key`, `fill`, `cloudMaterial`, `sky`, `lowFx`):

```ts
  let skyRedrawCooldown = 0
  let lastSkyHigh = PALETTE.skyHigh
  let lastSkyLow = PALETTE.skyLow

  function applyDay(params: DayParams, dt: number): void {
    key.color.set(params.keyColor)
    key.intensity = params.keyIntensity
    // Reduced quality bypasses shadows; a moving sun buys nothing there.
    if (!lowFx) key.position.set(params.keyX, params.keyY, params.keyZ)
    fill.color.set(params.fillSky)
    fill.groundColor.set(params.fillGround)
    fill.intensity = params.fillIntensity
    cloudMaterial.color.set(params.cloudTint)

    skyRedrawCooldown -= dt
    if (skyRedrawCooldown <= 0
      && (params.skyHigh !== lastSkyHigh || params.skyLow !== lastSkyLow)) {
      skyRedrawCooldown = 0.25
      lastSkyHigh = params.skyHigh
      lastSkyLow = params.skyLow
      sky.redraw(params.skyHigh, params.skyLow)
    }
  }
```

Add `applyDay` to the returned bundle:

```ts
  return { scene, stageRoot, camera, renderer, updateSky, applyDay, quality, composer, lowFx }
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all pass (nothing calls `applyDay` yet; defaults still render golden hour).

- [ ] **Step 4: Commit**

```bash
git add src/scene.ts
git commit -m "feat: scene applies day-clock lighting and sky looks"
```

---

### Task 7: Settings — Time of day control

**Files:**
- Modify: `src/ui/settings.ts`
- Create: `src/ui/settings.test.ts`

**Interfaces:**
- Consumes: `type TimeOfDayMode` from `src/core/dayClock.ts`.
- Produces: `SettingsUIOptions` gains `timeOfDay: TimeOfDayMode` and `onTimeOfDayChange(mode: TimeOfDayMode): void`; `SettingsUI` gains `setTimeOfDay(mode: TimeOfDayMode): void`; exported `const TIME_OF_DAY_OPTIONS: readonly { value: TimeOfDayMode; label: string }[]`. Task 8 relies on these names.

- [ ] **Step 1: Write the failing test**

Create `src/ui/settings.test.ts` (Node-safe: pure export only, like `tray.test.ts`):

```ts
import { expect, it } from 'vitest'
import { TIME_OF_DAY_OPTIONS } from './settings'

it('offers exactly Auto, Day, and Night in that order', () => {
  expect(TIME_OF_DAY_OPTIONS.map(option => option.value)).toEqual(['auto', 'day', 'night'])
  expect(TIME_OF_DAY_OPTIONS.map(option => option.label)).toEqual(['Auto', 'Day', 'Night'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/settings.test.ts`
Expected: FAIL — export missing.

- [ ] **Step 3: Implement**

In `src/ui/settings.ts`:

```ts
import type { TimeOfDayMode } from '../core/dayClock'

export const TIME_OF_DAY_OPTIONS: readonly { value: TimeOfDayMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
] as const
```

Extend the types:

```ts
  setTimeOfDay(mode: TimeOfDayMode): void   // on SettingsUI
  timeOfDay: TimeOfDayMode                   // on SettingsUIOptions
  onTimeOfDayChange(mode: TimeOfDayMode): void
```

Build the fieldset after `qualityGroup` (mirroring its markup; reuse the `settings-quality` class so existing styles apply):

```ts
  const timeGroup = document.createElement('fieldset')
  timeGroup.className = 'settings-quality settings-time'
  const timeLegend = document.createElement('legend')
  timeLegend.textContent = 'Time of day'
  const timeRadios = new Map<TimeOfDayMode, HTMLInputElement>()
  for (const option of TIME_OF_DAY_OPTIONS) {
    const label = document.createElement('label')
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'time-of-day'
    radio.value = option.value
    label.append(radio, document.createTextNode(option.label))
    timeGroup.append(label)
    timeRadios.set(option.value, radio)
  }
  timeGroup.prepend(timeLegend)
```

Append `timeGroup` to `body.append(...)` right after `qualityGroup`.

State + sync + handlers, mirroring the auto-rotate pattern (no confirmation dialog — unlike quality, this needs no reload):

```ts
  let timeOfDay = options.timeOfDay

  const syncTimeOfDay = (): void => {
    for (const [value, radio] of timeRadios) radio.checked = value === timeOfDay
  }

  const handleTimeOfDay = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value as TimeOfDayMode
    options.onTimeOfDayChange(value)
  }
  for (const radio of timeRadios.values()) radio.addEventListener('change', handleTimeOfDay)
```

Call `syncTimeOfDay()` beside the other initial syncs, add the returned method:

```ts
    setTimeOfDay(mode) {
      timeOfDay = mode
      syncTimeOfDay()
    },
```

and remove the listeners in `dispose()`:

```ts
      for (const radio of timeRadios.values()) radio.removeEventListener('change', handleTimeOfDay)
```

- [ ] **Step 4: Run tests, full check, commit**

Run: `npx vitest run src/ui/settings.test.ts && npm test && npm run lint`

```bash
git add src/ui/settings.ts src/ui/settings.test.ts
git commit -m "feat: add time-of-day control to settings"
```

---

### Task 8: Wire everything in `main.ts`, emit `day:phase`, update docs

**Files:**
- Modify: `src/main.ts`
- Modify: `src/core/events.ts`
- Modify: `docs/architecture.md`
- Modify: `README.md` (one line in "What makes it tick")

**Interfaces:**
- Consumes: everything produced by Tasks 1–7.
- Produces: `GameEvent` union gains `{ type: 'day:phase'; kind: DayKind }`.

- [ ] **Step 1: Add the event**

In `src/core/events.ts`:

```ts
import type { DayKind } from './dayClock'
```

Append to the `GameEvent` union:

```ts
  | { type: 'day:phase'; kind: DayKind }
```

Run `npm test` — the journal matcher switches on known types and must ignore this one; if `discovery/moments.ts` has an exhaustive switch, add an explicit ignore branch there.

- [ ] **Step 2: Wire the clock in `src/main.ts`**

Imports:

```ts
import { DayClock } from './core/dayClock'
import { NightSky } from './fx/nightSky'
```

Destructure `applyDay` from the scene bundle (add it to the existing `const { ... } = sceneBundle`).

After `cameraController` setup:

```ts
const dayClock = new DayClock(reducedMotion)
dayClock.setMode(startup.timeOfDay)
const nightSky = new NightSky(scene, stageRoot, lowFx)
let lastDayKind = dayClock.kind
```

In the **simulation callback**, immediately after the `if (!simulatesGameplay(flow)) return` line:

```ts
    dayClock.tick(dt)
    world.dayKind = dayClock.kind
    if (dayClock.kind !== lastDayKind) {
      lastDayKind = dayClock.kind
      if (dayClock.kind === 'night') world.assignNightRoles(rng)
      world.bus.emit({ type: 'day:phase', kind: dayClock.kind })
    }
```

In the **render callback**, inside the existing `if (gameplayActive) { ... }` block:

```ts
      const dayParams = dayClock.sample()
      applyDay(dayParams, dt)
      nightSky.setLevels(dayParams.starOpacity, dayParams.fireflyLevel)
      nightSky.update(dt, reducedMotion())
```

- [ ] **Step 3: Wire the Settings option**

In the `createSettingsUI` options object, after `reducedMotion: reducedMotion(),`:

```ts
  timeOfDay: startup.timeOfDay,
```

and after `onReducedMotionChange`:

```ts
  onTimeOfDayChange(mode) {
    preferences.setTimeOfDay(mode)
    dayClock.setMode(mode)
    settingsUI?.setTimeOfDay(mode)
  },
```

- [ ] **Step 4: Verify the full app**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

Manual QA (`npm run dev`):
1. Begin → gameplay opens at the familiar golden hour (no pop), then dusk falls within ~30 s and night within ~1 min: stars fade in, fireflies drift, clouds darken, villagers head to huts with `z` particles while 1–2 owls fish/tend the fire/watch the sea.
2. Cast Meteor at night — sleepers wake and flee; dawn arrives ~2 min later and normal bustle resumes.
3. Settings → Time of day → Day glides to midday and holds; Night holds night; Auto resumes. With Reduced motion On, the change snaps.
4. `?lowfx=1`: colors change but the light does not move; fewer stars; no fireflies.
5. Hide the tab ~2 min during day, return — it should be a later time of day.
6. Replay intro from Settings — prologue runs at canonical golden hour; gameplay restores the live time of day afterward.

- [ ] **Step 5: Update docs**

- `docs/architecture.md`: add a `src/core/dayClock.ts` bullet (pure keyframed clock, modes, hold surface), extend the `src/scene.ts` bullet with `applyDay`/redrawable sky, extend the villagers bullet with `sleep`/night roles, extend preferences bullet with `clayisland.timeOfDay`, and note the `day:phase` event.
- `README.md`: extend the feature list with one line, e.g. `- A six-minute day/night cycle with keyframed light, stars, fireflies, and villager sleep schedules — overridable in Settings.`

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/core/events.ts docs/architecture.md README.md
git commit -m "feat: wire day/night cycle into gameplay, settings, and events"
```

---

## Self-Review Notes

- Spec coverage: clock module (T1), override modes + hold surface (T1), preferences (T2), FSM schedule + sleep + owls (T3–T4), stars/fireflies (T5), scene lighting/sky/cloud tint + lowfx arc skip (T6), settings UI (T7), gameplay-only ticking, `day:phase` event, background advancement, docs (T8). Reduced-motion star/firefly behavior in T5/T6; snap-not-glide in T1.
- Node-only test environment respected: THREE/DOM code (T5 wrapper, T6, T7 DOM, T8) is verified by lint/build/manual QA; all pure logic is unit-tested.
- Helper names in existing test files (`fakeStorage`, `baseCtx`, `buildTestWorld`) are stand-ins — each task says to adapt to the file's real helpers.

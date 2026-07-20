# Photo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-click photo mode (tray camera button + key `P`) that renders one high-resolution frame, composites it onto a clay-paper postcard with a pressed caption like "Clay Island — Day 12, dusk", and downloads it as `clay-island-day-<n>-<phase>.png` — entirely locally.

**Architecture:** `DayClock` gains a day counter that increments only on free-run wraps and reports through an `onDayWrap` callback; `Preferences` persists it as `clayisland.dayCount` with the usual blocked-storage → session-local semantics. A new `src/ui/photo.ts` owns everything photo-shaped behind injectable boundaries so it tests in Node: pure caption/filename/layout/composition helpers, a `createPhotoCapture()` controller that resizes an abstract renderer/composer, renders one frame, reads the canvas synchronously, composites, restores, and downloads via `toBlob`, plus DOM helpers (`downloadBlob`, `createPhotoAnnouncer`). The tray gains a disabled-not-hidden camera button and the `P` shortcut; `Sfx` gains a synthesized shutter click; `main.ts` wires the real renderer/composer/day-clock/sfx into the controller.

**Tech Stack:** Vanilla Three.js, TypeScript (strict), Vite 8, Vitest (Node environment — no DOM/WebGL in tests; all DOM-touching code stays behind injected interfaces or in `main.ts`).

**Spec:** `docs/superpowers/specs/2026-07-18-photo-mode-design.md`

## Global Constraints

- Vitest runs in the **Node environment** (`vite.config.ts`): tests exercise pure helpers and stub-injected controllers only. `main.ts`, `styles.css`, and real canvas/audio behavior are verified by `npm run lint` + `npm run build` + manual QA.
- Hex colors live **only** in `PALETTE` (`src/ui/tokens.ts`) — this feature adds **no new hexes**. The postcard uses `PALETTE.paper` (border), `PALETTE.inkSoft` (pressed seam), `PALETTE.ink` / `PALETTE.cloud` (pressed caption), and the flash uses `PALETTE.cloud` (clay white — never pure `#fff`).
- Armability is exactly the powers' condition: `canArmPower(flow, modalOpen)` — gameplay phase, no modal owner. The button is **disabled, not hidden**, otherwise. Photo mode is deliberately **not** disabled during celebration (the spec builds it last precisely to capture upgraded celebrations).
- Capture is **synchronous render-then-read in one task** so `preserveDrawingBuffer` stays off. Capture width is capped at **2560 px**, aspect preserved. The renderer/composer must be restored on **every** path, including failures.
- Caption text: `Clay Island — Day <n>, <kind>` where `<kind>` is the `DayKind` string (`dawn`/`day`/`dusk`/`night`). Filename: `clay-island-day-<n>-<kind>.png`.
- Day counter: starts at 1, increments only when the clock **free-runs** past `DAY_PERIOD` — glides (Settings Day/Night toggles, celebration night hold) never count. Blocked storage → session-local, counter restarts at 1 next load.
- Feedback: white DOM flash (skipped entirely under reduced motion), `Sfx.shutter()` click, `aria-live="polite"` "Photo saved" / "Photo failed". Reduced motion keeps the click and announcement.
- `?lowfx=1`: capture works, shows the reduced renderer's honest output, and must **not** resize the unused post-processing composer (no wasted 2560-wide buffers).
- No new `GameEvent` variants, no new journal Moments, no external services.
- Out of scope: full-bleed export, share targets, filters, auto-photos during celebration, photo gallery.
- Run `npm test && npm run lint` after every task; both must pass before committing.

---

### Task 1: Day counter in `DayClock`

**Files:**
- Modify: `src/core/dayClock.ts`
- Test: `src/core/dayClock.test.ts`

**Interfaces:**
- Consumes: existing `DayClock` constructor `(reducedMotion: () => boolean, startT = GOLDEN_T)`, private `tick()` free-run branch, `DAY_PERIOD`.
- Produces (later tasks rely on these exact names):
  - `DayClock` constructor widens to `(reducedMotion: () => boolean, startT = GOLDEN_T, startDay = 1)` — `startDay` is sanitised to an integer ≥ 1.
  - `get day(): number` — current day count.
  - `onDayWrap: ((day: number) => void) | null` — public mutable field, fired with the **new** count each time the free-running clock wraps.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/dayClock.test.ts` inside the existing `describe('DayClock', ...)` block (reuses its `noReduced` helper):

```ts
  it('starts at day 1 and increments once per free-run wrap', () => {
    const clock = new DayClock(noReduced, DAY_PERIOD - 1)
    const wraps: number[] = []
    clock.onDayWrap = day => wraps.push(day)
    expect(clock.day).toBe(1)
    clock.tick(2)
    expect(clock.day).toBe(2)
    expect(wraps).toEqual([2])
    clock.tick(DAY_PERIOD)
    expect(clock.day).toBe(3)
    expect(wraps).toEqual([2, 3])
  })

  it('sanitises the persisted start day', () => {
    expect(new DayClock(noReduced, 0, 12).day).toBe(12)
    expect(new DayClock(noReduced, 0, 0).day).toBe(1)
    expect(new DayClock(noReduced, 0, -3).day).toBe(1)
    expect(new DayClock(noReduced, 0, 4.7).day).toBe(4)
  })

  it('does not count glides or holds as lived days', () => {
    const clock = new DayClock(noReduced, 300)
    const wraps: number[] = []
    clock.onDayWrap = day => wraps.push(day)
    clock.setMode('day') // glides forward through t=0 to DAY_ANCHOR
    for (let i = 0; i < 30 * 10; i++) clock.tick(1 / 30)
    expect(clock.time).toBeCloseTo(DAY_ANCHOR, 1)
    expect(clock.day).toBe(1)
    expect(wraps).toEqual([])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/dayClock.test.ts`
Expected: FAIL — `clock.day` is undefined / `onDayWrap` does not exist.

- [ ] **Step 3: Implement the counter**

In `src/core/dayClock.ts`, inside `class DayClock`:

Add fields and widen the constructor (replace the existing constructor):

```ts
  private dayValue: number
  /** Fired with the new count each time the free-running clock wraps a full day. */
  onDayWrap: ((day: number) => void) | null = null

  constructor(
    private readonly reducedMotion: () => boolean,
    startT = GOLDEN_T,
    startDay = 1,
  ) {
    this.t = wrap(startT)
    this.dayValue = Math.max(1, Math.floor(startDay))
  }
```

Add the getter next to the existing ones:

```ts
  get day(): number { return this.dayValue }
```

Replace the free-run tail of `tick()` (currently `if (this.parked) return` / `this.t = wrap(this.t + dt)`):

```ts
    if (this.parked) return
    const advanced = this.t + dt
    if (advanced >= DAY_PERIOD) {
      this.dayValue += Math.floor(advanced / DAY_PERIOD)
      this.onDayWrap?.(this.dayValue)
    }
    this.t = wrap(advanced)
```

Glide branches are untouched: a glide that crosses `t = 0` (mode toggles, celebration hold) never increments.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/core/dayClock.test.ts`
Expected: PASS (all existing DayClock tests still green).

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/core/dayClock.ts src/core/dayClock.test.ts
git commit -m "feat: add free-run day counter to DayClock"
```

---

### Task 2: Persisted day count in `Preferences` + bootstrap wiring

**Files:**
- Modify: `src/core/preferences.ts`
- Modify: `src/main.ts` (two lines at the `DayClock` construction site, `src/main.ts:89`)
- Test: `src/core/preferences.test.ts`

**Interfaces:**
- Consumes: `Preferences` storage `read()` helper and try/catch setter pattern; Task 1's `DayClock` `startDay` parameter and `onDayWrap` field.
- Produces (later tasks rely on these exact names):
  - `PreferencesSnapshot.dayCount: number` (integer ≥ 1; defaults to 1 on absent/corrupt/blocked storage).
  - `Preferences.setDayCount(count: number): void` — persists to `clayisland.dayCount`, session-local on failure.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/preferences.test.ts`:

```ts
describe('day count', () => {
  it('defaults to 1 for absent or corrupt values', () => {
    expect(new Preferences(null, '').snapshot.dayCount).toBe(1)
    const storage = new MemoryStorage()
    storage.values.set('clayisland.dayCount', 'twelve')
    expect(new Preferences(storage, '').snapshot.dayCount).toBe(1)
    storage.values.set('clayisland.dayCount', '0')
    expect(new Preferences(storage, '').snapshot.dayCount).toBe(1)
  })

  it('persists the count and survives reload', () => {
    const storage = new MemoryStorage()
    new Preferences(storage, '').setDayCount(12)
    expect(storage.values.get('clayisland.dayCount')).toBe('12')
    expect(new Preferences(storage, '').snapshot.dayCount).toBe(12)
  })

  it('stays session-local when storage writes fail', () => {
    const blocked: PreferenceStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('blocked') },
    }
    const preferences = new Preferences(blocked, '')
    preferences.setDayCount(4)
    expect(preferences.snapshot.dayCount).toBe(4)
  })
})
```

Also update the **existing** `'uses safe defaults for absent and corrupt values'` test: its `toEqual` snapshot object gains `dayCount: 1`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/preferences.test.ts`
Expected: FAIL — `dayCount` missing from snapshot, `setDayCount` not a function.

- [ ] **Step 3: Implement the preference**

In `src/core/preferences.ts`:

Add to `PreferencesSnapshot`:

```ts
  dayCount: number
```

Add the key beside the others:

```ts
const DAY_COUNT_KEY = 'clayisland.dayCount'
```

Add the field, constructor read, snapshot entry, and setter (matching the surrounding style):

```ts
  private dayCountValue: number
```

In the constructor, after the `timeOfDay` read:

```ts
    const dayCount = Number.parseInt(read(storage, DAY_COUNT_KEY) ?? '', 10)
    this.dayCountValue = Number.isInteger(dayCount) && dayCount >= 1 ? dayCount : 1
```

In `get snapshot()`:

```ts
      dayCount: this.dayCountValue,
```

New setter beside `setTimeOfDay`:

```ts
  setDayCount(count: number): void {
    this.dayCountValue = count
    try { this.storage?.setItem(DAY_COUNT_KEY, String(count)) } catch { /* session-only */ }
  }
```

- [ ] **Step 4: Wire bootstrap in `main.ts`**

Replace `const dayClock = new DayClock(reducedMotion)` (`src/main.ts:89`) with:

```ts
const dayClock = new DayClock(reducedMotion, GOLDEN_T, startup.dayCount)
dayClock.onDayWrap = day => preferences.setDayCount(day)
```

(`GOLDEN_T` is already imported at `src/main.ts:27`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/core/preferences.test.ts`
Expected: PASS.

- [ ] **Step 6: Full check and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/core/preferences.ts src/core/preferences.test.ts src/main.ts
git commit -m "feat: persist the island day count"
```

---

### Task 3: Shutter click in `Sfx`

**Files:**
- Modify: `src/audio/sfx.ts`
- Test: `src/audio/sfx.test.ts`

**Interfaces:**
- Consumes: existing private `knock(pitch, seconds, volume)` and `oscillator(type, from, to, seconds, volume)` voices.
- Produces (later tasks rely on these exact names):
  - `export function shutterSoundProfile(): ShutterSoundProfile` where `export type ShutterSoundProfile = { knock: { pitch: number; seconds: number; volume: number }; tick: { from: number; to: number; seconds: number; volume: number } }`.
  - `Sfx.shutter(): void` — layered low knock + high tick, one mechanical click.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/sfx.test.ts` (extend the top import with `shutterSoundProfile`):

```ts
it('keeps the shutter click short and quiet', () => {
  const profile = shutterSoundProfile()
  expect(profile.knock.seconds).toBeLessThanOrEqual(0.08)
  expect(profile.tick.seconds).toBeLessThanOrEqual(0.05)
  expect(profile.knock.volume).toBeLessThanOrEqual(0.06)
  expect(profile.tick.volume).toBeLessThanOrEqual(0.03)
  expect(profile.tick.from).toBeGreaterThan(profile.knock.pitch)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/audio/sfx.test.ts`
Expected: FAIL — `shutterSoundProfile` is not exported.

- [ ] **Step 3: Implement profile and voice**

In `src/audio/sfx.ts`, next to the other profile helpers:

```ts
export type ShutterSoundProfile = {
  knock: { pitch: number; seconds: number; volume: number }
  tick: { from: number; to: number; seconds: number; volume: number }
}

export function shutterSoundProfile(): ShutterSoundProfile {
  return {
    knock: { pitch: 430, seconds: 0.05, volume: 0.045 },
    tick: { from: 2400, to: 1500, seconds: 0.03, volume: 0.016 },
  }
}
```

In `class Sfx`, next to `reward()`:

```ts
  shutter(): void {
    const profile = shutterSoundProfile()
    this.knock(profile.knock.pitch, profile.knock.seconds, profile.knock.volume)
    this.oscillator(
      'sine',
      profile.tick.from,
      profile.tick.to,
      profile.tick.seconds,
      profile.tick.volume,
    )
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/audio/sfx.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/audio/sfx.ts src/audio/sfx.test.ts
git commit -m "feat: add synthesized shutter click"
```

---

### Task 4: Postcard pure helpers — caption, filename, layout, composition, armability

**Files:**
- Create: `src/ui/photo.ts`
- Test: `src/ui/photo.test.ts` (new)

**Interfaces:**
- Consumes: `DayKind` from `src/core/dayClock.ts`, `canArmPower` + `AppFlowState` from `src/core/appFlow.ts`, `PALETTE` from `src/ui/tokens.ts`.
- Produces (later tasks rely on these exact names):
  - `export const CAPTURE_MAX_WIDTH = 2560`
  - `export function postcardCaption(day: number, kind: DayKind): string`
  - `export function photoFilename(day: number, kind: DayKind): string`
  - `export type PostcardLayout = { outerWidth: number; outerHeight: number; border: number; captionBand: number; imageX: number; imageY: number; captionX: number; captionY: number; fontPx: number }`
  - `export function postcardLayout(width: number, height: number): PostcardLayout`
  - `export type PostcardImageSource = { width: number; height: number }`
  - `export type Postcard2dContext` (structural subset of `CanvasRenderingContext2D`, see below)
  - `export function composePostcard(context: Postcard2dContext, source: PostcardImageSource, layout: PostcardLayout, caption: string): void`
  - `export function photoArmable(state: AppFlowState, modalOpen: boolean): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/photo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { initialAppFlow, transitionAppFlow } from '../core/appFlow'
import { PALETTE } from './tokens'
import {
  composePostcard,
  photoArmable,
  photoFilename,
  postcardCaption,
  postcardLayout,
  type Postcard2dContext,
} from './photo'

describe('postcard text', () => {
  it('derives the caption from day count and phase kind', () => {
    expect(postcardCaption(12, 'dusk')).toBe('Clay Island — Day 12, dusk')
    expect(postcardCaption(1, 'night')).toBe('Clay Island — Day 1, night')
  })

  it('derives the filename from day count and phase kind', () => {
    expect(photoFilename(12, 'dusk')).toBe('clay-island-day-12-dusk.png')
    expect(photoFilename(3, 'dawn')).toBe('clay-island-day-3-dawn.png')
  })
})

describe('postcardLayout', () => {
  it('frames a 2560x1440 capture with a clay border and caption band', () => {
    const layout = postcardLayout(2560, 1440)
    expect(layout.border).toBe(77) // round(2560 * 0.03)
    expect(layout.captionBand).toBe(192) // round(2560 * 0.075)
    expect(layout.outerWidth).toBe(2560 + 77 * 2)
    expect(layout.outerHeight).toBe(1440 + 77 + 192)
    expect(layout.imageX).toBe(77)
    expect(layout.imageY).toBe(77)
    expect(layout.captionX).toBe(Math.round((2560 + 77 * 2) / 2))
    expect(layout.captionY).toBe(1440 + 77 + 96)
    expect(layout.fontPx).toBe(77) // round(192 * 0.4)
  })

  it('preserves portrait aspect captures', () => {
    const layout = postcardLayout(2560, 5120)
    expect(layout.outerWidth).toBe(2560 + layout.border * 2)
    expect(layout.outerHeight).toBe(5120 + layout.border + layout.captionBand)
  })
})

type Rect = { x: number; y: number; w: number; h: number; fill: string }
type Draw = { x: number; y: number; w: number; h: number }
type Text = { text: string; x: number; y: number; fill: string }

class StubContext implements Postcard2dContext {
  fillStyle: string | CanvasGradient | CanvasPattern = ''
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  rects: Rect[] = []
  draws: Draw[] = []
  texts: Text[] = []
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, fill: String(this.fillStyle) })
  }
  drawImage(_source: unknown, x: number, y: number, w: number, h: number): void {
    this.draws.push({ x, y, w, h })
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, fill: String(this.fillStyle) })
  }
}

describe('composePostcard', () => {
  it('paints paper, pressed seam, capture, and a two-pass pressed caption', () => {
    const layout = postcardLayout(2560, 1440)
    const context = new StubContext()
    composePostcard(context, { width: 2560, height: 1440 }, layout, 'Clay Island — Day 12, dusk')

    expect(context.rects[0]).toEqual({
      x: 0, y: 0, w: layout.outerWidth, h: layout.outerHeight, fill: PALETTE.paper,
    })
    expect(context.rects[1]).toEqual({
      x: layout.imageX - 3, y: layout.imageY - 3, w: 2560 + 6, h: 1440 + 6, fill: PALETTE.inkSoft,
    })
    expect(context.draws).toEqual([{ x: layout.imageX, y: layout.imageY, w: 2560, h: 1440 }])
    expect(context.texts).toHaveLength(2)
    expect(context.texts[0]).toMatchObject({
      text: 'Clay Island — Day 12, dusk', x: layout.captionX, fill: PALETTE.cloud,
    })
    expect(context.texts[0]!.y).toBeGreaterThan(layout.captionY)
    expect(context.texts[1]).toEqual({
      text: 'Clay Island — Day 12, dusk', x: layout.captionX, y: layout.captionY, fill: PALETTE.ink,
    })
    expect(context.textAlign).toBe('center')
    expect(context.textBaseline).toBe('middle')
    expect(context.font).toContain(`${layout.fontPx}px`)
  })
})

describe('photoArmable', () => {
  it('is armable only in gameplay with no modal owner', () => {
    const title = initialAppFlow(true)
    expect(photoArmable(title, false)).toBe(false)
    const prologue = transitionAppFlow(title, { type: 'begin' })
    expect(photoArmable(prologue, false)).toBe(false)
    const gameplay = transitionAppFlow(prologue, { type: 'finishPrologue' })
    expect(photoArmable(gameplay, false)).toBe(true)
    expect(photoArmable(gameplay, true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/photo.test.ts`
Expected: FAIL — module `./photo` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Create `src/ui/photo.ts`:

```ts
import { canArmPower, type AppFlowState } from '../core/appFlow'
import type { DayKind } from '../core/dayClock'
import { PALETTE } from './tokens'

/** Capture is capped here; aspect follows the live canvas. */
export const CAPTURE_MAX_WIDTH = 2560

export type PostcardLayout = {
  outerWidth: number
  outerHeight: number
  border: number
  captionBand: number
  imageX: number
  imageY: number
  captionX: number
  captionY: number
  fontPx: number
}

export type PostcardImageSource = { width: number; height: number }

export type Postcard2dContext = {
  fillStyle: string | CanvasGradient | CanvasPattern
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  fillRect(x: number, y: number, width: number, height: number): void
  drawImage(source: PostcardImageSource, x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
}

export function postcardCaption(day: number, kind: DayKind): string {
  return `Clay Island — Day ${day}, ${kind}`
}

export function photoFilename(day: number, kind: DayKind): string {
  return `clay-island-day-${day}-${kind}.png`
}

export function postcardLayout(width: number, height: number): PostcardLayout {
  const border = Math.round(width * 0.03)
  const captionBand = Math.round(width * 0.075)
  return {
    outerWidth: width + border * 2,
    outerHeight: height + border + captionBand,
    border,
    captionBand,
    imageX: border,
    imageY: border,
    captionX: Math.round((width + border * 2) / 2),
    captionY: Math.round(height + border + captionBand / 2),
    fontPx: Math.round(captionBand * 0.4),
  }
}

export function composePostcard(
  context: Postcard2dContext,
  source: PostcardImageSource,
  layout: PostcardLayout,
  caption: string,
): void {
  const imageWidth = layout.outerWidth - layout.border * 2
  const imageHeight = layout.outerHeight - layout.border - layout.captionBand
  context.fillStyle = PALETTE.paper
  context.fillRect(0, 0, layout.outerWidth, layout.outerHeight)
  // A pressed seam around the capture so the border reads as clay, not flat paper.
  context.fillStyle = PALETTE.inkSoft
  context.fillRect(layout.imageX - 3, layout.imageY - 3, imageWidth + 6, imageHeight + 6)
  context.drawImage(source, layout.imageX, layout.imageY, imageWidth, imageHeight)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `600 ${layout.fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`
  // Pressed caption: clay-white highlight one step below, ink on top.
  const press = Math.max(1, Math.round(layout.fontPx / 14))
  context.fillStyle = PALETTE.cloud
  context.fillText(caption, layout.captionX, layout.captionY + press)
  context.fillStyle = PALETTE.ink
  context.fillText(caption, layout.captionX, layout.captionY)
}

/**
 * Same condition as arming a power: gameplay, no modal owner. Deliberately
 * ignores celebration — photographing the fireworks is the point.
 */
export function photoArmable(state: AppFlowState, modalOpen: boolean): boolean {
  return canArmPower(state, modalOpen)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/photo.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/ui/photo.ts src/ui/photo.test.ts
git commit -m "feat: add postcard caption, layout, and composition helpers"
```

---

### Task 5: Capture controller — resize, render, composite, restore, download

**Files:**
- Modify: `src/ui/photo.ts`
- Test: `src/ui/photo.test.ts`

**Interfaces:**
- Consumes: Task 4's `CAPTURE_MAX_WIDTH`, `postcardLayout`, `postcardCaption`, `photoFilename`, `composePostcard`, `Postcard2dContext`, `PostcardImageSource`; Task 1's `DayKind`.
- Produces (Task 7 relies on these exact names):
  - `export type CaptureRenderer = { canvas: PostcardImageSource; size(): { width: number; height: number }; pixelRatio(): number; setPixelRatio(value: number): void; setSize(width: number, height: number): void }`
  - `export type CaptureComposer = { setSize(width: number, height: number): void }`
  - `export type PostcardCanvas = { getContext(kind: '2d'): Postcard2dContext | null; toBlob(callback: (blob: Blob | null) => void, type?: string): void }`
  - `export type PhotoCaptureOptions = { renderer: CaptureRenderer; composer: CaptureComposer | null; renderFrame(): void; day(): number; kind(): DayKind; createCanvas(width: number, height: number): PostcardCanvas; download(blob: Blob, filename: string): void; announce(message: string): void; onCaptured(): void }`
  - `export function createPhotoCapture(options: PhotoCaptureOptions): { capture(): void }`
  - `export function downloadBlob(blob: Blob, filename: string): void` (DOM boundary — untested in Node, exercised by manual QA)

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/photo.test.ts` (extend the `./photo` import with `createPhotoCapture`, `type PostcardCanvas`, and `type CaptureRenderer`):

```ts
function stubRenderer(width: number, height: number) {
  const sizes: { width: number; height: number }[] = []
  const ratios: number[] = []
  const renderer: CaptureRenderer = {
    canvas: { width, height },
    size: () => ({ width, height }),
    pixelRatio: () => 1.5,
    setPixelRatio: value => { ratios.push(value) },
    setSize: (w, h) => { sizes.push({ width: w, height: h }) },
  }
  return { renderer, sizes, ratios }
}

function stubCanvas(blob: Blob | null): PostcardCanvas {
  return {
    getContext: () => new StubContext(),
    toBlob: callback => callback(blob),
  }
}

function captureHarness(overrides: {
  blob?: Blob | null
  renderFrame?(): void
  download?(blob: Blob, filename: string): void
}) {
  const { renderer, sizes, ratios } = stubRenderer(1280, 720)
  const composerSizes: { width: number; height: number }[] = []
  const downloads: string[] = []
  const messages: string[] = []
  let rendered = 0
  let captured = 0
  const capture = createPhotoCapture({
    renderer,
    composer: { setSize: (w, h) => { composerSizes.push({ width: w, height: h }) } },
    renderFrame: overrides.renderFrame ?? (() => { rendered++ }),
    day: () => 3,
    kind: () => 'dusk',
    createCanvas: () => stubCanvas(overrides.blob !== undefined ? overrides.blob : ({} as Blob)),
    download: overrides.download ?? ((_, filename) => { downloads.push(filename) }),
    announce: message => { messages.push(message) },
    onCaptured: () => { captured++ },
  })
  return {
    capture,
    sizes,
    ratios,
    composerSizes,
    downloads,
    messages,
    renderedCount: () => rendered,
    capturedCount: () => captured,
  }
}

describe('createPhotoCapture', () => {
  it('renders once at the capped size then restores renderer and composer', () => {
    const harness = captureHarness({})
    harness.capture.capture()
    expect(harness.renderedCount()).toBe(1)
    expect(harness.ratios).toEqual([1, 1.5])
    expect(harness.sizes).toEqual([
      { width: 2560, height: 1440 },
      { width: 1280, height: 720 },
    ])
    expect(harness.composerSizes).toEqual([
      { width: 2560, height: 1440 },
      { width: 1280, height: 720 },
    ])
    expect(harness.downloads).toEqual(['clay-island-day-3-dusk.png'])
    expect(harness.messages).toEqual(['Photo saved'])
    expect(harness.capturedCount()).toBe(1)
  })

  it('restores sizes and announces failure when the render throws', () => {
    const harness = captureHarness({ renderFrame: () => { throw new Error('context lost') } })
    harness.capture.capture()
    expect(harness.sizes).toEqual([
      { width: 2560, height: 1440 },
      { width: 1280, height: 720 },
    ])
    expect(harness.ratios).toEqual([1, 1.5])
    expect(harness.downloads).toEqual([])
    expect(harness.messages).toEqual(['Photo failed'])
    expect(harness.capturedCount()).toBe(0)
  })

  it('announces failure and skips download when toBlob yields null', () => {
    const harness = captureHarness({ blob: null })
    harness.capture.capture()
    expect(harness.downloads).toEqual([])
    expect(harness.messages).toEqual(['Photo failed'])
  })

  it('announces failure when the download itself throws', () => {
    const harness = captureHarness({ download: () => { throw new Error('blocked') } })
    harness.capture.capture()
    expect(harness.messages).toEqual(['Photo failed'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/photo.test.ts`
Expected: FAIL — `createPhotoCapture` is not exported.

- [ ] **Step 3: Implement the controller**

Append to `src/ui/photo.ts`:

```ts
export type CaptureRenderer = {
  canvas: PostcardImageSource
  size(): { width: number; height: number }
  pixelRatio(): number
  setPixelRatio(value: number): void
  setSize(width: number, height: number): void
}

export type CaptureComposer = { setSize(width: number, height: number): void }

export type PostcardCanvas = {
  getContext(kind: '2d'): Postcard2dContext | null
  toBlob(callback: (blob: Blob | null) => void, type?: string): void
}

export type PhotoCaptureOptions = {
  renderer: CaptureRenderer
  composer: CaptureComposer | null
  renderFrame(): void
  day(): number
  kind(): DayKind
  createCanvas(width: number, height: number): PostcardCanvas
  download(blob: Blob, filename: string): void
  announce(message: string): void
  onCaptured(): void
}

export function createPhotoCapture(options: PhotoCaptureOptions): { capture(): void } {
  function capture(): void {
    const previous = options.renderer.size()
    const previousRatio = options.renderer.pixelRatio()
    const width = CAPTURE_MAX_WIDTH
    const height = Math.max(1, Math.round((width * previous.height) / previous.width))
    let postcard: PostcardCanvas
    try {
      options.renderer.setPixelRatio(1)
      options.renderer.setSize(width, height)
      options.composer?.setSize(width, height)
      // Render and read back in the same task so preserveDrawingBuffer stays off.
      options.renderFrame()
      const layout = postcardLayout(width, height)
      postcard = options.createCanvas(layout.outerWidth, layout.outerHeight)
      const context = postcard.getContext('2d')
      if (!context) throw new Error('no 2d context')
      composePostcard(
        context,
        options.renderer.canvas,
        layout,
        postcardCaption(options.day(), options.kind()),
      )
    } catch {
      options.announce('Photo failed')
      return
    } finally {
      options.renderer.setPixelRatio(previousRatio)
      options.renderer.setSize(previous.width, previous.height)
      options.composer?.setSize(previous.width, previous.height)
    }
    options.onCaptured()
    const filename = photoFilename(options.day(), options.kind())
    postcard.toBlob(blob => {
      if (!blob) {
        options.announce('Photo failed')
        return
      }
      try {
        options.download(blob, filename)
        options.announce('Photo saved')
      } catch {
        options.announce('Photo failed')
      }
    }, 'image/png')
  }
  return { capture }
}

/** Browser-only download boundary; the controller receives it injected. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/photo.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/ui/photo.ts src/ui/photo.test.ts
git commit -m "feat: add photo capture controller with guaranteed renderer restore"
```

---

### Task 6: Tray camera button, `P` shortcut, and glyph styles

**Files:**
- Modify: `src/ui/tray.ts`
- Modify: `src/styles.css`
- Test: `src/ui/tray.test.ts`

**Interfaces:**
- Consumes: existing `createTray` structure (spacer + journal button, document-level keydown handler).
- Produces (Task 7 relies on these exact names):
  - `TrayOptions.onPhoto(): void` (new required callback)
  - `createTray(...)` return gains `setPhotoEnabled(on: boolean): void`
  - `TRAY_AUXILIARY_CONTROLS` becomes `['photo', 'journal']`
  - Button: `id="photo-btn"`, `aria-label="Take photo"`, `aria-keyshortcuts="P"`, starts **disabled**; glyph span `class="photo-glyph"`.

- [ ] **Step 1: Update the failing test**

In `src/ui/tray.test.ts`, replace the first test:

```ts
it('keeps only Photo and Journal beside the five powers', () => {
  expect(TRAY_AUXILIARY_CONTROLS).toEqual(['photo', 'journal'])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/tray.test.ts`
Expected: FAIL — received `['journal']`.

- [ ] **Step 3: Implement the button and shortcut**

In `src/ui/tray.ts`:

Update the constant:

```ts
export const TRAY_AUXILIARY_CONTROLS = ['photo', 'journal'] as const
```

Add to `TrayOptions`:

```ts
  onPhoto(): void
```

In `createTray`, after the spacer is appended and **before** the journal button:

```ts
  const photo = document.createElement('button')
  photo.type = 'button'
  photo.id = 'photo-btn'
  photo.setAttribute('aria-label', 'Take photo')
  photo.setAttribute('aria-keyshortcuts', 'P')
  photo.title = 'Take photo (P)'
  photo.disabled = true
  photo.innerHTML = '<span class="photo-glyph" aria-hidden="true"></span>'
  photo.addEventListener('click', () => {
    if (!photo.disabled) opts.onPhoto()
  })
  tray.appendChild(photo)
```

In the document `keydown` listener, after the `event.repeat || event.altKey || ...` guard and before the number-key lookup:

```ts
    if (event.key === 'p' || event.key === 'P') {
      if (photo.disabled) return
      event.preventDefault()
      opts.onPhoto()
      return
    }
```

Add to the returned API object:

```ts
    setPhotoEnabled(on) {
      photo.disabled = !on
    },
```

and to the return type annotation:

```ts
  setPhotoEnabled(on: boolean): void
```

- [ ] **Step 4: Add the clay camera styles**

In `src/styles.css`, after the `#journal-btn` rules (around line 574):

```css
#photo-btn {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  padding: 0;
  border: 2px solid var(--ink-soft);
  border-radius: 9px 12px 8px 11px / 12px 8px 11px 9px;
  background: var(--paper);
  box-shadow: inset 1px 1px 0 var(--cloud), inset -2px -2px 0 var(--skin);
  cursor: pointer;
  transition: transform 140ms ease;
}

#photo-btn:not(:disabled):hover {
  transform: translateY(-2px);
}

#photo-btn:not(:disabled):active {
  transform: translateY(1px) scale(0.98);
}

#photo-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  filter: saturate(0.35);
}

.photo-glyph {
  position: relative;
  width: 26px;
  height: 19px;
  border: 2px solid var(--ink);
  border-radius: 4px 5px 4px 5px;
}

.photo-glyph::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ink);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.photo-glyph::after {
  content: '';
  position: absolute;
  top: -7px;
  left: 3px;
  width: 8px;
  height: 5px;
  border: 2px solid var(--ink);
  border-bottom: 0;
  border-radius: 3px 3px 0 0;
}
```

- [ ] **Step 5: Run the tests — expect a compile break in `main.ts`**

Run: `npx vitest run src/ui/tray.test.ts`
Expected: tray tests PASS.

Run: `npm run lint`
Expected: FAIL — `main.ts`'s `createTray` call lacks `onPhoto`. Add a placeholder to the tray options in `src/main.ts` (Task 7 replaces it):

```ts
    onPhoto: () => {},
```

Re-run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Full check and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/ui/tray.ts src/ui/tray.test.ts src/styles.css src/main.ts
git commit -m "feat: add disabled-not-hidden camera button and P shortcut to tray"
```

---

### Task 7: Wire photo mode in `main.ts` — announcer, flash, shutter, per-frame armability

**Files:**
- Modify: `src/ui/photo.ts` (announcer helper)
- Modify: `src/styles.css` (visually hidden announce region)
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `createPhotoCapture`, `downloadBlob`, `photoArmable` (Tasks 4–5), `tray.setPhotoEnabled` + `onPhoto` (Task 6), `sfx.shutter()` (Task 3), `dayClock.day`/`kind` (Task 1), existing `flash` from `src/fx/shake.ts`, `renderScene()`, `renderer`, `composer`, `lowFx`.
- Produces:
  - `export function createPhotoAnnouncer(host: HTMLElement): (message: string) => void` in `photo.ts`.
  - A working end-to-end photo mode.

- [ ] **Step 1: Add the announcer helper**

Append to `src/ui/photo.ts`:

```ts
/** Screen-reader-only status region for "Photo saved" / "Photo failed". */
export function createPhotoAnnouncer(host: HTMLElement): (message: string) => void {
  const region = document.createElement('div')
  region.className = 'photo-announce'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  region.setAttribute('aria-atomic', 'true')
  host.appendChild(region)
  return message => { region.textContent = message }
}
```

Add to `src/styles.css` (after the `#photo-btn` block from Task 6):

```css
.photo-announce {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 2: Wire `main.ts`**

Add the import (alphabetical with the other `./ui/*` imports):

```ts
import {
  createPhotoAnnouncer,
  createPhotoCapture,
  downloadBlob,
  photoArmable,
} from './ui/photo'
```

Before the `createTray` call (next to `let journalUI: JournalUI | null = null`, `src/main.ts:158`):

```ts
let takePhoto: (() => void) | null = null
const modalOpen = (): boolean => settingsOpen || Boolean(journalUI?.isOpen())
```

Replace the Task 6 placeholder in the tray options:

```ts
  onPhoto: () => takePhoto?.(),
```

Simplify the existing `onArm` guard to reuse the helper (same behavior):

```ts
  onArm: power => {
    const celebrationActive = celebration?.active ?? false
    if (!celebrationActive && canArmPower(flow, modalOpen())) {
      targeting.arm(power)
    }
  },
```

After the `sfx` creation block (`src/main.ts:181-183`):

```ts
const photoAnnounce = createPhotoAnnouncer(ui)
const photoCapture = createPhotoCapture({
  renderer: {
    canvas: renderer.domElement,
    size: () => {
      const size = renderer.getSize(new THREE.Vector2())
      return { width: size.x, height: size.y }
    },
    pixelRatio: () => renderer.getPixelRatio(),
    setPixelRatio: value => renderer.setPixelRatio(value),
    setSize: (width, height) => renderer.setSize(width, height, false),
  },
  // Reduced quality renders without the composer; resizing it would only
  // allocate capture-sized buffers that nothing reads.
  composer: lowFx ? null : { setSize: (width, height) => composer.setSize(width, height) },
  renderFrame: renderScene,
  day: () => dayClock.day,
  kind: () => dayClock.kind,
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  },
  download: downloadBlob,
  announce: photoAnnounce,
  onCaptured: () => {
    sfx.unlock()
    sfx.shutter()
    if (!reducedMotion()) flash(PALETTE.cloud, 0.24, false)
  },
})
takePhoto = () => {
  if (photoArmable(flow, modalOpen())) photoCapture.capture()
}
```

(`renderScene` is a hoisted function declaration; it is only invoked at capture time.)

In the render callback's `gameplayActive` block (next to the cooldown sync, `src/main.ts:579`):

```ts
      tray.setPhotoEnabled(photoArmable(flow, modalOpen()))
```

The button starts disabled (Task 6) and only gameplay frames enable it; outside gameplay the tray is hidden and inert, and `takePhoto` re-checks `photoArmable` so a stale `P` keypress during a replay transition is a no-op.

- [ ] **Step 3: Lint, test, build**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Manual QA**

Run: `npm run dev`, then verify in the browser:

1. Title screen: tray hidden. Enter gameplay: camera button visible and enabled.
2. Click it: white flash, shutter click, PNG downloads named `clay-island-day-1-<phase>.png`; the postcard shows the scene inside a clay border with the pressed caption; the live canvas never visibly resizes.
3. Press `P`: same result. Press `P` with Journal or Settings open: nothing happens, button shows disabled.
4. Settings → Reduced motion On, take a photo: no flash, click + download still work.
5. `?lowfx=1`: photo downloads showing the reduced (no shadows/post) render.
6. During a celebration (Journal → Celebrate Again): photo button stays enabled and captures fireworks.
7. DevTools → Application → block localStorage (or private mode): photos still work; day counter restarts at 1 next load.

- [ ] **Step 5: Commit**

```bash
git add src/ui/photo.ts src/styles.css src/main.ts
git commit -m "feat: wire postcard photo mode into tray, sfx, and renderer"
```

---

### Task 8: Documentation — `docs/architecture.md`

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update the touched module bullets**

- `src/core/dayClock.ts` bullet: append — "It also owns the persisted day counter: an integer starting at 1 that increments only when the free-running clock wraps a full period, reported through `onDayWrap`; glides and holds never count."
- `src/core/preferences.ts` bullet: add `clayisland.dayCount` to the owned-keys list and append — "The day count validates to an integer ≥ 1 (else 1) and stays session-local when storage is blocked."
- `src/audio/sfx.ts` bullet: add "a layered knock-plus-tick shutter click" to the synthesized-voices list.
- `src/ui/tray.ts` bullet: replace "its only auxiliary control is Journal" with "its auxiliary controls are the Photo camera button (`P`, disabled rather than hidden outside armability) and Journal".
- `src/main.ts` bullet: append one sentence — "Photo mode wires the tray camera button and `P` key through the powers' armability condition (deliberately ignoring celebration so fireworks are photographable), adapts the live renderer/composer/day-clock/Sfx into the capture controller, and syncs the button's disabled state every gameplay frame."

- [ ] **Step 2: Add the new module bullet**

After the `src/ui/tray.ts` bullet:

- "`src/ui/photo.ts` owns postcard photo mode: pure caption/filename/layout/composition helpers, the powers-equivalent armability predicate, and a capture controller that synchronously resizes the injected renderer/composer to a 2560-px-wide cap, renders one frame, composites the canvas onto a clay-paper postcard with a pressed caption, restores the previous size on every path (including failure), then downloads via `toBlob` and announces "Photo saved" / "Photo failed" through a polite live region. A white flash (skipped under reduced motion) and shutter click confirm capture. All DOM/WebGL access sits behind injected interfaces so the module tests in Node."

- [ ] **Step 3: Update the storage schema section**

In the cross-reload storage list, add:

- "`localStorage['clayisland.dayCount']`: integer ≥ 1 owned by `Preferences`, incremented by the day clock's free-run wraps; blocked storage restarts the count at 1 per session."

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: describe photo mode, day counter, and dayCount storage"
```

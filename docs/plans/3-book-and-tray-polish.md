# Clay Book & Tray Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the clay book's intro render artifact, invisible opening animation, flat non-clay look, pre-filled hint and floating chrome, and bring the tray and moment tiles up to the same clay finish.

**Architecture:** The book stays a Three.js object rendered into a scissored WebGL viewport on the shared renderer. Fixes land in four places: a new pure `src/ui/bookAnim.ts` holding the openness/easing math (unit-testable in node), `src/ui/book.ts` for lighting/material/geometry/motion, `src/ui/journal.ts` for DOM structure and hint behavior, and `src/styles.css` for chrome anchoring and tray/tile affordances. `src/intro.ts` gets the tray properly hidden.

**Tech Stack:** TypeScript, Three.js 0.185 (`MeshToonMaterial` + custom clay shader chunks), Vite 8, Vitest 4.

Spec: `docs/superpowers/specs/2026-07-13-book-and-tray-polish-design.md`

## Global Constraints

- **Tests run in `environment: 'node'`** (`vite.config.ts`) — there is no DOM and no WebGL in the test environment. Only pure logic gets unit tests. DOM, CSS, lighting and material changes are verified by driving the real app in a browser and observing. Do not add jsdom or change the test environment.
- **125 existing tests must stay green.** `npm test`, `npx tsc --noEmit`, and `npm run build` must pass at every commit.
- **No new files beyond `src/ui/bookAnim.ts` (+ its test). No new dependencies.**
- **All hex colors come from `PALETTE` in `src/ui/tokens.ts`.** That file is the only place hex values live; `styles.css` mirrors them as custom properties and the two are kept in sync by hand. Never introduce a raw hex anywhere else.
- **`?lowfx=1` and `prefers-reduced-motion` must keep working.** Both bypass the 3D book entirely and get the flat DOM panel (`#journal-layer.lowfx`). That fallback must not regress. `ClayBook.render()` already early-returns for both.
- **The stop-motion rule:** the *model* stutters at 12fps (`TIMING.fps`); *UI transitions do not* — they are real-world objects and move smoothly. The book is a model: its motion stays quantized. See the comment in `src/ui/tokens.ts`.
- **Never pure white.** `PALETTE.cloud` (`#fffaf2`) is the clay white. Nothing in clay is `#ffffff`.
- **Spend the boldness in one place.** The visual direction — hand-molded stop-motion clay — is already established and strong; this plan's job is to stop the book and tray from breaking it, not to invent new flourishes. The clay "tell" belongs on the objects that are *made of clay* (the book, the power blobs, the tiles, the rising cooldown). It does **not** get piled onto focus rings, outlines, or anything else the app already handles consistently. When a rule could take a wobble or leave it, leave it.
- **One name per thing.** The journal is currently called four things: the button says "Journal", the heading "Little Moments", the progress line "moments pressed", the hint "unpressed tile". A control keeps the same name through the whole flow. Standardize on **moments** as the noun and **pressed** as the verb (a moment is pressed into clay). Do not introduce a fifth word.
- **Copy is written from the player's side of the screen.** It names what the player does in the world, never the UI mechanism. "Focus an unpressed tile for a hint" describes the widget; it is the kind of line this rule exists to prevent.

## Browser verification harness

Several tasks require observing the real app. Set this up once and reuse it.

Start the dev server (note the port it prints — 5173 may be taken):

```bash
npm run dev
```

A Playwright-driven Chromium is available from the local cache. Create the harness in your scratchpad (not in the repo):

```js
// shot.mjs
import { chromium } from 'playwright-core'
import os from 'node:os'
import path from 'node:path'

const exe = path.join(os.homedir(),
  'Library/Caches/ms-playwright/chromium-1229/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
const URL = 'http://localhost:5173/'   // use the port vite actually printed

const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('[pageerror]', e.message))
await page.goto(URL, { waitUntil: 'load' })
// ... per-task steps go here
await browser.close()
```

Install it with `npm install playwright-core` inside the scratchpad directory only.

The intro runs for 4 seconds and is skipped by any pointerdown/keydown. To observe
the *intro*, do not click. To observe the *book*, wait >4s (or click once to skip),
then `await page.click('#journal-btn')`.

---

## File Structure

- **Create:** `src/ui/bookAnim.ts` — pure openness/easing math for the book's cover swing. No Three.js import, no DOM. Exists so the motion curve is unit-testable in the node environment.
- **Create:** `src/ui/bookAnim.test.ts` — unit tests for the above.
- **Modify:** `src/ui/book.ts` — render gate, lighting + shadows, page material regrain, page-stack edge, cover angle, consume `bookAnim`, tile hover/press.
- **Modify:** `src/ui/journal.ts` — closed-state rect, chrome moved into the viewport, hint starts empty and clears on leave, hover/focus forwarded to the book.
- **Modify:** `src/ui/tray.ts` — expose the tray element; Journal/Mute markup for clay styling.
- **Modify:** `src/intro.ts` — tray `inert` during intro.
- **Modify:** `src/styles.css` — chrome anchored to the viewport, backdrop, tray hide, cooldown clip, disabled powers, Journal/Mute clay, tile focus.
- **Modify:** `src/main.ts` — only if the render-gate wiring requires it.
- **Modify:** `docs/architecture.md` — document `bookAnim` and the book's render gate.

---

## Task 1: Extract the book's opening curve into a testable module

The current curve is the root cause of "the opening animation is barely visible":
`openness` steps `1/7` per 12fps tick and is eased by `1 - (1-o)**3`, which is so
front-loaded the cover is 63° open after one tick (83ms) and 82% open by 250ms. The
cover also swings to `-Math.PI * 0.94` ≈ -169°, ending flat *behind* the book body
where it cannot be seen. This task fixes the math in isolation, with tests.

**Files:**
- Create: `src/ui/bookAnim.ts`
- Test: `src/ui/bookAnim.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BOOK_OPEN_TICKS: number` — ticks (at `TIMING.fps`) for a full open.
  - `MAX_COVER_ANGLE: number` — radians the cover swings to (negative).
  - `advanceOpenness(current: number, targetOpen: boolean): number` — one quantized tick of travel, clamped to `[0, 1]`.
  - `easeOpen(openness: number): number` — maps linear `0..1` openness to an eased `0..~1.03` value with a small overshoot that settles to exactly `1` at `openness === 1`.
  - `coverAngle(openness: number): number` — radians for the cover pivot's `rotation.y`.

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/bookAnim.test.ts
import { describe, it, expect } from 'vitest'
import {
  BOOK_OPEN_TICKS,
  MAX_COVER_ANGLE,
  advanceOpenness,
  coverAngle,
  easeOpen,
} from './bookAnim'

describe('advanceOpenness', () => {
  it('opens over BOOK_OPEN_TICKS ticks and clamps at 1', () => {
    let openness = 0
    for (let tick = 0; tick < BOOK_OPEN_TICKS; tick++) {
      openness = advanceOpenness(openness, true)
    }
    expect(openness).toBeCloseTo(1, 5)
    expect(advanceOpenness(openness, true)).toBe(1)
  })

  it('closes symmetrically and clamps at 0', () => {
    let openness = 1
    for (let tick = 0; tick < BOOK_OPEN_TICKS; tick++) {
      openness = advanceOpenness(openness, false)
    }
    expect(openness).toBeCloseTo(0, 5)
    expect(advanceOpenness(openness, false)).toBe(0)
  })
})

describe('easeOpen', () => {
  it('is pinned at both ends', () => {
    expect(easeOpen(0)).toBe(0)
    expect(easeOpen(1)).toBe(1)
  })

  it('is not front-loaded: the first tick stays under a quarter open', () => {
    // The old 1-(1-o)**3 ease put the cover 37% open after one tick, which read
    // as the book snapping open. The new curve must hold back at the start.
    const firstTick = easeOpen(1 / BOOK_OPEN_TICKS)
    expect(firstTick).toBeLessThan(0.25)
  })

  it('overshoots before settling, so the cover lands with weight', () => {
    const samples = Array.from(
      { length: 101 },
      (_, index) => easeOpen(index / 100),
    )
    expect(Math.max(...samples)).toBeGreaterThan(1)
  })

  it('is monotonic up to its peak', () => {
    let previous = -Infinity
    let rising = true
    for (let index = 0; index <= 100 && rising; index++) {
      const value = easeOpen(index / 100)
      if (value < previous) { rising = false; break }
      previous = value
    }
    expect(previous).toBeGreaterThan(1)
  })
})

describe('coverAngle', () => {
  it('is closed flat at 0', () => {
    expect(coverAngle(0)).toBe(0)
  })

  it('swings to MAX_COVER_ANGLE when fully open', () => {
    expect(coverAngle(1)).toBeCloseTo(MAX_COVER_ANGLE, 5)
  })

  it('stops well short of lying flat behind the book body', () => {
    // The old cover swung to -0.94*PI (-169 degrees) and vanished behind the
    // body. It must stay visible as a foreshortened slab beside the pages.
    expect(Math.abs(MAX_COVER_ANGLE)).toBeLessThan(Math.PI * 0.85)
    expect(Math.abs(MAX_COVER_ANGLE)).toBeGreaterThan(Math.PI * 0.6)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/bookAnim.test.ts`
Expected: FAIL — `Failed to resolve import "./bookAnim"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/bookAnim.ts
// The book's cover swing, kept free of Three.js and the DOM so the curve can be
// tested in the node test environment. The book is a *model*, so this motion is
// advanced once per quantized 12fps tick, not per rendered frame.

/** Ticks at TIMING.fps for a full open — 6 ticks at 12fps is 500ms. */
export const BOOK_OPEN_TICKS = 6

/**
 * How far the cover swings, in radians. Deliberately short of PI: at a full swing
 * the cover lies flat behind the book body and is invisible against it. Stopping
 * near 140 degrees leaves it visible as a foreshortened slab beside the pages.
 */
export const MAX_COVER_ANGLE = -Math.PI * 0.78

/** Overshoot amplitude. Small — this is clay settling, not a rubber band. */
const OVERSHOOT = 1.7

export function advanceOpenness(current: number, targetOpen: boolean): number {
  const step = (targetOpen ? 1 : -1) / BOOK_OPEN_TICKS
  return Math.min(1, Math.max(0, current + step))
}

/**
 * Back-out ease: holds back at the start (the old cubic was 37% open after one
 * tick, which read as a snap), accelerates, overshoots slightly, then settles to
 * exactly 1. Pinned at both ends so the closed and open poses are exact.
 */
export function easeOpen(openness: number): number {
  if (openness <= 0) return 0
  if (openness >= 1) return 1
  const t = openness - 1
  return 1 + (OVERSHOOT + 1) * t ** 3 + OVERSHOOT * t ** 2
}

export function coverAngle(openness: number): number {
  return MAX_COVER_ANGLE * easeOpen(openness)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/bookAnim.test.ts`
Expected: PASS — 7 tests.

Then confirm nothing else broke: `npm test` → 132 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ui/bookAnim.ts src/ui/bookAnim.test.ts
git commit -m "feat: extract book opening curve into a testable module"
```

---

## Task 2: Gate the book's render on it being visible

This kills the floating artifact during the intro. `ClayBook.render()` currently
paints into whatever rect it is handed, and `JournalUI.rect()` hands it the *Journal
button's* rect whenever the book is closed — so a ~58x44px book is scissored onto the
canvas at the button's position every frame of the session. During the intro the tray
is transparent but still laid out, so it appears over bare sky with nothing behind it.

Both ends are fixed, because either alone leaves a latent bug.

**Files:**
- Modify: `src/ui/book.ts` — `render()` gate, `update()` uses `bookAnim`
- Modify: `src/ui/journal.ts:215-217` — `rect()` when closed

**Interfaces:**
- Consumes: `advanceOpenness`, `coverAngle` from Task 1.
- Produces: `JournalUI.rect(): DOMRect | null` — **note the changed return type**; `null` means "closed, nothing to render". `main.ts` passes it straight to `book.setRect()`, so `ClayBook.setRect()` must accept `DOMRect | null`.

- [ ] **Step 1: Change `JournalUI.rect()` to report nothing when closed**

In `src/ui/journal.ts`, change the `JournalUI` type (line 11):

```ts
  rect(): DOMRect | null
```

and the implementation (lines 215-217):

```ts
    rect() {
      return open ? viewport.getBoundingClientRect() : null
    },
```

- [ ] **Step 2: Accept a null rect in `ClayBook.setRect` and gate `render`**

In `src/ui/book.ts`, change `setRect` (line 182) to bail on `null`:

```ts
  setRect(rect: DOMRect | null): void {
    if (!rect) return
    this.rect = rect
    if (rect.width <= 0 || rect.height <= 0) return
```

(The rest of `setRect` is unchanged.)

Then gate `render()` (line 240) on the book actually being on screen. Add the
`visible` check as the first clause:

```ts
  render(): void {
    // Closed and fully settled: there is nothing on screen to draw. Without this
    // the book renders every frame into whatever rect it was last given.
    if (!this.targetOpen && this.openness <= 0) return
    if (
      this.options.lowFx
      || prefersReducedMotion()
      || this.rect.width < 1
      || this.rect.height < 1
    ) return
```

- [ ] **Step 3: Drive the cover swing from `bookAnim`**

Add the import at the top of `src/ui/book.ts`, alongside the existing `./tokens` import:

```ts
import { advanceOpenness, coverAngle, easeOpen } from './bookAnim'
```

Replace the body of `update()` (lines 214-238). The old code stepped `1/7` per tick
and used `1 - (1-o)**3`; both now come from `bookAnim`:

```ts
  update(dt: number, qt: number): void {
    this.elapsed += dt
    if (!prefersReducedMotion() && qt !== this.lastQt) {
      this.lastQt = qt
      this.openness = advanceOpenness(this.openness, this.targetOpen)
    }
    const eased = easeOpen(this.openness)
    this.coverPivot.rotation.y = coverAngle(this.openness)
    this.root.rotation.x = THREE.MathUtils.lerp(-0.08, 0.04, eased)
    this.root.rotation.z = THREE.MathUtils.lerp(-0.08, 0, eased)
    this.root.scale.setScalar(THREE.MathUtils.lerp(0.84, 1, eased) * this.fitScale)

    let popChanged = false
    for (const tile of this.tiles) {
      const popping = tile.popUntil > this.elapsed
      if (popping === tile.popping) continue
      tile.popping = popping
      popChanged = true
    }
    if (popChanged) this.rebuildTiles()
  }
```

Note `openness` is no longer stepped by a hand-written `1/7`, and the old
`const eased = 1 - (1 - this.openness) ** 3` line is gone — both now live in
`bookAnim`. The `lastQt` guard stays: the book is a *model*, so its motion advances
once per quantized 12fps tick, not once per rendered frame.

- [ ] **Step 4: Verify it compiles and tests still pass**

```bash
npx tsc --noEmit && npm test
```
Expected: no type errors; 132 passed.

- [ ] **Step 5: Verify in the browser that the artifact is gone**

With the dev server running, script the intro *without* clicking (a click skips it):

```js
await page.goto(URL, { waitUntil: 'load' })
const btn = await page.evaluate(() => {
  const r = document.getElementById('journal-btn').getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})
await page.waitForTimeout(1000)
await page.screenshot({
  path: 'crop-intro.png',
  clip: { x: btn.x - 60, y: btn.y - 40, width: btn.w + 120, height: btn.h + 80 },
})
```

Expected: `crop-intro.png` shows only sky and the island's rim — **no small book-like
rectangle**. Before this task, that crop contained a legible miniature book with
colored tiles.

- [ ] **Step 6: Verify the cover now visibly swings**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4500)          // let the intro finish
await page.click('#journal-btn')
for (const t of [80, 160, 240, 330, 420, 700]) {
  await page.waitForTimeout(t === 80 ? 80 : 80)
  await page.screenshot({ path: `open-${t}.png` })
}
```

Expected: across `open-80` → `open-700` the cover is visibly *mid-swing* in at least
three frames, ending as a foreshortened slab to the left of the pages — not a flat
slab that is already fully open by the second frame.

- [ ] **Step 7: Commit**

```bash
git add src/ui/book.ts src/ui/journal.ts
git commit -m "fix: stop the closed book rendering into the journal button's rect"
```

---

## Task 3: Make the book read as clay

The book is flat because of its lighting, not its geometry. Its key light sits at
(5,7,9) with the camera at (0,0.4,12) — nearly head-on — so the entire face lands in
the toon ramp's top band and saturates. `castShadow`/`receiveShadow` are already set on
every mesh but the book scene has **no shadow-casting light**, so those flags do
nothing. And the pages use `flat: true`, which switches off the fingerprint-dent
normals and the hand-mixed color noise — on the single largest surface in frame.

`renderer.shadowMap.enabled` is already true globally (`src/scene.ts:83-84`) and the
book shares that renderer, so no renderer change is needed.

**Files:**
- Modify: `src/ui/book.ts` — constructor (lines 90-166)

**Interfaces:**
- Consumes: `clayMaterial` from `src/fx/clayMaterial.ts`, `PALETTE` from `src/ui/tokens.ts`.
- Produces: nothing new.

- [ ] **Step 1: Regrain the pages**

In `src/ui/book.ts` line 98, drop `flat: true` so the pages get the clay shader like
everything else:

```ts
    const pagesMaterial = clayMaterial(PALETTE.cloud)
```

- [ ] **Step 2: Rake the key light and enable its shadow**

Replace the lighting block (lines 163-166):

```ts
    // Raking, not head-on. The old key sat almost on the camera axis, so the whole
    // book landed in the toon ramp's top band and read as a flat printed rectangle.
    // Pushing it left, high and forward drives a real terminator across the cover
    // and the page stack — which is the entire difference between "clay" and "slab".
    const key = new THREE.DirectionalLight(PALETTE.keyLight, 3.1)
    key.position.set(-6, 8, 6)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.radius = 5
    key.shadow.blurSamples = 12
    key.shadow.camera.left = -6
    key.shadow.camera.right = 6
    key.shadow.camera.top = 5
    key.shadow.camera.bottom = -5
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 30
    key.shadow.bias = 0
    // Ambient was 1.35, which lifted the shadow band clean out of the ramp. Lower it
    // so the ramp's dark band is actually reachable and the form reads.
    const fill = new THREE.AmbientLight(PALETTE.fillSky, 0.62)
    this.scene.add(key, fill, this.root)
```

- [ ] **Step 3: Add the desk plane that catches the contact shadow**

A shadow needs something to fall on. Add a receiving plane behind the book, before
the lighting block:

```ts
    // The book needs something to sit on, or its shadow has nowhere to land and it
    // floats. This plane is behind the book and catches the contact shadow.
    const deskGeometry = new THREE.PlaneGeometry(20, 14)
    const deskMaterial = clayMaterial(PALETTE.paper)
    const desk = new THREE.Mesh(deskGeometry, deskMaterial)
    desk.position.z = -1.2
    desk.receiveShadow = true
    this.root.add(desk)
    this.disposableGeometries.push(deskGeometry)
    this.disposableMaterials.push(deskMaterial)
```

- [ ] **Step 4: Give the book a visible page stack at the fore-edge**

Still in the constructor, after the `pages` mesh (line 102). A single page slab reads
as a printed rectangle; a stack of offset slabs reads as a book:

```ts
    // A stack, not a slab: three offset leaves so the fore-edge has real thickness.
    for (let leaf = 0; leaf < 3; leaf++) {
      const leafGeometry = wobble(
        new THREE.BoxGeometry(6.72 - leaf * 0.06, 4.6 - leaf * 0.05, 0.08, 8, 6, 1),
        rng,
        0.03,
      )
      const leafMaterial = clayMaterial(PALETTE.cloud)
      const leafMesh = new THREE.Mesh(leafGeometry, leafMaterial)
      leafMesh.position.set(0.03 * leaf, -0.02 * leaf, 0.18 + leaf * 0.05)
      leafMesh.castShadow = true
      leafMesh.receiveShadow = true
      this.root.add(leafMesh)
      this.disposableGeometries.push(leafGeometry)
      this.disposableMaterials.push(leafMaterial)
    }
```

- [ ] **Step 5: Verify in the browser**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4500)
await page.click('#journal-btn')
await page.waitForTimeout(1200)
await page.screenshot({ path: 'book-clay.png' })
```

Read `book-clay.png` and confirm all three, by eye:
1. There is a **visible terminator** — the cover and page stack are lighter on the lit
   side and fall into the ramp's shadow band on the other. The book is no longer one
   uniform tone.
2. The book **casts a soft shadow** onto the surface behind it, so it sits in space
   rather than floating.
3. The pages carry the same **fingerprint grain and mottled color** as the huts and the
   island — not a smooth flat field.

If the book is still flat, the light is still too close to the camera axis: push
`key.position` further to `-x` and `+y`, and lower `fill` intensity further.

- [ ] **Step 6: Check the fallback paths did not regress**

```js
await page.goto(URL + '?lowfx=1', { waitUntil: 'load' })
await page.waitForTimeout(1000)
await page.click('#journal-btn')
await page.waitForTimeout(400)
await page.screenshot({ path: 'book-lowfx.png' })
```

Expected: the flat DOM panel (`#journal-layer.lowfx`) with its bordered tiles — the
3D book must not render at all. Repeat with
`page.emulateMedia({ reducedMotion: 'reduce' })` and expect the same panel.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit && npm test && npm run build
git add src/ui/book.ts
git commit -m "feat: relight and regrain the clay book so it reads as clay"
```

---

## Task 4: Anchor the book's chrome to the book

The heading, progress line, close button and hint are positioned in percentages of
`#journal-dialog`, but `#journal-book-viewport` is a fixed `7.9 / 5.75` aspect box
*centered inside* that dialog. At 1280x800 the viewport is 780x568 inside a 780x630
dialog, so the chrome hangs over open sky, disconnected from the book, and drifts
independently as the window is resized. Moving the chrome inside the viewport glues it
to the book at every window size.

This task also adds the backdrop, which today exists only under `.lowfx`, so the open
book currently competes with a fully vivid island.

**Files:**
- Modify: `src/ui/journal.ts:85-88` — DOM nesting
- Modify: `src/styles.css:293-404` — chrome positioning + backdrop

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. `#journal-book-viewport` becomes the positioning context for the chrome.

- [ ] **Step 1: Nest the chrome inside the viewport**

In `src/ui/journal.ts`, replace the assembly at lines 85-88:

```ts
  viewport.append(heading, count, closeButton, grid, hint)
  dialog.append(viewport)
  layer.append(backdrop, dialog)
  ui.appendChild(layer)
```

The chrome is now a child of the fixed-aspect viewport rather than the dialog, so it
tracks the book's actual edges.

- [ ] **Step 2: Repoint the chrome's CSS at the viewport**

In `src/styles.css`, the chrome rules currently position against the dialog. They keep
their selectors but are now resolved inside `#journal-book-viewport` (which is already
`position: absolute`, so it is a containing block). Adjust the offsets so they sit on
the book rather than above it — the book body occupies roughly the middle 91% of the
viewport's width and 88% of its height (the extra is margin for the wobble and the
swung cover, per `BOOK_EXTENT`).

Replace the `#journal-heading`, `.journal-progress`, `.journal-close` and
`.journal-hint` rules:

```css
#journal-heading {
  position: absolute;
  top: 7.5%;
  left: 50%;
  z-index: 2;
  margin: 0;
  transform: translateX(-50%) rotate(-1deg);
  font-family: var(--ui-font);
  font-size: clamp(16px, 2.4vw, 23px);
  letter-spacing: var(--ui-track);
  pointer-events: none;
}

.journal-progress {
  position: absolute;
  top: 13.5%;
  left: 50%;
  z-index: 2;
  margin: 0;
  transform: translateX(-50%);
  color: var(--ink-soft);
  font-size: 11px;
  letter-spacing: 0.04em;
  pointer-events: none;
}

/* Sits on the book's top-right corner like a tab, not floating in the sky. */
.journal-close {
  position: absolute;
  top: 6%;
  right: 7%;
  z-index: 3;
  padding: 7px 9px;
  border: 1px solid var(--ink-soft);
  border-radius: 7px 5px 8px 4px;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}

/* Height is reserved so the layout does not jump when a hint arrives. */
.journal-hint {
  position: absolute;
  right: 12%;
  bottom: 6.5%;
  left: 12%;
  z-index: 2;
  min-height: 1.2em;
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
  text-align: center;
  pointer-events: none;
}
```

- [ ] **Step 3: Add the backdrop**

`.journal-backdrop` currently has no background outside `.lowfx`. Give it one drawn
from the toy's own palette — a clay-ink scrim, not a generic black overlay:

```css
.journal-backdrop {
  position: absolute;
  inset: 0;
  background: var(--ink);
  opacity: 0;
  transition: opacity 320ms ease;
}

#journal-layer.open .journal-backdrop {
  opacity: 0.28;
}
```

Delete the now-redundant `#journal-layer.lowfx .journal-backdrop` rule (lines 406-409),
since the base rule now covers both paths.

- [ ] **Step 4: Verify chrome stays glued to the book across window shapes**

```js
for (const [w, h] of [[1280, 800], [900, 900], [1600, 700], [700, 1000]]) {
  await page.setViewportSize({ width: w, height: h })
  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForTimeout(4500)
  await page.click('#journal-btn')
  await page.waitForTimeout(900)
  await page.screenshot({ path: `chrome-${w}x${h}.png` })
}
```

Expected in every shot: the heading and progress line sit **on the book's cover**, the
close button sits **on the book's corner**, and the hint sits **on the book's lower
page** — none of them floating over sky. Before this task, at 1280x800 the heading and
close button hung ~30px above the book's top edge.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npm test && npm run build
git add src/ui/journal.ts src/styles.css
git commit -m "feat: anchor journal chrome to the book and add a backdrop"
```

---

## Task 5: Fix the hint's initial and resting state

Two bugs and a copy problem. The hint is seeded with "Focus an unpressed tile for a
hint." at construction, and opening the book focuses the *close button* — never a tile —
so that sentence is already sitting there before the user has touched anything. There is
no `pointerleave`/`blur` handler, so once a tile is hovered the hint stays pinned to that
moment forever, even after the cursor has left the book. And the line itself is written
from the system's side of the screen: it describes the widget ("focus an unpressed tile")
rather than telling the player anything about their world.

Per the global constraints, the resting line is an **invitation**, not an instruction,
and it uses the standardized vocabulary (*moments*, *pressed*). A locked moment's hint
already carries the game's dry voice ("Electricity and water. What could go wrong.") —
the resting line must sit alongside those without breaking tone.

**Files:**
- Modify: `src/ui/journal.ts:63-83` — hint creation and tile handlers
- Modify: `src/ui/journal.ts:117-135` — reset the hint on open

**Interfaces:**
- Consumes: nothing new.
- Produces: `RESTING_HINT: string` — module-level constant in `journal.ts`, the hint's text when no tile is hovered or focused.

- [ ] **Step 1: Replace the seeded text with a resting line**

In `src/ui/journal.ts`, add the constant near the top of the module (below the imports):

```ts
// Shown when nothing is hovered. An invitation, in the game's voice — not an
// instruction about how to operate the widget.
const RESTING_HINT = 'Twelve moments. You press them into the clay by playing.'
```

Then the hint's creation (lines 63-66) starts from that line rather than the old
widget-mechanics sentence. Its height is reserved by the `min-height` added in Task 4,
so swapping text never jumps the layout:

```ts
  const hint = document.createElement('p')
  hint.className = 'journal-hint'
  hint.setAttribute('aria-live', 'polite')
  hint.textContent = RESTING_HINT
```

- [ ] **Step 2: Return to the resting line when the pointer or focus leaves a tile**

Replace the tile handler block (lines 77-82). This is the fix for the hint sticking to
the last-hovered moment forever:

```ts
    const showHint = (): void => {
      hint.textContent = journal.has(moment.id) ? moment.title : moment.hint
    }
    const restHint = (): void => {
      hint.textContent = RESTING_HINT
    }
    button.addEventListener('focus', showHint)
    button.addEventListener('blur', restHint)
    button.addEventListener('pointerenter', showHint)
    button.addEventListener('pointerleave', restHint)
    return button
```

- [ ] **Step 3: Reset the hint whenever the book opens**

In `setOpen` (lines 124-128), reset on open so a hint left over from the last visit does
not greet the user. This is what actually fixes "it already shows text before you hover
anything" — the book now always opens on the resting line, never on a stale moment:

```ts
    if (open) {
      hint.textContent = RESTING_HINT
      layer.hidden = false
      requestAnimationFrame(() => layer.classList.add('open'))
      closeButton.focus({ preventScroll: true })
    } else {
```

- [ ] **Step 4: Align the rest of the journal's copy on one vocabulary**

Per the global constraints, the journal is currently called four different things. Fix
the two that are wrong, so the flow reads *Moments → moments → pressed* throughout.

In `src/ui/journal.ts`, the heading (line 44) already reads "Little Moments" — keep it.
The progress line is set in `setUnlocked` (line 213) and already reads "N of 12 moments
pressed" — keep it.

In `src/ui/tray.ts` (line 97), the button says "Journal", which is the odd one out and
is the *entry point* to the whole flow. Rename it to match:

```ts
  journal.innerHTML = 'Moments <b>0/12</b>'
```

Leave the element `id` as `journal-btn` and the CSS selectors alone — this is a copy
change, not a rename of the machinery. Check the aria-label on the tray's toolbar and
the dialog's `aria-labelledby` still make sense after the change; they reference the
heading, which is unchanged.

- [ ] **Step 5: Verify in the browser**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4500)
await page.click('#journal-btn')
await page.waitForTimeout(900)
console.log('on open:', await page.textContent('.journal-hint'))
// expect the resting line, NOT a moment's hint

await page.hover('.moment-tile[data-index="0"]')
await page.waitForTimeout(120)
console.log('hovering tile 0:', await page.textContent('.journal-hint'))
// expect "Electricity and water. What could go wrong."

await page.mouse.move(10, 10)
await page.waitForTimeout(120)
console.log('after leaving:', await page.textContent('.journal-hint'))
// expect the resting line again — NOT tile 0's hint
```

Expected: the resting line on open, the moment's hint while hovering, and the resting
line again after leaving. Before this task, the last of those still held tile 0's hint
indefinitely.

Confirm by eye in a screenshot that the hint line never changes height as the text
swaps, and that the tray button now reads **Moments 0/12**.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit && npm test
git add src/ui/journal.ts src/ui/tray.ts
git commit -m "fix: journal hint rests on an invitation and no longer sticks to a tile"
```

---

## Task 6: Hide the tray properly during the intro

`.intro-hidden` sets `opacity: 0` and nothing else, so during the intro the tray keeps
its layout box, stays in the accessibility tree, and remains focusable — an invisible
row of buttons a keyboard user can tab into and press. (It also kept feeding the book a
rect to render into, which Task 2 fixed from the other side.)

**Files:**
- Modify: `src/intro.ts:25,58`
- Modify: `src/styles.css:64-68`

**Interfaces:**
- Consumes: `IntroOptions.tray: HTMLElement` (already passed from `main.ts:94`).
- Produces: nothing new.

- [ ] **Step 1: Mark the tray inert while the intro runs**

In `src/intro.ts`, the constructor (line 25) already adds the class. Add `inert`
alongside it, so the tray is genuinely out of the accessibility tree and unfocusable:

```ts
    options.tray.classList.add('intro-hidden')
    options.tray.inert = true
```

and in `skip()` (line 58), restore it:

```ts
    this.options.tray.classList.remove('intro-hidden')
    this.options.tray.inert = false
```

- [ ] **Step 2: Take the hidden tray out of the layout's reach**

In `src/styles.css`, extend `.intro-hidden` (lines 64-68) so it is not merely
transparent. `visibility` transitions discretely and is deferred to the end of the fade,
so the tray still fades in smoothly rather than popping:

```css
#tray.intro-hidden {
  transform: translate(-50%, 20px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

#tray {
  transition: opacity 320ms ease, transform 320ms ease, visibility 0s linear 320ms;
}

#tray:not(.intro-hidden) {
  transition: opacity 320ms ease, transform 320ms ease, visibility 0s;
}
```

Note the existing `#tray` rule (line 61) already sets a `transition`; fold the
`visibility` term into it rather than adding a duplicate rule.

- [ ] **Step 3: Verify the tray is unreachable during the intro**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(800)                    // still in the intro
console.log(await page.evaluate(() => {
  const tray = document.getElementById('tray')
  return {
    inert: tray.inert,
    visibility: getComputedStyle(tray).visibility,
    // a keyboard user must not be able to reach the buttons
    focusable: [...tray.querySelectorAll('button')]
      .some(b => { b.focus(); return document.activeElement === b }),
  }
}))
```

Expected: `{ inert: true, visibility: 'hidden', focusable: false }`.
Before this task: `inert: false`, `visibility: 'visible'`, `focusable: true`.

- [ ] **Step 4: Verify the tray still fades in normally**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4600)                   // intro over
await page.screenshot({ path: 'tray-after-intro.png' })
console.log(await page.evaluate(() => {
  const tray = document.getElementById('tray')
  return { inert: tray.inert, visibility: getComputedStyle(tray).visibility }
}))
```

Expected: `{ inert: false, visibility: 'visible' }`, and the screenshot shows the tray
fully faded in at the bottom, not popped or half-transparent.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npm test && npm run build
git add src/intro.ts src/styles.css
git commit -m "fix: make the tray genuinely hidden and inert during the intro"
```

---

## Task 7: Bring the tray buttons up to the clay finish

Three defects, all in CSS. The cooldown fill is a hard-edged rectangle sweeping up a
blob-shaped shell (`.power-cooldown` is a plain box inside a shell with an organic
`border-radius`). The disabled power state is only `cursor: not-allowed`, so readiness
is invisible at a glance. And Journal and Mute are unstyled text buttons sitting beside
sculpted clay blobs, so the tray does not read as one material.

**Files:**
- Modify: `src/styles.css:93-102` (cooldown), `:142-144` (disabled), `:217-232` (Journal/Mute)

**Interfaces:**
- Consumes: the tray DOM built in `src/ui/tray.ts` — `.power-shell` (organic `border-radius`, `overflow: hidden`), `.power-cooldown` (height driven from JS as a percentage), `.power:disabled`, `#journal-btn`, `#mute-btn`.
- Produces: nothing new. **No TypeScript changes** — `tray.ts`'s `sync()` already drives `cooldownFill.style.height`, and that stays exactly as it is.

- [ ] **Step 1: Clip the cooldown fill to the blob's silhouette**

`.power-shell` already has `overflow: hidden` and an organic `border-radius`, so the
fill is clipped to the blob's outline — the problem is that its *own* top edge is a
hard horizontal line, which reads as a rectangle sliding up. Soften that edge so it
reads as clay refilling:

```css
.power-cooldown {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  height: 0;
  border-radius: 40% 60% 0 0 / 18% 22% 0 0;
  background: var(--skin);
  pointer-events: none;
  transition: height 90ms linear;
}
```

The `border-radius` gives the rising surface an uneven, hand-pressed meniscus instead
of a ruled line. The short `transition` smooths the 12-step quantized jumps
(`COOLDOWN_STEPS = 12` in `tray.ts`) without breaking the stepping.

- [ ] **Step 2: Make disabled powers visibly drained**

Replace the `.power:disabled` rule (lines 142-144), and add a shell-level rule so the
whole blob reads as spent, not just the button inside it:

```css
.power:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  filter: saturate(0.35);
}

/* The whole blob goes flat and loses its highlight while the power is spent. */
.power-shell:has(.power:disabled) {
  box-shadow: inset 2px 2px 0 var(--paper), inset -3px -3px 0 var(--skin);
}
```

- [ ] **Step 3: Give Journal and Mute the same pressed-clay treatment**

Replace the `#journal-btn, #mute-btn` rule (lines 217-225). They keep their text but
gain the tray's material — a pressed clay tab, wobbly-cornered like everything else:

```css
#journal-btn,
#mute-btn {
  padding: 9px 10px;
  border: 2px solid var(--ink-soft);
  border-radius: 11px 8px 12px 7px / 8px 12px 7px 11px;
  background: var(--paper);
  box-shadow: inset 1px 1px 0 var(--cloud), inset -2px -2px 0 var(--skin);
  color: var(--ink);
  cursor: pointer;
  letter-spacing: 0.04em;
  white-space: nowrap;
  transition: transform 140ms ease;
}

#journal-btn:hover,
#mute-btn:hover {
  transform: translateY(-2px);
}

#journal-btn:active,
#mute-btn:active {
  transform: translateY(1px) scale(0.98);
}

#mute-btn[aria-pressed='true'] {
  opacity: 0.6;
  filter: saturate(0.4);
}
```

- [ ] **Step 4: Verify in the browser**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4500)
await page.screenshot({ path: 'tray-idle.png' })

// fire a power to put it on cooldown, then catch the fill mid-rise
await page.click('.power[data-power="meteor"]')
await page.mouse.click(640, 400)
await page.waitForTimeout(600)
await page.screenshot({ path: 'tray-cooldown.png',
  clip: { x: 400, y: 680, width: 500, height: 120 } })
```

Expected in `tray-cooldown.png`: the meteor blob is visibly **drained** (desaturated,
dimmer) and its fill has an **uneven top edge that follows the blob**, not a ruled
rectangle. In `tray-idle.png`: Journal and Mute read as the same pressed clay as the
power blobs rather than bare text.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npm test && npm run build
git add src/styles.css
git commit -m "feat: give tray cooldown, disabled and journal/mute a clay finish"
```

---

## Task 8: Make the moment tiles respond to hover and focus

The `.moment-tile` buttons are deliberately invisible — they are hit targets sitting
over the 3D clay tiles behind them. But they carry `cursor: help` and a rectangular
focus ring drawn over an organic tile, and hovering one produces **no response on the
tile itself**, so the book feels dead under the cursor. `ClayBook` already owns the
machinery to press a tile (`tile.pressed` geometry, the `popping` scale, and
`rebuildTiles()`); this task exposes it and wires the DOM hit targets to it.

**Files:**
- Modify: `src/ui/book.ts` — `BookTile` type, `setHovered`, `buildTileGeometry`
- Modify: `src/ui/journal.ts` — forward hover/focus to the book
- Modify: `src/ui/journal.ts` — `JournalUI` type gains `onHover`
- Modify: `src/main.ts` — wire `journalUI.onHover` to `book.setHovered`
- Modify: `src/styles.css:377-391` — tile cursor and focus ring

**Interfaces:**
- Consumes: `MOMENTS`, `MomentId` from `src/discovery/moments.ts`.
- Produces:
  - `ClayBook.setHovered(id: MomentId | null): void` — presses that tile's clay, or clears.
  - `JournalUI.onHover(handler: (id: MomentId | null) => void): () => void` — fires on tile pointerenter/focus (with the id) and pointerleave/blur (with `null`). Returns an unsubscribe function, matching the existing `onOpenChange` shape.

- [ ] **Step 1: Track a hovered tile in `ClayBook`**

In `src/ui/book.ts`, add a field beside the other private state (near line 78):

```ts
  private hovered: MomentId | null = null
```

Add the setter, next to `setUnlocked` (after line 212):

```ts
  setHovered(id: MomentId | null): void {
    if (this.hovered === id) return
    this.hovered = id
    this.rebuildTiles()
  }
```

- [ ] **Step 2: Press the hovered tile when building the geometry**

In `buildTileGeometry()` (lines 273-293), a tile currently picks its geometry from
`unlocked` alone and its scale from `popping` alone. A hovered tile should read as
pressed under a fingertip. Replace the `parts` mapping:

```ts
    const parts = this.tiles.map((tile, index) => {
      const hovered = this.hovered === MOMENTS[index].id
      // Hovering presses the clay: a hovered tile takes the dented geometry and sits
      // slightly deeper, so the cursor visibly pushes into the book.
      const geometry = (tile.unlocked || hovered ? tile.pressed : tile.plain).clone()
      color.set(tile.unlocked ? MOMENTS[index].color : PALETTE.stone)
      const count = geometry.getAttribute('position').count
      const colors = new Float32Array(count * 3)
      for (let vertex = 0; vertex < count; vertex++) color.toArray(colors, vertex * 3)
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const scale = tile.popping ? 1.09 : 1
      const position = hovered
        ? tile.position.clone().setZ(tile.position.z - 0.03)
        : tile.position
      matrix.compose(position, rotation, new THREE.Vector3(scale, scale, scale))
      geometry.applyMatrix4(matrix)
      return geometry
    })
```

- [ ] **Step 3: Emit hover from `JournalUI`**

In `src/ui/journal.ts`, add to the `JournalUI` type (after line 13):

```ts
  onHover(handler: (id: MomentId | null) => void): () => void
```

Add the handler set beside `openHandlers` (line 92):

```ts
  const hoverHandlers = new Set<(id: MomentId | null) => void>()
  const notifyHover = (id: MomentId | null): void => {
    for (const handler of hoverHandlers) handler(id)
  }
```

Extend the tile handlers from Task 5 so they drive the book as well as the hint:

```ts
    const showHint = (): void => {
      hint.textContent = journal.has(moment.id) ? moment.title : moment.hint
      notifyHover(moment.id)
    }
    const clearHint = (): void => {
      hint.textContent = ''
      notifyHover(null)
    }
```

Add to the returned `api` object (beside `onOpenChange`, line 219):

```ts
    onHover(handler) {
      hoverHandlers.add(handler)
      return () => { hoverHandlers.delete(handler) }
    },
```

And clear any stale hover when the book closes — inside `setOpen`'s `else` branch:

```ts
    } else {
      notifyHover(null)
      layer.classList.remove('open')
```

- [ ] **Step 4: Wire it up in `main.ts`**

In `src/main.ts`, beside the existing `journalUI.onOpenChange(...)` (lines 80-83):

```ts
journalUI.onHover(id => book.setHovered(id))
```

- [ ] **Step 5: Fix the tile's cursor and focus ring**

In `src/styles.css`, replace the `.moment-tile` and `.moment-tile:focus-visible` rules
(lines 377-391). `cursor: help` is wrong — these are buttons you press — and a square
outline over an organic clay tile looks like a bug:

```css
.moment-tile {
  appearance: none;
  min-width: 0;
  overflow: hidden;
  border: 0;
  border-radius: 13px 9px 12px 8px / 9px 13px 8px 12px;
  background: transparent;
  color: transparent;
  font: inherit;
  cursor: pointer;
}

/* The tile itself does the pressing (Step 2), so the ring's only job is to be
   unmistakably visible. It inherits the app-wide terracotta focus treatment from
   the `:focus-visible` rule and only overrides the offset, so the ring hugs the
   tile instead of floating outside it. No extra wobble here — the clay tell belongs
   on the clay, not on the focus ring. */
.moment-tile:focus-visible {
  outline-offset: -2px;
}
```

- [ ] **Step 6: Verify in the browser**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4500)
await page.click('#journal-btn')
await page.waitForTimeout(900)
await page.screenshot({ path: 'tile-rest.png' })
await page.hover('.moment-tile[data-index="4"]')
await page.waitForTimeout(200)
await page.screenshot({ path: 'tile-hover.png' })
```

Expected: comparing the two shots, the **middle tile is visibly pressed in** in
`tile-hover.png` — dented and sitting deeper — while the others are unchanged. Before
this task the two screenshots were identical.

Also tab to a tile and confirm the focus ring follows the tile's rounded outline rather
than drawing a rectangle across it.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit && npm test && npm run build
git add src/ui/book.ts src/ui/journal.ts src/main.ts src/styles.css
git commit -m "feat: press the clay tile on hover and focus"
```

---

## Task 9: Update the architecture doc

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Document the new module and the render gate**

Read `docs/architecture.md`, find the section covering `src/ui/`, and add:

- `src/ui/bookAnim.ts` — pure openness/easing math for the book's cover swing. Split
  out of `book.ts` so the curve is unit-testable in the node test environment (there is
  no DOM or WebGL under test). Exports `BOOK_OPEN_TICKS`, `MAX_COVER_ANGLE`,
  `advanceOpenness`, `easeOpen`, `coverAngle`.
- A note on `ClayBook.render()`: it draws only while the book is open or animating
  (`targetOpen || openness > 0`), and `JournalUI.rect()` returns `null` when closed.
  Previously the closed book was rendered every frame into the Journal *button's* rect,
  which showed up as a small floating artifact during the intro.
- A note that `ClayBook` relies on the shared renderer's `shadowMap.enabled`
  (set in `src/scene.ts`) and configures its own shadow-casting key light.

Match the file's existing structure and tone; do not restructure it.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: document bookAnim and the book render gate"
```

---

## Final verification

- [ ] **Full check**

```bash
npm test && npx tsc --noEmit && npm run build
```
Expected: 132 tests passed (125 existing + 7 new), no type errors, build succeeds.

- [ ] **End-to-end pass in the browser**

Walk the whole flow once, without scripting it away:

1. Load the page and **do not touch it**. Watch the full 4-second intro. There must be
   no small floating artifact at the bottom of the screen.
2. Open the journal. The cover must visibly **swing open** over ~half a second and come
   to rest as a foreshortened slab beside the pages.
3. The book must read as **clay** — a terminator across its surface, a contact shadow
   under it, fingerprint grain on the pages.
4. The heading, progress, close button and hint must sit **on the book**, not over sky.
5. The hint must be **empty** on open, fill on hover, and **clear** when you leave a tile.
6. Hovering a tile must **press it into the clay**.
7. Cast a power. Its blob must go visibly **drained** while it recharges, and the fill
   must rise with an uneven, clay-like edge.
8. Resize the window to a few shapes and confirm the chrome stays glued to the book.
9. Load `?lowfx=1` and confirm the flat DOM panel still works.
10. Enable `prefers-reduced-motion` and confirm the same.

# Moments Tablet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the 3D clay book and replace it with a single DOM clay tablet — a pressed clay slab whose moment tiles are dents, not buttons — so that `lowfx` and the normal path collapse into one code path.

**Architecture:** The journal stops being a Three.js object rendered into a scissored WebGL viewport with an invisible DOM shadow-copy on top. It becomes one DOM component. `src/ui/book.ts`, `src/ui/bookAnim.ts` and its test are deleted outright; `src/main.ts` loses all book wiring; `src/ui/journal.ts` loses `rect()`, `onHover()` and the book viewport element; `src/styles.css` gains the clay material and loses the aspect lock and every `.lowfx` override. Nothing new is created — this plan is a net deletion of code plus one rewritten block of CSS.

**Tech Stack:** TypeScript, Vite 8, Vitest 4. **No Three.js in the journal any more.** No new dependencies.

Spec: `docs/superpowers/specs/2026-07-13-moments-tablet-design.md`

## Global Constraints

- **Tests run in `environment: 'node'`** (`vite.config.ts`) — no DOM, no WebGL. The tablet is DOM and CSS, so **it gets no unit tests**; it is verified by driving the real app in a browser and looking at it. Do not add jsdom and do not change the test environment.
- **125 tests must stay green.** The current count is 132 (125 + the 7 `bookAnim` tests). Deleting `bookAnim` takes it back to **125**. `npm test`, `npx tsc --noEmit` and `npm run build` must pass at every commit.
- **No new files. No new dependencies.** This plan only deletes and modifies.
- **All hex colors come from `PALETTE` in `src/ui/tokens.ts`**, mirrored by hand as custom properties in `styles.css`. Never introduce a raw hex anywhere else. `--stone` does not exist as a custom property yet and must be added (Task 3) to mirror `PALETTE.stone` (`#8d8078`).
- **Never pure white.** `--cloud` (`#fffaf2`) is the clay white. Nothing in clay is `#ffffff`.
- **The stop-motion rule:** the *model* stutters at 12fps (`TIMING.fps`); *UI transitions do not* — the UI is made of real-world objects and moves smoothly. **The tablet is a real-world object, so its motion is smooth**, not quantized. See the comment in `src/ui/tokens.ts`.
- **The dent recipe is the raised recipe, flipped.** The tray's power blobs are raised: `inset 1px 1px 0 var(--cloud), inset -2px -2px 0 var(--skin)` — light top-left, dark bottom-right. A dent inverts it: **dark top-left** (the wall the thumb pushed, in shadow), **light bottom-right** (the far wall catching the light). Do not invent a third recipe.
- **Tiles cast no drop shadows.** Hard offset rectangles are what made the 3D version read as a flat mockup. Dents occlude; they do not drop shadows.
- **There is no scrim.** `.journal-backdrop` survives *only* as an invisible click-to-close target and paints nothing. The island stays vivid behind the tablet.
- **`?lowfx=1` and `prefers-reduced-motion` no longer branch structure.** They show the **same tablet**, only without the press-in transition.
- **One name per thing:** *moments* is the noun, *pressed* is the verb. Do not introduce a fifth word.

## Browser verification harness

Several tasks require looking at the real app. Set this up once and reuse it.

Start the dev server and **note the port it prints** — 5173 is often taken and it will fall back to 5174:

```bash
npm run dev
```

A Playwright-driven Chromium is available from the local cache. Create the harness in your scratchpad (**not** in the repo), and `npm install playwright-core` in that scratchpad directory only:

```js
// shot.mjs
import { chromium } from 'playwright-core'
import os from 'node:os'
import path from 'node:path'

const exe = path.join(os.homedir(),
  'Library/Caches/ms-playwright/chromium-1229/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
const URL = 'http://localhost:5174/'   // use the port vite actually printed

const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('[pageerror]', e.message))
await page.goto(URL, { waitUntil: 'load' })
// ... per-task steps go here
await browser.close()
```

The intro runs for 4 seconds and is skipped by any pointerdown/keydown. To reach the
tablet: `await page.waitForTimeout(4600)` then `await page.click('#journal-btn')`.

**Watch the console for `[pageerror]`.** Task 1 removes a lot of code; a stray reference
to `book` will surface there rather than as a type error.

---

## File Structure

- **Delete:** `src/ui/book.ts` — the `ClayBook` class (366 lines): scissored viewport, desk plane, shadow-casting key light, merged tile geometry, label canvas, cover pivot.
- **Delete:** `src/ui/bookAnim.ts` and `src/ui/bookAnim.test.ts` — the cover-swing math serves a cover that no longer exists.
- **Modify:** `src/main.ts` — remove the `ClayBook` import, its construction, and all six call sites.
- **Modify:** `src/ui/journal.ts` — drop `rect()`, `onHover()`, `hoverHandlers`, the `#journal-book-viewport` element, and the `lowFx` structural branch.
- **Modify:** `src/styles.css` — add `--stone`; rewrite the journal block as the clay tablet; delete the aspect lock and every `.lowfx` override.
- **Modify:** `docs/architecture.md` — record the removal and the tablet.

---

## Task 1: Delete the 3D book and unwire it

Pure deletion. The tablet does not exist yet, so at the end of this task the journal is
the *unstyled* DOM panel — the grid and chrome with no clay. That is expected and Task 2
and Task 3 dress it. Splitting the deletion from the styling keeps each commit reviewable:
this one is provably "nothing else referenced the book", the next ones are "the tablet
looks right".

**Files:**
- Delete: `src/ui/book.ts`
- Delete: `src/ui/bookAnim.ts`
- Delete: `src/ui/bookAnim.test.ts`
- Modify: `src/main.ts` — lines 15, 77, 79, 80-84, 92, 136-141

**Interfaces:**
- Consumes: nothing.
- Produces: `JournalUI` no longer needs `rect()` or `onHover()` — those are removed from the type in Task 2. `main.ts` must stop calling them **in this task**, because Task 2 deletes them.

- [ ] **Step 1: Delete the three book files**

```bash
git rm src/ui/book.ts src/ui/bookAnim.ts src/ui/bookAnim.test.ts
```

- [ ] **Step 2: Remove the `ClayBook` import from `src/main.ts`**

Delete line 15 entirely:

```ts
import { ClayBook } from './ui/book'
```

- [ ] **Step 3: Remove the book's construction and wiring in `src/main.ts`**

Replace the block at lines 76-93 (from `const journalUI` through the closing `})` of the
bus handler). The `book` lines go; everything else stays exactly as it is:

```ts
const journalUI = createJournalUI(ui, journal, { lowFx })
tray.setJournalCount(journal.count())
world.bus.on((event) => {
  const unlocked = journal.observe(event)
  if (!unlocked) return
  journalUI.toast(unlocked)
  sfx.reward()
  journalUI.setUnlocked(journal.unlocked)
  tray.setJournalCount(journal.count())
})
```

Note that `journalUI.onOpenChange(...)` and `journalUI.onHover(...)` are **both gone**.
`onOpenChange` existed *only* to drive `book.open()`/`book.close()` — verified: it had
exactly one subscriber, this one. With the book deleted it has zero consumers, so Task 2
removes it from the `JournalUI` type entirely rather than leaving a dead public hook.

- [ ] **Step 4: Remove the book from the render loop in `src/main.ts`**

Replace lines 136-141 — the three `book.*` calls and the dev readout — so the loop body
ends at the splash:

```ts
    if (lowFx) renderer.render(scene, camera)
    else composer.render()
    if (first) {
      first = false
      splash.classList.add('gone')
    }
```

The `bookDrawCalls` dev readout goes with it. Check nothing reads
`document.documentElement.dataset.bookDrawCalls`:

```bash
grep -rn "bookDrawCalls" src/ tests/ e2e/ 2>/dev/null
```
Expected: no matches.

- [ ] **Step 5: Verify the book is gone and nothing references it**

```bash
grep -rn "ClayBook\|bookAnim\|book\." src/ | grep -v "styles.css\|tokens.ts"
```
Expected: **no matches.** (`styles.css` and `tokens.ts` still contain the *word* "book" in
a comment and a selector; Task 3 handles those.)

```bash
npx tsc --noEmit && npm test
```
Expected: no type errors. **125 tests passed** — down from 132, because the 7 `bookAnim`
tests were deleted with the module. This drop is correct and expected.

- [ ] **Step 6: Confirm the app still runs**

With the dev server running:

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4600)
await page.click('#journal-btn')
await page.waitForTimeout(600)
await page.screenshot({ path: 'task1-unstyled.png' })
```

Expected: **no `[pageerror]` in the console**, and the journal opens as an *unstyled* panel
— heading, progress line, close button, a grid of plain rectangles, hint. It will look
plain. That is correct at this stage. What matters is that the island behind it is still
rendering and nothing threw.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: delete the 3D clay book

A head-on orthographic camera cannot show a book opening: the cover
swung to 140 degrees and rendered as a 10px splinter. The desk plane
filled the scissored rect and erased the book's silhouette, and the
tile shadow map produced twelve hard drop shadows that read as CSS.
None of it is fixable by tuning. Replaced by a DOM clay tablet."
```

---

## Task 2: Simplify the journal's DOM

Strip the journal of everything that existed to serve the 3D book: the viewport element
the camera was scissored into, the `rect()` that fed it, and the `onHover()` that
rebuilt its tile geometry. The `lowFx` option stops branching structure.

**Files:**
- Modify: `src/ui/journal.ts` — the `JournalUI` type (8-16), the `lowFx` class toggle (30), the viewport element (56-57), `hoverHandlers` (68-71), the tile handlers (82-93), the assembly (97-100), `openHandlers`/`notify` (104, 125-127), `setOpen` (141-148), and the `api` object (229-241)

**Interfaces:**
- Consumes: nothing.
- Produces: `JournalUI` — the type shrinks to **three members**: `toast()`, `setUnlocked()` and `close()`. `rect()`, `onHover()`, `onOpenChange()` and `isOpen` are all removed: the first two served the book's scissor rect and geometry rebuilds, and the last two had **zero consumers** once the book was deleted (verified — `onOpenChange`'s only subscriber was `book.open()`/`book.close()`). `createJournalUI(ui, journal, { lowFx })` keeps its signature: `lowFx` still selects the no-motion path.

- [ ] **Step 1: Shrink the `JournalUI` type**

In `src/ui/journal.ts`, replace the type (lines 8-16). Four members go; the `MomentId`
import is still needed by `setUnlocked`:

```ts
export type JournalUI = {
  toast(moment: Moment): void
  setUnlocked(unlocked: ReadonlySet<MomentId>): void
  close(): void
}
```

Removing `onOpenChange` means the `openHandlers` set (line 104) and the `notify()` helper
(lines 125-127) are now dead. Delete both, and delete the `notify()` call at the end of
`setOpen` (line 148).

- [ ] **Step 2: Replace the book viewport with a plain slab element**

The `#journal-book-viewport` div existed to be a fixed-aspect box for the WebGL scissor
rect. The tablet needs no fixed aspect — it is the slab itself. Replace lines 56-57:

```ts
  const slab = document.createElement('div')
  slab.className = 'journal-slab'
```

Rename its use in the assembly (lines 97-100):

```ts
  slab.append(heading, count, closeButton, grid, hint)
  dialog.append(slab)
  layer.append(backdrop, dialog)
  ui.appendChild(layer)
```

- [ ] **Step 3: Delete the hover plumbing**

Remove the `hoverHandlers` set and `notifyHover` entirely (lines 68-71).

Then simplify the tile handlers (lines 82-93). They now only drive the hint — the tile's
*visual* press is pure CSS `:hover`/`:focus-visible` from Task 3, so there is nothing to
forward:

```ts
    const showHint = (): void => {
      hint.textContent = journal.has(moment.id) ? moment.title : moment.hint
    }
    const clearHint = (): void => {
      hint.textContent = ''
    }
    button.addEventListener('focus', showHint)
    button.addEventListener('blur', clearHint)
    button.addEventListener('pointerenter', showHint)
    button.addEventListener('pointerleave', clearHint)
    return button
```

- [ ] **Step 4: Clean up `setOpen`**

`setOpen` (lines 129-149) calls both `notifyHover(null)` and `notify()`, neither of which
exists any more. Here is the method in full, as it should end up — this is the whole thing,
not a fragment:

```ts
  const setOpen = (value: boolean): void => {
    if (open === value) return
    open = value
    window.clearTimeout(closeTimer)
    trigger.setAttribute('aria-expanded', String(open))
    setBackgroundInert(open)

    if (open) {
      hint.textContent = ''
      layer.hidden = false
      requestAnimationFrame(() => layer.classList.add('open'))
      closeButton.focus({ preventScroll: true })
    } else {
      layer.classList.remove('open')
      trigger.focus({ preventScroll: true })
      if (prefersReducedMotion()) layer.hidden = true
      else closeTimer = window.setTimeout(() => { layer.hidden = true }, 340)
    }
  }
```

The `open` variable is still needed (the `if (open === value) return` guard reads it), so
keep `let open = false` at line 102.

- [ ] **Step 5: Drop the four dead members from the returned api**

In the `api` object, delete `rect()` (229-231), the `isOpen` getter (232), `onOpenChange()`
(233-236) and `onHover()` (237-240). What remains is `toast()`, `setUnlocked()` and
`close()`, so the object now ends:

```ts
    close() { setOpen(false) },
  }
```

`setOpen` is still called by the trigger, the close button, the backdrop and Escape — it
just no longer notifies anyone.

- [ ] **Step 6: Keep the `lowfx` class, because it still selects the no-motion path**

Line 30 stays exactly as it is:

```ts
  layer.classList.toggle('lowfx', options.lowFx || prefersReducedMotion())
```

It no longer swaps in a different *structure* — Task 3 makes `.lowfx` mean only "skip the
press-in transition". Do not delete this line.

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit && npm test
```
Expected: no type errors, 125 passed.

```bash
grep -rn "journal-book-viewport\|onHover\|notifyHover\|\.rect()" src/
```
Expected: only `src/styles.css` still matches (`#journal-book-viewport`), which Task 3
deletes.

- [ ] **Step 8: Commit**

```bash
git add src/ui/journal.ts
git commit -m "refactor: drop the journal's book viewport, rect and hover plumbing"
```

---

## Task 3: Sculpt the clay tablet

The whole visual payload. One block of CSS replaces the journal's styling; the aspect lock
and every `.lowfx` structural override are deleted.

The governing idea, restated because it is the thing that makes this work: **a pressed dent
is the raised button's recipe, flipped.** The tray's power blobs are raised (light top-left,
dark bottom-right). The tiles are dented (dark top-left, light bottom-right).

**Files:**
- Modify: `src/styles.css` — add `--stone` to `:root` (1-15); replace lines 306-469 (the whole journal block, including the `.lowfx` overrides); adjust the reduced-motion block (534-541)

**Interfaces:**
- Consumes: the DOM from Task 2 — `#journal-layer` (`.open`, `.lowfx`), `.journal-backdrop`, `#journal-dialog`, `.journal-slab`, `#journal-heading`, `.journal-progress`, `.journal-close`, `.moment-grid`, `.moment-tile` (`.unlocked`, `--moment-color`), `.journal-hint`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `--stone` custom property**

`PALETTE.stone` (`#8d8078`) is the locked-tile color but has no CSS mirror. Add it to
`:root` in `src/styles.css`, beside the others (after `--skin`, line 6):

```css
  --stone: #8d8078;
```

Per the global constraints this is a hand-kept mirror of `PALETTE.stone` in
`src/ui/tokens.ts`. Do not invent a new value — copy that one.

- [ ] **Step 2: Replace the entire journal block**

In `src/styles.css`, replace **lines 306 through 469** — everything from `#journal-layer`
down to and including the last `#journal-layer.lowfx .moment-tile.unlocked` rule — with the
following. This deletes `#journal-book-viewport`, the `7.9 / 5.75` aspect lock, and all
four `.lowfx` structural overrides:

```css
#journal-layer {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 320ms ease;
}

#journal-layer[hidden] {
  display: none;
}

#journal-layer.open {
  opacity: 1;
  pointer-events: auto;
}

/* Paints nothing. The tablet separates from the world by form and shadow, not by
   dimming — an object that needs the world darkened to be visible is not yet an
   object. This element survives only as a full-bleed click-to-close target. */
.journal-backdrop {
  position: absolute;
  inset: 0;
}

#journal-dialog {
  position: relative;
  width: min(720px, calc(100vw - 32px));
  height: min(600px, calc(100vh - 54px));
  min-height: 430px;
}

/* The slab. Raised clay: light inset top-left, dark inset bottom-right — the same
   recipe as the tray's power blobs. It rests at a slight angle so it reads as placed,
   not aligned. The drop shadow sits it ABOVE the island rather than pasting it on. */
.journal-slab {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border: 2px solid var(--ink-soft);
  border-radius: 28px 20px 31px 18px / 21px 30px 18px 29px;
  background: var(--paper);
  box-shadow:
    inset 2px 2px 0 var(--cloud),
    inset -3px -3px 0 var(--skin),
    0 10px 0 -2px var(--ink-soft),
    0 18px 34px rgb(61 52 54 / 28%);
  transform: scale(0.9) rotate(-1.4deg);
  transition: transform 320ms cubic-bezier(0.34, 1.4, 0.64, 1);
}

/* Presses into place: scales up with a small overshoot and settles, the rotation
   correcting toward true. Smooth, not quantized — the model stutters at 12fps, the
   UI does not, because the UI is a real-world object. */
#journal-layer.open .journal-slab {
  transform: scale(1) rotate(-0.4deg);
}

/* The grain. The DOM analogue of the clayHash fingerprint dents in clayMaterial.ts —
   this is what stops the slab being a flat CSS fill. Kept faint on purpose. */
.journal-slab::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  background-image:
    repeating-linear-gradient(
      98deg,
      rgb(61 52 54 / 4%) 0 1px,
      transparent 1px 4px
    ),
    repeating-linear-gradient(
      171deg,
      rgb(255 250 242 / 5%) 0 1px,
      transparent 1px 3px
    ),
    radial-gradient(circle at 22% 28%, rgb(61 52 54 / 5%) 0 12%, transparent 13%),
    radial-gradient(circle at 74% 66%, rgb(232 176 135 / 9%) 0 16%, transparent 17%);
  content: '';
  pointer-events: none;
}

#journal-heading {
  position: absolute;
  top: 26px;
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
  top: 60px;
  left: 50%;
  z-index: 2;
  margin: 0;
  transform: translateX(-50%);
  color: var(--ink-soft);
  font-size: 11px;
  letter-spacing: 0.04em;
  pointer-events: none;
}

.journal-close {
  position: absolute;
  top: 20px;
  right: 22px;
  z-index: 3;
  padding: 7px 10px;
  border: 2px solid var(--ink-soft);
  border-radius: 9px 6px 10px 5px / 6px 10px 5px 9px;
  background: var(--paper);
  box-shadow: inset 1px 1px 0 var(--cloud), inset -2px -2px 0 var(--skin);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
  transition: transform 140ms ease;
}

.journal-close:hover {
  transform: translateY(-2px);
}

.journal-close:active {
  transform: translateY(1px) scale(0.98);
}

.moment-grid {
  position: absolute;
  z-index: 1;
  top: 92px;
  right: 34px;
  bottom: 52px;
  left: 34px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(4, 1fr);
  gap: 14px 16px;
}

/* A DENT, not a button: the raised recipe inverted. Dark on the top-left — the wall
   the thumb pushed, which the light does not reach. Light on the bottom-right — the
   far wall of the hollow, catching it. No drop shadow: dents occlude, they do not
   cast. Twelve hard offset rectangles is what made the 3D book read as a mockup. */
.moment-tile {
  appearance: none;
  display: grid;
  place-items: center;
  min-width: 0;
  padding: 6px;
  border: 0;
  border-radius: 13px 9px 12px 8px / 9px 13px 8px 12px;
  background: var(--stone);
  box-shadow:
    inset 3px 3px 0 rgb(61 52 54 / 34%),
    inset -2px -2px 0 rgb(255 250 242 / 22%);
  color: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease;
}

/* Pigment pressed into the hollow: the moment's color fills the dent, and the dent
   shadow stays, so it still reads as pressed IN rather than popped out. */
.moment-tile.unlocked {
  background: var(--moment-color);
  color: var(--ink);
}

/* Hovering presses it deeper. The same physical story the 3D setHovered told, as one
   rule instead of a geometry rebuild. */
.moment-tile:hover,
.moment-tile:focus-visible {
  transform: translate(1px, 1px);
  box-shadow:
    inset 5px 5px 0 rgb(61 52 54 / 42%),
    inset -2px -2px 0 rgb(255 250 242 / 26%);
}

.moment-tile:focus-visible {
  outline-offset: -3px;
}

/* The pop when a moment lands. */
.moment-tile.pop {
  animation: moment-press 260ms ease;
}

@keyframes moment-press {
  0% { transform: scale(1); }
  40% { transform: scale(1.07); }
  100% { transform: scale(1); }
}

.journal-hint {
  position: absolute;
  right: 34px;
  bottom: 20px;
  left: 34px;
  z-index: 2;
  min-height: 1.2em;
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
  text-align: center;
  pointer-events: none;
}

/* lowfx and reduced motion no longer branch the STRUCTURE — there is one tablet.
   They only skip the press-in. */
#journal-layer.lowfx .journal-slab {
  transform: rotate(-0.4deg);
  transition: none;
}
```

Note `rgb(... / n%)` is used for the *shadow* alphas rather than a `PALETTE` hex, because
these are translucent shades of `--ink` (`#3d3436` → `rgb(61 52 54)`), `--cloud`
(`#fffaf2` → `rgb(255 250 242)`) and `--skin` (`#e8b087` → `rgb(232 176 135)`). They are
those exact palette colors with an alpha, not new hues — the constraint is that no new
*color* is invented, and none is.

- [ ] **Step 3: Fix the reduced-motion block**

The block at lines 534-541 still names `#journal-dialog`, which no longer carries the
transform — the slab does. Replace those two rules:

```css
  #journal-layer {
    transition: opacity 140ms ease !important;
  }

  .journal-slab,
  #journal-layer.open .journal-slab {
    transform: rotate(-0.4deg);
  }
```

- [ ] **Step 4: Fix the small-screen block**

At lines 586-589, `#journal-dialog` still has its size overridden for narrow screens. That
rule is still correct — the dialog is still the sizing box — so **leave it as it is**. Just
confirm it reads:

```css
  #journal-dialog {
    width: calc(100vw - 16px);
    height: calc(100vh - 24px);
  }
```

- [ ] **Step 5: Wire the unlock pop**

The `.pop` class in Step 2 needs to be applied when a moment unlocks. In
`src/ui/journal.ts`, `setUnlocked` currently only toggles `.unlocked`. Add the pop, keeping
the rest of the method as it is:

```ts
    setUnlocked(unlocked) {
      tiles.forEach((button, index) => {
        const moment = MOMENTS[index]
        const isUnlocked = unlocked.has(moment.id)
        const wasUnlocked = button.classList.contains('unlocked')
        button.classList.toggle('unlocked', isUnlocked)
        button.setAttribute(
          'aria-label',
          isUnlocked ? moment.title : `Locked moment: ${moment.hint}`,
        )
        button.style.setProperty('--moment-color', moment.color)
        button.textContent = isUnlocked ? moment.title : ''
        if (isUnlocked && !wasUnlocked && !prefersReducedMotion()) {
          button.classList.remove('pop')
          // Force a reflow so re-adding the class restarts the animation.
          void button.offsetWidth
          button.classList.add('pop')
        }
      })
      count.textContent = `${unlocked.size} of ${MOMENTS.length} moments pressed`
    },
```

- [ ] **Step 6: Verify the tablet by eye — this is the task's real test**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4600)
await page.click('#journal-btn')
await page.waitForTimeout(700)
await page.screenshot({ path: 'tablet.png' })

await page.hover('.moment-tile[data-index="4"]')
await page.waitForTimeout(220)
await page.screenshot({ path: 'tablet-hover.png' })
```

Read both images and confirm **all five**, by eye. This is a visual task; a passing test
suite proves nothing here:

1. The tablet reads as **one hand-made clay object** with a clear silhouette. It has a
   wobbly edge, a visible drop shadow lifting it off the island, and a faint grain — it is
   not a flat beige rectangle.
2. **The island behind it is still vivid.** The sky is still warm, the grass is still
   green. Nothing is dimmed or grey. If the world looks muddy, a scrim survived — find it
   and delete it.
3. The tiles read as **hollows pressed into the slab** — dark on the top-left, light on
   the bottom-right. They must NOT look like raised buttons, and must NOT have drop
   shadows beneath them.
4. In `tablet-hover.png`, the **middle tile is visibly pressed deeper** than the others.
5. There is **no rectangular WebGL seam** anywhere — the scissored viewport is gone, so
   the tablet's corners must be its own rounded corners, over live island.

If the dents do not read: **strengthen the inset contrast** in `.moment-tile` (raise the
`34%`/`42%` alphas). Do not add more layers — adding layers is how the 3D book got here.

- [ ] **Step 7: Verify the press-in motion**

```js
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4600)
await page.click('#journal-btn')
for (const t of [90, 180, 270, 400]) {
  await page.waitForTimeout(90)
  await page.screenshot({ path: `press-${t}.png` })
}
```

Expected: across the four frames the tablet is visibly **growing and its rotation is
settling** — it is smaller and more crooked in `press-90` than in `press-400`. It must not
be already fully placed by the second frame.

- [ ] **Step 8: Verify lowfx and reduced motion show the SAME tablet**

```js
await page.goto(URL + '?lowfx=1', { waitUntil: 'load' })
await page.waitForTimeout(4600)
await page.click('#journal-btn')
await page.waitForTimeout(400)
await page.screenshot({ path: 'tablet-lowfx.png' })

await page.emulateMedia({ reducedMotion: 'reduce' })
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(4600)
await page.click('#journal-btn')
await page.waitForTimeout(400)
await page.screenshot({ path: 'tablet-reduced.png' })
await page.emulateMedia({ reducedMotion: 'no-preference' })
```

Expected: **both look like `tablet.png`** — the same clay slab with the same dented tiles.
The only difference is that they did not animate in. This is the point of the whole change:
there is no second, uglier fallback panel any more. If either shows a *different* panel, a
`.lowfx` structural override survived.

- [ ] **Step 9: Verify and commit**

```bash
npx tsc --noEmit && npm test && npm run build
```
Expected: no type errors, 125 passed, build succeeds.

```bash
git add src/styles.css src/ui/journal.ts
git commit -m "feat: sculpt the moments tablet as pressed clay

Tiles are dents, not buttons: the tray's raised recipe inverted, dark
top-left where the thumb pushed. No scrim — the tablet separates by
form and shadow, so the island stays vivid behind it. lowfx and
reduced-motion now show the same tablet, minus the press-in."
```

---

## Task 4: Update the architecture doc

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Record the removal and the tablet**

Read `docs/architecture.md`, find the sections covering `src/ui/` and any description of
the 3D book, and:

- **Remove** every reference to `src/ui/book.ts`, `ClayBook`, `src/ui/bookAnim.ts`, the
  scissored book viewport, and the book's render gate. These modules no longer exist.
- **Add**, in the `src/ui/` section: the journal is a **DOM clay tablet** built in
  `src/ui/journal.ts` and styled in `src/styles.css`. It is not a 3D object and does not
  touch the renderer. Moment tiles are styled as *dents* — the tray's raised-clay
  `box-shadow` recipe inverted (dark inset top-left, light inset bottom-right) — and an
  unlocked tile fills with its moment color like pigment pressed into the hollow.
- **Add** a note that `lowFx` and `prefers-reduced-motion` no longer select a different
  journal structure; they only skip the tablet's press-in transition. There is one tablet.
- **Add** a one-line note recording *why* the 3D book was removed, so nobody rebuilds it:
  a head-on orthographic camera cannot show a cover swing (at 140° the cover is edge-on and
  renders as a ~10px splinter), and the desk plane required to catch its shadow filled the
  scissored rect and erased the book's silhouette.

Match the file's existing structure and tone. Do not restructure it.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: replace the clay book with the moments tablet"
```

---

## Final verification

- [ ] **Full check**

```bash
npm test && npx tsc --noEmit && npm run build
```
Expected: **125 tests passed**, no type errors, build succeeds.

- [ ] **Confirm the book is really gone**

```bash
grep -rni "claybook\|bookanim\|book-viewport\|drawcalls" src/ docs/architecture.md
```
Expected: no matches.

- [ ] **End-to-end pass in the browser**

Walk the whole flow once, by hand, without scripting it away:

1. Load the page and watch the full 4-second intro. No floating artifact at the bottom of
   the screen. (This was the intro bug; the book that caused it no longer exists.)
2. Open the journal. The tablet **presses into place** over ~320ms — growing and settling
   straight, smoothly.
3. The tablet reads as **one clay object**: wobbly silhouette, grain, a shadow lifting it
   off the world.
4. **The island behind it is still vivid** — not dimmed, not grey.
5. The tiles read as **dents**, not buttons, and cast no drop shadows.
6. Hovering a tile **presses it deeper**.
7. Cast powers until a moment unlocks. The tile **fills with its color like pigment
   pressed into the hollow**, and pops as it lands.
8. The hint is **empty** on open, fills on hover, and **clears** when you leave a tile.
9. Resize the window to a few shapes. The tablet stays coherent and the chrome stays on it.
10. Load `?lowfx=1`. **The same tablet appears**, without the press-in.
11. Enable `prefers-reduced-motion`. The same.

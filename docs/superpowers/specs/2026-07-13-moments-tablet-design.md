# The Moments Tablet — replacing the 3D clay book

**Status:** approved, supersedes the book half of `docs/plans/3-book-and-tray-polish.md`

## Why we are throwing the 3D book away

The 3D book was implemented as specified and it looks worse than the `?lowfx=1`
fallback it was supposed to beat. That is not a tuning problem. Four things are wrong,
and three of them are structural:

1. **The desk plane erased the book's silhouette.** Task 3 added a
   `PlaneGeometry(20, 14)` in `PALETTE.paper` so the shadow had somewhere to land. The
   book renders into a *scissored rect*, so that plane fills the box edge to edge. The
   result is a beige card on a beige card behind a grey scrim — three rectangles of
   nearly the same value, and no object.

2. **The tile shadows read as CSS, not clay.** Every tile drops a hard blue-grey shadow
   down and to the right onto the pages. Twelve identical offset rectangles is exactly
   what `box-shadow` looks like. Clay tiles pressed *into* a page do not cast drop
   shadows — they occlude. The shadow map was actively selling the wrong material.

3. **A head-on orthographic camera cannot show a book opening.** This is the important
   one. `MAX_COVER_ANGLE` was tuned to `-0.78π` (140°), which puts the cover nearly
   edge-on to the camera — it renders as a ~10px brown splinter at the left edge. Task 1
   tuned the *easing curve*, but the failure is geometric. No easing curve fixes it. The
   only fix is a raked perspective camera, which breaks the DOM-tile alignment that the
   entire design depends on.

4. **The ink scrim killed the world.** `--ink` at `0.28` over everything turned the sky
   muddy and desaturated the island into sludge — and the book, being the same value as
   the scrim, still did not pop.

Underneath all four: the 3D book pays an enormous complexity cost (a scissored WebGL
viewport, an aspect lock, invisible DOM hit-targets aligned to clay tiles, a merged
geometry rebuild on every hover) and the only thing it buys over a DOM panel is a cover
swing that cannot be seen and grain that cannot be read at that size.

## What we are building instead

The journal becomes **one DOM component styled as clay**: a pressed clay tablet, not a
UI dialog and not a book. The material sells it. There is no cover and nothing swings.

The governing idea for the material:

> **A pressed dent is the exact inverse of a raised button.**

The tray's power blobs already prove the raised recipe works in this codebase
(`inset 1px 1px 0 var(--cloud), inset -2px -2px 0 var(--skin)` — light on the top-left,
dark on the bottom-right). The tablet's tiles use that recipe *flipped*: dark on the
top-left (the wall the thumb pushed, in shadow), light on the bottom-right (the far wall
catching the light). Same material, pressed the other way. We are not inventing a recipe;
we are reusing a proven one, inverted.

## Architecture

### Deleted

- **`src/ui/book.ts`** (366 lines) — `ClayBook`, the scissored viewport, the desk plane,
  the shadow-casting key light, the merged tile geometry, the label canvas.
- **`src/ui/bookAnim.ts`** and **`src/ui/bookAnim.test.ts`** — the cover-swing math exists
  solely to serve a cover that no longer exists.
- **In `src/main.ts`:** the `ClayBook` import, its construction, and every call site —
  `setRect`, `update`, `render`, `setUnlocked`, `setHovered`, `open`/`close`, and the
  `bookDrawCalls` dev readout (lines 15, 77–92, 136–141).
- **In `src/ui/journal.ts`:** `rect()`, `onHover()`, the `hoverHandlers` set, and the
  `#journal-book-viewport` element. `JournalUI`'s type shrinks by two members.
- **In `src/styles.css`:** `#journal-book-viewport` and its `7.9 / 5.75` aspect lock, and
  every `#journal-layer.lowfx` override.

### Retained, untouched

The hint behavior and `RESTING_HINT`, arrow-key grid navigation, the focus trap, the
toast, the tray inerting during the intro, and the tray's clay finish. Tasks 5, 6 and 7
of the previous plan landed correctly and are not in scope. This design replaces only the
*rendering* of the book.

### The `lowfx` collapse

`lowFx` and `prefers-reduced-motion` no longer branch the journal's **structure**. There
is one tablet. Those flags now only reduce **motion** — they skip the press-in transition.

This is the central simplification. The thing the user judged to look better becomes the
only thing that exists, so it can no longer rot as an unmaintained fallback path.

## The material, in three layers

All colors come from `PALETTE` (via the CSS custom properties that mirror it). No new hex
values. Never pure white — `--cloud` (`#fffaf2`) is the clay white.

**1. The slab.** `--paper` ground. An irregular hand-cut `border-radius` in the existing
idiom (`28px 20px 31px 18px / 21px 30px 18px 29px`). A `2px` `--ink-soft` edge. The
*raised* clay shadow — `inset` light on the top-left (`--cloud`), `inset` dark on the
bottom-right (`--skin`) — plus one soft drop shadow beneath, so it sits *above* the island
rather than being pasted onto it. It rests at `-0.4deg`, so it reads as **placed**, not
**aligned**.

**2. The grain.** A low-opacity `::before` overlay combining a `repeating-linear-gradient`
with fine radial noise. This is the DOM analogue of the `clayHash` fingerprint dents in
`src/fx/clayMaterial.ts`, and it is the single cheapest thing that stops the tablet being
a flat CSS fill.

**3. The tiles, as dents.** The inverse recipe:
`inset 2px 2px 0 var(--ink-soft), inset -2px -2px 0 var(--cloud)`. Each tile carries its
own irregular `border-radius`. A locked tile is a dim `--stone` recess. An unlocked tile
**fills with `--moment-color` like pigment pressed into the hollow**, keeps its dent
shadow, and shows its title — so unlocking reads as *the moment being pressed into the
clay*, which is precisely the vocabulary the flow already standardized on.

**Tiles cast no drop shadows.** That was the tell that made the 3D version read as a
mockup. Dents do not drop shadows; they occlude.

## Motion

- **Opening:** the tablet **presses in** — `scale(0.9) → 1` with a small overshoot and
  settle, the rotation correcting toward true, over `TIMING.uiSlow` (320ms). Smooth, not
  quantized: per the project's stop-motion rule, the *model* stutters at 12fps and the
  *UI does not*, because the UI is a real-world object. The tablet is a real-world object.
- **Hover / focus on a tile:** it presses **deeper** — the inset shadows strengthen and
  the tile translates 1px down and right. This is the same physical story the 3D
  `setHovered` told, expressed as one CSS rule instead of a geometry rebuild.
- **Unlock pop:** the existing pop stays — a brief scale bump as the pigment lands.
- **Reduced motion / lowfx:** the tablet appears with no transition. Structure identical.

## The backdrop

**There is no scrim.** The `.journal-backdrop` element survives *only* as an invisible
full-bleed click-to-close target; it paints nothing.

The tablet separates from the world by **form and shadow**, not by dimming. The island
stays vivid and alive behind it. This is the honest way to do it: if an object needs the
world dimmed to be visible, the object is not yet an object.

## Success criteria

The work is done when, on a real screen:

1. The tablet reads as **one hand-made clay object** with a clear silhouette against an
   undimmed, still-vivid island.
2. The tiles read as **dents pressed into the slab** — not as raised buttons and not as
   rectangles with drop shadows.
3. An unlocked tile reads as **pigment pressed into its hollow**.
4. Hovering a tile visibly **presses it deeper**.
5. The tablet **presses into place** when opened, over ~320ms, smoothly.
6. `?lowfx=1` and `prefers-reduced-motion` show the **same tablet**, only without the
   press-in motion.
7. `npm test`, `npx tsc --noEmit` and `npm run build` all pass. The two `bookAnim` tests
   are gone with the module; no other test referenced the book.

## Risk

The honest one: **CSS clay looks cheap if the grain and the dent shadows are not right.**

The mitigation is that the recipe is already proven in this codebase — the tray's power
blobs are the raised version of the same thing, and the tablet is that recipe flipped. If
the dents do not read after the first pass, the correction is to **strengthen the inset
contrast**, not to add more layers. Adding layers is how the 3D book got here.

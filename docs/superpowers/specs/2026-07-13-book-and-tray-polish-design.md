# Clay Book & Tray Polish — Design

Date: 2026-07-13

## Problem

The journal ("clay book") and the control tray both ship with visible defects. Each
was reproduced in a real browser at 1280x800 against the dev server.

1. **A small artifact floats at the bottom of the screen during the intro.** It is the
   clay book itself, rendered at postage-stamp size. `main.ts` calls
   `book.setRect(journalUI.rect())` every frame, and `journalUI.rect()` returns the
   *Journal button's* rect while the book is closed. `ClayBook.render()` bails only on
   lowFx, reduced-motion, or a degenerate rect — never on "the book is closed" — so it
   scissors a ~58x44px viewport at the button's position and paints the closed book into
   it every frame. During the intro the tray is `opacity: 0` but still laid out, so the
   button has a real rect and the book paints onto bare canvas with no tray behind it.

2. **The opening animation is barely visible.** `openness` advances `1/7` per quantized
   12fps tick (583ms total), but the ease `1 - (1-o)**3` is severely front-loaded: the
   cover is 63° open after one tick (83ms) and 82% open by 250ms. The cover also swings
   to `-PI * 0.94` ≈ -169°, ending flat *behind* the book body where it is invisible
   against it. The net effect is a flat slab appearing, not a book opening.

3. **The book does not read as clay.** The book scene's single directional light sits at
   (5,7,9) with the camera at (0,0.4,12) — nearly head-on — so the whole face lands in
   the toon ramp's top band and saturates flat. Ambient at 1.35 finishes the job.
   `castShadow`/`receiveShadow` are set on the meshes but the scene has **no**
   shadow-casting light configured, so those flags are inert. The pages use
   `clayMaterial(cloud, { flat: true })`, and `flat: true` disables the fingerprint-dent
   normal perturbation and the hand-mixed color noise — so the largest surface in frame
   is the one part with no clay grain at all.

4. **The hint line is pre-filled and then sticks.** `journal.ts` sets the hint to
   "Focus an unpressed tile for a hint." at construction, and opening the book focuses
   the *close button*, never a tile — so that text is already sitting there before the
   user has touched anything. There is no `pointerleave`/`blur` handler, so once a tile
   is hovered the hint remains pinned to that moment forever, even after the cursor
   leaves the book.

5. **The book chrome floats free of the book.** Heading, progress line, close button and
   hint are positioned in percentages of `#journal-dialog`, but the book viewport is a
   fixed `7.9 / 5.75` aspect box centered inside that dialog. At 1280x800 the viewport is
   780x568 inside a 780x630 dialog, so the chrome hangs over sky, visually disconnected
   from the object it labels, and drifts independently as the window is resized.

6. **There is no backdrop in the normal path.** `.journal-backdrop` is only given a
   background under `.lowfx`, so the vivid island stays at full strength behind the open
   book and the modal does not read as modal.

7. **The tray is only faded, not hidden, during the intro.** `.intro-hidden` sets
   `opacity: 0` alone: the buttons keep their layout box and stay in the accessibility
   tree, and (per issue 1) keep handing the book a rect to render into.

8. **Tray and tile affordances are unfinished.** The cooldown fill is a hard-edged
   rectangle sweeping up a blob-shaped shell; the disabled power state is only a cursor
   change; Journal and Mute are plain text buttons sitting beside sculpted clay blobs, so
   the tray does not read as one material. The invisible `.moment-tile` DOM buttons carry
   `cursor: help` and a rectangular focus ring drawn over an organic clay tile, and
   hovering one produces no response on the 3D tile behind it.

## Goals

Make the book read unmistakably as the same clay as the island, make it visibly *open*,
remove the intro artifact, and bring the tray and tiles up to the same finish. No new
files, no new dependencies. The existing 125 tests must stay green.

## Non-goals

- Rebuilding the book's geometry from scratch (rounded spine, cover curl, molded forms).
  The book stays a 3D object rendered into a scissored WebGL viewport; we fix its
  lighting, material and motion in place.
- Replacing the 3D book with a DOM/CSS panel.
- Any change to what the twelve Moments are, how they unlock, or how they persist.

## Design

### 1. Intro artifact

The book must not render when it is not on screen. Two independent fixes, because either
alone leaves a latent bug:

- Gate `ClayBook.render()` on the book being open or mid-animation
  (`targetOpen || openness > 0`). When closed there is nothing to draw. This also stops
  the book consuming a draw call every frame, for the whole session, while invisible.
- Have `JournalUI.rect()` return the book viewport's rect only when open. Closed, it
  reports nothing to render into rather than the trigger button's box.

### 2. Tray during intro

`.intro-hidden` gains `visibility: hidden` alongside the existing opacity fade, and
`Intro` marks the tray `inert` until `skip()`. The tray becomes genuinely absent —
out of layout's reach, out of the accessibility tree, unfocusable — rather than merely
transparent.

### 3. The book reads as clay

All inside `ClayBook`:

- **Raking key light.** Move the key off the camera axis so a real terminator crosses the
  cover and the page stack, instead of the whole face landing in the ramp's top band.
  Lower ambient so the ramp's shadow band is actually reachable.
- **Enable shadows.** Turn on shadow casting for the key light (the meshes already carry
  `castShadow`/`receiveShadow`; today they do nothing) and add a subtle clay "desk" plane
  behind the book to catch a soft contact shadow. This is what separates the book from
  the world and sells it as a physical object.
- **Regrain the pages.** Drop `flat: true` from the pages material so the biggest surface
  in frame gets the same fingerprint dents and hand-mixed color unevenness as every other
  clay surface in the game.
- **Page-stack edge.** Add a thin stack of offset page slabs at the fore-edge so the book
  has visible thickness instead of reading as a single printed rectangle.

### 4. Opening animation

- Cover swings to **~140°**, not ~169°, so it remains visible as a foreshortened slab
  beside the pages rather than lying flat behind the body.
- Replace the front-loaded cubic ease with a slower curve plus a small overshoot and
  settle, over roughly 500ms, still quantized to the 12fps stutter so it lands with
  stop-motion weight instead of snapping open in two frames.
- Closing runs the same curve in reverse, rather than today's instant `-1/7` per tick.

### 5. Chrome anchored to the book

Heading, progress line, close button and hint move out of `#journal-dialog` and into
`#journal-book-viewport`, positioned against the viewport's own edges. Because that
viewport holds a fixed `7.9 / 5.75` aspect, the chrome then stays glued to the book at
any window size instead of drifting over sky. Title and progress read as pressed into the
cover; the close button sits on the book's corner like a tab.

### 6. Hint behavior

- The hint starts **empty**. Its height is reserved so the layout does not jump when text
  arrives.
- `pointerleave` and `blur` handlers clear the hint, so it no longer stays pinned to the
  last-hovered moment after the cursor leaves.
- It keeps `aria-live="polite"` but must not announce on open.

### 7. Tray and tile affordances

- **Cooldown fill** clips to the power blob's own silhouette, so it reads as the clay
  refilling rather than a rectangle sweeping across a blob.
- **Disabled powers** get a drained, greyed clay treatment, so readiness is legible at a
  glance instead of only through the cursor.
- **Journal and Mute** get the same pressed-clay treatment as the power blobs, so the
  tray reads as one material rather than text pasted beside sculpture.
- **Tiles** lose `cursor: help` and the rectangular focus ring in favor of a treatment
  that fits an organic tile, and hover/focus actually presses the 3D clay tile — reusing
  the `pressed` geometry and pop-scale machinery `ClayBook` already has.

### 8. Backdrop

The normal path gets a soft scrim behind the open book, drawn from the toy's own ink and
paper palette rather than a generic black overlay, so the book clearly owns focus while
the island stays recognizable behind it.

## Verification

- `tsc`, the build, and all 125 existing tests stay green.
- The app is driven in a real browser and each fix confirmed by observation, not by
  inspection alone:
  - intro frames show no artifact at the tray position;
  - the cover visibly swings open over its full arc;
  - the book reads as clay (terminator, grain, contact shadow) rather than a flat slab;
  - the hint starts empty and clears when the pointer leaves a tile;
  - chrome stays glued to the book across window sizes and aspect ratios;
  - the tray is unfocusable during the intro.
- The `?lowfx=1` and `prefers-reduced-motion` paths still work: both bypass the 3D book
  for the flat DOM panel, and that fallback must not regress.

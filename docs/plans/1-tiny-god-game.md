# Tiny God Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-12-tiny-god-game-design.md`

**Goal:** A browser claymation god-game toy: a floating clay island with 6 villagers, three staged god powers (meteor / lightning / rain), a fire-spread system, and a discovery journal — all procedural, deployed as a static site.

**Architecture:** Vanilla Three.js + TypeScript, fixed-timestep sim loop with a 12fps quantized animation clock for the stop-motion look. All sim logic (FSM, fire spread, discovery matching, crater math, layout, interaction matrix) is pure TS with no Three.js imports, unit-tested with Vitest. Visual layers (materials, island mesh, FX, powers) consume the pure logic. A typed event bus connects powers → world → discovery.

**Tech Stack:** Vite, TypeScript (strict), three, postprocessing, Vitest. Zero asset files — geometry, textures, and audio are all generated in code.

**The three things this plan is really about**, in priority order — when a trade-off comes up, resolve it in this order:

1. **The idle scene must be beautiful before any power exists.** Milestone 1's exit test is "would a stranger screenshot this?". Powers cannot rescue a scene that isn't already worth looking at.
2. **The 12fps quantization is the single strongest claymation cue and it is nearly free.** Villagers and objects stutter; camera, particles, and post run smooth. That contrast *is* the look. Never smooth the villagers to make them feel "better".
3. **Reactions are the content.** The interaction matrix (Task 16) and the villagers coping (flee/mourn/rebuild) are why anyone stays past 30 seconds. The VFX are the hook; the reactions are the toy.

## Global Constraints

- TypeScript `strict: true`; ESM; Vite project layout (`src/`, `public/` stays empty).
- **No asset files**: no models, no image textures (canvas-generated textures OK), no audio files (WebAudio-synthesized SFX). Web fonts are *not* covered by this rule, but we ship none anyway — see Task 0.
- Villager FSM hard-capped at exactly 8 states: `wander, chopTree, buildHut, sitAtFire, flee, mourn, rebuild, fish`.
- Pure-logic modules (marked **(pure)** below) must not import `three`. They get unit tests. Visual modules are verified by running the app.
- Animation of villagers/objects/emotes quantized to 12fps via `QuantizedClock`; camera, particles, post run at display rate.
- One golden-hour grade; no day/night cycle. No pathfinding, no needs/economy.
- **Design tokens are the single source of truth for every color.** No hex literal appears outside `src/ui/tokens.ts` (Task 0). Tasks below quote token *names*; the hex values live in one file.
- **Accessibility floor** (non-negotiable, this scene shakes the screen and flashes white):
  - `prefers-reduced-motion: reduce` → no screen shake, no white flash (fade instead), no camera auto-rotate, no film grain animation. Powers still play; they just don't assault the vestibular system.
  - Every power is reachable by keyboard: tray buttons are real `<button>`s with visible focus; `Enter`/`Space` arms a power, then arrow keys move a reticle and `Enter` fires. Drag is the *primary* affordance, not the only one.
  - Journal is a focus-trapped dialog, `Esc` closes.
- Performance target: 60fps on a mid-range laptop.
  - `InstancedMesh` is used for **particles, droplets, stones, fruit, and flowers** — the many-identical-small-thing cases. Trees/huts/villagers are individual meshes (each needs its own one-time vertex wobble, which instancing forbids); at ~12 trees × 4 meshes + 3 huts + 6 villagers this is well under 100 draw calls and is fine.
  - One shadow map. `?lowfx=1` URL flag → no shadow map, no post stack, blob-shadow discs, DPR 1.
  - DPR capped at **1.5** (not 2) — a full post stack + 2048 VSM map at DPR 2 on a retina panel will not hold 60.
- Seedable RNG everywhere — no `Math.random()` outside `RNG`.
- Conventional commits after every task (`feat:`, `test:`, `chore:`).
- Dev server: `npm run dev`; tests: `npm test`. Visual verification steps say exactly what to look for.

## File Structure

```
index.html                     — canvas mount + #ui overlay root + loading splash
src/styles.css                 — token-driven CSS custom properties + UI styles
src/ui/tokens.ts       (pure)  — palette, type scale, timings — the ONLY place hexes live
src/main.ts                    — composition root: builds everything, starts loop
src/core/rng.ts        (pure)  — seedable RNG
src/core/noise.ts      (pure)  — hash noise, valueNoise2, fbm2
src/core/events.ts     (pure)  — GameEvent union, EventBus
src/core/loop.ts       (pure)  — GameLoop (fixed timestep), QuantizedClock
src/core/timeline.ts   (pure)  — Timeline (scheduled callbacks for power staging)
src/core/motion.ts     (pure)  — prefersReducedMotion() + motion-scaled helpers
src/fx/clayMaterial.ts         — toon ramp + clay shader patches
src/fx/wobble.ts               — one-time vertex wobble for hand-molded look
src/fx/particles.ts            — clay-blob particle bursts (instanced)
src/fx/shake.ts                — screen shake
src/fx/emotes.ts               — canvas-drawn emote sprite bubbles
src/fx/decals.ts               — scorch painting into island vertex colors
src/world/island.ts            — island mesh, sampleHeight, crater deform, scorch paint
src/world/craters.ts   (pure)  — crater depth math shared by mesh + walkers
src/world/scatter.ts   (pure)  — layout solver: non-overlapping placement of everything
src/world/fire.ts      (pure)  — FireSystem (spread/burn/douse logic)
src/world/objects.ts           — Tree, Hut, Campfire, Grave, Pond visual classes
src/world/world.ts             — World registry + spatial queries + resolveTarget
src/villagers/fsm.ts   (pure)  — decideNext(ctx) state selection
src/villagers/villager.ts      — entity: mesh, steering, activity execution, death
src/powers/power.ts            — Power base, PowerManager (cooldowns)
src/powers/meteor.ts           — meteor spectacle
src/powers/lightning.ts        — lightning spectacle
src/powers/rain.ts             — rain spectacle
src/powers/matrix.ts   (pure)  — power × target interaction table
src/powers/drag.ts             — drag-from-tray targeting controller (+ keyboard reticle)
src/discovery/moments.ts (pure)— Moment defs + Journal matching/count logic
src/ui/tray.ts                 — power tray DOM
src/ui/journal.ts              — clay-book journal + unlock toasts + localStorage
src/audio/sfx.ts               — WebAudio synth SFX + ambient, event-driven
src/scene.ts                   — renderer, camera rig, lights, sky, post stack
```

Milestone mapping — Tasks 0–8 = Week 1 (living island), Tasks 9–15 = Week 2 (powers), Tasks 16–19 = Week 3 (matrix, discovery, audio, ship).

---

### Task 0: Design direction — tokens, type, signature

**Files:**
- Create: `src/ui/tokens.ts`, `src/styles.css`

**Interfaces:**
- Produces: `PALETTE`, `TYPE`, `TIMING` consts imported by every visual and UI module. Every hex in this codebase comes from here.

**Design direction (decided here, executed everywhere else):**

The subject is *plasticine on a tabletop under a softbox* — Aardman, not Pixar. The whole page should feel like a photograph of a physical object someone made with their hands. That means:

- **The UI is not a game HUD.** It is the stuff sitting on the table *next to* the model: three lumps of clay in a tray, and a notebook. Nothing glows, nothing has a drop-shadow-blur, nothing is a rounded-rect card with a gradient border.
- **No Comic Sans.** It is the most default "playful" choice available and it says *1994 Windows*, not *handmade*. Personality lives in the **shapes** (lumpy, irregular, hand-cut) and in the **motion** (12fps stutter), not in a novelty typeface. Body/UI type is a plain, quiet grotesque — `system-ui` — set small, in sentence case, with generous letter-spacing on labels. The one expressive type moment is the journal's Moment titles, set in a heavy condensed face at a slight rotation, like a label written on masking tape and stuck to the model.
- **Signature element:** the **journal is a clay book, in 3D, not a DOM panel.** Clicking the notebook on the tray tilts the camera down to a hardback clay book lying beside the island; it opens with a 12fps page-turn. Each of the 12 Moments is a **pressed thumbprint tile** — a blank dimpled slab until you discover it, then it takes on the Moment's color and title. Locked tiles are not greyed-out text; they are *unpressed clay*. This is the one bold thing. Everything else — tray, toasts, mute — stays quiet and small.

- [ ] **Step 1: Tokens** — `src/ui/tokens.ts` (pure; no `three` import — colors are strings):

```ts
// The ONLY place hex values live. Three.js consumes these strings directly;
// styles.css mirrors them as custom properties (keep the two in sync by hand —
// there are ~12 of them and a build step would be more machinery than it saves).
export const PALETTE = {
  // island
  grassLight:  '#a7c957',
  grassDark:   '#7fb069',
  dirt:        '#9c6644',
  rock:        '#7f5539',
  scorch:      '#3d3436',
  // objects
  bark:        '#8a5a44',
  leafA:       '#6a994e',
  leafB:       '#588157',
  hutClay:     '#d4a373',
  stone:       '#8d8078',
  // life & fire
  skin:        '#e8b087',
  smockA:      '#c96f4a',   // terracotta
  smockB:      '#6d9dc5',
  smockC:      '#e0c341',
  flame:       '#ff8c42',
  ember:       '#ffd166',
  water:       '#6d9dc5',
  bloom:       '#e56b9f',
  ghost:       '#e8ecf1',
  cloud:       '#fffaf2',   // clay white — never pure #fff; nothing in clay is pure white
  // sky & light
  skyLow:      '#ffd9a0',
  skyHigh:     '#aee1f5',
  keyLight:    '#ffe3c0',
  fillSky:     '#bcd7ff',
  fillGround:  '#e8b087',
  // ui
  paper:       '#e8d5b7',   // clay-cream, the tray + book surface
  ink:         '#3d3436',
  inkSoft:     '#6f645f',
} as const

export const TYPE = {
  ui:      "system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "'Archivo Black', 'Helvetica Neue', Impact, sans-serif", // system-resident fallbacks; no web font shipped
  uiSize:  '13px',
  uiTrack: '0.08em',
} as const

// Stop-motion is 12fps; UI transitions are NOT — the UI is real-world objects,
// they move smoothly. Only the model stutters.
export const TIMING = {
  fps: 12,
  uiFast: 140,
  uiSlow: 320,
} as const
```

- [ ] **Step 2: Base styles** — `src/styles.css`:

```css
:root {
  --paper: #e8d5b7;
  --ink: #3d3436;
  --ink-soft: #6f645f;
  --terracotta: #c96f4a;
  --ui-font: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --ui-size: 13px;
  --ui-track: 0.08em;
}
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--paper); }
body { font-family: var(--ui-font); font-size: var(--ui-size); color: var(--ink); }
#app canvas { display: block; }
#ui { position: fixed; inset: 0; pointer-events: none; }
#ui > * { pointer-events: auto; }

/* Focus is visible and unmistakable — a hand-drawn ring, not a browser default. */
:focus-visible { outline: 3px solid var(--terracotta); outline-offset: 3px; border-radius: 2px; }

/* Loading splash — clay-cream, fades out on first rendered frame. No spinner:
   a spinner is a web-app tell. Just the word, and it lifts away. */
#splash {
  position: fixed; inset: 0; display: grid; place-items: center;
  background: var(--paper); z-index: 10; transition: opacity 600ms ease;
  letter-spacing: var(--ui-track); text-transform: lowercase; color: var(--ink-soft);
}
#splash.gone { opacity: 0; pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 3: Verify** — No visual output yet; this task exists so no later task invents a color. Confirm `npx tsc --noEmit` passes once Task 1 has scaffolded `tsconfig.json` (run this step's check at the end of Task 1 if scaffolding hasn't happened yet).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: design tokens and base styles"`

---

### Task 1: Project scaffold + blank sky + loading splash

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/core/motion.ts`, `.gitignore`

**Interfaces:**
- Produces: running Vite dev server; `#app` canvas mount; `#ui` DOM overlay root used by Tasks 9/17; `#splash` that fades on first frame; `prefersReducedMotion(): boolean`; WebGL failure fallback.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/hungnguyen/Developer/tiny-god-game
npm create vite@latest . -- --template vanilla-ts   # keep existing files if prompted
npm i three postprocessing
npm i -D vitest @types/three
rm -rf src/counter.ts src/style.css src/typescript.svg public/vite.svg
```

Add to `package.json` scripts: `"test": "vitest run"`. In `tsconfig.json` ensure `"strict": true`.

Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any)
```

- [ ] **Step 2: Motion preference** — `src/core/motion.ts` (pure):

```ts
// Read live, not cached — the user can flip the OS setting mid-session.
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches
}
```

- [ ] **Step 3: index.html** — links `src/styles.css` from Task 0; splash is real content, not a spinner:

```html
<link rel="stylesheet" href="/src/styles.css" />
<div id="app"></div>
<div id="ui"></div>
<div id="splash">molding clay…</div>
<noscript>This toy needs JavaScript.</noscript>
<script type="module" src="/src/main.ts"></script>
```

- [ ] **Step 4: main.ts with WebGL fallback**

```ts
import * as THREE from 'three'
import { PALETTE } from './ui/tokens'

const splash = document.getElementById('splash')!

let renderer: THREE.WebGLRenderer
try {
  renderer = new THREE.WebGLRenderer({ antialias: true })
} catch {
  splash.textContent = 'This toy needs WebGL, and this browser does not have it.'
  throw new Error('no webgl')
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
// VSM must be set before any material compiles (Task 5 turns shadows on).
renderer.shadowMap.type = THREE.VSMShadowMap
document.getElementById('app')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(PALETTE.skyLow)
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 200)
camera.position.set(0, 14, 34)
camera.lookAt(0, 0, 0)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

let first = true
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera)
  if (first) { first = false; splash.classList.add('gone') }  // fade only after a real frame
})
```

- [ ] **Step 5: Verify** — `npm run dev`. Expected: "molding clay…" on cream for a beat, then it fades to a full-window warm peach background. No console errors, no flash of white. `npm run build` compiles clean.

- [ ] **Step 6: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold vite + three + vitest, splash and webgl fallback"
```

---

### Task 2: Core — RNG, noise, events, loop, timeline (pure, TDD)

**Files:**
- Create: `src/core/rng.ts`, `src/core/noise.ts`, `src/core/events.ts`, `src/core/loop.ts`, `src/core/timeline.ts`
- Test: `src/core/core.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `class RNG { constructor(seed?: number); next(): number; range(min, max): number; int(min, max): number; pick<T>(a: T[]): T; chance(p: number): boolean }`
  - `valueNoise2(x, y): number` (in [-1,1]), `fbm2(x, y, octaves?): number`
  - `type PowerId = 'meteor' | 'lightning' | 'rain'`
  - `type TargetKind = 'ground' | 'tree' | 'hut' | 'villager' | 'pond' | 'crater' | 'campfire'`
  - `type GameEvent` — union listed below; `class EventBus { on(h: (e: GameEvent) => void): () => void; emit(e: GameEvent): void }`
  - `class GameLoop { constructor(onSim: (dt: number) => void, onRender: (dt: number) => void, simDt?: number); start(): void; stop(): void }`
  - `class QuantizedClock { constructor(fps?: number); advance(dt: number): void; readonly ticked: boolean; readonly quantizedTime: number }`
  - `class Timeline { at(t: number, fn: () => void): this; update(dt: number): void; readonly done: boolean }`

- [ ] **Step 1: Write failing tests** — `src/core/core.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { RNG } from './rng'
import { valueNoise2 } from './noise'
import { EventBus, type GameEvent } from './events'
import { QuantizedClock } from './loop'
import { Timeline } from './timeline'

describe('RNG', () => {
  it('is deterministic per seed', () => {
    const a = new RNG(42), b = new RNG(42)
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()])
  })
  it('range stays in bounds', () => {
    const r = new RNG(1)
    for (let i = 0; i < 100; i++) { const v = r.range(2, 5); expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThan(5) }
  })
})

describe('noise', () => {
  it('is deterministic and bounded', () => {
    expect(valueNoise2(1.5, 2.5)).toBe(valueNoise2(1.5, 2.5))
    for (let i = 0; i < 100; i++) {
      const v = valueNoise2(i * 0.37, i * 0.91)
      expect(Math.abs(v)).toBeLessThanOrEqual(1)
    }
  })
})

describe('EventBus', () => {
  it('emits to handlers and unsubscribes', () => {
    const bus = new EventBus(); const seen: GameEvent[] = []
    const off = bus.on(e => seen.push(e))
    bus.emit({ type: 'pond:created', x: 0, z: 0 })
    off()
    bus.emit({ type: 'pond:created', x: 0, z: 0 })
    expect(seen).toHaveLength(1)
  })
  it('survives a handler unsubscribing during emit', () => {
    const bus = new EventBus(); let n = 0
    const off = bus.on(() => { n++; off() })   // the [...handlers] copy is why this is safe
    bus.emit({ type: 'pond:emptied' })
    bus.emit({ type: 'pond:emptied' })
    expect(n).toBe(1)
  })
})

describe('QuantizedClock', () => {
  it('ticks on the very first advance', () => {
    const c = new QuantizedClock(12)
    c.advance(1 / 60)
    expect(c.ticked).toBe(true)   // frame 0 is a real frame — something must pop on it
  })
  it('ticks at the quantized rate only', () => {
    const c = new QuantizedClock(12)
    c.advance(1 / 60)             // frame 0
    c.advance(1 / 60); expect(c.ticked).toBe(false)
    c.advance(4 / 60); expect(c.ticked).toBe(true)
    expect(c.quantizedTime).toBeCloseTo(1 / 12)
  })
})

describe('Timeline', () => {
  it('fires callbacks in windows, reports done', () => {
    const hits: number[] = []
    const t = new Timeline().at(0.1, () => hits.push(1)).at(0.3, () => hits.push(2))
    expect(t.done).toBe(false)                                   // not done before it runs
    t.update(0.2); expect(hits).toEqual([1]); expect(t.done).toBe(false)
    t.update(0.2); expect(hits).toEqual([1, 2]); expect(t.done).toBe(true)
  })
  it('fires a t=0 callback on the first update', () => {
    const hits: number[] = []
    const t = new Timeline().at(0, () => hits.push(0))
    t.update(1 / 60)
    expect(hits).toEqual([0])
  })
  it('fires each callback exactly once', () => {
    let n = 0
    const t = new Timeline().at(0.1, () => n++)
    t.update(1); t.update(1)
    expect(n).toBe(1)
  })
  it('an empty timeline is never done', () => {
    expect(new Timeline().done).toBe(false)   // guards against `[].every() === true`
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/core/rng.ts`:

```ts
export class RNG {
  private s: number
  constructor(seed = 1) { this.s = seed >>> 0 }
  next(): number {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(min: number, max: number): number { return min + (max - min) * this.next() }
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)) }
  pick<T>(a: T[]): T { return a[Math.floor(this.next() * a.length)] }
  chance(p: number): boolean { return this.next() < p }
}
```

`src/core/noise.ts`:

```ts
// NOTE: hash2 takes INTEGER lattice coords only. Math.imul coerces via ToInt32,
// so hash2(1.5, y) === hash2(1.9, y). Only valueNoise2 may call it, and it always
// passes Math.floor'd values. Do not call hash2 directly from anywhere else.
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** Returns [-1, 1). */
export function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi), b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}
/** Sum of octaves; bounded by the amp series (~[-1, 1) as octaves → ∞, tighter for few). */
export function fbm2(x: number, y: number, octaves = 3): number {
  let sum = 0, amp = 0.5, f = 1
  for (let i = 0; i < octaves; i++) { sum += valueNoise2(x * f, y * f) * amp; amp *= 0.5; f *= 2 }
  return sum
}
```

`src/core/events.ts`:

```ts
export type PowerId = 'meteor' | 'lightning' | 'rain'
export type TargetKind = 'ground' | 'tree' | 'hut' | 'villager' | 'pond' | 'crater' | 'campfire'

// Events carrying `x`/`z` do so because the discovery system (Task 17) needs to
// correlate them in SPACE, not just in time — e.g. "Watering Hole" = a pond created
// where a crater was created. `burning` counts ride along for the "Wildfire" (5+ at
// once) and "Firefighter" (doused while 3+ burning) Moments. Add the field when a
// Moment needs it; don't speculatively attach data to every event.
export type GameEvent =
  | { type: 'power:anticipate'; power: PowerId; x: number; z: number }
  | { type: 'power:impact'; power: PowerId; target: TargetKind; x: number; z: number }
  | { type: 'fire:ignited'; kind: 'tree' | 'hut' | 'campfire'; bySpread: boolean; burning: number }
  | { type: 'fire:doused'; byRain: boolean; burning: number }
  | { type: 'burnt'; kind: 'tree' | 'hut' }
  | { type: 'villager:died'; cause: 'meteor' | 'lightning' }
  | { type: 'villager:mourned' }
  | { type: 'villager:fished' }
  | { type: 'hut:rebuilt' }
  | { type: 'crater:created'; x: number; z: number }
  | { type: 'pond:created'; x: number; z: number }
  | { type: 'pond:emptied' }
  | { type: 'fish:floated' }
  | { type: 'flower:bloomed' }
  | { type: 'fruit:grown'; treeId: string }   // "Full Harvest" = 4+ DISTINCT trees
  | { type: 'campfire:flared' }

export class EventBus {
  private handlers = new Set<(e: GameEvent) => void>()
  on(h: (e: GameEvent) => void): () => void { this.handlers.add(h); return () => { this.handlers.delete(h) } }
  emit(e: GameEvent): void { for (const h of [...this.handlers]) h(e) }
}
```

`src/core/loop.ts`:

```ts
export class GameLoop {
  private acc = 0; private last = 0; private raf = 0; private running = false
  constructor(
    private onSim: (dt: number) => void,
    private onRender: (dt: number) => void,
    private simDt = 1 / 30,
  ) {}
  start(): void {
    this.running = true; this.last = performance.now()
    const frame = (now: number) => {
      if (!this.running) return
      const dt = Math.min((now - this.last) / 1000, 0.1)
      this.last = now; this.acc += dt
      while (this.acc >= this.simDt) { this.onSim(this.simDt); this.acc -= this.simDt }
      this.onRender(dt)
      this.raf = requestAnimationFrame(frame)
    }
    this.raf = requestAnimationFrame(frame)
  }
  stop(): void { this.running = false; cancelAnimationFrame(this.raf) }
}

export class QuantizedClock {
  private time = 0
  private frame = -1        // -1 so the first advance() lands on frame 0 and ticks
  ticked = false
  constructor(private fps = 12) {}
  advance(dt: number): void {
    this.time += dt
    const f = Math.floor(this.time * this.fps)
    this.ticked = f !== this.frame
    this.frame = f
  }
  get quantizedTime(): number { return Math.max(this.frame, 0) / this.fps }
}
```

`src/core/timeline.ts`:

```ts
// Fires each callback exactly once, on the first update at or past its time.
// A fired-flag (rather than a prev < t <= now window) is what makes `at(0, …)`
// work and makes `done` mean "everything actually ran", not "the clock passed them".
export class Timeline {
  private events: { t: number; fn: () => void; fired: boolean }[] = []
  private t = 0
  at(t: number, fn: () => void): this { this.events.push({ t, fn, fired: false }); return this }
  update(dt: number): void {
    this.t += dt
    for (const e of this.events) {
      if (!e.fired && this.t >= e.t) { e.fired = true; e.fn() }
    }
  }
  get done(): boolean { return this.events.length > 0 && this.events.every(e => e.fired) }
}
```

- [ ] **Step 4: Run tests** — `npm test` → all PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: core rng/noise/events/loop/timeline with tests"`

---

### Task 3: Clay material + vertex wobble

**Files:**
- Create: `src/fx/clayMaterial.ts`, `src/fx/wobble.ts`
- Modify: `src/main.ts` (temporary test blobs)

**Interfaces:**
- Produces:
  - `clayMaterial(color: THREE.ColorRepresentation, opts?: { flat?: boolean }): THREE.MeshToonMaterial` — toon ramp + fingerprint normal noise + hue unevenness. `flat: true` skips the normal noise (used for tiny meshes like eyes/emotes).
  - `wobble(geo: THREE.BufferGeometry, rng: RNG, amount?: number): THREE.BufferGeometry` — displaces vertices along normals with low-frequency noise; returns same geometry.

- [ ] **Step 1: Implement wobble** — `src/fx/wobble.ts`:

```ts
import * as THREE from 'three'
import { RNG } from '../core/rng'
import { fbm2 } from '../core/noise'

export function wobble(geo: THREE.BufferGeometry, rng: RNG, amount = 0.06): THREE.BufferGeometry {
  geo.computeVertexNormals()
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute
  const ox = rng.range(0, 100), oy = rng.range(0, 100), oz = rng.range(0, 100)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    // Two decorrelated 2D samples ≈ 3D noise. Do NOT fold axes together
    // (e.g. fbm2(x, y + z)): that makes every vertex on a y+z diagonal displace
    // identically and ridges the sphere along a visible seam.
    const n = (fbm2(x * 1.7 + ox, z * 1.7 + oz, 2)
             + fbm2(y * 1.7 + oy, x * 1.3 + oz, 2)) * 0.5 * amount
    pos.setXYZ(i, x + nrm.getX(i) * n, y + nrm.getY(i) * n, z + nrm.getZ(i) * n)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}
```

(Noise is position-based, so shared vertices displace identically — no cracks on indexed geometry.)

- [ ] **Step 2: Implement clay material** — `src/fx/clayMaterial.ts`:

```ts
import * as THREE from 'three'

let ramp: THREE.Texture | null = null
function toonRamp(): THREE.Texture {
  if (ramp) return ramp
  const c = document.createElement('canvas'); c.width = 128; c.height = 1
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 128, 0)
  // 3 bands with soft transitions — the "lit plasticine" ramp
  grad.addColorStop(0.0, '#555'); grad.addColorStop(0.28, '#555')
  grad.addColorStop(0.38, '#999'); grad.addColorStop(0.62, '#999')
  grad.addColorStop(0.72, '#fff'); grad.addColorStop(1.0, '#fff')
  g.fillStyle = grad; g.fillRect(0, 0, 128, 1)
  ramp = new THREE.CanvasTexture(c)
  ramp.colorSpace = THREE.NoColorSpace
  // LinearFilter (not Nearest) is deliberate: we want the SOFT band transitions
  // baked into the gradient above, not hard cel edges. ClampToEdge is required —
  // without it the ramp wraps and the terminator gets a bright fringe.
  ramp.minFilter = ramp.magFilter = THREE.LinearFilter
  ramp.wrapS = ramp.wrapT = THREE.ClampToEdgeWrapping
  ramp.generateMipmaps = false
  return ramp
}

export function clayMaterial(color: THREE.ColorRepresentation, opts: { flat?: boolean } = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() })
  if (!opts.flat) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vClayPos;')
        // World-ish position, so InstancedMesh instances each get their own clay
        // grain and hue instead of all sharing the local-space one.
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vClayPos = (instanceMatrix * vec4(position, 1.0)).xyz;
#else
  vClayPos = position;
#endif`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vClayPos;
float clayHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
        // MeshToonMaterial has NO <normal_fragment_maps> chunk — patching it is a
        // silent no-op. <normal_fragment_begin> is the one that defines `normal`.
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
// fingerprint-scale dents: perturb the normal with high-frequency hash noise
vec3 dent = vec3(
  clayHash(floor(vClayPos * 40.0)),
  clayHash(floor(vClayPos * 40.0 + 13.0)),
  clayHash(floor(vClayPos * 40.0 + 47.0))) - 0.5;
normal = normalize(normal + dent * 0.18);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
// hand-mixed clay: subtle low-frequency color unevenness
float tint = clayHash(floor(vClayPos * 3.0)) * 0.08 - 0.04;
diffuseColor.rgb *= 1.0 + tint;`)
    }
    // Without this, three caches the compiled program by material *type* and the
    // flat and non-flat variants collide — whichever compiles first wins for both.
    mat.customProgramCacheKey = () => 'clay'
  } else {
    mat.customProgramCacheKey = () => 'clay-flat'
  }
  return mat
}
```

- [ ] **Step 3: Test scene** — In `src/main.ts`, add temporary blobs (removed in Task 4):

```ts
import { clayMaterial } from './fx/clayMaterial'
import { wobble } from './fx/wobble'
import { RNG } from './core/rng'
import { PALETTE } from './ui/tokens'

const rng = new RNG(7)
const colors = [PALETTE.smockA, PALETTE.grassDark, PALETTE.smockC, PALETTE.smockB, PALETTE.hutClay]
for (let i = 0; i < 5; i++) {
  const geo = wobble(new THREE.SphereGeometry(1.4, 32, 24), rng, 0.1)
  const m = new THREE.Mesh(geo, clayMaterial(colors[i]))
  m.position.set((i - 2) * 3.4, 0, 0)
  scene.add(m)
}
scene.add(new THREE.DirectionalLight(PALETTE.keyLight, 2.5).translateX(5).translateY(8).translateZ(4))
scene.add(new THREE.AmbientLight(PALETTE.fillSky, 0.9))
```

- [ ] **Step 4: Verify visually** — `npm run dev`. Expected: 5 lumpy spheres, each a slightly different irregular shape, with visible soft 3-band shading, grainy fingerprint-scale surface, and slight patchy color unevenness. They should read as "plasticine", not "plastic". Check the spheres for a **diagonal ridge seam** — if you see one, the wobble noise is folding axes together (see the comment in `wobble.ts`). Tune `0.18` (dent strength) and `0.08` (tint) only if it reads wrong.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: clay toon material and vertex wobble"`

---

### Task 4: Island, sky, clouds, camera rig

**Files:**
- Create: `src/world/island.ts`, `src/world/craters.ts`, `src/scene.ts`
- Test: `src/world/craters.test.ts`
- Modify: `src/main.ts` (use scene.ts; delete test blobs)

**Interfaces:**
- Produces:
  - `const ISLAND_RADIUS = 15`, `const WALK_RADIUS = 12`
  - `islandSurfaceY(x: number, z: number): number` — pure formula for undeformed terrain height
  - `type Crater = { x: number; z: number; radius: number; depth: number }`
  - `craterOffset(x, z, craters: Crater[]): number` **(pure)** — total downward displacement at a point
  - `class Island { group; topMesh; craters: Crater[]; sampleHeight(x, z): number; addCrater(c: Crater): void; scorch(x, z, r): void }` — `addCrater`/`scorch` land in Task 10, but **`craters` and the crater-aware `sampleHeight` exist from now**.
  - `createScene(): { scene, camera, renderer, controls, floaters, updateSky(dt) }` from `src/scene.ts` — camera rig with orbit limits + idle drift.

> **Why craters are wired in now, not in Task 10:** `sampleHeight` is what villagers, trees, huts and particles all stand on. If it ignores craters, then the moment Task 10 lands, every villager walks through the air across a crater floor and every object hovers. Ship the crater-aware version from the start with an empty `craters` array — it costs nothing and it is a genuinely nasty bug to retrofit.

- [ ] **Step 1: Crater math (pure, TDD)** — `src/world/craters.ts`:

```ts
export type Crater = { x: number; z: number; radius: number; depth: number }

/** Downward displacement at (x,z) from all craters. Always >= 0. */
export function craterOffset(x: number, z: number, craters: Crater[]): number {
  let d = 0
  for (const c of craters) {
    const t = Math.hypot(x - c.x, z - c.z) / c.radius
    if (t >= 1) continue
    // Smooth bowl: 1 at centre, 0 at rim, with a slight raised lip just inside.
    const bowl = Math.cos(t * Math.PI * 0.5) ** 2
    d += c.depth * bowl
  }
  return d
}

/** True if the point is inside any crater's rim — used by resolveTarget + pond fill. */
export function craterAt(x: number, z: number, craters: Crater[]): Crater | null {
  for (const c of craters) if (Math.hypot(x - c.x, z - c.z) < c.radius) return c
  return null
}
```

`src/world/craters.test.ts` — write these first, watch them fail:

```ts
import { describe, it, expect } from 'vitest'
import { craterOffset, craterAt, type Crater } from './craters'

const c: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]

describe('craterOffset', () => {
  it('is deepest at the centre', () => expect(craterOffset(0, 0, c)).toBeCloseTo(1.5))
  it('is zero at and beyond the rim', () => {
    expect(craterOffset(3, 0, c)).toBeCloseTo(0)
    expect(craterOffset(9, 0, c)).toBe(0)
  })
  it('is never negative and never lifts terrain', () => {
    for (let i = 0; i < 50; i++) expect(craterOffset(i * 0.2 - 5, 0, c)).toBeGreaterThanOrEqual(0)
  })
  it('accumulates across overlapping craters', () => {
    const two: Crater[] = [...c, { x: 1, z: 0, radius: 3, depth: 1.5 }]
    expect(craterOffset(0.5, 0, two)).toBeGreaterThan(craterOffset(0.5, 0, c))
  })
  it('is zero with no craters', () => expect(craterOffset(0, 0, [])).toBe(0))
})

describe('craterAt', () => {
  it('finds the crater containing a point', () => expect(craterAt(1, 1, c)).toBe(c[0]))
  it('returns null outside', () => expect(craterAt(5, 5, c)).toBeNull())
})
```

- [ ] **Step 2: Island geometry** — `src/world/island.ts`:

```ts
import * as THREE from 'three'
import { fbm2 } from '../core/noise'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { PALETTE } from '../ui/tokens'
import { craterOffset, type Crater } from './craters'

export const ISLAND_RADIUS = 15
export const WALK_RADIUS = 12

export function islandSurfaceY(x: number, z: number): number {
  const r = Math.hypot(x, z)
  if (r >= ISLAND_RADIUS) return 0
  const t = r / ISLAND_RADIUS
  const dome = (1 - t * t) * 2.0
  const bumps = fbm2(x * 0.14 + 7, z * 0.14 + 3) * 0.9 * (1 - t * 0.6)
  return dome + bumps
}

const GRASS_A = new THREE.Color(PALETTE.grassDark)
const GRASS_B = new THREE.Color(PALETTE.grassLight)
const DIRT = new THREE.Color(PALETTE.dirt)

export class Island {
  group = new THREE.Group()
  topMesh: THREE.Mesh
  craters: Crater[] = []
  /** Per-vertex scorch amount 0..1, painted in Task 10, mixed into vertex colors. */
  private scorchAmt: Float32Array
  private baseColors: Float32Array
  private rings = 40
  private segs = 80

  constructor(_rng: RNG) {
    // --- top: radial grid displaced by islandSurfaceY, vertex-colored grass
    const { rings, segs } = this
    const positions: number[] = [], colors: number[] = [], index: number[] = []
    for (let i = 0; i <= rings; i++) {
      const r = (i / rings) * ISLAND_RADIUS
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2
        const x = Math.cos(a) * r, z = Math.sin(a) * r
        positions.push(x, islandSurfaceY(x, z), z)
        const patch = (fbm2(x * 0.3, z * 0.3) + 1) / 2
        const c = GRASS_A.clone().lerp(GRASS_B, patch)
        if (r > ISLAND_RADIUS - 1.2) c.lerp(DIRT, (r - (ISLAND_RADIUS - 1.2)) / 1.2)
        colors.push(c.r, c.g, c.b)
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + segs + 1
      index.push(a, b, a + 1, b, b + 1, a + 1)
    }
    const topGeo = new THREE.BufferGeometry()
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    topGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    topGeo.setIndex(index)
    topGeo.computeVertexNormals()
    // White base so the per-vertex grass colors come through unmodulated.
    const topMat = clayMaterial('#ffffff'); topMat.vertexColors = true
    this.topMesh = new THREE.Mesh(topGeo, topMat)
    this.topMesh.receiveShadow = true
    this.group.add(this.topMesh)

    this.baseColors = Float32Array.from(colors)
    this.scorchAmt = new Float32Array(positions.length / 3)

    // --- underside: lathe cone with chunky noise, rock colored
    const profile: THREE.Vector2[] = []
    const depth = 10
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      const r = ISLAND_RADIUS * (1 - t * t * 0.98) * (1 + fbm2(t * 5, 3.7) * 0.15)
      profile.push(new THREE.Vector2(Math.max(r, 0.01), -t * depth))
    }
    const underGeo = new THREE.LatheGeometry(profile, 48)
    const under = new THREE.Mesh(underGeo, clayMaterial(PALETTE.rock))
    under.castShadow = false
    this.group.add(under)
  }

  /** The one true ground height. Everything that stands on the island calls this. */
  sampleHeight(x: number, z: number): number {
    return islandSurfaceY(x, z) - craterOffset(x, z, this.craters)
  }

  // addCrater() and scorch() are implemented in Task 10; they push to `craters`,
  // rewrite the position/color attributes, and recompute normals.
}
```

- [ ] **Step 3: Run crater tests** — `npm test` → all PASS.

- [ ] **Step 4: Scene module** — `src/scene.ts`: move renderer/camera setup from main.ts, add:
  - `scene.background` = vertical gradient CanvasTexture (`PALETTE.skyLow` horizon → `PALETTE.skyHigh` top, 2×256 canvas).
  - OrbitControls (`three/addons/controls/OrbitControls.js`): `enablePan = false`, `minDistance 18`, `maxDistance 55`, `minPolarAngle 0.6`, `maxPolarAngle 1.35`, `enableDamping = true`, `autoRotate = true`, `autoRotateSpeed = 0.35`. Any pointer interaction pauses autoRotate for 8 s then resumes (track `lastInteraction` timestamp in `updateSky`).
  - **Reduced motion:** `autoRotate = !prefersReducedMotion()`. The island bob and cloud drift also go to zero. The user can still orbit by hand — we remove *ambient, unrequested* motion, not agency.
  - Clouds: 6 clusters of 3–5 wobbled spheres (`clayMaterial(PALETTE.cloud, {flat:true})`) at radius 22–35, y 3–8; `updateSky(dt)` rotates the cloud group slowly (`0.01 rad/s`) and drifts each cloud on a sine bob.
  - Island floats: whole `island.group` gets `position.y = Math.sin(t * 0.15) * 0.3` inside `updateSky` via a `floaters: THREE.Object3D[]` array on the scene bundle.

`createScene()` returns `{ scene, camera, renderer, controls, floaters, updateSky }`.

- [ ] **Step 5: Wire main.ts** — Remove test blobs. Compose: `createScene()`, `new Island(rng)` added to scene + `floaters`, temporary lights from Task 3 kept for now, `GameLoop` with `onRender` calling `controls.update()`, `updateSky(dt)`, render.

- [ ] **Step 6: Verify visually** — Expected: a lumpy green clay island with dirt-fringed edge and a rocky cone below, floating and gently bobbing in a peach-to-blue gradient sky with puffy drifting clouds; camera slowly orbits; drag to orbit works and auto-rotate resumes ~8 s after release. No z-fighting, no seams at the island rim. With OS "reduce motion" on: island is still, clouds are still, no auto-orbit — but dragging still works.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: procedural island with crater-aware height, sky, clouds, camera rig"`

---

### Task 5: Golden-hour lighting + post stack

**Files:**
- Modify: `src/scene.ts`, `src/main.ts`

**Interfaces:**
- Produces: `createScene()` additionally returns `{ composer, lowFx: boolean }`; render loop calls `composer.render()` instead of `renderer.render()`. `lowFx` is true when URL has `?lowfx=1` — later tasks check it for blob shadows.

- [ ] **Step 1: Lights** — In `scene.ts`:

```ts
import { PALETTE } from './ui/tokens'

const key = new THREE.DirectionalLight(PALETTE.keyLight, 3.2)
key.position.set(18, 24, 10)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.radius = 7           // soft edges (VSM). Start at 7; see Step 5.
key.shadow.blurSamples = 16
key.shadow.camera.left = -18; key.shadow.camera.right = 18
key.shadow.camera.top = 18; key.shadow.camera.bottom = -18
// VSM does NOT use `bias` — it compares variance, not depth. A negative bias here
// does nothing useful and can cause light leaking. Leave it at 0 and tune `radius`.
key.shadow.bias = 0
renderer.shadowMap.enabled = true
// NOTE: renderer.shadowMap.type is set in main.ts BEFORE any material compiles.
// Changing it after a material has compiled silently does nothing.
const fill = new THREE.HemisphereLight(PALETTE.fillSky, PALETTE.fillGround, 1.1)
scene.add(key, fill)
```

`lowFx` (from `new URLSearchParams(location.search).get('lowfx')`): when true, `renderer.shadowMap.enabled = false` and DPR drops to 1 (Task 6 adds blob shadow discs under objects when `lowFx`).

- [ ] **Step 2: Post stack**

```ts
import { EffectComposer, RenderPass, EffectPass, TiltShiftEffect, VignetteEffect, NoiseEffect, BlendFunction, HueSaturationEffect } from 'postprocessing'
import { prefersReducedMotion } from './core/motion'

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
// TiltShiftEffect is a screen-space band blur, NOT depth-based. For a floating
// island seen from a constrained orbit these are visually equivalent and this one
// is far cheaper — deliberate deviation from the spec's "depth-based tilt-shift".
const tilt = new TiltShiftEffect({ focusArea: 0.45, feather: 0.35 })
const vignette = new VignetteEffect({ darkness: 0.55, offset: 0.3 })
const grain = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT })
grain.blendMode.opacity.value = 0.18
const grade = new HueSaturationEffect({ saturation: 0.12 })
composer.addPass(new EffectPass(camera, tilt, vignette, grain, grade))
```

**Grain must stutter with the model, not the display.** `NoiseEffect` reseeds every frame, so at 60fps it reads as digital video noise — the exact opposite of film. Freeze it to the 12fps clock: hold the effect's noise seed and only advance it on `clock.ticked`. If `postprocessing`'s `NoiseEffect` exposes no seed uniform in the installed version, subclass it with a `uniform float seed` and a `mod` on the hash input. Under `prefers-reduced-motion`, set `grain.blendMode.opacity.value = 0.06` and stop animating it entirely (static grain, no flicker).

Handle resize: `composer.setSize(innerWidth, innerHeight)`. When `lowFx`, skip the EffectPass entirely (plain RenderPass only).

- [ ] **Step 3: Enable shadows on island** — `island.topMesh.receiveShadow = true` (already), clouds `castShadow = true` for drifting cloud shadows on the grass (cheap drama), lathe underside `castShadow = false`.

- [ ] **Step 4: Verify visually** — Expected: warm key light with visibly **soft** shadow edges; top/bottom of frame gently blurred (tilt-shift miniature feel); grain visible on flat areas and **stuttering at 12fps, not shimmering at 60**; corners darkened; colors slightly richer. Cloud shadows drift across the grass. `?lowfx=1` loads with no shadows/post and still looks acceptable. FPS ≥ 55 in devtools performance overlay.

- [ ] **Step 5: Shadow sanity check** — The 36×36 ortho box over a 2048 map is ~57 texels/unit; a villager is ~0.8 units, so at `radius: 7` a villager's shadow will blur into a featureless puddle. Look at a villager (Task 7) or a tree now: if its shadow has no readable shape, drop `radius` to 3–4. Soft is the goal; *gone* is not.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: golden-hour lighting, soft shadows, tilt-shift post stack"`

---

### Task 6: World objects — trees, huts, campfire + World registry

**Files:**
- Create: `src/world/objects.ts`, `src/world/world.ts`, `src/world/scatter.ts` **(pure)**
- Test: `src/world/scatter.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces (consumed by villagers, powers, fire):
  - `class Tree { id: string; x: number; z: number; state: 'normal'|'chopped'|'burning'|'burnt'; group: THREE.Group; chop(): void; ignite(): void; extinguish(): void; setBurnt(): void; growFruit(): void; update(dt: number, qt: number): void }` — chopped/burnt shrink the crown and regrow over 120 s back to `normal`.
  - `class Hut { id, x, z; state: 'site'|'building'|'built'|'burning'|'ruin'; progress: number; group; buildTick(): void  // +0.34, at ≥1 becomes built; ignite(); extinguish(); setRuin(); update(dt, qt) }` — built hut shows smoke curl (3 small grey blobs rising at 12fps).
  - `class Campfire { x, z; group; flare(): void; douse(): void; lit: boolean; update(dt, qt) }`
  - `class World { trees: Tree[]; huts: Hut[]; campfire: Campfire; graves: Grave[]; ponds: Pond[]; villagers: Villager[]  // typed as unknown[] until Task 7, then retyped
      choppableTree(): Tree | null; buildSite(): Hut | null; nearestBurning(x, z, radius): {x,z} | null; resolveTarget(x, z): TargetKind; objectsNear(x, z, r): Array<Tree|Hut|Campfire> }` (`Grave`/`Pond` classes are added in Tasks 15/14; declare empty arrays now.)
  - `placeSites(rng): Placement[]` **(pure)** — the layout solver, no `three` import. `scatter(world, island, rng)` consumes it and builds meshes.

- [ ] **Step 1: Layout solver (pure, TDD)** — `src/world/scatter.ts`. The naive version ("12 trees min 2.5 apart") lets a tree spawn **inside a hut**, because trees only test against trees. Rejection sampling must test against *everything already placed*, with per-kind clearance radii.

```ts
import { RNG } from '../core/rng'

export type PlacementKind = 'tree' | 'hut' | 'site' | 'campfire'
export type Placement = { kind: PlacementKind; x: number; z: number }

/** Footprint radius per kind — two placements must not have overlapping footprints. */
const CLEARANCE: Record<PlacementKind, number> = {
  campfire: 2.0, hut: 2.0, site: 2.0, tree: 1.3,
}

function fits(p: Placement, placed: Placement[]): boolean {
  for (const q of placed) {
    const min = CLEARANCE[p.kind] + CLEARANCE[q.kind]
    if (Math.hypot(p.x - q.x, p.z - q.z) < min) return false
  }
  return true
}

/** Campfire at centre, 2 huts + 1 empty site ringing it, then 12 trees in the gaps. */
export function placeSites(rng: RNG): Placement[] {
  const placed: Placement[] = [{ kind: 'campfire', x: 0, z: 0 }]

  const ring: PlacementKind[] = ['hut', 'hut', 'site']
  for (const kind of ring) {
    for (let tries = 0; tries < 200; tries++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(4, 6)
      const p = { kind, x: Math.cos(a) * r, z: Math.sin(a) * r }
      if (fits(p, placed)) { placed.push(p); break }
    }
  }

  let trees = 0
  for (let tries = 0; tries < 4000 && trees < 12; tries++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 10.5
    const p: Placement = { kind: 'tree', x: Math.cos(a) * r, z: Math.sin(a) * r }
    if (fits(p, placed)) { placed.push(p); trees++ }
  }
  return placed
}
```

`src/world/scatter.test.ts` — write first, watch fail:

```ts
import { describe, it, expect } from 'vitest'
import { RNG } from '../core/rng'
import { placeSites } from './scatter'

describe('placeSites', () => {
  const p = placeSites(new RNG(1))

  it('places the campfire, 2 huts, 1 site and 12 trees', () => {
    const n = (k: string) => p.filter(x => x.kind === k).length
    expect(n('campfire')).toBe(1)
    expect(n('hut')).toBe(2)
    expect(n('site')).toBe(1)
    expect(n('tree')).toBe(12)
  })

  it('never overlaps ANY two placements — including tree-into-hut', () => {
    const CLEAR: Record<string, number> = { campfire: 2, hut: 2, site: 2, tree: 1.3 }
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      const d = Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z)
      expect(d).toBeGreaterThanOrEqual(CLEAR[p[i].kind] + CLEAR[p[j].kind] - 1e-9)
    }
  })

  it('keeps everything on walkable ground', () => {
    for (const x of p) expect(Math.hypot(x.x, x.z)).toBeLessThan(12)
  })

  it('is deterministic per seed', () => {
    expect(placeSites(new RNG(9))).toEqual(placeSites(new RNG(9)))
  })
})
```

- [ ] **Step 2: Build meshes** — `src/world/objects.ts`. All from wobbled primitives + `clayMaterial`, all `castShadow = true`, positioned with `y = island.sampleHeight(x, z)`. **Colors come from `PALETTE` — no hex literals in this file.**
  - Tree: trunk = wobbled `CylinderGeometry(0.18, 0.28, 1.1)` in `PALETTE.bark`; crown = 2–3 overlapping wobbled spheres (r 0.7–1.0) in greens picked from `[PALETTE.leafA, PALETTE.grassDark, PALETTE.leafB]`, slight per-tree crown scale/rotation from rng. `chop()`: crown scales to 0.15 over 4 quantized frames; regrow lerps back over 120 s. `ignite()`: crown material color lerps toward `PALETTE.scorch` (Task 13 attaches real flames). `growFruit()`: 4 small `PALETTE.smockA` spheres on an `InstancedMesh` parented to the crown, removed after 60 s.
  - Hut: base = wobbled squashed sphere (r 1.1, scaleY 0.75) in `PALETTE.hutClay`; door = flattened dark box; roof knob on top. `site` = a ring of 5 small stones (`InstancedMesh`, `PALETTE.stone`); `building` = base scaled by `progress`; smoke = 3 grey blobs looping upward above roof when `built`.
  - Campfire: stone ring (6 wobbled small spheres, `PALETTE.stone`), log cross, flame = 3 blobs (`PALETTE.flame` / `PALETTE.ember`) that jitter at 12fps (`qt`-driven hash offsets), point light `PALETTE.flame` intensity 1.5 distance 6.
  - If `lowFx`: add a `CircleGeometry` blob shadow (`PALETTE.scorch`, opacity 0.25) under each object instead of `castShadow`.

- [ ] **Step 3: World registry** — `world.ts` implements the queries with simple linear scans (≤ ~30 objects; fine). `resolveTarget(x,z)` checks, in order: villager within 1.0 → `'villager'`; tree within 1.2 → `'tree'`; hut within 1.6 → `'hut'`; campfire within 1.5 → `'campfire'`; pond containing point → `'pond'`; crater containing point (via `craterAt` from Task 4) → `'crater'`; else `'ground'`. (Villager/pond arrays are empty until later tasks — the checks compile against the declared arrays.)

- [ ] **Step 4: Wire into main.ts** — `scatter(world, island, rng)` calls `placeSites(rng)` and builds a mesh per placement; call each object's `update(dt, clock.quantizedTime)` in `onRender`.

- [ ] **Step 5: Verify** — `npm test` passes. `npm run dev`: 12 varied clay trees, 2 lumpy huts with curling smoke, a stone-ring campfire with jittery 12fps flames and warm light, one hut site of stones. Everything casts soft shadows. **No tree intersects a hut or the campfire** — orbit all the way round and check. `?lowfx=1` shows blob shadows.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: trees, huts, campfire, world registry and non-overlapping scatter"`

---

### Task 7: Villager FSM (pure, TDD)

**Files:**
- Create: `src/villagers/fsm.ts` **(pure)**
- Test: `src/villagers/fsm.test.ts`

**Interfaces:**
- Produces:
  - `type VillagerState = 'wander' | 'chopTree' | 'buildHut' | 'sitAtFire' | 'flee' | 'mourn' | 'rebuild' | 'fish'` — **exactly 8, enforced by a test**
  - `type FsmCtx = { state: VillagerState; fireNear: boolean; freshGrave: boolean; hasRuin: boolean; hasSite: boolean; hasPond: boolean; hasTree: boolean; rng: RNG }`
  - `decideNext(ctx: FsmCtx): VillagerState` — triggers first, then weighted random
  - `stateDuration(s: VillagerState, rng: RNG): number` — seconds before re-deciding

The FSM is **theatrical, not systemic**: triggers are hard overrides (fire → flee), everything else is a weighted roll. No needs, no utility scores, no planning.

- [ ] **Step 1: Write failing tests** — `src/villagers/fsm.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { RNG } from '../core/rng'
import { decideNext, STATES, type FsmCtx } from './fsm'

const base = (o: Partial<FsmCtx> = {}): FsmCtx => ({
  state: 'wander', fireNear: false, freshGrave: false, hasRuin: false,
  hasSite: false, hasPond: false, hasTree: true, rng: new RNG(3), ...o,
})

describe('FSM shape', () => {
  it('has exactly 8 states — the hard cap from the spec', () => {
    expect(STATES).toHaveLength(8)
    expect([...STATES].sort()).toEqual(
      ['buildHut','chopTree','fish','flee','mourn','rebuild','sitAtFire','wander'])
  })
})

describe('triggers override everything', () => {
  it('fire nearby always flees, from any state', () => {
    for (const s of STATES) {
      expect(decideNext(base({ state: s, fireNear: true }))).toBe('flee')
    }
  })
  it('fire beats a fresh grave — self-preservation first', () => {
    expect(decideNext(base({ fireNear: true, freshGrave: true }))).toBe('flee')
  })
  it('a fresh grave pulls a mourner', () => {
    expect(decideNext(base({ freshGrave: true }))).toBe('mourn')
  })
  it('a ruin pulls a rebuilder', () => {
    expect(decideNext(base({ hasRuin: true }))).toBe('rebuild')
  })
})

describe('weighted idle selection', () => {
  it('only ever returns states whose preconditions hold', () => {
    for (let seed = 0; seed < 200; seed++) {
      const ctx = base({ rng: new RNG(seed), hasTree: false, hasSite: false, hasPond: false })
      const next = decideNext(ctx)
      expect(['wander', 'sitAtFire']).toContain(next)   // nothing else is available
    }
  })
  it('fishes only when a pond exists', () => {
    let fished = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({ rng: new RNG(seed), hasPond: true })) === 'fish') fished = true
    }
    expect(fished).toBe(true)
    for (let seed = 0; seed < 300; seed++) {
      expect(decideNext(base({ rng: new RNG(seed), hasPond: false }))).not.toBe('fish')
    }
  })
  it('is deterministic for a given seed', () => {
    expect(decideNext(base({ rng: new RNG(11) }))).toBe(decideNext(base({ rng: new RNG(11) })))
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/villagers/fsm.ts`:

```ts
import type { RNG } from '../core/rng'

export const STATES = [
  'wander', 'chopTree', 'buildHut', 'sitAtFire', 'flee', 'mourn', 'rebuild', 'fish',
] as const
export type VillagerState = (typeof STATES)[number]

export type FsmCtx = {
  state: VillagerState
  fireNear: boolean
  freshGrave: boolean
  hasRuin: boolean
  hasSite: boolean
  hasPond: boolean
  hasTree: boolean
  rng: RNG
}

/** Weighted candidates for the idle roll. Preconditions gate availability. */
const IDLE: { state: VillagerState; weight: number; when: (c: FsmCtx) => boolean }[] = [
  { state: 'wander',    weight: 4, when: () => true },
  { state: 'sitAtFire', weight: 3, when: () => true },
  { state: 'chopTree',  weight: 3, when: c => c.hasTree },
  { state: 'buildHut',  weight: 3, when: c => c.hasSite },
  { state: 'fish',      weight: 4, when: c => c.hasPond },   // new pond = novelty, weight it up
]

export function decideNext(ctx: FsmCtx): VillagerState {
  // Triggers, in priority order. These are overrides, not weights.
  if (ctx.fireNear) return 'flee'
  if (ctx.freshGrave) return 'mourn'
  if (ctx.hasRuin) return 'rebuild'

  const avail = IDLE.filter(o => o.when(ctx))
  const total = avail.reduce((s, o) => s + o.weight, 0)
  let roll = ctx.rng.next() * total
  for (const o of avail) { roll -= o.weight; if (roll < 0) return o.state }
  return 'wander'
}

export function stateDuration(s: VillagerState, rng: RNG): number {
  switch (s) {
    case 'flee':      return rng.range(2.5, 4)
    case 'mourn':     return rng.range(4, 7)
    case 'chopTree':  return rng.range(3, 5)
    case 'buildHut':
    case 'rebuild':   return rng.range(3, 5)
    case 'fish':      return rng.range(5, 9)
    case 'sitAtFire': return rng.range(6, 12)
    case 'wander':    return rng.range(3, 6)
  }
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: villager FSM with 8-state cap and tests"`

---

### Task 8: Villagers — mesh, steering, activities, emotes

**Files:**
- Create: `src/villagers/villager.ts`, `src/fx/emotes.ts`
- Modify: `src/world/world.ts` (retype `villagers: Villager[]`), `src/main.ts`

**Interfaces:**
- Produces:
  - `class Villager { id; x; z; state: VillagerState; alive: boolean; group: THREE.Group; update(dt, qt, world, island): void; die(cause): void; emote(kind: EmoteKind): void; panic(from: {x,z}): void }`
  - `spawnVillagers(world, island, rng, n = 6): Villager[]`
  - `type EmoteKind = 'alarm' | 'question' | 'water' | 'sleep' | 'fish' | 'sad'`; `class EmoteSprite { show(kind, seconds): void; update(qt): void }`

- [ ] **Step 1: Emote sprites** — `src/fx/emotes.ts`. A canvas-drawn glyph on a `THREE.Sprite`, one shared canvas texture atlas (6 glyphs in a row, 6×1 cells of 64px), `sprite.material.map.offset.x` picks the cell. The bubble is a wobbly hand-drawn circle, not a perfect one — draw it with 3 arcs of jittered radius.
  - **Quantized:** the bubble's bob and its 2-frame "pop in" scale animation both key off `qt`, so emotes stutter with the villagers.
  - Sprites always face camera (that's what `Sprite` does) — no billboard math needed.

- [ ] **Step 2: Villager mesh** — pill body (wobbled `CapsuleGeometry(0.22, 0.34)`) in one of `PALETTE.smockA/B/C`, a `PALETTE.skin` sphere head, two stub arms, two stub legs. Total ~0.8 units tall. `castShadow = true`.

- [ ] **Step 3: Steering + the 12fps waddle** — no pathfinding, per the spec:

```ts
// Steer toward target, repelled by solid objects. Sim runs at 30Hz (GameLoop),
// but the MESH only moves on a quantized tick — that is the whole stop-motion trick.
private steer(dt: number, world: World, island: Island): void {
  const dx = this.tx - this.x, dz = this.tz - this.z
  const d = Math.hypot(dx, dz) || 1
  let vx = (dx / d) * this.speed, vz = (dz / d) * this.speed
  for (const o of world.objectsNear(this.x, this.z, 1.4)) {   // simple repulsion
    const ox = this.x - o.x, oz = this.z - o.z
    const od = Math.hypot(ox, oz) || 1
    if (od < 1.4) { vx += (ox / od) * (1.4 - od) * 2; vz += (oz / od) * (1.4 - od) * 2 }
  }
  this.x += vx * dt; this.z += vz * dt
  // Keep them on the island.
  const r = Math.hypot(this.x, this.z)
  if (r > WALK_RADIUS) { this.x *= WALK_RADIUS / r; this.z *= WALK_RADIUS / r }
}

update(dt: number, qt: number, world: World, island: Island): void {
  if (!this.alive) return
  this.steer(dt, world, island)            // continuous, 30Hz
  this.timer -= dt
  if (this.timer <= 0) this.enter(decideNext(this.ctx(world)), world)

  if (!this.tickedThisFrame(qt)) return    // ↓ everything below is 12fps only ↓
  this.group.position.set(this.x, island.sampleHeight(this.x, this.z), this.z)
  this.group.rotation.y = Math.atan2(this.tx - this.x, this.tz - this.z)
  // Waddle: 2-frame side-to-side rock + a small hop. At 12fps this reads as
  // stop-motion, not as a bad lerp. Do NOT smooth this.
  const f = Math.floor(qt * TIMING.fps) % 4
  this.group.rotation.z = (f === 0 ? 0.09 : f === 2 ? -0.09 : 0)
  this.group.position.y += (f % 2 === 0 ? 0.03 : 0)
}
```

> The mesh transform is written **only on quantized ticks**, while `x`/`z` update at 30Hz. Position is therefore always "one 12fps frame behind" the sim — that is correct and is exactly the look we want.

- [ ] **Step 4: Activities** — each state maps to a target + a behavior:
  - `wander` → random point within `WALK_RADIUS`; occasional `sleep` emote if idle.
  - `chopTree` → `world.choppableTree()`; on arrival, 4 quantized chop frames (arm raise/lower), then `tree.chop()`.
  - `buildHut` → `world.buildSite()`; on arrival, `hut.buildTick()` every 1.5 s until built. Emits `hut:rebuilt` when a `ruin` completes.
  - `sitAtFire` → point on the campfire ring; sit (scale Y 0.8), face the fire, `sleep` emote occasionally.
  - `flee` → run **away** from `world.nearestBurning()`, speed ×2.2, `alarm` emote, re-target every second while fire persists.
  - `mourn` → nearest fresh grave; stand still, `sad` emote, then emit `villager:mourned` and clear the grave's `fresh` flag.
  - `rebuild` → nearest ruin; same as `buildHut`.
  - `fish` → pond edge; sit, `fish` emote; every ~4 s a 5% chance to emit `villager:fished`.
- [ ] **Step 5: Death & respawn** — `die(cause)`: play the cause-specific gag (Task 12/13 supply the visuals), spawn a `Grave` at the spot, emit `villager:died`. **The toy must be unbreakable:** a `World.repopulate()` check in `main.ts` — if `alive < 6`, after 20–30 s a new villager waddles out of a built hut (scale from 0 over 4 quantized frames). Population never permanently drops.

- [ ] **Step 6: Verify visually** — 6 villagers waddle around the island in visible **12fps stutter** while the camera and clouds stay silky. They chop trees (crown shrinks), build the empty hut site up from nothing, and sit around the campfire. Emote bubbles pop in with a 2-frame snap. Nobody walks through a hut or off the island. Nobody stands *inside* a tree.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: villagers with steering, activities, emotes, respawn"`

> **Milestone 1 exit test (from the spec): would a stranger screenshot the idle scene?** Take an actual screenshot. If the answer is no, stop and fix the look before starting Task 9 — the powers cannot rescue a scene that isn't already beautiful.

---

### Task 9: Power tray + drag targeting + keyboard reticle

**Files:**
- Create: `src/ui/tray.ts`, `src/powers/drag.ts`
- Modify: `src/styles.css`, `src/main.ts`

**Interfaces:**
- Produces:
  - `createTray(ui: HTMLElement, opts: { onArm(id: PowerId): void; onCancel(): void; cooldowns: () => Record<PowerId, number> }): { setCooldown(id, t01): void; setEnabled(id, on): void }`
  - `class DragTargeting { constructor(dom, camera, island, world, onFire: (id: PowerId, x: number, z: number, kind: TargetKind) => void); update(): void }` — raycast to island, reticle, drag *and* keyboard paths.

**Design (from Task 0):** the tray is *three lumps of clay on the table*, not a game HUD. Circular, irregular (a `border-radius` with four different values), the paper color, with a tiny 3D-ish clay glyph. No glow, no gradient, no glass.

- [ ] **Step 1: Tray DOM** — real `<button>`s, because keyboard users exist:

```html
<div id="tray" role="toolbar" aria-label="Powers">
  <button class="power" data-power="meteor"    aria-keyshortcuts="1">Meteor</button>
  <button class="power" data-power="lightning" aria-keyshortcuts="2">Lightning</button>
  <button class="power" data-power="rain"      aria-keyshortcuts="3">Rain</button>
  <span class="spacer"></span>
  <button id="journal-btn" aria-haspopup="dialog">Journal <b>0/12</b></button>
  <button id="mute-btn" aria-pressed="false">Sound on</button>
</div>
```

- Labels are words, not icons-only. A person should not have to guess what the third lump does.
- Cooldown is shown as a **clay skin re-forming over the lump** — a `conic-gradient` mask that sweeps round — not a progress bar. `aria-disabled` while cooling; `setEnabled` toggles it.
- Button label = what happens: the toast after Meteor says "Meteor", the button says "Meteor". Same word throughout.

- [ ] **Step 2: Drag targeting** — pointerdown on a tray button arms the power and starts a drag; a **reticle** (a soft clay ring, `RingGeometry` + `clayMaterial(flat)`) follows the raycast hit on `island.topMesh`, sitting at `island.sampleHeight(x, z) + 0.05`. Pointerup fires. Drag off the island → cancel, the lump returns to the tray.
  - Raycast against `island.topMesh` only — not the whole scene. It's one mesh; this is cheap.
  - `world.resolveTarget(x, z)` at fire time gives the `TargetKind`, which is what the interaction matrix (Task 16) and the discovery system (Task 17) both switch on.

- [ ] **Step 3: Keyboard path (non-optional)** — drag is the primary affordance, not the only one:
  - `1` / `2` / `3` or `Enter`/`Space` on a focused tray button → arms the power, reticle appears at the island centre.
  - Arrow keys move the reticle (2 units/press, held = repeat). `Enter` fires. `Esc` cancels and returns focus to the tray button.
  - Announce the target kind in an `aria-live="polite"` region as the reticle moves ("over a tree", "over the campfire") — this is also just genuinely useful feedback for everyone.

- [ ] **Step 4: Verify** — Drag a lump from the tray onto a tree: the reticle snaps to the ground and follows the cursor; releasing logs `{ power: 'meteor', target: 'tree' }`. Cooldown skin sweeps over the lump and it re-enables. **Unplug the mouse:** Tab to the tray, press `1`, arrow-key the reticle onto a hut, press `Enter` — same event fires. Focus ring is clearly visible.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: power tray, drag targeting, keyboard reticle"`

---

### Task 10: Craters + scorch — persistent island scars

**Files:**
- Modify: `src/world/island.ts` (implement `addCrater`, `scorch`)
- Create: `src/fx/decals.ts`

**Interfaces:**
- Produces: `island.addCrater(c: Crater)` — rewrites position + normal attributes; `island.scorch(x, z, r)` — blends `PALETTE.scorch` into vertex colors within radius. Both are permanent. `craters` already feeds `sampleHeight` (Task 4), so villagers walk *down into* craters the moment one appears.

- [ ] **Step 1: addCrater** — push to `this.craters`, then for every vertex within the crater's radius (plus a margin) recompute `y = islandSurfaceY(x,z) - craterOffset(x,z,craters)` and darken its color toward `PALETTE.dirt` (a crater exposes soil). Mark `position` + `color` attributes `needsUpdate`, call `computeVertexNormals()`.
  - Only touch vertices in range — a full 40×80 rebuild per meteor is 3200 verts and would be a visible hitch. Index them by ring/segment from `(x, z)` rather than scanning all.

- [ ] **Step 2: scorch** — `src/fx/decals.ts` holds the blend helper. `scorch(x, z, r)` raises `scorchAmt[i]` for nearby vertices (accumulating, clamped to 1) and rewrites `color[i] = lerp(baseColors[i], PALETTE.scorch, scorchAmt[i])`. Because we keep `baseColors` separately, repeated scorching converges instead of marching to black.

- [ ] **Step 3: Verify** — Call `island.addCrater({x: 4, z: 0, radius: 3, depth: 1.4})` from the console. Expected: a real bowl in the mesh with exposed dirt, correct soft shading in it (normals recomputed), and **villagers walk down into it and back out** rather than gliding over the hole. Call `island.scorch(4, 0, 3)` — the grass blackens and stays black.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: persistent craters and scorch marks"`

---

### Task 11: FX kit — particles, screen shake, flash

**Files:**
- Create: `src/fx/particles.ts`, `src/fx/shake.ts`

**Interfaces:**
- Produces:
  - `class ParticleBurst { constructor(scene, max = 400); burst(o: { x, y, z, n, color, speed, gravity, size, life }): void; update(dt): void }` — **one `InstancedMesh`** of a wobbled low-poly sphere; this is where instancing actually pays.
  - `class Shake { add(amount: number, seconds: number): void; update(dt: number, camera): void }`
  - `flash(color, seconds)` — full-screen DOM overlay flash (cheaper than a post pass, and trivially reducible).

- [ ] **Step 1: Particles** — a fixed pool; `burst()` claims dead slots. Each particle: position, velocity, life, scale. Update integrates gravity, scales down over life, writes `instanceMatrix`. Set `instanceMatrix.needsUpdate = true` once per frame. Dead particles get scale 0 (rather than being removed — no reallocation).
  - Particles run at **display rate, not 12fps** — per the spec, the stop-motion applies to characters and objects. Debris moving smoothly against stuttering villagers is exactly the Aardman contrast.
  - Clay chunks are *chunky*: `IcosahedronGeometry(0.1, 0)` wobbled, random per-instance rotation that tumbles.

- [ ] **Step 2: Shake** — trauma-based, the standard: store `trauma`, decay it linearly, offset the camera by `trauma² × noise`. Squaring makes small shakes subtle and big ones violent.

```ts
update(dt: number, camera: THREE.Camera): void {
  this.trauma = Math.max(0, this.trauma - dt / this.duration)
  if (prefersReducedMotion()) return          // hard stop — no vestibular assault
  const s = this.trauma ** 2 * this.amount
  camera.position.x += (valueNoise2(this.t * 30, 0)) * s
  camera.position.y += (valueNoise2(0, this.t * 30)) * s
}
```

- [ ] **Step 3: Flash** — a `<div>` in `#ui`, `background: white`, opacity animated down. Under `prefers-reduced-motion`, replace the 1-frame white flash with a 200ms fade to 30% opacity — **a hard white strobe is a seizure risk and is not negotiable**.

- [ ] **Step 4: Verify** — From the console: `particles.burst({...n: 200})` throws a convincing spray of tumbling clay chunks that fall and settle. `shake.add(0.8, 0.5)` kicks the camera hard and settles smoothly. With OS reduce-motion on: no shake at all, flash is a soft fade.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: instanced clay particles, screen shake, flash"`

---

### Task 12: Power base + Meteor

**Files:**
- Create: `src/powers/power.ts`, `src/powers/meteor.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces:
  - `abstract class Power { readonly id: PowerId; readonly cooldown: number; abstract cast(ctx: CastCtx): Timeline }`
  - `type CastCtx = { x: number; z: number; kind: TargetKind; world; island; scene; fx; bus; rng }`
  - `class PowerManager { cast(id, x, z): void; ready(id): boolean; cooldown01(id): number; update(dt): void }` — holds active `Timeline`s, ticks them, drops them when `done`.

Every power is **three beats: anticipation → impact → aftermath**, expressed as a `Timeline`. This structure is the entire spectacle system.

- [ ] **Step 1: Power base** — `PowerManager.cast` checks the cooldown, builds the `Timeline` from the power, and stores it. `update(dt)` advances every live timeline and removes the `done` ones. Cooldowns: meteor 6 s, lightning 3 s, rain 8 s.

- [ ] **Step 2: Meteor** — the marquee power; it must feel *heavy*.

```ts
cast(c: CastCtx): Timeline {
  const y0 = c.island.sampleHeight(c.x, c.z)
  const shadow = growingShadowDisc(c.scene, c.x, y0, c.z)   // the tell
  const rock = meteorMesh(c.scene, c.rng)                   // wobbled, glowing rim

  return new Timeline()
    // ── ANTICIPATION (1.2s) — the villagers see it before the player does
    .at(0.0, () => { c.bus.emit({ type: 'power:anticipate', power: 'meteor', x: c.x, z: c.z })
                     c.world.alarmNear(c.x, c.z, 7)          // ❗ emotes, look up, scatter
                     sfx.whistle(1.2) })
    .at(0.0, () => shadow.animate({ from: 0.2, to: 2.6, seconds: 1.2 }))
    .at(0.0, () => rock.fall({ from: { x: c.x + 6, y: 40, z: c.z - 6 }, to: { x: c.x, y: y0, z: c.z }, seconds: 1.2 }))
    // ── IMPACT (1 frame) — everything at once
    .at(1.2, () => {
      rock.remove(); shadow.remove()
      c.fx.shake.add(0.9, 0.6)
      c.fx.particles.burst({ x: c.x, y: y0, z: c.z, n: 160, color: PALETTE.dirt,   speed: 9, gravity: 14, life: 1.4 })
      c.fx.particles.burst({ x: c.x, y: y0, z: c.z, n: 40,  color: PALETTE.scorch, speed: 5, gravity: 3,  life: 2.2 })
      c.island.addCrater({ x: c.x, z: c.z, radius: 2.8, depth: 1.3 })
      c.island.scorch(c.x, c.z, 3.4)
      c.bus.emit({ type: 'crater:created', x: c.x, z: c.z })
      c.bus.emit({ type: 'power:impact', power: 'meteor', target: c.kind, x: c.x, z: c.z })
      applyMeteorMatrix(c)                                  // Task 16 replaces this
    })
    // ── AFTERMATH (3s) — consequence, and the villagers cope
    .at(1.3, () => c.world.igniteNear(c.x, c.z, 3.2, c.rng, 0.6))  // scattered small fires
    .at(1.5, () => dustRing(c.scene, c.x, y0, c.z))
    .at(4.2, () => {})                                             // timeline ends
}
```

- **The anticipation beat is the whole trick.** 1.2 seconds of growing shadow + villagers pointing up is what turns a particle burst into a *scene*. Do not shorten it to feel "responsive" — the delay IS the product.

- [ ] **Step 3: Verify** — Drag meteor onto open ground: a shadow blooms, villagers ❗ and scatter, a whistle rises, then a hard hit — shake, dirt spray, a real crater with a scorch ring, small fires around it. Villagers flee. Then they come back and stand near the hole. Watch it ten times; it should still feel good.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: power base, timeline staging, meteor"`

---

### Task 13: Fire system (pure, TDD) + flames

**Files:**
- Create: `src/world/fire.ts` **(pure)**
- Test: `src/world/fire.test.ts`
- Modify: `src/world/objects.ts` (flame visuals)

**Interfaces:**
- Produces:
  - `const FIRE_CONFIG = { spreadRadius: 3.0, spreadChancePerSec: 0.35, burnSeconds: 12, hutBurnSeconds: 16, douseRadius: 4 }` — **one config object**, per the spec's risk mitigation.
  - `type Flammable = { id: string; x: number; z: number; kind: 'tree'|'hut'|'campfire'; burning: boolean; burnt: boolean; burnTime: number }`
  - `class FireSystem { update(dt, items: Flammable[], rng): FireEvent[] }` — pure; returns events, mutates the plain flammable records. The visual layer applies them.

- [ ] **Step 1: Write failing tests** — this is the system most likely to be "too dull or too apocalyptic", so pin its behavior:

```ts
describe('FireSystem', () => {
  it('spreads to a neighbour within radius, given enough time', () => { /* burning tree at 0,0;
      healthy tree at 2,0; run 10s of 1/30 steps with a fixed seed → neighbour burning */ })
  it('never spreads beyond spreadRadius', () => { /* tree at 20,0 stays healthy after 60s */ })
  it('burns out after burnSeconds and becomes burnt, not burning', () => {})
  it('does not re-ignite something already burnt', () => {})
  it('cannot spread FROM a burnt item', () => {})
  it('douse() clears burning within radius and leaves burnt items burnt', () => {})
  it('is deterministic for a fixed seed', () => {})
  it('cannot burn the whole island from one tree in 60s', () => {
    // The apocalypse guard. With the shipped config and the default scatter,
    // at least 3 of 12 trees survive a single ignition over 60 simulated seconds.
  })
})
```

The last test is the one that matters. It converts "playtest-tune the fire" from a vibe into a check.

- [ ] **Step 2: Implement** — for each burning item: `burnTime += dt`; past its limit → `burning = false, burnt = true`, emit `burnt`. Then, for each burning item, for each healthy flammable within `spreadRadius`, roll `rng.chance(spreadChancePerSec * dt)` → ignite, emit `fire:ignited` with `bySpread: true`.
  - Campfire is flammable-adjacent: it can *start* fires (a meteor scatters it) but never burns out.

- [ ] **Step 3: Flames** — the visual layer reads `burning` and attaches 3–5 flame blobs (`PALETTE.flame`/`PALETTE.ember`) that jitter on the 12fps clock, plus a small point light (**cap total fire lights at 3** — pick the 3 nearest the camera; a dozen point lights will tank the frame). Smoke particles drift up continuously from burning objects.

- [ ] **Step 4: Verify** — `npm test` passes, including the apocalypse guard. In-game: lightning a tree in a dense grove; fire jumps tree→tree over several seconds, villagers flee with ❗, trees burn to stumps, and it **burns out on its own** without taking the whole island. Sit and watch for a full minute.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: fire spread system with tests and flame visuals"`

---

### Task 14: Lightning

**Files:**
- Create: `src/powers/lightning.ts`

**Interfaces:**
- Produces: `class Lightning extends Power` — cooldown 3 s. Fastest power, cheapest thrill.

- [ ] **Step 1: Bolt geometry** — a jagged clay-white ribbon, not a glow. Build a `TubeGeometry` along a `CatmullRomCurve3` of 8 points from y=25 down to the target, each x/z offset by `rng.range(-0.6, 0.6)`, in `PALETTE.ghost` with `clayMaterial(flat)`. Add 2 short forked branches. It exists for **2 quantized frames (~166ms)** and vanishes — a lightning bolt that fades out is a lightning bolt that looks like a laser.

- [ ] **Step 2: Timeline**
  - **Anticipation (0.9s):** a small dark cloud gathers *at the drop point* (3 grey blobs scaling up + a low rumble). Villagers below look up (`question` emote — they're curious, not yet alarmed; the comedy is that they don't run).
  - **Impact (2 frames):** bolt appears, `flash('white', 0.06)`, sharp crack SFX, shake 0.35.
  - **Aftermath (2s):** per the matrix — tree ignites, villager does the comic zap, pond makes fish float, campfire flares huge.

- [ ] **Step 3: The comic zap** — the spec says *cute, never gory*. Struck villager: freezes in a charred pose (material → `PALETTE.scorch`, arms out), blinks **twice on the 12fps clock** (scale 1 → 1.08 → 1), tips over stiff like a plank, then a small `PALETTE.ghost` blob with a tiny face floats up, waves, and fades at y+4. Then a grave. The whole gag runs ~2.5 s and it must be *funny*, which means the timing is the work: hold the charred pose a beat too long. That beat is the joke.

- [ ] **Step 4: Verify** — Lightning a lone villager. Expected: cloud gathers, they look up quizzically, CRACK, charred pose, two blinks, timber, ghost floats up and waves. Show it to someone; if they don't smile, the pause before the fall is wrong. Lightning a tree → it ignites and fire spreads. Lightning the campfire → it flares to 3× for 2 s.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: lightning with comic zap"`

---

### Task 15: Rain — the nurture power

**Files:**
- Create: `src/powers/rain.ts`
- Modify: `src/world/objects.ts` (`Pond`, `Grave`, flowers, fruit)

**Interfaces:**
- Produces: `class Rain extends Power` — cooldown 8 s, the longest: rain is the *undo*, and undo should cost something.
  - `class Pond { x; z; radius; group; hasFish: boolean }`, `class Grave { x; z; fresh: boolean; group }`

Rain is what makes the destruction guilt-free. It should feel **relieving** — slower, quieter, and prettier than the other two.

- [ ] **Step 1: Cloud + droplets** — a puffy `clayMaterial` cloud (5 wobbled spheres) drifts in over 1.2 s and sits at y=9. Droplets: **one `InstancedMesh`** of ~120 small elongated blobs (`PALETTE.water`) falling within the cloud's radius, recycled at the top when they hit `island.sampleHeight`. Each impact leaves a 2-frame ring ripple. Rain lasts 6 s, then the cloud drifts off and dissipates.

- [ ] **Step 2: Effects, applied every 0.5 s while raining** (a tick, not a one-shot — rain is an *area over time*, which is what makes it feel different in the hand):
  - Douses any burning object within radius → `fire:doused { byRain: true }`.
  - **Fills craters into ponds:** any crater fully inside the rain radius gets a `Pond` (a translucent `PALETTE.water` disc at the crater's mid-depth, gently animated on the 12fps clock) → `pond:created`. Ponds enable the `fish` FSM state — the world gets *richer* from your destruction, which is the whole thesis of the toy.
  - Trees in radius `growFruit()` → `fruit:grown`.
  - Grass in radius pops flowers: an `InstancedMesh` of tiny `PALETTE.bloom` blobs on the ground → `flower:bloomed`.
  - Villagers in radius: hold a leaf overhead, `water` emote, grumpy — they waddle for the nearest hut. → this is the joke: you saved them and they're annoyed.
  - Campfire in radius: doused, villagers around it emote `sad`.

- [ ] **Step 3: Graves** — `Grave` is a small wobbled slab (`PALETTE.stone`) with `fresh: true` for 60 s. `fresh` graves drive the FSM's `mourn` trigger; after mourning, `fresh = false` so villagers don't loop forever on one grave.

- [ ] **Step 4: Verify** — Meteor an area, let fires spread, then rain on it. Expected: fires hiss out, the crater fills into a shining pond, flowers pop, fruit appears on nearby trees, villagers put leaves on their heads and look annoyed. Then a villager wanders to the pond and **fishes**. This sequence — destroy, restore, new behavior emerges — is the game. If it doesn't land, nothing else will.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: rain, ponds, flowers, fruit, graves"`

---

### Task 16: The interaction matrix

**Files:**
- Create: `src/powers/matrix.ts` **(pure)**
- Test: `src/powers/matrix.test.ts`
- Modify: all three powers (replace their `applyXMatrix` stubs)

**Interfaces:**
- Produces: `resolveInteraction(power: PowerId, target: TargetKind): Interaction[]` **(pure)** — returns a list of *declarative outcomes*; each power's visual layer executes them.
  - `type Interaction = { kind: 'ignite' | 'destroy' | 'kill' | 'scatter' | 'emptyPond' | 'steam' | 'floatFish' | 'flare' | 'growFruit' | 'douse' | 'grumpy' | 'fillPond' | 'bloom' }`

The matrix is 15 cells. It is **the reason people stay** (spec: "reactions are the content"), and it is trivially unit-testable as pure data. Encode it as data, not as `if` statements scattered across three power files.

- [ ] **Step 1: The table** — straight from the spec, no invention:

```ts
const MATRIX: Record<PowerId, Partial<Record<TargetKind, Interaction['kind'][]>>> = {
  meteor: {
    tree:     ['ignite', 'destroy'],
    hut:      ['destroy'],
    villager: ['kill'],
    pond:     ['emptyPond', 'steam'],
    campfire: ['scatter'],
    crater:   [],                 // deepens the existing hole; handled by addCrater
    ground:   [],
  },
  lightning: {
    tree:     ['ignite'],
    hut:      ['ignite'],
    villager: ['kill'],           // the comic zap
    pond:     ['floatFish'],      // 🐟 → the "Fishing Hole" Moment
    campfire: ['flare'],
    crater:   [],
    ground:   [],
  },
  rain: {
    tree:     ['growFruit'],
    hut:      ['douse'],
    villager: ['grumpy'],
    pond:     ['fillPond'],
    campfire: ['douse'],
    crater:   ['fillPond'],
    ground:   ['bloom'],
  },
}

export function resolveInteraction(power: PowerId, target: TargetKind): Interaction[] {
  return (MATRIX[power][target] ?? []).map(kind => ({ kind }))
}
```

- [ ] **Step 2: Tests** — every cell of the spec's table is asserted explicitly (15 assertions; it's a table, test it like one), plus: every `(power, target)` pair returns *something* defined (no crash on `crater` or `ground`), and every `Interaction['kind']` the matrix can emit has a handler registered in the visual layer (a completeness test that fails loudly when someone adds a matrix outcome and forgets to implement it).

- [ ] **Step 3: Wire** — each power's impact beat calls `resolveInteraction(this.id, ctx.kind)` and dispatches each `Interaction` to a handler map in the visual layer. `applyMeteorMatrix` etc. disappear.

- [ ] **Step 4: Verify** — Play all 15 cells by hand, in one session, ticking them off. Every cell must do *something visible and distinct*. A cell that produces no reaction is a bug in the product, not just the code.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: power × target interaction matrix"`

---

### Task 17: Discovery — Moments + the clay-book journal

**Files:**
- Create: `src/discovery/moments.ts` **(pure)**, `src/ui/journal.ts`
- Test: `src/discovery/moments.test.ts`

**Interfaces:**
- Produces:
  - `type Moment = { id: string; title: string; hint: string; color: string; match: (e: GameEvent, s: MomentState) => boolean }`
  - `class Journal { unlocked: Set<string>; observe(e: GameEvent): Moment | null; count(): number; save(): void; load(): void }` **(pure — `localStorage` is injected)**
  - `createJournalUI(...)` — the **signature element** (Task 0): a 3D clay book, not a DOM panel.

- [ ] **Step 1: The 12 Moments** — silly titles, per the spec. Hints are written for a stranger, and they tease without instructing:

| id | Title | Trigger | Hint |
|---|---|---|---|
| `fishing-hole` | Fishing Hole | `lightning` + `pond` | "Electricity and water. What could go wrong." |
| `flash-fry` | Flash Fry | `lightning` + `campfire` | "The fire was already lit. It could be more lit." |
| `first-bloom` | First Bloom | `flower:bloomed` | "Something grows where nothing happened." |
| `ghost-story` | Ghost Story | `villager:died` ×3 | "They keep coming back. Sort of." |
| `full-harvest` | Full Harvest | `fruit:grown` on 4+ trees | "Rain on an orchard." |
| `new-pond` | Watering Hole | `crater:created` → `pond:created` at same spot | "Make a hole. Then fill it." |
| `gone-fishing` | Gone Fishing | `villager:fished` | "Give them a pond and see what happens." |
| `wildfire` | Wildfire | 5+ objects burning at once | "It got away from you." |
| `firefighter` | Firefighter | `fire:doused` while 3+ burning | "Second thoughts." |
| `homewrecker` | Homewrecker | `burnt { kind: 'hut' }` | "That was somebody's house." |
| `they-rebuild` | They Rebuild | `hut:rebuilt` | "You broke it. They fixed it." |
| `respects-paid` | Respects Paid | `villager:mourned` | "Someone remembers." |

Note `they-rebuild` and `respects-paid`: the journal should reward the player for **watching the consequences**, not only for causing them. That's the spec's "mischief & consequence" thesis, made into a goal.

- [ ] **Step 2: Journal logic (pure, TDD)** — `observe(e)` runs each locked Moment's `match` against the event + accumulated `MomentState` (counters for "3 deaths", "5 burning", "4 fruit trees"). Returns the newly-unlocked Moment or null. Tests: each of the 12 unlocks from its trigger sequence and from nothing else; unlocking twice is a no-op; `load()` from a corrupt/absent `localStorage` value yields an empty set and does not throw (inject a fake storage — this module stays pure and headlessly testable).

- [ ] **Step 3: The clay book (the signature element)** — this is the one place the design spends its boldness:
  - A hardback clay book lies on the "table" beside the island, always in-scene. Clicking the journal button (or the book itself) glides the camera down to it over 700ms and it **opens with a 12fps page-turn** — the pages stutter like everything else in the model, which is what sells that it's part of the diorama and not a web UI pasted on top.
  - The 12 Moments are a 3×4 grid of **pressed thumbprint tiles**: a locked tile is a blank dimpled slab of grey clay. An unlocked one takes the Moment's `color`, and its title is **stamped into the clay** — set in the display face, small, slightly rotated, like a label pressed by hand.
  - Locked tiles show the *hint* on hover/focus. They are not greyed-out text; they are unpressed clay.
  - `Esc` or clicking away closes the book and returns the camera. Focus is trapped in the open book (it is a dialog); tiles are keyboard-navigable with arrows.
- [ ] **Step 4: Toasts** — on unlock, a small clay tag slides in at the top: the title, and one line of copy. Quiet, 3 seconds, no sound sting bigger than a soft *thump*. The book's counter (`3/12`) increments with a 2-frame pop. Under reduced motion the toast fades instead of sliding.

- [ ] **Step 5: Persist** — `localStorage['tinygod.moments']` = a JSON array of ids. Wrap `load()` in try/catch: a user with a corrupt value gets an empty journal, not a white screen.

- [ ] **Step 6: Verify** — Unlock *Fishing Hole* by lightning-ing a pond: toast appears, counter goes 0/12 → 1/12. Open the book: the tile is now colored and titled, the other 11 are blank clay with hints. Reload the page — it's still unlocked. Tab through the book with the keyboard; `Esc` closes it. Clear `localStorage` — it resets cleanly.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: discovery moments and the clay-book journal"`

---

### Task 18: Audio — synthesized foley

**Files:**
- Create: `src/audio/sfx.ts`

**Interfaces:**
- Produces: `class Sfx { unlock(): void; setMuted(m: boolean): void; observe(e: GameEvent): void }` — subscribes to the `EventBus`; **no audio files** (WebAudio synthesis only, per the global constraint).

Per the spec: *"claymation without foley is half the effect."* This task is not optional polish.

- [ ] **Step 1: Autoplay policy** — browsers block audio until a gesture. Create the `AudioContext` lazily on the first pointerdown/keydown, and **never** show a "click to enable sound" modal — the toy just becomes audible the moment the player touches it. Mute button starts unmuted, state in `localStorage`.

- [ ] **Step 2: The foley kit** — all synthesized:
  - *Squish* (villager step, at 12fps on the waddle frames): a short lowpassed noise burst with a fast pitch-drop — the sound of a thumb pressing clay. Randomize pitch ±15% per step or it becomes a machine gun.
  - *Whistle* (meteor anticipation): a sine sweeping 900→180 Hz over 1.2 s, matched exactly to the fall.
  - *Thud* (meteor impact): a 60 Hz sine with a hard exponential decay + a noise transient. It should be felt more than heard.
  - *Crack* (lightning): a 20 ms white-noise burst, bandpassed, into a short bright decay.
  - *Hiss* (douse): filtered noise, 0.8 s, opening then closing — steam.
  - *Pop* (flower/fruit/emote): a tiny sine blip, pitched up. Comedic.
  - *Thump* (moment unlocked): a soft, warm, low pop. The reward sound is the *quietest* thing in the mix — it's an acknowledgement, not a fanfare.
  - *Ambient*: a slow filtered-noise wind bed + two detuned sines at very low gain, always running. It's what makes the silence feel like a place.
- [ ] **Step 3: Mixing** — one master `GainNode`; a hard cap of ~6 concurrent voices (drop the oldest) so a big fire doesn't turn into a wall of hiss. Duck the ambient bed by 6 dB during a power's impact beat.

- [ ] **Step 4: Verify** — Play with your eyes closed. You should be able to tell a meteor from a lightning strike from rain. Villager footsteps should sync visibly to the 12fps waddle, not float free of it. Mute works; the state survives a reload. Nothing clips.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: synthesized foley and ambient bed"`

---

### Task 19: Performance pass, polish, ship

**Files:**
- Modify: `vite.config.ts`, `index.html`, `README.md`

- [ ] **Step 1: Performance pass** — profile with the devtools performance panel while a fire is spreading and a meteor lands (the worst case). Targets and the levers, in order of what actually pays:
  - Draw calls < 120. Check `renderer.info.render.calls`. If high, the fire flame blobs are the likely culprit — instance them.
  - Fire point lights capped at 3 (Task 13). Verify it holds during a big fire.
  - `renderer.info.memory.geometries` must be **stable over 5 minutes of play** — if it climbs, a power is leaking geometry (bolts, droplets, and particles are the suspects). Dispose or pool them.
  - Shadow map stays 2048 on desktop; drop to 1024 if a mid laptop can't hold 60.
  - Confirm DPR is capped at 1.5 and that `?lowfx=1` genuinely bypasses the composer.

- [ ] **Step 2: The accessibility checklist** (each of these is a real user, not a checkbox):
  - Full keyboard playthrough: arm each power, target it, fire it, open the journal, read a hint, close it — **without touching the mouse once**.
  - OS reduce-motion on: no shake, no strobe, no auto-orbit, no ambient bob. The powers still read clearly.
  - Focus is visible on every interactive element.
  - The `aria-live` reticle announcements say something useful.

- [ ] **Step 3: The five-second test** — the spec's actual acceptance criterion for the whole project. Load the page cold, on a machine that's never seen it. Within 5 seconds, is the idle scene screenshot-worthy? Watch someone else's first 30 seconds and don't say anything. Where their hand hesitates is the bug.

- [ ] **Step 4: Ship** — `npm run build`, deploy the static output (Vercel/Netlify/Pages). Add:
  - An OG share image — take a real screenshot of the best moment (a meteor mid-fall, shadow blooming, villagers scattering), not a logo.
  - `<title>` and a one-line meta description written like the toy, not like a product.
  - A `README.md` with a GIF, the tech, and what's interesting about it (12fps quantization, procedural everything, zero assets).

- [ ] **Step 5: Update docs** — `docs/architecture.md` (classes, event union, module map, key patterns) and `STATUS.md`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore: perf pass, a11y pass, ship"`

---

## Deliberately not in this plan

Carried over from the spec's cut list, restated so no task quietly reintroduces them: day/night cycle, resources/economy, villager dialogue, pathfinding, a flood power, multiple islands, eras, mobile-first layout. Desktop-first; touch drag works as a bonus, not a target.

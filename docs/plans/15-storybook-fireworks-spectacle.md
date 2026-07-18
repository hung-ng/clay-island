# Storybook Fireworks Spectacle Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current checkout. Project instructions prohibit commits unless the user explicitly requests one, so every commit step from the generic workflow is intentionally omitted.

**Goal:** Turn the existing fourteen-second completion celebration into an escalating, clay-styled fireworks show with varied silhouettes, denser overlapping launches, glowing anticipation, a sky-filling finale, stronger sound, and more expressive villagers.

**Architecture:** Keep `CelebrationClock` and `CelebrationDirector` as the timing and lifecycle owners. Extend the reusable particle pool with one generic ring-emission primitive, then keep all show-specific launch data, burst recipes, echo scheduling, flash meshes, and tube anticipation inside `CelebrationFireworks`. Preserve the current fixed pools, deterministic reset behavior, live reduced-motion checks, quality tiers, camera policy, and replay path.

**Tech Stack:** TypeScript 6, Three.js 0.185, Vitest 4, Vite 8.

## Global Constraints

- Preserve the existing `4s gathering + 8s fireworks + 2s finale = 14s` lifecycle.
- Preserve the interruptible, user-controlled celebration camera behavior.
- Keep every visual resource pooled, bounded, resettable, and disposable; do not allocate per frame.
- Enhanced quality may use more particles, but reduced quality must remain visibly celebratory without dynamic lights.
- Reduced motion keeps the full timeline while lowering particle density, shortening trails, removing echo bursts, and suppressing extra bouncing.
- Follow the handmade clay palette and low-poly visual language.
- Do not add dependencies, persistence keys, or database state.
- Update `docs/architecture.md` when the implementation contract changes.
- Do not modify `STATUS.md` or create a git commit unless explicitly asked.

---

### Task 1: Add a reusable ring emission shape

**Files:**
- Modify: `src/fx/particles.ts:7-18,147-177`
- Test: `src/fx/particles.test.ts:36-59`

**Interfaces:**
- Consumes: the existing `ParticleBurst.burst(options: BurstOptions): void` API.
- Produces: `BurstOptions.shape?: 'fountain' | 'sphere' | 'ring'`; ring particles travel radially through the local XZ plane with only slight vertical variation.

- [ ] **Step 1: Write the failing ring-emission test**

Add a Vitest case that creates a deterministic 32-particle ring, advances it by `0.1`, and verifies that every particle expands horizontally while its vertical displacement stays much smaller than its horizontal radius:

```ts
it('supports a horizontally expanding ring emission', () => {
  const parent = new THREE.Group()
  const ring = new ParticleBurst(parent, 32, 117)
  ring.burst({
    x: 0, y: 5, z: 0, n: 32, color: 0xffffff,
    speed: 3, gravity: 0, life: 1, shape: 'ring',
  })
  ring.update(0.1)

  const matrix = new THREE.Matrix4()
  for (let index = 0; index < 32; index++) {
    ring.mesh.getMatrixAt(index, matrix)
    const point = new THREE.Vector3().setFromMatrixPosition(matrix)
    const radius = Math.hypot(point.x, point.z)
    expect(radius).toBeGreaterThan(0.2)
    expect(Math.abs(point.y - 5)).toBeLessThan(radius)
  }
})
```

- [ ] **Step 2: Run the focused test and confirm it fails to compile**

Run: `npx vitest run src/fx/particles.test.ts`

Expected: FAIL because `'ring'` is not assignable to `BurstOptions.shape`.

- [ ] **Step 3: Implement deterministic ring velocities**

Extend the shape union and add a branch before the existing sphere branch:

```ts
shape?: 'fountain' | 'sphere' | 'ring'
```

```ts
if (options.shape === 'ring') {
  const angle = this.rng.range(0, Math.PI * 2)
  const speed = options.speed * this.rng.range(0.82, 1.08)
  this.velocity[offset] = Math.cos(angle) * speed
  this.velocity[offset + 1] = options.speed * this.rng.range(-0.08, 0.14)
  this.velocity[offset + 2] = Math.sin(angle) * speed
} else if (options.shape === 'sphere') {
  // Preserve the current spherical branch unchanged.
} else {
  // Preserve the current fountain branch unchanged.
}
```

- [ ] **Step 4: Run particle tests**

Run: `npx vitest run src/fx/particles.test.ts`

Expected: all particle tests PASS.

---

### Task 2: Replace uniform triplets with an escalating fireworks show

**Files:**
- Modify: `src/celebration/fireworks.ts:6-203`
- Test: `src/celebration/fireworks.test.ts:1-40`

**Interfaces:**
- Consumes: `ParticleBurst` with `fountain | sphere | ring` emission and the existing absolute celebration elapsed time.
- Produces: exported `FireworkPattern = 'peony' | 'ring' | 'willow' | 'finale'`; `FireworkLaunch.pattern`; deterministic eighteen-launch `FIREWORK_LAUNCHES`; `CelebrationSoundCue` extended with `'crackle'`; the unchanged public lifecycle `begin()`, `update()`, `reset()`, and `dispose()`.

- [ ] **Step 1: Replace the schedule test with escalation assertions**

Assert the show has three opening launches, a denser middle, a six-shell finale, varied patterns and heights, while all launch times stay inside the fixed window:

```ts
it('escalates from a three-shell fan into a six-shell finale', () => {
  expect(FIREWORK_LAUNCHES).toHaveLength(18)
  expect(FIREWORK_LAUNCHES.slice(0, 3).map(cue => cue.wave)).toEqual([1, 1, 1])
  expect(FIREWORK_LAUNCHES.filter(cue => cue.finale)).toHaveLength(6)
  expect(new Set(FIREWORK_LAUNCHES.map(cue => cue.pattern))).toEqual(
    new Set(['peony', 'ring', 'willow', 'finale']),
  )
  expect(Math.max(...FIREWORK_LAUNCHES.map(cue => cue.height))).toBeGreaterThan(11)
  expect(FIREWORK_LAUNCHES[0]?.at).toBe(4)
  expect(FIREWORK_LAUNCHES.at(-1)?.at).toBeLessThan(12)
})
```

- [ ] **Step 2: Add quality, reduced-motion, replay, and cue tests**

Keep the current stage-local/reset/dispose case, update expected capacities to `200` reduced and `560` enhanced, and expect eighteen launches after advancing through the show. Add a reduced-motion case verifying the same eighteen launches complete without exceeding the fixed pool and a reset/replay case verifying the second run emits the same launch count and cue sequence as the first.

```ts
function runShow(subject: CelebrationFireworks): string[] {
  const cues: string[] = []
  for (let elapsed = 0; elapsed < 13.9; elapsed += 0.05) {
    cues.push(...subject.update(0.05))
  }
  return cues
}

expect(subject.poolCapacity).toBe(200)
expect(subject.launchedCount).toBe(18)
expect(cues).toContain('crackle')
expect(cues.filter(cue => cue === 'finale').length).toBeGreaterThanOrEqual(1)
```

- [ ] **Step 3: Run the firework tests and confirm they fail**

Run: `npx vitest run src/celebration/fireworks.test.ts`

Expected: FAIL on the old launch count, pattern contract, capacities, and missing crackle cue.

- [ ] **Step 4: Define the richer launch contract and deterministic schedule**

Add `pattern` and optional `echo` fields. Use eighteen launches: a three-shell fan from `4.0–4.5`, six mixed peony/ring/willow shells from `5.8–9.45`, three crescendo shells around `10.0–10.4`, one central gold-white finale shell at `11.25`, and five surrounding finale shells at `11.7`. Alternate X offsets, Z offsets, heights, and palette colors so the display fills the camera framing rather than stacking at one point.

The exact terminal finale contract is:

```ts
{ at: 11.25, wave: 4, x: 0, z: 0.3, height: 11.6,
  color: PALETTE.cloud, pattern: 'finale', echo: false, finale: true },
{ at: 11.70, wave: 4, x: -4.2, z: 0.5, height: 9.4,
  color: PALETTE.flame, pattern: 'finale', echo: false, finale: true },
{ at: 11.70, wave: 4, x: -2.1, z: -0.1, height: 10.5,
  color: PALETTE.smockB, pattern: 'finale', echo: false, finale: true },
{ at: 11.70, wave: 4, x: 0, z: -0.5, height: 9.8,
  color: PALETTE.ember, pattern: 'finale', echo: false, finale: true },
{ at: 11.70, wave: 4, x: 2.1, z: -0.1, height: 10.5,
  color: PALETTE.smockC, pattern: 'finale', echo: false, finale: true },
{ at: 11.70, wave: 4, x: 4.2, z: 0.5, height: 9.4,
  color: PALETTE.bloom, pattern: 'finale', echo: false, finale: true },
```

- [ ] **Step 5: Add pooled anticipation and flash state**

Increase fixed capacity to `200` reduced / `560` enhanced and rocket slots from four to six. Store tube materials so their emissive value can rise during gathering. Add fixed arrays for:

```ts
type EchoBurst = { at: number; x: number; y: number; z: number; color: string }
type FlashSlot = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  age: number
  life: number
}
```

Construct eight hidden flash spheres once. During `2.6–4.0s`, pulse tube emissive intensity and emit bounded one-particle ember sputters at a slower interval under reduced motion. Do not add point lights or per-frame geometry.

- [ ] **Step 6: Add pattern-specific burst recipes and echoes**

Keep one private `burst(launch, x, y, z)` method that maps:

- `peony` to a medium spherical bloom;
- `ring` to a crisp ring plus a small contrasting spherical center;
- `willow` to a slower, longer-lived spherical fall with stronger gravity and warm accent particles;
- `finale` to a large sphere plus ring, using the launch color and gold/white accents.

Scale counts by quality first, then multiply by `0.55` under reduced motion. Only launches marked `echo` schedule one small crackle bloom `0.22s` later, and skip echo scheduling entirely when reduced motion is active. Every explosion acquires one flash slot, makes it visible for about `0.16s`, and returns it to hidden state through the normal update loop.

- [ ] **Step 7: Coalesce simultaneous sound cues**

Within each `update()`, return at most one cue of each type even when several rockets launch or burst on the same frame. Preserve chronological priority as `launch`, `pop`, `crackle`, `finale`. This prevents the six-shell finale from exhausting the global six-voice audio cap while still making each beat audible.

- [ ] **Step 8: Reset and dispose every new pooled resource**

`reset()` must clear echoes, sputter timers, flash ages/visibility, tube emissive colors, rockets, particles, elapsed time, and launch count. `dispose()` must dispose each flash material plus the shared flash geometry exactly once, alongside the existing tubes, rockets, and particle pool.

- [ ] **Step 9: Run the focused visual-system tests**

Run: `npx vitest run src/fx/particles.test.ts src/celebration/fireworks.test.ts`

Expected: all tests PASS with deterministic replay and bounded pools.

---

### Task 3: Strengthen audio beats and village choreography

**Files:**
- Modify: `src/audio/sfx.ts:8-42,138-145`
- Test: `src/audio/sfx.test.ts:14-19`
- Modify: `src/celebration/director.ts:104-139`
- Test: `src/celebration/director.test.ts:92-105`
- Modify: `src/villagers/villager.ts:1670-1709`

**Interfaces:**
- Consumes: the existing `CelebrationDirector` phase signals and firework sound callback.
- Produces: shared `CelebrationSoundCue = 'launch' | 'pop' | 'crackle' | 'finale' | 'cheer'`; one synchronized cheer at the start of the finale; anticipation pointing, alternating claps, and a unified finale jump.

- [ ] **Step 1: Write failing sound-profile and finale-cheer assertions**

Extend the audio profile test:

```ts
expect(celebrationSoundProfile('crackle')).toMatchObject({
  kind: 'tone', from: 980, seconds: 0.11,
})
expect(celebrationSoundProfile('pop')).toMatchObject({ kind: 'knock', seconds: 0.22 })
expect(celebrationSoundProfile('finale')).toMatchObject({ kind: 'knock', seconds: 0.36 })
```

In the director phase test, assert `onSound('cheer')` fires when the clock crosses into `finale` and does not fire a second time on completion.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run src/audio/sfx.test.ts src/celebration/director.test.ts`

Expected: FAIL because `crackle` is missing and cheer still fires at completion.

- [ ] **Step 3: Add the crackle profile and fuller bounded beats**

Use these profiles:

```ts
if (cue === 'launch') {
  return { kind: 'tone', from: 210, to: 1040, seconds: 0.46, volume: 0.021 }
}
if (cue === 'pop') {
  return { kind: 'knock', from: 118, to: 72, seconds: 0.22, volume: 0.044 }
}
if (cue === 'crackle') {
  return { kind: 'tone', from: 980, to: 620, seconds: 0.11, volume: 0.012 }
}
if (cue === 'finale') {
  return { kind: 'knock', from: 88, to: 46, seconds: 0.36, volume: 0.058 }
}
return { kind: 'tone', from: 310, to: 620, seconds: 0.34, volume: 0.026 }
```

Keep `celebration()` on the existing bounded oscillator/knock path; simultaneous firework cues are already coalesced by Task 2.

- [ ] **Step 4: Move the synchronized cheer to finale entry**

In `handleSignal()`, emit `onSound('cheer')` only inside the `signal === 'finale'` branch, after switching participants to the finale phase. Completion should release active work without emitting another cheer.

- [ ] **Step 5: Enrich the existing phase-based villager poses**

Keep the current arrival and reduced-motion gates. In gathering, alternate which arm points skyward by participant order and add only a tiny non-reduced-motion bounce. During fireworks, preserve clapping but add a subtle alternating lean and slightly larger `0.10` bounce. During the finale, keep both arms overhead and raise the synchronized non-reduced-motion jump from `0.12` to `0.18`; do not create a new villager state or animation system.

- [ ] **Step 6: Run audio, director, and villager tests**

Run: `npx vitest run src/audio/sfx.test.ts src/celebration/director.test.ts src/villagers/villager.test.ts`

Expected: all tests PASS.

---

### Task 4: Update architecture and verify the whole project

**Files:**
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: the completed particle, fireworks, audio, director, and villager behavior.
- Produces: an accurate source-of-truth description; no runtime interface.

- [ ] **Step 1: Update the celebration and particle architecture bullets**

Document the eighteen-launch escalating schedule, peony/ring/willow/finale recipes, six reusable rockets, `200/560` dedicated particle capacity, pooled flash cores, deterministic echo crackles, coalesced sound cues, finale-entry cheer, and reduced-motion behavior. Update the generic `ParticleBurst` bullet to list ring emission beside fountain and sphere.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 3: Run type-check and production build**

Run: `npm run lint`

Expected: TypeScript exits successfully with no diagnostics.

Run: `npm run build`

Expected: TypeScript and Vite production build both succeed.

- [ ] **Step 4: Inspect change hygiene**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only the approved fireworks implementation, tests, architecture update, and this plan are modified; `STATUS.md` remains untouched.

- [ ] **Step 5: Perform live visual QA**

Start the existing Vite development server and trigger **Celebrate Again** from a completed Journal. Verify the tubes glow and sputter before launch, the fan opens across the full camera view, rings and willow falls read as distinct clay silhouettes, the middle overlaps without starving the pool, the central gold-white shell cues five surrounding finale blooms, the crowd cheers at finale entry, and the embers clear cleanly before replay. Repeat with reduced motion and `?lowfx=1`, then replay twice and confirm no duplicate meshes, audio storms, or stale particles.

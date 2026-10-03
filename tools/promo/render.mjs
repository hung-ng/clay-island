// Scripted promo capture (see README.md beside this file). Usage:
//   node video.mjs preview   -> a few stills per shot at 960x540 (framing check)
//   node video.mjs final [A|B] -> every frame at 1920x1080 / 30fps into frames/
//     A records the day shots, B the night ones; each replays what comes before
//     it unrecorded, so the halves can render as separate runs.
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { open } from './harness.mjs'

const mode = process.argv[2] ?? 'preview'
const final = mode === 'final'
const checkShot = mode === 'check' ? process.argv[3] : null
const W = final ? 1920 : 960, H = final ? 1080 : 540
const FPS = final || checkShot ? 30 : 10
const part = final ? (process.argv[3] ?? 'all') : 'all'
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out', final ? 'frames' : 'preview')
if (!final || part === 'all') rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const NIGHT_FROM = 'to-night'

const vt = await open({
  width: W, height: H,
  storage: { 'clayisland.introSeen': 'true', 'clayisland.autoRotate': 'false', 'clayisland.timeOfDay': 'auto' },
})
const { page } = vt

// --- camera helpers (island-local coordinates, converted in-page) ---------
const lerp = (a, b, t) => a + (b - a) * t
const ease = t => t * t * (3 - 2 * t)
const orbit = ({ target, angle, dist, height }) => {
  const a = angle * Math.PI / 180
  return {
    target,
    position: { x: target.x + Math.sin(a) * dist, y: target.y + height, z: target.z + Math.cos(a) * dist },
  }
}
const mix = (p, q, t) => ({
  target: { x: lerp(p.target.x, q.target.x, t), y: lerp(p.target.y, q.target.y, t), z: lerp(p.target.z, q.target.z, t) },
  angle: lerp(p.angle, q.angle, t), dist: lerp(p.dist, q.dist, t), height: lerp(p.height, q.height, t),
})
const move = (from, to, curve = ease) => t => orbit(mix(from, to, curve(t)))

async function setCamera(pose) {
  await page.evaluate((pose) => {
    const { camera, island } = window.__clay
    // Scripted framing, not player framing: the 'photo' lock stops OrbitControls
    // applying its distance/angle limits, and a high lift lets the aim rise
    // above the ground (aims must stay inside the 7.5m target radius).
    camera.lock('photo')
    camera.setTargetLift(50)
    const toScene = (p) => island.group.localToWorld(camera.controls.target.clone().set(p.x, p.y, p.z))
    const position = toScene(pose.position), target = toScene(pose.target)
    camera.setPose({ position: { x: position.x, y: position.y, z: position.z }, target: { x: target.x, y: target.y, z: target.z } })
  }, pose)
}
const act = (fn, arg) => page.evaluate(fn, arg)
const cast = (power, x, z) => act(([p, x, z]) => window.__clay.powers.cast(p, x, z), [power, x, z])

// --- the shots ---------------------------------------------------------
const V = (x, y, z) => ({ x, y, z })
const shots = [
  {
    name: 'establish', seconds: 3.6,
    camera: move(
      { target: V(0, 0.6, 0), angle: 150, dist: 34, height: 15 },
      { target: V(-0.5, 0.8, 0.5), angle: 185, dist: 17, height: 6.5 },
    ),
  },
  {
    // Looking along the fall's side-on axis, aimed high so the streak crosses
    // from top right before the hit, with the village at frame left.
    name: 'meteor', seconds: 4.3,
    events: [[0.1, () => cast('meteor', 6.5, -6.5)]],
    // Slow motion (game time) for the last of the fall and the hit.
    timeScale: gameT => (gameT >= 1.0 && gameT <= 1.5 ? 0.35 : 1),
    camera: move(
      { target: V(4.5, 5.2, -4.5), angle: 225, dist: 18, height: 1.8 },
      { target: V(4.8, 4.4, -4.8), angle: 219, dist: 15.5, height: 2.2 },
    ),
  },
  {
    name: 'lightning', seconds: 2.8,
    events: [[0.1, () => cast('lightning', -4.7, 5)]],
    // From the village looking out at the tree, so the bolt drops into open sky.
    camera: move(
      { target: V(-4.5, 4, 4.8), angle: 136, dist: 11.5, height: 2.5 },
      { target: V(-4.5, 3.8, 4.8), angle: 140, dist: 10.5, height: 2.3 },
    ),
  },
  {
    name: 'rain', seconds: 4.0,
    events: [[0.05, () => cast('rain', -4.5, 4.6)]],
    camera: move(
      { target: V(-4.5, 3.8, 4.8), angle: 140, dist: 10.5, height: 2.3 },
      { target: V(-4, 3, 4.4), angle: 155, dist: 14.5, height: 4 },
    ),
  },
  // Unrecorded: let the rain finish and send the clock to night.
  { name: 'to-night', seconds: 5, record: false, events: [[0, () => act(() => window.__clay.dayClock.setMode('night'))]] },
  {
    name: 'night', seconds: 4.4,
    camera: move(
      { target: V(0, 1.2, 0), angle: 140, dist: 14.5, height: 6.5 },
      { target: V(0, 1.2, 0), angle: 200, dist: 13, height: 5.5 },
      t => t,
    ),
  },
  // Unrecorded: the celebration queues until the Moment toasts clear, then the
  // villagers gather; roll on until just before the first launch (4s in).
  {
    name: 'gather', seconds: 3.4, record: false,
    events: [[0, () => act(() => window.__clay.celebration.request())]],
    until: () => act(() => window.__clay.celebration.active),
    camera: () => orbit({ target: V(0, 8, 0), angle: 165, dist: 20, height: -5 }),
  },
  {
    name: 'fireworks', seconds: 8.6,
    camera: move(
      { target: V(0, 8, 0), angle: 165, dist: 20, height: -5 },
      { target: V(0, 8.2, 0), angle: 186, dist: 19, height: -5 },
      t => t,
    ),
  },
  // End card: the toy's own title plaque fades in over the finale.
  {
    name: 'title', seconds: 2.6,
    events: [[0, () => act(() => {
      const layer = document.getElementById('title-layer')
      const plaque = document.getElementById('title-plaque')
      plaque.hidden = false
      document.getElementById('begin-btn').hidden = false
      layer.dataset.mode = 'begin'
    })]],
    camera: move(
      { target: V(0, 8.2, 0), angle: 186, dist: 19, height: -5 },
      { target: V(0, 8.3, 0), angle: 190, dist: 19.5, height: -4.8 },
      t => t,
    ),
  },
]

// --- run ---------------------------------------------------------------
await vt.run(0.3)
await page.click('#begin-btn')
await vt.run(0.3)
await page.click('#intro-skip')
await vt.run(2.5)
// UI chrome off for a clean frame; Moment toasts stay (they're part of the toy).
await page.addStyleTag({ content: '#tray,#settings-btn{visibility:hidden!important}' })

let frame = 0
let inB = false
for (const [shotIndex, shot] of shots.entries()) {
  if (shot.name === NIGHT_FROM) inB = true
  if (part === 'A' && inB) break
  const inPart = part === 'all' || (part === 'A' ? !inB : inB)
  const record = shot.record !== false && inPart
  const fps = record ? FPS : 10
  if (shot.until) {
    for (const [, event] of shot.events ?? []) await event()
    shot.events = []
    let waited = 0
    while (!(await shot.until())) {
      if (shot.camera) await setCamera(shot.camera(0))
      await page.evaluate(ms => window.__vt.step(ms), 1000 / fps)
      if (++waited > fps * 30) throw new Error(`${shot.name}: condition never held`)
    }
    console.log(`  ${shot.name}: condition held after ${(waited / fps).toFixed(1)}s`)
  }
  const frames = Math.round(shot.seconds * fps)
  const events = [...(shot.events ?? [])]
  const stills = new Set(final ? [] : checkShot === shot.name
    ? Array.from({ length: frames }, (_, k) => k)
    : checkShot ? [] : [0, Math.floor(frames / 3), Math.floor(2 * frames / 3), frames - 1])
  const started = Date.now()
  console.log(`shot ${shot.name}: ${frames} frames${record ? '' : ' (unrecorded)'}`)
  let gameT = 0
  for (let i = 0; i < frames; i++) {
    const t = i / frames
    while (events.length && events[0][0] <= gameT) await events.shift()[1]()
    if (shot.camera) await setCamera(shot.camera(t))
    const scale = shot.timeScale ? shot.timeScale(gameT) : 1
    gameT += scale / fps
    await page.evaluate(ms => window.__vt.step(ms), 1000 * scale / fps)
    if (!record) continue
    if (final) {
      const name = `${String(shotIndex).padStart(2, '0')}-${String(i).padStart(4, '0')}.jpg`
      await page.screenshot({ path: `${outDir}/${name}`, type: 'jpeg', quality: 94, timeout: 180000 })
      if (frame % 30 === 0) console.log(`  frame ${frame}`)
    } else if (stills.has(i)) {
      await page.screenshot({ path: `${outDir}/${String(frame).padStart(5, '0')}-${shot.name}-${i}.png`, timeout: 180000 })
    }
    frame++
  }
  if (checkShot === shot.name) break
  console.log(`  ${shot.name} took ${((Date.now() - started) / 1000).toFixed(0)}s (${((Date.now() - started) / frames / 1000).toFixed(2)}s/frame)`)
}
console.log('done', frame, 'frames')
await vt.close()

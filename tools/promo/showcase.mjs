// Feature showcase capture (see README.md beside this file).
//   node showcase.mjs preview        stills at 960x540 (four per shot) into preview/
//   node showcase.mjs final [A..D]   1920x1080 @30fps frames + audio into frames/
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { open } from './harness.mjs'

const mode = process.argv[2] ?? 'preview'
const final = mode === 'final'
// final: which section to record; preview: comma-separated sections to still
const part = final ? (process.argv[3] ?? 'all') : 'all'
const previewOnly = !final && process.argv[3] ? process.argv[3].split(',') : null
const W = final ? 1920 : 960, H = final ? 1080 : 540
const REC_FPS = final ? 30 : 10
const SKIP_FPS = 10
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out', final ? 'frames' : 'preview')
if (!final) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const vt = await open({ width: W, height: H, storage: { 'clayisland.autoRotate': 'false' } })
const { page } = vt

// --- state ------------------------------------------------------------------
let section = 'A'
let recording = false
let frameNo = 0
let shotName = 'start'
let shotFrame = 0
let dayT = null
const cursor = { x: W * 0.8, y: H * 1.1, shown: false, down: false }
const isRecording = () => recording

await page.addStyleTag({ content: `
  #settings-btn { visibility: hidden !important; }
  #cap-cursor { position: fixed; left: 0; top: 0; width: ${W / 1920 * 44}px; height: ${W / 1920 * 44}px; z-index: 2147483647;
    pointer-events: none; opacity: 0; transition: none; transform-origin: 3px 2px;
    filter: drop-shadow(0 ${W / 1920 * 3}px ${W / 1920 * 3}px rgba(0,0,0,.35)); }
  #cap-cursor svg { width: 100%; height: 100%; display: block; }
` })
await page.evaluate(() => {
  const el = document.createElement('div')
  el.id = 'cap-cursor'
  el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.5 15 L10.5 21.5 L13.5 20.2 L10.6 13.8 L16.5 13.8 Z" fill="#fffaf2" stroke="#3d3436" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  document.body.appendChild(el)
})

async function drawCursor() {
  await page.evaluate(c => {
    const el = document.getElementById('cap-cursor')
    el.style.opacity = c.shown ? '1' : '0'
    el.style.transform = `translate(${c.x - 3}px, ${c.y - 2}px) scale(${c.down ? 0.86 : 1})`
  }, cursor)
}

// --- camera -----------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t
const ease = t => t * t * (3 - 2 * t)
const V = (x, y, z) => ({ x, y, z })
const orbit = ({ target, angle, dist, height }) => {
  const a = angle * Math.PI / 180
  return { target, position: { x: target.x + Math.sin(a) * dist, y: target.y + height, z: target.z + Math.cos(a) * dist } }
}
const mixPose = (p, q, t) => ({
  target: V(lerp(p.target.x, q.target.x, t), lerp(p.target.y, q.target.y, t), lerp(p.target.z, q.target.z, t)),
  angle: lerp(p.angle, q.angle, t), dist: lerp(p.dist, q.dist, t), height: lerp(p.height, q.height, t),
})
const still = p => () => orbit(p)
const move = (p, q, curve = ease) => t => orbit(mixPose(p, q, curve(t)))

async function setCamera(pose) {
  await page.evaluate((pose) => {
    const { camera, island } = window.__clay
    camera.lock('photo')
    camera.setTargetLift(50)
    const toScene = p => island.group.localToWorld(camera.controls.target.clone().set(p.x, p.y, p.z))
    const position = toScene(pose.position), target = toScene(pose.target)
    camera.setPose({ position: { x: position.x, y: position.y, z: position.z }, target: { x: target.x, y: target.y, z: target.z } })
  }, pose)
}

/** Screen position of an island-local point (`ground` snaps it to the surface). */
async function toScreen(p, ground = false) {
  return page.evaluate(([p, w, h, ground]) => {
    const { camera, island } = window.__clay
    const y = ground ? island.sampleHeight(p.x, p.z) : p.y
    const v = island.group.localToWorld(camera.controls.target.clone().set(p.x, y, p.z)).project(camera.controls.object)
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h }
  }, [p, W, H, ground])
}
async function centerOf(selector) {
  return page.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, selector)
}

// --- frames -----------------------------------------------------------------
let currentCamera = null
let gameT = 0

async function frame({ timeScale = 1 } = {}) {
  const fps = recording ? REC_FPS : SKIP_FPS
  if (currentCamera) await setCamera(currentCamera())
  if (dayT !== null) await page.evaluate(t => { window.__clay.dayClock.t = t }, dayT)
  const ms = 1000 * timeScale / fps
  gameT += ms / 1000
  await vt.frame(ms, recording ? 1 / fps : ms / 1000, recording && final)
  if (!recording) return
  if (final) {
    await page.screenshot({ path: `${outDir}/${section}-${String(frameNo).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 94, timeout: 180000 })
  }
  frameNo++
  shotFrame++
}

/** Play `seconds` of video; `camera(t)` and `each(t)` get shot progress 0..1. */
async function play(seconds, { camera = null, each = null, timeScale = null } = {}) {
  const fps = recording ? REC_FPS : SKIP_FPS
  const n = Math.max(1, Math.round(seconds * fps))
  const stills = new Set([0, Math.floor(n / 2), n - 1])
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1)
    if (camera) currentCamera = () => camera(t)
    if (each) await each(t)
    await frame({ timeScale: timeScale ? timeScale(t) : 1 })
    if (!final && recording && stills.has(i) && (!previewOnly || previewOnly.includes(section))) {
      await page.screenshot({ path: `${outDir}/${String(frameNo).padStart(5, '0')}-${section}-${shotName}-${i}.png`, timeout: 180000 })
    }
  }
}

/** Skip (unrecorded) until `predicate` holds in the page, up to `max` seconds. */
async function until(predicate, max = 60, arg = null) {
  const wasRecording = recording
  recording = false
  let waited = 0
  while (!(await page.evaluate(predicate, arg))) {
    await frame()
    waited += 1 / SKIP_FPS
    if (waited > max) { console.log(`  until: gave up after ${max}s`); break }
  }
  recording = wasRecording
  console.log(`  waited ${waited.toFixed(1)}s`)
}
async function skip(seconds) {
  const wasRecording = recording
  recording = false
  await play(seconds)
  recording = wasRecording
}

function shot(name) {
  shotName = name
  shotFrame = 0
  console.log(`[${section}] ${name} @ video frame ${frameNo}`)
}
function startSection(name) {
  section = name
  recording = part === 'all' || part === name
  console.log(`== section ${name} (${recording ? 'recording' : 'skipping'})`)
}

// --- cursor gestures --------------------------------------------------------
async function glideCursor(dest, seconds, opts = {}) {
  const from = { x: cursor.x, y: cursor.y }
  cursor.shown = true
  await play(seconds, {
    ...opts,
    each: async t => {
      const to = typeof dest === 'function' ? await dest() : dest
      const k = ease(t)
      // A little arc, like a hand moving rather than a plotter.
      const lift = Math.sin(Math.PI * k) * Math.min(80, Math.hypot(to.x - from.x, to.y - from.y) * 0.15)
      cursor.x = lerp(from.x, to.x, k)
      cursor.y = lerp(from.y, to.y, k) - lift
      await page.mouse.move(cursor.x, cursor.y)
      await drawCursor()
    },
  })
}
async function press(down) {
  cursor.down = down
  if (down) await page.mouse.down(); else await page.mouse.up()
  await drawCursor()
}
async function hideCursor() {
  cursor.shown = false
  await drawCursor()
}

/** Drag a power from the tray and drop it on an island-local point. */
async function dragPower(power, target, { toButton = 0.5, toTarget = 0.75, camera = null, snap = true } = {}) {
  const button = await centerOf(`button[data-power="${power}"]`)
  await glideCursor(button, toButton, { camera })
  await press(true)
  await play(0.12, { camera })
  // Targeting raycasts the ground, so aim at the surface under the target;
  // a moving target is re-read every frame so the hand follows it.
  const drop = async () => toScreen(typeof target === 'function' ? await target() : target, snap)
  await glideCursor(drop, toTarget, { camera })
  for (let i = 0; i < 2; i++) {
    const at = await drop()
    cursor.x = at.x; cursor.y = at.y
    await page.mouse.move(at.x, at.y)
    await drawCursor()
    await play(0.07, { camera })
  }
  await press(false)
}
async function click(selector, seconds = 0.5, camera = null) {
  await glideCursor(await centerOf(selector), seconds, { camera })
  await press(true)
  await play(0.08, { camera })
  await press(false)
}

const world = (fn, arg) => page.evaluate(fn, arg)

// ============================================================================
// The show
// ============================================================================
startSection('A')

shot('title')
await play(1.4)
await glideCursor(await centerOf('#begin-btn'), 0.9)
await play(0.25)
await press(true)
await play(0.08)
await press(false)
await hideCursor()

shot('intro')
// The prologue's own camera and clock; a touch faster than real time.
await (async () => {
  let guard = 0
  while (!(await page.evaluate(() => !document.getElementById('tray').classList.contains('gameplay-hidden')))) {
    await frame({ timeScale: 1.35 })
    if (++guard > 30 * 25) break
  }
})()
await play(0.6)

// ---------------------------------------------------------------------------
startSection('B')
dayT = 212

shot('village-life')
await play(4.2, { camera: move(
  { target: V(-2, 1.1, 0.5), angle: 150, dist: 11.5, height: 4.2 },
  { target: V(-1.5, 1.1, 0.8), angle: 182, dist: 10, height: 3.8 },
) })

const CRATER = V(6.5, 0.4, -6.5)
const meteorCam = { target: V(4.6, 2.6, -4.6), angle: 222, dist: 19, height: 5 }
shot('meteor')
await play(0.3, { camera: still(meteorCam) })
await dragPower('meteor', CRATER, { camera: still(meteorCam) })
await hideCursor()
await play(3.4, {
  camera: move(meteorCam, { ...meteorCam, dist: 17, height: 5.5 }),
  // Slow motion over the end of the fall and the hit.
  timeScale: t => (t > 0.24 && t < 0.42 ? 0.4 : 1),
})

const pondCam = { target: V(5.8, 0.6, -5.8), angle: 220, dist: 14, height: 9 }
shot('rain-fills-crater')
await play(0.4, { camera: move({ ...meteorCam, dist: 17, height: 5.5 }, pondCam) })
await dragPower('rain', CRATER, { camera: still(pondCam), snap: false })
await hideCursor()
await play(6, { camera: move(pondCam, { ...pondCam, angle: 212, dist: 13 }) })

// A nudge on a stocked pond suggests fishing to whoever is idle.
shot('nudge-fishing')
const pondCam3 = { ...pondCam, angle: 212, dist: 13 }
await dragPower('nudge', CRATER, { camera: still(pondCam3), snap: false })
await hideCursor()
await play(1.6, { camera: move(pondCam3, { ...pondCam3, dist: 12 }) })
shot('gone-fishing')
await until(() => window.__clay.world.villagers.some(v => v.state === 'fish' && v.rod?.visible), 60)
const fisher = await world(() => {
  const v = window.__clay.world.villagers.find(v => v.state === 'fish' && v.rod?.visible)
  return v ? { x: v.x, z: v.z } : null
})
// Behind the angler, looking over their shoulder at the pond.
const fishAngle = fisher ? Math.atan2(fisher.x - CRATER.x, fisher.z - CRATER.z) * 180 / Math.PI + 30 : 220
const fishTarget = fisher ? V(lerp(fisher.x, CRATER.x, 0.35), 0.8, lerp(fisher.z, CRATER.z, 0.35)) : CRATER
const fishCam = { target: fishTarget, angle: fishAngle, dist: 8, height: 3.2 }
await play(3.4, { camera: move(fishCam, { ...fishCam, angle: fishAngle - 12, dist: 7.4 }) })

shot('lightning-pond')
const strikeCam = { target: fishTarget, angle: fishAngle - 12, dist: 9.5, height: 4.6 }
await play(0.4, { camera: move({ ...fishCam, angle: fishAngle - 12, dist: 7.4 }, strikeCam) })
await dragPower('lightning', CRATER, { camera: still(strikeCam), snap: false })
await hideCursor()
await play(3.4, { camera: move(strikeCam, { ...strikeCam, dist: 8.8 }) })

// ---------------------------------------------------------------------------
startSection('C')
dayT = 212

// The forest changes as villagers chop and saplings grow, so find a standing
// pair close enough for fire to jump between them.
const pair = await world(() => {
  const trees = window.__clay.world.trees.filter(t => t.state === 'normal' && !t.burning && !t.burnt)
  let best = null
  for (const a of trees) for (const b of trees) {
    if (a === b) continue
    const d = Math.hypot(a.x - b.x, a.z - b.z)
    const r = Math.hypot(a.x, a.z)
    // Far enough out that the rain to put it out won't douse the campfire.
    if (d < 2.8 && r > 6.2 && Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) > 6 && (!best || d < best.d)) best = { a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, d }
  }
  return best
})
console.log('  tree pair', pair)
const TREE = V(pair.a.x, 1, pair.a.z)
const mid = { x: (pair.a.x + pair.b.x) / 2, z: (pair.a.z + pair.b.z) / 2 }
// From outside the pair looking in, so the village sits behind the trees.
const fireCam = {
  target: V(mid.x, 2.2, mid.z),
  angle: Math.atan2(mid.x, mid.z) * 180 / Math.PI + 25,
  dist: 12, height: 3.8,
}
shot('wildfire')
await play(0.3, { camera: still(fireCam) })
await dragPower('lightning', TREE, { camera: still(fireCam) })
await hideCursor()
await play(2.2, { camera: move(fireCam, { ...fireCam, dist: 12 }) })
await until(() => window.__clay.world.trees.filter(t => t.burning).length >= 2, 20)
await play(1.6, { camera: still({ ...fireCam, dist: 12 }) })
shot('firefighter')
await dragPower('rain', V(mid.x, 1, mid.z), { camera: still({ ...fireCam, dist: 12 }) })
await hideCursor()
await play(4, { camera: move({ ...fireCam, dist: 12 }, { ...fireCam, angle: fireCam.angle - 14, dist: 13.5, height: 5 }) })

const HUT = V(4.1, 0.8, 0.3)
const hutCam = { target: V(3.2, 1.3, 0.3), angle: 268, dist: 14, height: 5 }
shot('homewrecker')
await play(0.3, { camera: still(hutCam) })
await dragPower('meteor', HUT, { camera: still(hutCam) })
await hideCursor()
await play(3.4, {
  camera: move(hutCam, { ...hutCam, dist: 13 }),
  timeScale: t => (t > 0.26 && t < 0.4 ? 0.4 : 1),
})
// Rain on one villager: out comes a leaf umbrella, and a grumpy face.
shot('grumpy-rain')
const walker = await world(() => {
  // Out of the rain's reach of the campfire, which it would douse.
  const fire = window.__clay.world.campfire
  const away = v => Math.hypot(v.x - fire.x, v.z - fire.z)
  const vs = window.__clay.world.villagers
    .filter(v => v.alive && away(v) > 5.8 && Math.hypot(v.x, v.z) < 11)
    .sort((a, b) => Math.abs(away(a) - 7) - Math.abs(away(b) - 7))
  const v = vs[0] ?? window.__clay.world.villagers.find(v => v.alive)
  return v ? { id: v.id, x: v.x, z: v.z } : null
})
const villagerAt = () => world(id => {
  const v = window.__clay.world.villagers.find(v => v.id === id)
  return { x: v.x, y: 1, z: v.z }
}, walker.id)
const grumpCam = { target: V(walker.x, 1, walker.z), angle: Math.atan2(walker.x, walker.z) * 180 / Math.PI + 160, dist: 8, height: 3.2 }
await play(0.3, { camera: still(grumpCam) })
await dragPower('rain', villagerAt, { camera: still(grumpCam) })
await hideCursor()
const after = await villagerAt()
await play(3.8, { camera: move(grumpCam, { ...grumpCam, target: V(after.x, 1, after.z), dist: 6.5, height: 2.6 }) })

// ---------------------------------------------------------------------------
startSection('D')
dayT = 212

const windCam = { target: V(-1, 1, 0.8), angle: 200, dist: 17, height: 6.5 }
shot('wind')
await play(0.3, { camera: still(windCam) })
await dragPower('wind', V(-2.2, 1, 0.4), { camera: still(windCam) })
await play(3.6, { camera: move(windCam, { ...windCam, angle: 206, dist: 16 }) })

shot('journal')
await click('#journal-btn', 0.6, still({ ...windCam, angle: 206, dist: 16 }))
await play(2.8, { camera: still({ ...windCam, angle: 206, dist: 16 }) })
await page.keyboard.press('Escape')
await hideCursor()
await play(0.6, { camera: still({ ...windCam, angle: 206, dist: 16 }) })

shot('sunset-timelapse')
await page.evaluate(() => document.getElementById('tray').classList.add('gameplay-hidden'))
await play(8, {
  camera: move(
    { target: V(0, 1.2, 0), angle: 150, dist: 30, height: 9 },
    { target: V(0, 1.2, 0), angle: 200, dist: 26, height: 7 },
    t => t,
  ),
  // Linear, so golden hour and dusk get their share of the shot.
  each: async t => { dayT = lerp(205, 262, t) },
})

shot('night-life')
dayT = 300
await play(4.4, { camera: move(
  { target: V(0, 1.2, 0), angle: 140, dist: 14.5, height: 6 },
  { target: V(0, 1.2, 0), angle: 195, dist: 12.5, height: 5 },
  t => t,
) })

shot('fireworks')
dayT = null
await world(() => window.__clay.celebration.request())
// Bursts open 10-16m up over a village 2m tall: a wider lens fits both while
// staying close enough for the bursts to fill the sky.
await page.evaluate(() => {
  const camera = window.__clay.camera.controls.object
  camera.fov = 52
  camera.updateProjectionMatrix()
})
const skyCam = { target: V(0, 8.2, 0), angle: 165, dist: 16, height: -4.4 }
currentCamera = () => orbit(skyCam)
await until(() => window.__clay.celebration.active, 20)
await play(9.4, { camera: move(skyCam, { ...skyCam, angle: 188, dist: 15 }, t => t) })

console.log('done', frameNo, 'frames')
if (final) {
  const audio = await vt.writeAudio(`${outDir}/${part}.wav`)
  console.log('audio', audio)
  writeFileSync(`${outDir}/${part}.json`, JSON.stringify({ frames: frameNo, audio }))
}
await vt.close()

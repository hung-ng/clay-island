import * as THREE from 'three'
import { Timeline } from '../core/timeline'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'
import { Power, type CastCtx } from './power'

type Actor = {
  start(): void
  remove(): void
}

let lightningAudio: AudioContext | null = null

function tone(kind: 'rumble' | 'crack', seconds: number): void {
  try {
    lightningAudio ??= new AudioContext()
    void lightningAudio.resume()
    const start = lightningAudio.currentTime
    const oscillator = lightningAudio.createOscillator()
    const gain = lightningAudio.createGain()
    oscillator.type = kind === 'rumble' ? 'sawtooth' : 'square'
    oscillator.frequency.setValueAtTime(kind === 'rumble' ? 58 : 940, start)
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'rumble' ? 34 : 120, start + seconds)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(kind === 'rumble' ? 0.035 : 0.09, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
    oscillator.connect(gain).connect(lightningAudio.destination)
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect()
      gain.disconnect()
    }, { once: true })
    oscillator.start(start)
    oscillator.stop(start + seconds)
  } catch {
    // Lightning remains fully legible when WebAudio is unavailable.
  }
}

function gatheringCloud(ctx: CastCtx): Actor {
  const group = new THREE.Group()
  group.name = 'lightning-cloud'
  group.position.set(ctx.x, 9, ctx.z)
  group.scale.setScalar(0.01)
  group.visible = false

  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const offsets = [
    [-0.72, 0, 0.08, 0.9],
    [0, 0.18, 0, 1.18],
    [0.72, -0.02, -0.08, 0.86],
  ] as const
  for (let i = 0; i < offsets.length; i++) {
    const geometry = wobble(new THREE.SphereGeometry(0.82, 12, 9), ctx.rng, 0.09)
    const material = clayMaterial(i === 1 ? PALETTE.scorch : PALETTE.stone)
    const blob = new THREE.Mesh(geometry, material)
    blob.name = 'lightning-cloud-blob'
    const [x, y, z, scale] = offsets[i]
    blob.position.set(x, y, z)
    blob.scale.set(scale, scale * 0.72, scale)
    blob.castShadow = true
    group.add(blob)
    geometries.push(geometry)
    materials.push(material)
  }
  ctx.island.group.add(group)

  let startedAt = Number.POSITIVE_INFINITY
  let removed = false
  const driver = group.children[0]
  driver.onBeforeRender = () => {
    if (!Number.isFinite(startedAt)) return
    const progress = Math.min(1, (performance.now() - startedAt) / 900)
    const scale = 0.01 + (1 - (1 - progress) ** 3) * 0.99
    group.scale.setScalar(scale)
    group.position.y = 9 + Math.sin(performance.now() * 0.004) * 0.08
  }

  return {
    start: () => {
      startedAt = performance.now()
      group.visible = true
    },
    remove: () => {
      if (removed) return
      removed = true
      ctx.island.group.remove(group)
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}

function boltGeometry(ctx: CastCtx, y0: number): Actor {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 8; i++) {
    const progress = i / 7
    points.push(new THREE.Vector3(
      ctx.x + (i === 7 ? 0 : ctx.rng.range(-0.6, 0.6)),
      THREE.MathUtils.lerp(25, y0, progress),
      ctx.z + (i === 7 ? 0 : ctx.rng.range(-0.6, 0.6)),
    ))
  }

  const material = clayMaterial(PALETTE.ghost, { flat: true })
  const geometries: THREE.BufferGeometry[] = []
  const group = new THREE.Group()
  group.name = 'lightning-bolt'
  group.visible = false

  const addTube = (path: THREE.Vector3[], radius: number): void => {
    const curve = new THREE.CatmullRomCurve3(path)
    const geometry = new THREE.TubeGeometry(curve, 32, radius, 4, false)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = radius > 0.05 ? 'lightning-main-bolt' : 'lightning-fork'
    mesh.castShadow = false
    group.add(mesh)
    geometries.push(geometry)
  }
  addTube(points, 0.075)

  for (const [index, side] of [[3, -1], [5, 1]] as const) {
    const start = points[index]
    const end = start.clone().add(new THREE.Vector3(
      ctx.rng.range(1.1, 1.8) * side,
      ctx.rng.range(-3.8, -2.4),
      ctx.rng.range(-1.3, 1.3),
    ))
    const middle = start.clone().lerp(end, 0.52)
    middle.x += ctx.rng.range(-0.35, 0.35)
    middle.z += ctx.rng.range(-0.35, 0.35)
    addTube([start.clone(), middle, end], 0.042)
  }

  ctx.island.group.add(group)
  let removed = false
  return {
    start: () => { group.visible = true },
    remove: () => {
      if (removed) return
      removed = true
      ctx.island.group.remove(group)
      for (const geometry of geometries) geometry.dispose()
      material.dispose()
    },
  }
}

function applyLightningOutcome(ctx: CastCtx): void {
  if (ctx.kind === 'tree' || ctx.kind === 'hut') {
    ctx.world.igniteTarget(ctx.kind, ctx.x, ctx.z)
    return
  }
  if (ctx.kind === 'villager') {
    ctx.world.villagerAt(ctx.x, ctx.z, 1.2)?.zap()
    return
  }
  if (ctx.kind === 'pond') {
    const pond = ctx.world.pondAt(ctx.x, ctx.z)
    if (pond?.floatFish()) ctx.bus.emit({ type: 'fish:floated' })
    return
  }
  if (ctx.kind === 'campfire') {
    ctx.world.campfire.flare(2, 3)
    ctx.bus.emit({ type: 'campfire:flared' })
  }
}

export class Lightning extends Power {
  readonly id = 'lightning' as const
  readonly cooldown = 3

  cast(ctx: CastCtx): Timeline {
    const y0 = ctx.island.sampleHeight(ctx.x, ctx.z)
    const cloud = gatheringCloud(ctx)
    const bolt = boltGeometry(ctx, y0)

    return new Timeline()
      .at(0, () => {
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        for (const villager of ctx.world.villagers) {
          if (villager.alive && Math.hypot(villager.x - ctx.x, villager.z - ctx.z) <= 4) {
            villager.emote('question')
          }
        }
        cloud.start()
        tone('rumble', 0.9)
      })
      .at(0.9, () => {
        bolt.start()
        ctx.fx.flash(PALETTE.ghost, 0.06)
        ctx.fx.shake.add(0.35, 0.24)
        tone('crack', 0.14)
        ctx.bus.emit({
          type: 'power:impact', power: this.id, target: ctx.kind, x: ctx.x, z: ctx.z,
        })
        applyLightningOutcome(ctx)
      })
      .at(0.9 + 2 / 12, () => bolt.remove())
      .at(1.2, () => cloud.remove())
      .at(3.4, () => {
        bolt.remove()
        cloud.remove()
      })
  }
}

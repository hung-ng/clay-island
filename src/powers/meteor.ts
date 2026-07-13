import * as THREE from 'three'
import { Timeline } from '../core/timeline'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'
import { Power, type CastCtx } from './power'

type AnimatedActor = {
  start(): void
  remove(): void
}

let whistleContext: AudioContext | null = null

function whistle(seconds: number): void {
  try {
    whistleContext ??= new AudioContext()
    void whistleContext.resume()
    const start = whistleContext.currentTime
    const oscillator = whistleContext.createOscillator()
    const gain = whistleContext.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(220, start)
    oscillator.frequency.exponentialRampToValueAtTime(980, start + seconds)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.045, start + seconds * 0.72)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
    oscillator.connect(gain).connect(whistleContext.destination)
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect()
      gain.disconnect()
    }, { once: true })
    oscillator.start(start)
    oscillator.stop(start + seconds)
  } catch {
    // Visual staging remains complete when WebAudio is unavailable.
  }
}

function growingShadow(parent: THREE.Object3D, x: number, y: number, z: number): AnimatedActor {
  const geometry = new THREE.CircleGeometry(1, 32)
  const material = new THREE.MeshBasicMaterial({
    color: PALETTE.scorch,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'meteor-shadow'
  mesh.position.set(x, y + 0.045, z)
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.setScalar(0.2)
  parent.add(mesh)

  let startedAt = Number.POSITIVE_INFINITY
  let removed = false
  mesh.onBeforeRender = () => {
    if (!Number.isFinite(startedAt)) return
    const progress = Math.min(1, (performance.now() - startedAt) / 1200)
    const scale = THREE.MathUtils.lerp(0.2, 2.6, progress)
    mesh.scale.setScalar(scale)
    material.opacity = THREE.MathUtils.lerp(0.18, 0.48, progress)
  }

  return {
    start: () => { startedAt = performance.now() },
    remove: () => {
      if (removed) return
      removed = true
      parent.remove(mesh)
      geometry.dispose()
      material.dispose()
    },
  }
}

function fallingMeteor(parent: THREE.Object3D, ctx: CastCtx, y0: number): AnimatedActor {
  const geometry = wobble(new THREE.IcosahedronGeometry(1.05, 1), ctx.rng, 0.16)
  const coreMaterial = clayMaterial(PALETTE.scorch)
  const rimMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.ember, side: THREE.BackSide })
  const core = new THREE.Mesh(geometry, coreMaterial)
  const rim = new THREE.Mesh(geometry, rimMaterial)
  rim.scale.setScalar(1.1)
  core.frustumCulled = false
  core.castShadow = true
  rim.frustumCulled = false

  const light = new THREE.PointLight(PALETTE.ember, 3.5, 10)
  const group = new THREE.Group()
  group.name = 'falling-meteor'
  group.visible = false
  group.add(rim, core, light)
  parent.add(group)

  const from = new THREE.Vector3(ctx.x + 6, 40, ctx.z - 6)
  const to = new THREE.Vector3(ctx.x, y0, ctx.z)
  let startedAt = Number.POSITIVE_INFINITY
  let removed = false
  core.onBeforeRender = () => {
    const progress = Math.min(1, (performance.now() - startedAt) / 1200)
    const eased = progress * progress
    group.position.lerpVectors(from, to, eased)
    group.rotation.set(progress * 4.5, progress * 6.2, progress * 2.8)
  }

  return {
    start: () => {
      startedAt = performance.now()
      group.position.copy(from)
      group.visible = true
    },
    remove: () => {
      if (removed) return
      removed = true
      parent.remove(group)
      geometry.dispose()
      coreMaterial.dispose()
      rimMaterial.dispose()
    },
  }
}

function dustRing(parent: THREE.Object3D, x: number, y: number, z: number): void {
  const geometry = new THREE.RingGeometry(0.72, 1, 48)
  const material = new THREE.MeshBasicMaterial({
    color: PALETTE.dirt,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.name = 'meteor-dust-ring'
  // Cleanup is driven by onBeforeRender; keep the ring renderable at edge casts
  // so a culled ring cannot remain allocated forever.
  ring.frustumCulled = false
  ring.position.set(x, y + 0.12, z)
  ring.rotation.x = -Math.PI / 2
  ring.scale.setScalar(0.45)
  parent.add(ring)

  const startedAt = performance.now()
  ring.onBeforeRender = () => {
    const progress = Math.min(1, (performance.now() - startedAt) / 850)
    ring.scale.setScalar(THREE.MathUtils.lerp(0.45, 4.2, progress))
    material.opacity = (1 - progress) * 0.5
    if (progress < 1) return
    parent.remove(ring)
    geometry.dispose()
    material.dispose()
  }
}

/** Temporary Task 12 outcome dispatch; Task 16 replaces this with the pure matrix. */
export function applyMeteorOutcome(ctx: CastCtx, y0: number): void {
  if (ctx.kind === 'tree') {
    ctx.world.igniteTarget('tree', ctx.x, ctx.z)
    ctx.world.destroyTarget('tree', ctx.x, ctx.z)
    return
  }
  if (ctx.kind === 'hut') {
    ctx.world.destroyTarget('hut', ctx.x, ctx.z)
    return
  }
  if (ctx.kind === 'villager') {
    ctx.world.killVillagerNear(ctx.x, ctx.z, 3, 'meteor')
    return
  }
  if (ctx.kind === 'pond') {
    if (!ctx.world.emptyPondAt(ctx.x, ctx.z)) return
    ctx.fx.particles.burst({
      x: ctx.x,
      y: y0 + ctx.island.group.position.y,
      z: ctx.z,
      n: 36,
      color: PALETTE.cloud,
      speed: 2.2,
      gravity: -0.35,
      size: 1.8,
      life: 1.5,
    })
    return
  }
  if (ctx.kind === 'campfire') ctx.world.scatterCampfire()
}

export class Meteor extends Power {
  readonly id = 'meteor' as const
  readonly cooldown = 6

  cast(ctx: CastCtx): Timeline {
    const y0 = ctx.island.sampleHeight(ctx.x, ctx.z)
    const parent = ctx.island.group
    const shadow = growingShadow(parent, ctx.x, y0, ctx.z)
    const rock = fallingMeteor(parent, ctx, y0)

    return new Timeline()
      .at(0, () => {
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        ctx.world.alarmNear(ctx.x, ctx.z, 7)
        whistle(1.2)
      })
      .at(0, () => shadow.start())
      .at(0, () => rock.start())
      .at(1.2, () => {
        rock.remove()
        shadow.remove()
        ctx.fx.shake.add(0.9, 0.6)
        const particleY = y0 + ctx.island.group.position.y
        ctx.fx.particles.burst({
          x: ctx.x, y: particleY, z: ctx.z, n: 160,
          color: PALETTE.dirt, speed: 9, gravity: 14, life: 1.4,
        })
        ctx.fx.particles.burst({
          x: ctx.x, y: particleY, z: ctx.z, n: 40,
          color: PALETTE.scorch, speed: 5, gravity: 3, life: 2.2,
        })
        ctx.island.addCrater({ x: ctx.x, z: ctx.z, radius: 2.8, depth: 1.3 })
        ctx.world.clearFlowersNear(ctx.x, ctx.z, 2.8)
        ctx.world.reground()
        ctx.island.scorch(ctx.x, ctx.z, 3.4)
        ctx.bus.emit({ type: 'crater:created', x: ctx.x, z: ctx.z })
        ctx.bus.emit({
          type: 'power:impact', power: this.id, target: ctx.kind, x: ctx.x, z: ctx.z,
        })
        applyMeteorOutcome(ctx, y0)
      })
      .at(1.3, () => ctx.world.igniteNear(ctx.x, ctx.z, 3.2, ctx.rng, 0.6))
      .at(1.5, () => dustRing(parent, ctx.x, y0, ctx.z))
      .at(4.2, () => {
        rock.remove()
        shadow.remove()
      })
  }
}

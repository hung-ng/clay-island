import * as THREE from 'three'
import { RNG } from '../core/rng'
import { Timeline } from '../core/timeline'
import { clayMaterial } from '../fx/clayMaterial'
import { flameClay } from '../fx/flameClay'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'
import { resolveInteraction } from './matrix'
import { applyInteractions } from './outcomes'
import { impactContext, type Power, type CastCtx } from './power'

type AnimatedActor = {
  start(): void
  remove(): void
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
  // Pushed past 1.0 so the molten rim blooms against the sky.
  const rimMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.ember, side: THREE.BackSide })
  rimMaterial.color.multiplyScalar(4)
  const core = new THREE.Mesh(geometry, coreMaterial)
  const rim = new THREE.Mesh(geometry, rimMaterial)
  rim.scale.setScalar(1.1)
  core.frustumCulled = false
  core.castShadow = true
  rim.frustumCulled = false

  const light = new THREE.PointLight(PALETTE.ember, 9, 14)
  const group = new THREE.Group()
  group.name = 'falling-meteor'
  group.visible = false
  group.add(rim, core, light)
  parent.add(group)

  // A tail of shrinking flame lumps, the same glowing clay as the campfire,
  // strung out behind the rock so the fall reads on camera as a streak.
  const trail = new THREE.Group()
  trail.name = 'meteor-trail'
  trail.visible = false
  const trailRng = new RNG(97)
  const trailGeometry = wobble(new THREE.IcosahedronGeometry(0.8, 2), trailRng, 0.12)
  const trailMaterials = [flameClay(true), flameClay(false)]
  for (let i = 0; i < TRAIL_PUFFS; i++) {
    const puff = new THREE.Mesh(trailGeometry, trailMaterials[i < 2 ? 0 : 1]!)
    puff.frustumCulled = false
    puff.scale.setScalar(0.85 * (1 - i / TRAIL_PUFFS) + 0.2)
    puff.rotation.set(trailRng.range(0, 6), trailRng.range(0, 6), trailRng.range(0, 6))
    trail.add(puff)
  }
  parent.add(trail)

  const from = new THREE.Vector3(ctx.x + 6, 40, ctx.z - 6)
  const to = new THREE.Vector3(ctx.x, y0, ctx.z)
  let startedAt = Number.POSITIVE_INFINITY
  let removed = false
  core.onBeforeRender = () => {
    const progress = Math.min(1, (performance.now() - startedAt) / 1200)
    const eased = progress * progress
    group.position.lerpVectors(from, to, eased)
    group.rotation.set(progress * 4.5, progress * 6.2, progress * 2.8)
    trail.children.forEach((puff, index) => {
      const behind = Math.max(0, progress - (index + 1) * TRAIL_SPACING)
      puff.position.lerpVectors(from, to, behind * behind)
      puff.visible = behind > 0
    })
  }

  return {
    start: () => {
      startedAt = performance.now()
      group.position.copy(from)
      group.visible = true
      trail.visible = true
    },
    remove: () => {
      if (removed) return
      removed = true
      parent.remove(group, trail)
      geometry.dispose()
      coreMaterial.dispose()
      rimMaterial.dispose()
      trailGeometry.dispose()
      for (const material of trailMaterials) material.dispose()
    },
  }
}

/**
 * The hit: a ring of flame lumps, the campfire's glowing clay, that pop out of
 * the crater, swell and shrink away, stepped at the villagers' 12fps so the
 * blast lands as stop-motion.
 */
function impactBurst(parent: THREE.Object3D, x: number, y: number, z: number): void {
  const rng = new RNG(131)
  const geometry = wobble(new THREE.IcosahedronGeometry(0.55, 2), rng, 0.1)
  const materials = [flameClay(true), flameClay(false)]
  const burst = new THREE.Group()
  burst.name = 'meteor-impact-burst'
  burst.position.set(x, y, z)
  const lumps: { mesh: THREE.Mesh; angle: number; reach: number; lift: number; size: number }[] = []
  for (let i = 0; i < IMPACT_LUMPS; i++) {
    const mesh = new THREE.Mesh(geometry, materials[i % 3 === 0 ? 0 : 1]!)
    mesh.frustumCulled = false
    mesh.rotation.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6))
    mesh.scale.setScalar(0.001)
    burst.add(mesh)
    lumps.push({
      mesh,
      angle: (i / IMPACT_LUMPS) * Math.PI * 2 + rng.range(-0.25, 0.25),
      reach: rng.range(1.2, 2.4),
      lift: rng.range(0.6, 1.6),
      size: rng.range(0.7, 1.25),
    })
  }
  parent.add(burst)

  const startedAt = performance.now()
  lumps[0]!.mesh.onBeforeRender = () => {
    const seconds = (performance.now() - startedAt) / 1000
    const held = Math.floor(seconds * 12) / 12
    const progress = Math.min(1, held / IMPACT_SECONDS)
    const out = 1 - (1 - progress) ** 2
    const swell = Math.sin(Math.min(1, progress * 1.15) * Math.PI)
    for (const lump of lumps) {
      lump.mesh.position.set(
        Math.cos(lump.angle) * lump.reach * out,
        0.3 + lump.lift * Math.sin(out * Math.PI * 0.8),
        Math.sin(lump.angle) * lump.reach * out,
      )
      lump.mesh.scale.setScalar(Math.max(0.001, lump.size * swell))
    }
    if (seconds < IMPACT_SECONDS) return
    parent.remove(burst)
    geometry.dispose()
    for (const material of materials) material.dispose()
  }
}

const TRAIL_PUFFS = 7
const IMPACT_LUMPS = 9
const IMPACT_SECONDS = 0.6
/** Fraction of the fall between trail puffs. */
const TRAIL_SPACING = 0.045

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

export class Meteor implements Power {
  readonly id = 'meteor' as const
  readonly cooldown = 6

  cast(ctx: CastCtx): Timeline {
    const y0 = ctx.island.sampleHeight(ctx.x, ctx.z)
    const parent = ctx.island.group
    const shadow = growingShadow(parent, ctx.x, y0, ctx.z)
    const rock = fallingMeteor(parent, ctx, y0)
    const atRisk = new Set<(typeof ctx.world.villagers)[number]>()

    return new Timeline()
      .at(0, () => {
        for (const villager of ctx.world.villagers) {
          if (villager.alive && Math.hypot(villager.x - ctx.x, villager.z - ctx.z) <= 3) {
            atRisk.add(villager)
          }
        }
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        ctx.world.warnNear(ctx.x, ctx.z, 9, 4.5)
        ctx.world.startleNear(ctx.x, ctx.z, 4.5)
      })
      .at(0, () => shadow.start())
      .at(0, () => rock.start())
      .at(1.2, () => {
        const impact = impactContext(ctx)
        rock.remove()
        shadow.remove()
        impactBurst(parent, ctx.x, y0, ctx.z)
        ctx.fx.shake.add(0.9, 0.6)
        const particleY = y0
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
        // A crater cut beside a lake joins its basin: the water spreads into the
        // new hollow and settles at the merged bowl's lowest rim.
        ctx.world.refloodBasins(ctx.rng, ctx.lowFx)
        ctx.island.scorch(ctx.x, ctx.z, 3.4)
        ctx.bus.emit({ type: 'crater:created', x: ctx.x, z: ctx.z })
        ctx.bus.emit({
          type: 'power:impact', power: this.id, target: impact.kind, x: ctx.x, z: ctx.z,
        })
        applyInteractions(resolveInteraction(this.id, impact.kind), impact, y0)
        for (const villager of ctx.world.villagers) {
          if (villager.alive && Math.hypot(villager.x - ctx.x, villager.z - ctx.z) <= 4.5) {
            villager.cower()
          }
        }
        for (const villager of atRisk) {
          if (villager.alive && Math.hypot(villager.x - ctx.x, villager.z - ctx.z) > 3) {
            ctx.bus.emit({ type: 'villager:escaped' })
            break
          }
        }
      })
      .at(1.3, () => ctx.world.igniteNear(ctx.x, ctx.z, 3.2, ctx.rng, 0.6))
      .at(1.5, () => dustRing(parent, ctx.x, y0, ctx.z))
      .at(4.2, () => {
        rock.remove()
        shadow.remove()
      })
  }
}

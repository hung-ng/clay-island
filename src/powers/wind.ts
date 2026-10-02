import * as THREE from 'three'
import { Timeline } from '../core/timeline'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'
import { ISLAND_RADIUS } from '../world/island'
import { resolveInteraction } from './matrix'
import { applyInteractions } from './outcomes'
import { impactContext, type Power, type CastCtx } from './power'

/** Wind gust tuning: one source for the module and the outcome handlers. */
export const WIND = {
  radius: 6,
  anticipationSeconds: 0.8,
  /** Let the crown begin bending before its fruit shakes loose. */
  fruitDropDelaySeconds: 0.25,
  gustSeconds: 2.5,
  /** Reduced motion keeps the outcomes but shortens the bounded gust. */
  reducedGustSeconds: 1.2,
  cooldown: 3,
  /** A fanned campfire throws one ember toward nearby intact fuel. */
  emberRadius: 4.5,
  emberChance: 1,
  /** Match ember targets to the visible downwind streaks. */
  emberHalfAngle: 50 * Math.PI / 180,
} as const

/** Outward from the island centre through the cast point: weather passing over. */
export function gustDirection(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z)
  if (length < 1e-6) return { x: 1, z: 0 }
  return { x: x / length, z: z / length }
}

type GustActor = {
  start(): void
  gust(): void
  settle(): void
  remove(): void
}

/** A bounded field of instanced leaf and dust streaks along the gust line. */
function gustField(ctx: CastCtx, reduced: boolean, gustSeconds: number): GustActor {
  const direction = gustDirection(ctx.x, ctx.z)
  const total = ctx.lowFx ? 28 : 84
  const group = new THREE.Group()
  group.name = 'wind-gust'
  group.position.set(ctx.x, 0, ctx.z)
  group.visible = false

  const geometry = wobble(new THREE.SphereGeometry(0.055, 6, 5), ctx.rng, 0.012)
  const leafMaterial = clayMaterial(PALETTE.leafA, { flat: true })
  const dustMaterial = clayMaterial(PALETTE.dirt, { flat: true })
  const leaves = new THREE.InstancedMesh(geometry, leafMaterial, Math.ceil(total * 0.6))
  const dust = new THREE.InstancedMesh(geometry, dustMaterial, Math.floor(total * 0.4))
  leaves.name = 'wind-leaves'
  dust.name = 'wind-dust'
  const dummy = new THREE.Object3D()
  dummy.scale.setScalar(0)
  dummy.updateMatrix()
  for (const mesh of [leaves, dust]) {
    mesh.frustumCulled = false
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, dummy.matrix)
    group.add(mesh)
  }

  const lane = new Float32Array(total)
  const along = new Float32Array(total)
  const phase = new Float32Array(total)
  const speed = new Float32Array(total)
  const height = new Float32Array(total)
  for (let i = 0; i < total; i++) {
    lane[i] = ctx.rng.range(-WIND.radius * 0.85, WIND.radius * 0.85)
    along[i] = ctx.rng.range(-WIND.radius, WIND.radius)
    phase[i] = ctx.rng.next()
    speed[i] = ctx.rng.range(0.55, 1.05)
    height[i] = ctx.rng.range(0.25, 1.7)
  }

  const perpendicular = { x: -direction.z, z: direction.x }
  let startedAt = Number.POSITIVE_INFINITY
  let gustAt = Number.POSITIVE_INFINITY
  let settleAt = Number.POSITIVE_INFINITY
  let removed = false

  const place = (index: number, streakAlong: number, scale: number): void => {
    const x = direction.x * streakAlong + perpendicular.x * lane[index]!
    const z = direction.z * streakAlong + perpendicular.z * lane[index]!
    const outsideIsland = Math.hypot(ctx.x + x, ctx.z + z) > ISLAND_RADIUS
    if (outsideIsland) {
      dummy.position.set(x, 0, z)
      dummy.scale.setScalar(0)
    } else {
      const ground = ctx.island.sampleHeight(ctx.x + x, ctx.z + z)
      dummy.position.set(x, ground + height[index]!, z)
      dummy.scale.set(scale * 0.8, scale * 0.8, scale * (reduced ? 1 : 3.2))
    }
    dummy.rotation.set(0, Math.atan2(direction.x, direction.z), 0)
    dummy.updateMatrix()
    if (index < leaves.count) leaves.setMatrixAt(index, dummy.matrix)
    else dust.setMatrixAt(index - leaves.count, dummy.matrix)
  }

  const render = (): void => {
    if (!Number.isFinite(startedAt) || removed) return
    const now = performance.now()
    const anticipation = Math.min(1, (now - startedAt) / (WIND.anticipationSeconds * 1000))
    let strength = anticipation * 0.25
    if (Number.isFinite(gustAt)) {
      const gustProgress = Math.min(1, (now - gustAt) / (gustSeconds * 1000))
      strength = 0.25 + Math.sin(gustProgress * Math.PI) * 0.75
    }
    if (Number.isFinite(settleAt)) {
      strength *= Math.max(0, 1 - (now - settleAt) / 600)
    }
    const travelled = Number.isFinite(gustAt) ? (now - gustAt) / 1000 : 0
    for (let i = 0; i < total; i++) {
      const cycle = (phase[i]! + travelled * speed[i]!) % 1
      const streakAlong = reduced ? along[i]! : (cycle * 2 - 1) * WIND.radius
      place(i, streakAlong, strength * Math.sin(cycle * Math.PI))
    }
    leaves.instanceMatrix.needsUpdate = true
    dust.instanceMatrix.needsUpdate = true
  }

  leaves.onBeforeRender = render
  ctx.island.group.add(group)

  return {
    start: () => {
      startedAt = performance.now()
      group.visible = true
    },
    gust: () => { gustAt = performance.now() },
    settle: () => { settleAt = performance.now() },
    remove: () => {
      if (removed) return
      removed = true
      ctx.island.group.remove(group)
      geometry.dispose()
      leafMaterial.dispose()
      dustMaterial.dispose()
    },
  }
}

export class Wind implements Power {
  readonly id = 'wind' as const
  readonly cooldown = WIND.cooldown

  cast(ctx: CastCtx): Timeline {
    const reduced = ctx.reducedMotion()
    const gustSeconds = reduced ? WIND.reducedGustSeconds : WIND.gustSeconds
    const direction = gustDirection(ctx.x, ctx.z)
    const actor = gustField(ctx, reduced, gustSeconds)
    const y0 = ctx.island.sampleHeight(ctx.x, ctx.z)
    const gustEnd = WIND.anticipationSeconds + gustSeconds

    return new Timeline()
      .at(0, () => {
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        actor.start()
      })
      .at(WIND.anticipationSeconds, () => {
        const impact = impactContext(ctx)
        actor.gust()
        for (const tree of ctx.world.trees) {
          if (Math.hypot(tree.x - ctx.x, tree.z - ctx.z) <= WIND.radius) {
            tree.sway(direction.x, direction.z, gustSeconds)
          }
        }
        const directlyTargetedVillager = impact.kind === 'villager'
          ? ctx.world.villagerAt(ctx.x, ctx.z, 1.2)
          : null
        const tumbleFrom = {
          x: ctx.x - direction.x * 2,
          z: ctx.z - direction.z * 2,
        }
        for (const villager of ctx.world.villagers) {
          if (villager === directlyTargetedVillager) continue
          if (Math.hypot(villager.x - ctx.x, villager.z - ctx.z) <= WIND.radius) {
            villager.tumble(tumbleFrom)
          }
        }
        const campfire = ctx.world.campfire
        const campfireInGust = campfire.lit
          && Math.hypot(campfire.x - ctx.x, campfire.z - ctx.z) <= WIND.radius
        // Snapshot sources before any ember lands so a newly lit object cannot
        // propagate again during the same cast.
        const fireSources = [
          ...(campfireInGust ? [campfire] : []),
          ...ctx.world.trees.filter(tree => (
            tree.burning
            && Math.hypot(tree.x - ctx.x, tree.z - ctx.z) <= WIND.radius
          )),
          ...ctx.world.huts.filter(hut => (
            hut.burning
            && Math.hypot(hut.x - ctx.x, hut.z - ctx.z) <= WIND.radius
          )),
        ]
        if (campfireInGust) {
          // Reuse the matrix recipe for both direct and nearby hits so the
          // radius gate remains the sole owner and the fire fans exactly once.
          applyInteractions(resolveInteraction(this.id, 'campfire'), impact, y0)
        }
        for (const source of fireSources) {
          if (source.kind !== 'campfire') source.flare(2, 3)
          ctx.world.emberIgnite(
            source,
            ctx.rng,
            WIND.emberChance,
            WIND.emberRadius,
            direction,
            WIND.emberHalfAngle,
          )
        }
        if (impact.kind === 'pond') {
          ctx.fx.particles.burst({
            x: ctx.x,
            y: y0 + 0.15,
            z: ctx.z,
            n: ctx.lowFx ? 8 : 20,
            color: PALETTE.water,
            speed: 2.6,
            gravity: 2,
            size: 0.5,
            life: 0.8,
            shape: 'ring',
          })
        }
        if (impact.kind === 'crater') {
          ctx.fx.particles.burst({
            x: ctx.x,
            y: y0 + 0.2,
            z: ctx.z,
            n: ctx.lowFx ? 8 : 24,
            color: PALETTE.dirt,
            speed: 1.4,
            gravity: -0.6,
            size: 0.8,
            life: 1.2,
          })
        }
        ctx.bus.emit({
          type: 'power:impact',
          power: this.id,
          target: impact.kind,
          x: ctx.x,
          z: ctx.z,
        })
        if (impact.kind !== 'campfire') {
          applyInteractions(resolveInteraction(this.id, impact.kind), impact, y0)
        }
      })
      .at(WIND.anticipationSeconds + WIND.fruitDropDelaySeconds, () => {
        ctx.world.dropFruitNear(ctx.x, ctx.z, WIND.radius, ctx.rng, ctx.lowFx)
      })
      .at(gustEnd, () => actor.settle())
      .at(gustEnd + 1, () => actor.remove())
  }
}

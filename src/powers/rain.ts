import * as THREE from 'three'
import { Timeline } from '../core/timeline'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'
import { ISLAND_RADIUS } from '../world/island'
import { resolveInteraction } from './matrix'
import { applyInteractions } from './outcomes'
import { Power, type CastCtx } from './power'

const RAIN_RADIUS = 5
const DROP_COUNT = 120
const RIPPLE_COUNT = 24

type RainActor = {
  start(): void
  stop(): void
  remove(): void
}

export function rainOffset(
  centerX: number,
  centerZ: number,
  rng: CastCtx['rng'],
): { x: number; z: number } {
  for (let attempt = 0; attempt < 40; attempt++) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = Math.sqrt(rng.next()) * RAIN_RADIUS * 0.9
    const x = Math.cos(angle) * distance
    const z = Math.sin(angle) * distance
    if (Math.hypot(centerX + x, centerZ + z) <= ISLAND_RADIUS) return { x, z }
  }
  // Cast centers come from island ray hits, so the center is always a safe
  // fallback even for an adversarial RNG sequence at the exact rim.
  return { x: 0, z: 0 }
}

function rainField(ctx: CastCtx): RainActor {
  const group = new THREE.Group()
  group.name = 'rain-storm'
  group.position.set(ctx.x, 0, ctx.z)
  group.visible = false

  const cloud = new THREE.Group()
  cloud.name = 'rain-cloud'
  cloud.position.set(-7, 9, 0)
  cloud.scale.setScalar(0.01)
  const cloudGeometries: THREE.BufferGeometry[] = []
  const cloudMaterials: THREE.Material[] = []
  const cloudOffsets = [
    [-1.25, 0, 0.05, 1],
    [-0.55, 0.25, -0.2, 1.25],
    [0.25, 0.18, 0.14, 1.38],
    [1.1, 0.02, -0.08, 1.02],
    [0, -0.35, 0.18, 1.1],
  ] as const
  for (let i = 0; i < cloudOffsets.length; i++) {
    const geometry = wobble(new THREE.SphereGeometry(0.95, 12, 9), ctx.rng, 0.1)
    const material = clayMaterial(i === 4 ? PALETTE.stone : PALETTE.cloud)
    const blob = new THREE.Mesh(geometry, material)
    blob.name = 'rain-cloud-blob'
    const [x, y, z, scale] = cloudOffsets[i]
    blob.position.set(x, y, z)
    blob.scale.set(scale, scale * 0.68, scale)
    blob.castShadow = true
    cloud.add(blob)
    cloudGeometries.push(geometry)
    cloudMaterials.push(material)
  }
  group.add(cloud)

  const dropGeometry = wobble(new THREE.SphereGeometry(0.055, 7, 5), ctx.rng, 0.012)
  const dropMaterial = clayMaterial(PALETTE.water, { flat: true })
  const droplets = new THREE.InstancedMesh(dropGeometry, dropMaterial, DROP_COUNT)
  droplets.name = 'rain-droplets'
  droplets.frustumCulled = false
  droplets.visible = false
  group.add(droplets)

  const rippleGeometry = new THREE.RingGeometry(0.08, 0.12, 16)
  const rippleMaterial = new THREE.MeshBasicMaterial({
    color: PALETTE.water,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const ripples = new THREE.InstancedMesh(rippleGeometry, rippleMaterial, RIPPLE_COUNT)
  ripples.name = 'rain-ripples'
  ripples.frustumCulled = false
  group.add(ripples)

  const dummy = new THREE.Object3D()
  dummy.scale.setScalar(0)
  dummy.updateMatrix()
  for (let i = 0; i < DROP_COUNT; i++) droplets.setMatrixAt(i, dummy.matrix)
  for (let i = 0; i < RIPPLE_COUNT; i++) ripples.setMatrixAt(i, dummy.matrix)
  droplets.instanceMatrix.needsUpdate = true
  ripples.instanceMatrix.needsUpdate = true

  const dropX = new Float32Array(DROP_COUNT)
  const dropZ = new Float32Array(DROP_COUNT)
  const dropSpeed = new Float32Array(DROP_COUNT)
  const dropPhase = new Float32Array(DROP_COUNT)
  const previousCycle = new Float32Array(DROP_COUNT)
  for (let i = 0; i < DROP_COUNT; i++) {
    const offset = rainOffset(ctx.x, ctx.z, ctx.rng)
    dropX[i] = offset.x
    dropZ[i] = offset.z
    dropSpeed[i] = ctx.rng.range(0.72, 1.18)
    dropPhase[i] = ctx.rng.next()
    previousCycle[i] = dropPhase[i]
  }

  const rippleX = new Float32Array(RIPPLE_COUNT)
  const rippleY = new Float32Array(RIPPLE_COUNT)
  const rippleZ = new Float32Array(RIPPLE_COUNT)
  const rippleStarted = new Float64Array(RIPPLE_COUNT).fill(Number.NEGATIVE_INFINITY)
  let rippleCursor = 0
  let startedAt = Number.POSITIVE_INFINITY
  let stoppedAt = Number.POSITIVE_INFINITY
  let removed = false

  const spawnRipple = (x: number, y: number, z: number, now: number): void => {
    rippleX[rippleCursor] = x
    rippleY[rippleCursor] = y
    rippleZ[rippleCursor] = z
    rippleStarted[rippleCursor] = now
    rippleCursor = (rippleCursor + 1) % RIPPLE_COUNT
  }

  const render = (): void => {
    if (!Number.isFinite(startedAt) || removed) return
    const now = performance.now()
    const elapsed = (now - startedAt) / 1000
    const arrival = Math.min(1, elapsed / 1.2)
    cloud.position.x = THREE.MathUtils.lerp(-7, 0, 1 - (1 - arrival) ** 3)
    cloud.position.y = 9 + Math.sin(now * 0.0025) * 0.1
    cloud.scale.setScalar(Math.max(0.01, arrival))

    if (Number.isFinite(stoppedAt)) {
      const departure = Math.min(1, (now - stoppedAt) / 1200)
      cloud.position.x = THREE.MathUtils.lerp(0, 7, departure * departure)
      cloud.scale.setScalar(Math.max(0.01, 1 - departure))
    }

    const raining = elapsed >= 1.2 && !Number.isFinite(stoppedAt)
    droplets.visible = raining
    if (raining) {
      const rainElapsed = elapsed - 1.2
      for (let i = 0; i < DROP_COUNT; i++) {
        const cycle = (rainElapsed * dropSpeed[i] + dropPhase[i]) % 1
        const ground = ctx.island.sampleHeight(ctx.x + dropX[i], ctx.z + dropZ[i]) + 0.08
        const y = THREE.MathUtils.lerp(9, ground, cycle)
        dummy.position.set(dropX[i], y, dropZ[i])
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(0.75, 2.8, 0.75)
        dummy.updateMatrix()
        droplets.setMatrixAt(i, dummy.matrix)
        if (cycle < previousCycle[i]) spawnRipple(dropX[i], ground, dropZ[i], now)
        previousCycle[i] = cycle
      }
      droplets.instanceMatrix.needsUpdate = true
    }

    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const age = (now - rippleStarted[i]) / 1000
      if (age < 0 || age > 2 / 12) {
        dummy.scale.setScalar(0)
      } else {
        const progress = age / (2 / 12)
        dummy.position.set(rippleX[i], rippleY[i], rippleZ[i])
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.setScalar(THREE.MathUtils.lerp(0.7, 3.8, progress))
      }
      dummy.updateMatrix()
      ripples.setMatrixAt(i, dummy.matrix)
    }
    ripples.instanceMatrix.needsUpdate = true
  }

  const driver = cloud.children[0]
  driver.frustumCulled = false
  driver.onBeforeRender = render
  ctx.island.group.add(group)

  return {
    start: () => {
      startedAt = performance.now()
      stoppedAt = Number.POSITIVE_INFINITY
      group.visible = true
    },
    stop: () => {
      if (!Number.isFinite(stoppedAt)) stoppedAt = performance.now()
      droplets.visible = false
    },
    remove: () => {
      if (removed) return
      removed = true
      ctx.island.group.remove(group)
      for (const geometry of cloudGeometries) geometry.dispose()
      for (const material of cloudMaterials) material.dispose()
      dropGeometry.dispose()
      dropMaterial.dispose()
      rippleGeometry.dispose()
      rippleMaterial.dispose()
    },
  }
}

export class Rain extends Power {
  readonly id = 'rain' as const
  readonly cooldown = 8

  cast(ctx: CastCtx): Timeline {
    const actor = rainField(ctx)
    const y0 = ctx.island.sampleHeight(ctx.x, ctx.z)
    let bloomed = false
    const effectTick = (): void => {
      const campfireWasLit = ctx.world.campfire.lit
        && Math.hypot(ctx.world.campfire.x - ctx.x, ctx.world.campfire.z - ctx.z) <= RAIN_RADIUS
      ctx.world.douseNear(ctx.x, ctx.z, RAIN_RADIUS, true)
      ctx.world.fillCratersNear(ctx.x, ctx.z, RAIN_RADIUS, ctx.rng, ctx.lowFx)
      ctx.world.growFruitNear(ctx.x, ctx.z, RAIN_RADIUS)
      if (!bloomed) {
        ctx.world.bloomNear(ctx.x, ctx.z, RAIN_RADIUS * 0.82, ctx.rng, ctx.lowFx)
        bloomed = true
      }
      ctx.world.grumpNear(ctx.x, ctx.z, RAIN_RADIUS)
      if (campfireWasLit) ctx.world.sadNear(ctx.world.campfire.x, ctx.world.campfire.z, 2.8)
    }

    const timeline = new Timeline()
      .at(0, () => {
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        actor.start()
      })
      .at(1.2, () => {
        ctx.bus.emit({
          type: 'power:impact', power: this.id, target: ctx.kind, x: ctx.x, z: ctx.z,
        })
        effectTick()
        applyInteractions(resolveInteraction(this.id, ctx.kind), ctx, y0)
      })

    for (let i = 1; i < 12; i++) timeline.at(1.2 + i * 0.5, effectTick)
    return timeline
      .at(7.2, () => actor.stop())
      .at(8.4, () => actor.remove())
  }
}

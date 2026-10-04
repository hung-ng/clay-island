import * as THREE from 'three'
import { Timeline } from '../core/timeline'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'
import { resolveInteraction } from './matrix'
import { applyInteractions } from './outcomes'
import { impactContext, type Power, type CastCtx } from './power'

type Actor = {
  start(): void
  remove(): void
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
  for (const [i, [x, y, z, scale]] of offsets.entries()) {
    const geometry = wobble(new THREE.SphereGeometry(0.82, 12, 9), ctx.rng, 0.09)
    const material = clayMaterial(i === 1 ? PALETTE.scorch : PALETTE.stone)
    const blob = new THREE.Mesh(geometry, material)
    blob.name = 'lightning-cloud-blob'
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
  const driver = group.children[0]!
  driver.frustumCulled = false
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

  // Over-bright so bloom wraps the bolt in a halo; unlit, like real light.
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.ghost).multiplyScalar(3.4),
  })
  const geometries: THREE.BufferGeometry[] = []
  const group = new THREE.Group()
  group.name = 'lightning-bolt'
  group.visible = false
  const strikeLight = new THREE.PointLight(PALETTE.ghost, ctx.lowFx ? 0 : 26, 16)
  strikeLight.position.set(ctx.x, y0 + 2.2, ctx.z)
  strikeLight.visible = !ctx.lowFx
  group.add(strikeLight)

  const addTube = (path: THREE.Vector3[], radius: number): void => {
    const curve = new THREE.CatmullRomCurve3(path)
    const geometry = new THREE.TubeGeometry(curve, 32, radius, 4, false)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = radius > 0.07 ? 'lightning-main-bolt' : 'lightning-fork'
    mesh.castShadow = false
    group.add(mesh)
    geometries.push(geometry)
  }
  addTube(points, 0.11)

  for (const [index, side] of [[3, -1], [5, 1]] as const) {
    const start = points[index]!
    const end = start.clone().add(new THREE.Vector3(
      ctx.rng.range(1.1, 1.8) * side,
      ctx.rng.range(-3.8, -2.4),
      ctx.rng.range(-1.3, 1.3),
    ))
    const middle = start.clone().lerp(end, 0.52)
    middle.x += ctx.rng.range(-0.35, 0.35)
    middle.z += ctx.rng.range(-0.35, 0.35)
    addTube([start.clone(), middle, end], 0.06)
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

export class Lightning implements Power {
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
      })
      .at(0.9, () => {
        const impact = impactContext(ctx)
        bolt.start()
        ctx.fx.flash(PALETTE.ghost, 0.06)
        ctx.fx.shake.add(0.35, 0.24)
        ctx.fx.sparks?.burst({
          x: ctx.x, y: y0 + 0.2, z: ctx.z, n: 36,
          color: PALETTE.ghost, speed: 5.5, gravity: 10, life: 0.55, size: 0.9, shape: 'sphere',
        })
        for (const villager of ctx.world.villagers) {
          if (villager.alive) villager.flinch()
        }
        ctx.bus.emit({
          type: 'power:impact', power: this.id, target: impact.kind, x: ctx.x, z: ctx.z,
        })
        applyInteractions(resolveInteraction(this.id, impact.kind), impact, y0)
      })
      .at(0.9 + 2 / 12, () => bolt.remove())
      .at(1.2, () => cloud.remove())
      .at(3.4, () => {
        bolt.remove()
        cloud.remove()
      })
  }
}

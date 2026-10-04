import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE, TIMING } from '../ui/tokens'
import { Charring } from './charring'
import { craterAt } from './craters'
import { holdsPlace, isLiving, type TreeState } from './forest'
import { ISLAND_RADIUS, WALK_RADIUS } from './island'
import { isSubmerged, type Basin } from './terrain'

export type { TreeState } from './forest'
export type HutState = 'site' | 'building' | 'built' | 'burning' | 'ruin' | 'abandoned'
export type CampfireState = 'site' | 'building' | 'lit' | 'doused' | 'scattered'

function disposeObjectResources(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    geometries.add(child.geometry)
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of childMaterials) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

function setShadow(object: THREE.Object3D, lowFx: boolean): void {
  object.castShadow = !lowFx
}

/** A low-FX blob shadow that can follow an object's changing silhouette. */
class BlobShadow {
  private readonly mesh: THREE.Mesh | null

  constructor(group: THREE.Group, private readonly baseRadius: number, lowFx: boolean) {
    if (!lowFx) {
      this.mesh = null
      return
    }
    const material = new THREE.MeshBasicMaterial({
      color: PALETTE.scorch,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = 0.025
    this.mesh.renderOrder = 1
    this.mesh.scale.setScalar(baseRadius)
    group.add(this.mesh)
  }

  setScale(fraction: number, stretch = 1): void {
    if (!this.mesh) return
    this.mesh.scale.set(this.baseRadius * fraction * stretch, this.baseRadius * fraction, 1)
  }

  setOffset(x: number, z = 0): void {
    if (!this.mesh) return
    this.mesh.position.x = x
    this.mesh.position.z = z
  }
}

function addBlobShadow(group: THREE.Group, radius: number, lowFx: boolean): BlobShadow {
  return new BlobShadow(group, radius, lowFx)
}

function ringMesh(
  count: number,
  radius: number,
  stoneRadius: number,
  rng: RNG,
  lowFx: boolean,
): THREE.InstancedMesh {
  const geometry = wobble(new THREE.SphereGeometry(stoneRadius, 10, 8), rng, 0.035)
  const stones = new THREE.InstancedMesh(geometry, clayMaterial(PALETTE.stone), count)
  const matrix = new THREE.Matrix4()
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    matrix.makeTranslation(Math.cos(angle) * radius, stoneRadius * 0.7, Math.sin(angle) * radius)
    stones.setMatrixAt(i, matrix)
  }
  stones.instanceMatrix.needsUpdate = true
  setShadow(stones, lowFx)
  return stones
}

/** Clay that also emits: fire stays bright at night and feeds the bloom pass. */
function glowingClay(color: string, intensity: number): THREE.MeshToonMaterial {
  const material = clayMaterial(color)
  material.emissive.set(color)
  material.emissiveIntensity = intensity
  return material
}

/** Burning trees and huts: daylight already overexposes them, so stay subtle. */
const FLAME_GLOW = 0.6
/** The campfire glows hardest after dark, when it is the light source. */
const CAMPFIRE_DAY_GLOW = 0.25
const CAMPFIRE_NIGHT_GLOW = 1.6
const CAMPFIRE_DAY_LIGHT = 1.5
const CAMPFIRE_NIGHT_LIGHT = 7

function hash(value: number): number {
  return Math.sin(value * 12.9898) * 43758.5453 % 1
}

function seedFromId(value: string): number {
  let seed = 2166136261
  for (let i = 0; i < value.length; i++) {
    seed ^= value.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  return seed >>> 0
}

/**
 * The dome a fire burns on: a tree's crown or a hut's roof. `y` is its centre
 * height, `radius` its horizontal reach, `squash` its height over its width.
 */
export type FireShell = { y: number; radius: number; squash: number }

const TREE_FIRE: FireShell = { y: 1.62, radius: 0.95, squash: 0.85 }

/**
 * Where a fire's flames sit: one on the crest, the rest round the shoulders a
 * golden angle apart, so the fire shows from every side. Each sits just proud
 * of the dome. Inside it, the leaves or clay would hide the flames and a
 * burning tree would only read as a charring one.
 */
export function flameAnchors(shell: FireShell, count: number, size: number, rng: RNG): THREE.Vector3[] {
  const anchors: THREE.Vector3[] = []
  const turn = rng.range(0, Math.PI * 2)
  for (let i = 0; i < count; i++) {
    // Crest first, then shoulders from 60 down to 25 degrees above the middle.
    const elevation = i === 0
      ? Math.PI / 2
      : THREE.MathUtils.lerp(1.05, 0.45, (i - 1) / Math.max(1, count - 2)) + rng.range(-0.08, 0.08)
    const azimuth = turn + i * 2.4 + rng.range(-0.2, 0.2)
    const ring = Math.cos(elevation) * shell.radius
    const point = new THREE.Vector3(
      Math.cos(azimuth) * ring,
      shell.y + Math.sin(elevation) * shell.radius * shell.squash,
      Math.sin(azimuth) * ring,
    )
    const normal = new THREE.Vector3(
      point.x,
      (point.y - shell.y) / (shell.squash * shell.squash),
      point.z,
    ).normalize()
    anchors.push(point.addScaledVector(normal, size * 0.35))
  }
  return anchors
}

class BurningVisual {
  readonly group = new THREE.Group()

  private readonly flames: THREE.Mesh[] = []
  private readonly smoke: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[] = []
  private readonly light: THREE.PointLight
  private readonly baseLightIntensity: number
  private lightEnabled = false
  private lastQt = Number.NEGATIVE_INFINITY
  private flareTime = 0
  private flareScale = 1

  constructor(seed: number, shell: FireShell, radius: number, flameCount: number, lowFx: boolean) {
    const rng = new RNG(seed)
    this.group.name = 'burning-fx'
    this.group.visible = false

    const anchors = flameAnchors(shell, flameCount, radius, rng)
    const top = shell.y + shell.radius * shell.squash
    for (let i = 0; i < flameCount; i++) {
      // The crest flame is the biggest: it is the one seen against the sky.
      const size = i === 0 ? radius * 1.2 : rng.range(radius * 0.6, radius)
      const flame = new THREE.Mesh(
        wobble(new THREE.SphereGeometry(size, 9, 7), rng, size * 0.15),
        glowingClay(i % 2 === 0 ? PALETTE.flame : PALETTE.ember, FLAME_GLOW),
      )
      flame.name = 'fire-flame'
      const anchor = anchors[i]!
      flame.userData.baseX = anchor.x
      flame.userData.baseY = anchor.y
      flame.userData.baseZ = anchor.z
      flame.userData.phase = rng.range(0, 100)
      flame.position.set(flame.userData.baseX, flame.userData.baseY, flame.userData.baseZ)
      flame.scale.y = rng.range(1.25, 1.7)
      flame.castShadow = false
      this.flames.push(flame)
      this.group.add(flame)
    }

    const smokeCount = lowFx ? 2 : 3
    for (let i = 0; i < smokeCount; i++) {
      const material = clayMaterial(PALETTE.stone)
      material.transparent = true
      material.depthWrite = false
      const blob = new THREE.Mesh(
        wobble(new THREE.SphereGeometry(radius * 0.48, 8, 6), rng, radius * 0.08),
        material,
      )
      blob.name = 'fire-smoke'
      blob.userData.phase = i / smokeCount
      blob.userData.curl = rng.range(0, Math.PI * 2)
      blob.userData.baseY = top
      blob.castShadow = false
      this.smoke.push(blob)
      this.group.add(blob)
    }

    this.baseLightIntensity = lowFx ? 0.8 : 1.2
    this.light = new THREE.PointLight(PALETTE.flame, this.baseLightIntensity, 5)
    this.light.name = 'fire-point-light'
    // Above the crest, so it lights the ground round the fire instead of
    // blowing out the flames from inside, as the campfire's light once did.
    this.light.position.y = top + 0.4
    this.light.castShadow = false
    this.light.visible = false
    this.group.add(this.light)
  }

  setBurning(on: boolean): void {
    this.group.visible = on
    this.light.visible = on && this.lightEnabled
    if (!on) {
      this.lastQt = Number.NEGATIVE_INFINITY
      this.flareTime = 0
      this.flareScale = 1
      this.light.intensity = this.baseLightIntensity
    }
  }

  flare(seconds = 1, scale = 1.75): void {
    if (!this.group.visible) return
    this.flareTime = Math.max(this.flareTime, seconds)
    this.flareScale = Math.max(this.flareScale, scale)
  }

  setLightEnabled(on: boolean): void {
    this.lightEnabled = on
    this.light.visible = this.group.visible && on
  }

  update(qt: number): void {
    if (!this.group.visible || qt === this.lastQt) return
    if (Number.isFinite(this.lastQt)) {
      this.flareTime = Math.max(0, this.flareTime - Math.max(0, qt - this.lastQt))
    }
    const flareScale = this.flareTime > 0 ? this.flareScale : 1
    if (this.flareTime === 0) this.flareScale = 1
    const frame = Math.floor(qt * 12)
    for (let i = 0; i < this.flames.length; i++) {
      const flame = this.flames[i]!
      const phase = flame.userData.phase as number
      const jx = hash(frame * 7.1 + phase)
      const jy = hash(frame * 13.7 + phase * 1.7)
      const jz = hash(frame * 19.3 + phase * 2.3)
      flame.position.set(
        (flame.userData.baseX as number) + jx * 0.12,
        (flame.userData.baseY as number) + Math.abs(jy) * 0.12,
        (flame.userData.baseZ as number) + jz * 0.12,
      )
      flame.scale.set(
        flareScale * (0.85 + Math.abs(jz) * 0.2),
        flareScale * (1.25 + Math.abs(jx) * 0.45),
        flareScale * 0.85,
      )
    }
    for (const blob of this.smoke) {
      const phase = (qt * 0.28 + (blob.userData.phase as number)) % 1
      const curl = (blob.userData.curl as number) + phase * Math.PI * 2
      blob.position.set(
        Math.sin(curl) * (0.12 + phase * 0.28),
        (blob.userData.baseY as number) + phase * 2.4,
        Math.cos(curl) * (0.12 + phase * 0.2),
      )
      blob.scale.setScalar(0.65 + phase * 1.15)
      blob.material.opacity = (1 - phase) * 0.58
    }
    this.light.intensity = this.baseLightIntensity * flareScale
    this.lastQt = qt
  }
}

const TOPPLE_SECONDS = 0.6
const FELLED_OFFSET = 0.9
const FELLED_SECONDS = 30
const FADE_SECONDS = 2
const GROW_SECONDS = 40
const STUMP_SECONDS = 30

type TreeFallCause = 'chop' | 'fire' | null
type PreFireState = 'sapling' | 'normal'

export class Tree {
  state: TreeState
  group = new THREE.Group()
  readonly kind = 'tree' as const
  burning = false
  burnt = false
  burnTime = 0

  private trunk: THREE.Mesh
  private stump: THREE.Mesh
  private crown = new THREE.Group()
  private charring: Charring
  private shadow: BlobShadow
  private fruit: THREE.InstancedMesh | null = null
  /** Local positions of the four fruit slots; `null` once picked. */
  private fruitSlots: (THREE.Vector3 | null)[] = []
  private fruitTime = 0
  private shudderTime = 0
  private swayTime = 0
  private swaySeconds = 0
  private swayDir = { x: 1, z: 0 }
  private fireVisual: BurningVisual
  private fireStarted = false
  private phase = 0
  private fallCause: TreeFallCause = null
  private fallScale = 1
  private fallTrunkY = 0.55
  private fallCrownY = 1.45
  private expiredValue = false
  private preFireState: PreFireState | null = null
  private preFirePhase = 0

  constructor(
    public id: string,
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    private lowFx = false,
    state: TreeState = 'normal',
  ) {
    this.state = state
    this.group.position.set(x, y, z)

    const trunkMaterial = clayMaterial(PALETTE.bark)
    this.trunk = new THREE.Mesh(
      wobble(new THREE.CylinderGeometry(0.18, 0.28, 1.1, 10, 3), rng, 0.045),
      trunkMaterial,
    )
    this.trunk.name = 'tree-trunk'
    this.trunk.position.y = 0.55
    setShadow(this.trunk, lowFx)
    this.group.add(this.trunk)

    const stumpMaterial = clayMaterial(PALETTE.bark)
    stumpMaterial.color.multiplyScalar(0.85)
    this.stump = new THREE.Mesh(
      wobble(new THREE.CylinderGeometry(0.26, 0.3, 0.3, 9, 2), rng, 0.06),
      stumpMaterial,
    )
    this.stump.name = 'tree-stump'
    this.stump.position.y = 0.15
    this.stump.visible = false
    setShadow(this.stump, lowFx)
    this.group.add(this.stump)

    this.charring = new Charring([trunkMaterial])

    const leafColors = [PALETTE.leafA, PALETTE.grassDark, PALETTE.leafB]
    const crownCount = rng.int(2, 3)
    for (let i = 0; i < crownCount; i++) {
      const radius = rng.range(0.7, 1)
      const material = clayMaterial(rng.pick(leafColors))
      const blob = new THREE.Mesh(
        wobble(new THREE.SphereGeometry(radius, 14, 10), rng, 0.08),
        material,
      )
      blob.position.set(
        rng.range(-0.42, 0.42),
        rng.range(-0.08, 0.42),
        rng.range(-0.35, 0.35),
      )
      blob.scale.set(rng.range(0.9, 1.15), rng.range(0.8, 1.05), rng.range(0.9, 1.15))
      blob.rotation.set(rng.range(-0.18, 0.18), rng.range(0, Math.PI * 2), rng.range(-0.18, 0.18))
      setShadow(blob, lowFx)
      this.charring.add(material)
      this.crown.add(blob)
    }
    this.crown.position.y = 1.45
    this.crown.name = 'tree-crown'
    this.crown.rotation.y = rng.range(0, Math.PI * 2)
    this.group.add(this.crown)
    this.fireVisual = new BurningVisual(seedFromId(id), TREE_FIRE, 0.3, 3, lowFx)
    this.group.add(this.fireVisual.group)
    this.shadow = addBlobShadow(this.group, 1.05, lowFx)
    this.syncAppearance()
    if (this.state === 'sapling') this.setGrowth(0)
  }

  get living(): boolean {
    return isLiving(this.state)
  }

  get holdsPlace(): boolean {
    return holdsPlace(this.state)
  }

  get expired(): boolean {
    return this.expiredValue
  }

  chop(): void {
    if (this.state !== 'normal') return
    this.burnt = true
    this.topple('chop')
  }

  ignite(): void {
    if (this.fireStarted || this.burnt) return
    if (this.state !== 'sapling' && this.state !== 'normal') return
    this.preFireState = this.state
    this.preFirePhase = this.phase
    this.state = 'burning'
    this.phase = 0
    this.burning = true
    this.burnt = false
    this.burnTime = 0
    this.charring.set(0)
    this.fireVisual.setBurning(true)
    this.fireStarted = true
    this.syncAppearance()
  }

  extinguish(): void {
    if (this.state !== 'burning') return
    this.state = this.preFireState ?? 'normal'
    this.phase = this.preFirePhase
    this.burning = false
    this.burnt = false
    this.burnTime = 0
    this.charring.set(0)
    this.fireVisual.setBurning(false)
    this.fireStarted = false
    this.preFireState = null
    this.preFirePhase = 0
    this.syncAppearance()
    if (this.state === 'sapling') this.setGrowth(Math.min(1, this.phase / GROW_SECONDS))
  }

  setBurnt(): void {
    if (this.state !== 'burning') return
    this.burning = false
    this.burnt = true
    this.fireVisual.setBurning(false)
    this.fireStarted = false
    this.charring.set(1)
    this.preFireState = null
    this.preFirePhase = 0
    this.topple('fire')
  }

  obliterate(): void {
    this.burning = false
    this.burnt = true
    this.burnTime = 0
    this.fireVisual.setBurning(false)
    this.fireStarted = false
    this.expire()
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }

  setFireLightEnabled(on: boolean): void {
    this.fireVisual.setLightEnabled(on)
  }

  flare(seconds = 1, scale = 1.75): void {
    if (!this.burning) return
    this.fireVisual.flare(seconds, scale)
  }

  /** Seek the authored sapling presentation without advancing gameplay systems. */
  setGrowthProgress(value: number): void {
    if (this.state !== 'sapling' && this.state !== 'normal') return
    const growth = THREE.MathUtils.clamp(value, 0, 1)
    this.phase = growth * GROW_SECONDS
    this.state = growth >= 1 ? 'normal' : 'sapling'
    this.setGrowth(growth)
    this.syncAppearance()
  }

  /** Struck but not felled: the canopy jolts. */
  shudder(): void {
    if (this.state !== 'normal') return
    this.shudderTime = 0.18
  }

  /** A gust bends the whole crown along its direction for `seconds`. */
  sway(dirX: number, dirZ: number, seconds: number): void {
    if (this.state !== 'normal' && this.state !== 'sapling') return
    const length = Math.hypot(dirX, dirZ) || 1
    this.swayDir = { x: dirX / length, z: dirZ / length }
    this.swaySeconds = Math.max(seconds, 0.001)
    this.swayTime = this.swaySeconds
  }

  growFruit(): boolean {
    if (this.state !== 'normal') return false
    if (this.fruit) {
      this.fruitTime = 60
      return false
    }
    const rng = new RNG(this.id.length * 97)
    const geometry = wobble(new THREE.SphereGeometry(0.12, 8, 6), rng, 0.018)
    const fruit = new THREE.InstancedMesh(geometry, clayMaterial(PALETTE.smockA), 4)
    fruit.name = 'tree-fruit'
    const blobs = this.crown.children.filter(child => child instanceof THREE.Mesh) as THREE.Mesh[]
    this.fruitSlots = []
    const matrix = new THREE.Matrix4()

    for (let i = 0; i < 4; i++) {
      const blob = blobs[i % blobs.length]!
      const sphere = blob.geometry as THREE.SphereGeometry
      const radius = sphere.parameters.radius
        * Math.max(blob.scale.x, blob.scale.y, blob.scale.z)
      // One fruit per quadrant. A free yaw let two fruit share a bearing, and
      // the burial-projection pass below then shoved both into the same pocket.
      const yaw = (i * Math.PI) / 2 + rng.range(-0.5, 0.5)
      const pitch = rng.range(-0.9, -0.15)
      const direction = new THREE.Vector3(
        Math.cos(pitch) * Math.cos(yaw),
        Math.sin(pitch),
        Math.cos(pitch) * Math.sin(yaw),
      )
      const position = direction.multiplyScalar(radius * 1.08).add(blob.position)

      // Crowns overlap. Project through every blob so a fruit placed on one
      // surface cannot remain buried inside its neighbour.
      for (let pass = 0; pass < blobs.length * 2; pass++) {
        let moved = false
        for (const neighbour of blobs) {
          const neighbourSphere = neighbour.geometry as THREE.SphereGeometry
          const neighbourRadius = neighbourSphere.parameters.radius
            * Math.max(neighbour.scale.x, neighbour.scale.y, neighbour.scale.z)
          const offset = position.clone().sub(neighbour.position)
          const length = offset.length()
          if (length >= neighbourRadius * 1.04) continue
          if (length <= Number.EPSILON) offset.set(1, -0.4, 0)
          position.copy(neighbour.position).add(
            offset.normalize().multiplyScalar(neighbourRadius * 1.04),
          )
          moved = true
        }
        if (!moved) break
      }

      this.fruitSlots[i] = position.clone()
      matrix.makeTranslation(position.x, position.y, position.z)
      fruit.setMatrixAt(i, matrix)
    }
    fruit.instanceMatrix.needsUpdate = true
    fruit.castShadow = !this.lowFx
    this.crown.add(fruit)
    this.fruit = fruit
    this.fruitTime = 60
    return true
  }

  get hasFruit(): boolean {
    return this.fruitCount > 0
  }

  /** How many fruit are still hanging. */
  get fruitCount(): number {
    return this.fruitSlots.filter(slot => slot !== null).length
  }

  /**
   * A villager takes the one fruit nearest them. Returns false when the tree is
   * bare. The mesh is kept and the taken instance is scaled to nothing, so the
   * remaining fruit stay exactly where they hung.
   */
  pickFruit(x: number, z: number): boolean {
    if (!this.fruit || this.fruitCount === 0) return false

    // Convert the picker from world space into the rotated crown's local frame.
    this.crown.updateWorldMatrix(true, false)
    const local = this.crown.worldToLocal(new THREE.Vector3(
      x,
      this.group.position.y + this.crown.position.y,
      z,
    ))

    let nearest = -1
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < this.fruitSlots.length; i++) {
      const slot = this.fruitSlots[i]
      if (!slot) continue
      const gap = Math.hypot(slot.x - local.x, slot.z - local.z)
      if (gap < best) {
        best = gap
        nearest = i
      }
    }
    if (nearest < 0) return false

    this.fruitSlots[nearest] = null
    const matrix = new THREE.Matrix4()
    matrix.makeScale(0, 0, 0)
    this.fruit.setMatrixAt(nearest, matrix)
    this.fruit.instanceMatrix.needsUpdate = true

    // The last fruit takes the mesh with it.
    if (this.fruitCount === 0) {
      this.crown.remove(this.fruit)
      disposeObjectResources(this.fruit)
      this.fruit = null
      this.fruitTime = 0
    }
    return true
  }

  /**
   * Wind shakes one fruit out of the crown. Unlike `pickFruit`, the fruit
   * leaves for the ground: the caller receives the island-local landing point
   * and owns the resulting ground fruit. Returns null when the tree is bare.
   */
  dropFruit(): { x: number; z: number } | null {
    if (!this.fruit || this.fruitCount === 0) return null
    const index = this.fruitSlots.findIndex(slot => slot !== null)
    if (index < 0) return null
    const slot = this.fruitSlots[index]!
    this.fruitSlots[index] = null
    const matrix = new THREE.Matrix4()
    matrix.makeScale(0, 0, 0)
    this.fruit.setMatrixAt(index, matrix)
    this.fruit.instanceMatrix.needsUpdate = true
    if (this.fruitCount === 0) {
      this.crown.remove(this.fruit)
      disposeObjectResources(this.fruit)
      this.fruit = null
      this.fruitTime = 0
    }
    return { x: this.x + slot.x * 1.15, z: this.z + slot.z * 1.15 }
  }

  update(dt: number, qt: number): void {
    if (this.expiredValue) return
    this.phase += dt

    if (this.swayTime > 0 && (this.state === 'normal' || this.state === 'sapling')) {
      this.swayTime = Math.max(0, this.swayTime - dt)
      const progress = 1 - this.swayTime / this.swaySeconds
      const strength = Math.sin(Math.min(1, progress) * Math.PI)
      const lean = strength * (0.24 + Math.sin(this.phase * 26) * 0.07)
      this.crown.rotation.z = -this.swayDir.x * lean
      this.crown.rotation.x = this.swayDir.z * lean
    } else if (this.crown.rotation.x !== 0) {
      this.crown.rotation.x = 0
    }

    if (this.shudderTime > 0 && this.state === 'normal') {
      this.shudderTime = Math.max(0, this.shudderTime - dt)
      const amount = this.shudderTime / 0.18
      this.crown.rotation.z = Math.sin(this.shudderTime * 60) * 0.06 * amount
    } else if (this.swayTime <= 0 && (this.state === 'normal' || this.state === 'sapling')) {
      this.crown.rotation.z = 0
    }

    if (this.burning) {
      this.charring.set(Math.min(1, this.charring.amount + dt * 0.65))
    }

    if (this.state === 'sapling') {
      const growth = Math.min(1, this.phase / GROW_SECONDS)
      this.setGrowth(growth)
      if (growth >= 1) {
        this.state = 'normal'
        this.phase = 0
      }
    }

    if (this.state === 'toppling') {
      const fall = Math.min(1, this.phase / TOPPLE_SECONDS)
      const easedFall = fall * fall
      this.trunk.rotation.z = -(Math.PI / 2) * easedFall
      this.crown.rotation.z = this.trunk.rotation.z
      this.trunk.position.x = FELLED_OFFSET * easedFall
      this.crown.position.x = 1.45 * easedFall
      this.trunk.position.y = THREE.MathUtils.lerp(
        this.fallTrunkY,
        0.18 * this.fallScale,
        fall,
      )
      this.crown.position.y = THREE.MathUtils.lerp(
        this.fallCrownY,
        0.42 * this.fallScale,
        fall,
      )
      this.shadow.setScale(this.fallScale, 1 + fall * 0.6)
      this.shadow.setOffset(FELLED_OFFSET * easedFall * 0.5)
      if (fall >= 1 && !this.burning) {
        this.state = 'felled'
        this.burnt = true
        this.phase = 0
        this.dropCrown()
        this.syncAppearance()
      }
    }

    if (this.state === 'felled') {
      const fade = Math.max(0, this.phase - FELLED_SECONDS) / FADE_SECONDS
      if (fade > 0) {
        const material = this.trunk.material as THREE.MeshToonMaterial
        material.transparent = true
        material.opacity = Math.max(0, 1 - fade)
      }
      if (this.phase >= FELLED_SECONDS + FADE_SECONDS) {
        if (this.fallCause === 'chop') {
          this.state = 'stump'
          this.phase = 0
          this.syncAppearance()
        } else {
          this.expire()
        }
      }
    }

    if (this.state === 'stump') {
      const fade = Math.max(0, this.phase - STUMP_SECONDS) / FADE_SECONDS
      if (fade > 0) {
        const material = this.stump.material as THREE.MeshToonMaterial
        material.transparent = true
        material.opacity = Math.max(0, 1 - fade)
      }
      if (this.phase >= STUMP_SECONDS + FADE_SECONDS) this.expire()
    }

    if (this.fruit) {
      this.fruitTime -= dt
      if (this.fruitTime <= 0) {
        this.crown.remove(this.fruit)
        disposeObjectResources(this.fruit)
        this.fruit = null
        this.fruitSlots = []
      }
    }
    this.fireVisual.update(qt)
  }

  private topple(cause: Exclude<TreeFallCause, null>): void {
    if (this.state === 'toppling' || this.state === 'felled' || this.state === 'stump') return
    this.fallCause = cause
    this.fallScale = this.trunk.scale.x
    this.fallTrunkY = this.trunk.position.y
    this.fallCrownY = this.crown.position.y
    this.state = 'toppling'
    this.phase = 0
    this.syncAppearance()
  }

  private dropCrown(): void {
    this.crown.visible = false
  }

  private setGrowth(growth: number): void {
    const scale = THREE.MathUtils.lerp(0.25, 1, growth)
    this.trunk.scale.setScalar(scale)
    this.trunk.position.y = 0.55 * scale
    this.crown.scale.setScalar(scale)
    this.crown.position.y = 1.45 * scale
    // The fire sits on the crown, so a burning sapling's fire is sapling-sized.
    this.fireVisual.group.scale.setScalar(scale)
    this.shadow.setScale(scale)
  }

  private syncAppearance(): void {
    const standing = this.state === 'sapling' || this.state === 'normal' || this.state === 'burning'
    const fallen = this.state === 'toppling' || this.state === 'felled'

    this.trunk.visible = standing || fallen
    this.crown.visible = standing || this.state === 'toppling'
    this.stump.visible = this.fallCause === 'chop'
      && (this.state === 'toppling' || this.state === 'felled' || this.state === 'stump')

    if (this.state === 'stump') {
      this.shadow.setOffset(0)
      this.shadow.setScale(0.33)
      return
    }
    if (this.state === 'felled') {
      this.shadow.setOffset(FELLED_OFFSET * 0.5)
      this.shadow.setScale(this.fallScale, 1.6)
      return
    }
    if (this.state === 'burning' && this.preFireState === 'sapling') {
      this.shadow.setOffset(0)
      this.shadow.setScale(THREE.MathUtils.lerp(0.25, 1, Math.min(1, this.preFirePhase / GROW_SECONDS)))
      return
    }
    if (this.state === 'sapling') return
    this.shadow.setOffset(0)
    this.shadow.setScale(1)
  }

  private expire(): void {
    this.expiredValue = true
    this.group.visible = false
    this.fireVisual.setBurning(false)
  }
}

/** The hut dome: centre height, radius, and its squash (height over width). */
const HUT_DOME_Y = 0.82
const HUT_DOME_RADIUS = 1.1
const HUT_DOME_SQUASH = 0.75
const HUT_FIRE: FireShell = { y: HUT_DOME_Y, radius: HUT_DOME_RADIUS, squash: HUT_DOME_SQUASH }
/** The doorway on the dome's front: bottom height, width, and height to the top of the arch. */
const DOORWAY = { bottom: 0.32, width: 0.46, height: 0.64 }
/**
 * How far the clay inside the arch is pressed back, so the doorway reads as an
 * opening. Deep enough that the dome's own wobble (up to about 0.07) never
 * pokes through the dark back of the doorway.
 */
const DOORWAY_PRESS = 0.24

/**
 * Signed distance from the doorway outline, in the dome's front view (x
 * across, `y` height above the ground): negative inside the arch.
 */
function doorwayDistance(x: number, y: number): number {
  const half = DOORWAY.width / 2
  const shoulder = DOORWAY.bottom + DOORWAY.height - half
  if (y <= shoulder) return Math.max(Math.abs(x) - half, DOORWAY.bottom - y)
  return Math.hypot(x, y - shoulder) - half
}

/**
 * Presses the doorway into the front of a unit-squash dome sphere (before the
 * mesh's squash is applied): the clay inside the arch goes back by
 * DOORWAY_PRESS, easing out to the wall just past the outline.
 */
function pressDoorway(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const point = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i)
    if (point.z <= 0.3) continue
    const height = HUT_DOME_Y + point.y * HUT_DOME_SQUASH
    const press = DOORWAY_PRESS * (1 - THREE.MathUtils.smoothstep(doorwayDistance(point.x, height), -0.01, 0.05))
    if (press <= 0) continue
    point.multiplyScalar(1 - press / point.length())
    position.setXYZ(i, point.x, point.y, point.z)
  }
  position.needsUpdate = true
  return geometry
}

/** An archway outline standing on y = 0: straight sides, a round top. */
function archShape(width: number, height: number): THREE.Shape {
  const half = width / 2
  const shape = new THREE.Shape()
  shape.moveTo(-half, 0)
  shape.lineTo(-half, height - half)
  shape.absarc(0, height - half, half, Math.PI, 0, true)
  shape.lineTo(half, 0)
  shape.closePath()
  return shape
}

/** The band round an archway: an outer arch with the inner one cut out, open at the bottom. */
function archFrameShape(outerWidth: number, outerHeight: number, innerWidth: number, innerHeight: number): THREE.Shape {
  const outer = outerWidth / 2
  const inner = innerWidth / 2
  const shape = new THREE.Shape()
  shape.moveTo(-outer, 0)
  shape.lineTo(-outer, outerHeight - outer)
  shape.absarc(0, outerHeight - outer, outer, Math.PI, 0, true)
  shape.lineTo(outer, 0)
  shape.lineTo(inner, 0)
  shape.lineTo(inner, innerHeight - inner)
  shape.absarc(0, innerHeight - inner, inner, 0, Math.PI, false)
  shape.lineTo(-inner, 0)
  shape.closePath()
  return shape
}

/**
 * Wraps a flat extrusion (outline in XY, depth along +Z) onto the front of the
 * hut dome, so a doorway follows the curved wall instead of standing off it.
 * X keeps its place across the wall, Y is height above the ground from the
 * doorway's bottom, and depth becomes height above the clay, from `inset` under
 * it to `proud` over it. Over its lowest 22 cm a part sinks by `settle`, so it
 * melts into the wall where the dome curves under rather than jutting out.
 * The result is relative to the dome's centre.
 */
function onHutDome(geometry: THREE.BufferGeometry, inset: number, proud: number, settle = 0): THREE.BufferGeometry {
  geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox!
  const radius = HUT_DOME_RADIUS
  const tall = HUT_DOME_RADIUS * HUT_DOME_SQUASH
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = DOORWAY.bottom + position.getY(i) - HUT_DOME_Y
    const z = radius * Math.sqrt(Math.max(1e-4, 1 - (x * x) / (radius * radius) - (y * y) / (tall * tall)))
    normal.set(x / (radius * radius), y / (tall * tall), z / (radius * radius)).normalize()
    const lift = THREE.MathUtils.lerp(-inset, proud, (position.getZ(i) - min.z) / (max.z - min.z))
      - settle * (1 - THREE.MathUtils.smoothstep(position.getY(i), 0, 0.22))
    position.setXYZ(i, x + normal.x * lift, y + normal.y * lift, z + normal.z * lift)
  }
  // The extrusion's faces are a few big triangles; bent onto the dome, each
  // stays flat and the toon ramp shows the creases. Welding them shades the
  // face smoothly, while UV seams keep the edge round the face crisp.
  geometry.deleteAttribute('normal')
  const welded = mergeVertices(geometry)
  geometry.dispose()
  welded.computeVertexNormals()
  return welded
}

const extrudeClay = { bevelEnabled: true, bevelSegments: 2, curveSegments: 14 }

export class Hut {
  group = new THREE.Group()
  progress: number
  readonly kind = 'hut' as const
  burning = false
  burnt = false
  burnTime = 0

  private base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private door: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private doorGlow = 0
  private roofKnob: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private siteStones: THREE.InstancedMesh
  private smoke: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[] = []
  private lastQt = Number.NEGATIVE_INFINITY
  private charring: Charring
  private fireVisual: BurningVisual

  constructor(
    public id: string,
    public x: number,
    public z: number,
    public state: HutState,
    y: number,
    rng: RNG,
    lowFx = false,
  ) {
    this.progress = state === 'built' ? 1 : 0
    this.group.position.set(x, y, z)
    this.group.rotation.y = Math.atan2(-x, -z)

    // Anything new draws from its own seed. The shared `rng` must see exactly
    // the draws it always did, or every hut after this one, and the sim with
    // them, would come out different.
    const detail = new RNG(seedFromId(id) ^ 0x9e3779b9)

    const baseMaterial = clayMaterial(PALETTE.hutClay)
    // Finer than a bare dome needs, so the pressed-in doorway keeps a clean edge.
    const dome = pressDoorway(new THREE.SphereGeometry(HUT_DOME_RADIUS, 64, 48))
    this.base = new THREE.Mesh(wobble(dome, rng, 0.1), baseMaterial)
    this.base.name = 'hut-base'
    this.base.position.y = HUT_DOME_Y
    setShadow(this.base, lowFx)

    // An arched doorway pressed into the wall: the dark back of the opening
    // sits in the hollow, and a lip of pushed-out clay rings it. It lives at
    // the dome's centre, so it shrinks onto the dome while the hut goes up.
    const doorMaterial = clayMaterial(PALETTE.scorch)
    this.door = new THREE.Mesh(
      wobble(onHutDome(
        new THREE.ExtrudeGeometry(archShape(DOORWAY.width + 0.04, DOORWAY.height + 0.02), {
          ...extrudeClay, depth: 0.05, bevelThickness: 0.02, bevelSize: 0.02,
        }),
        0.18, -0.06, 0.06,
      ), rng, 0.01),
      doorMaterial,
    )
    this.door.name = 'hut-door'
    this.door.position.y = HUT_DOME_Y
    setShadow(this.door, lowFx)

    const frameMaterial = clayMaterial(PALETTE.hutClay)
    frameMaterial.color.multiplyScalar(0.9)
    const frame = new THREE.Mesh(
      wobble(onHutDome(
        new THREE.ExtrudeGeometry(archFrameShape(
          DOORWAY.width + 0.2, DOORWAY.height + 0.1, DOORWAY.width - 0.02, DOORWAY.height - 0.02,
        ), { ...extrudeClay, depth: 0.06, bevelThickness: 0.025, bevelSize: 0.025 }),
        0.06, 0.075, 0.12,
      ), detail, 0.02),
      frameMaterial,
    )
    frame.name = 'hut-door-frame'
    setShadow(frame, lowFx)
    this.door.add(frame)

    const knobMaterial = clayMaterial(PALETTE.hutClay)
    this.roofKnob = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.25, 10, 8), rng, 0.04),
      knobMaterial,
    )
    this.roofKnob.name = 'hut-roof-knob'
    this.roofKnob.position.y = 1.72
    this.roofKnob.scale.y = 0.8
    setShadow(this.roofKnob, lowFx)

    this.charring = new Charring([baseMaterial, doorMaterial, frameMaterial, knobMaterial])

    this.siteStones = ringMesh(5, 0.82, 0.22, rng, lowFx)

    for (let i = 0; i < 3; i++) {
      const material = clayMaterial(PALETTE.stone)
      material.transparent = true
      material.depthWrite = false
      const blob = new THREE.Mesh(
        wobble(new THREE.SphereGeometry(0.23 + i * 0.035, 9, 7), rng, 0.035),
        material,
      )
      blob.userData.phase = i / 3
      setShadow(blob, lowFx)
      this.smoke.push(blob)
      this.group.add(blob)
    }

    this.group.add(this.base, this.door, this.roofKnob, this.siteStones)
    this.fireVisual = new BurningVisual(seedFromId(id), HUT_FIRE, 0.36, 3, lowFx)
    this.group.add(this.fireVisual.group)
    addBlobShadow(this.group, 1.35, lowFx)
    this.syncAppearance()
  }

  buildTick(): void {
    if (this.state === 'abandoned') return
    if (this.state !== 'site' && this.state !== 'building' && this.state !== 'ruin') return
    if (this.state === 'ruin') {
      this.burnt = false
      this.burnTime = 0
    }
    this.state = 'building'
    this.progress = Math.min(1, this.progress + 0.34)
    this.charring.set(0)
    if (this.progress >= 1) this.state = 'built'
    this.syncAppearance()
  }

  setProgress(value: number): void {
    if (this.state !== 'site' && this.state !== 'building' && this.state !== 'built') return
    const next = Math.max(0, Math.min(1, value))
    if (next <= 0) {
      this.state = 'site'
      this.progress = 0
      this.syncAppearance()
      return
    }
    this.state = next >= 1 ? 'built' : 'building'
    this.progress = next
    this.syncAppearance()
  }

  ignite(): void {
    if (this.state !== 'built' || this.burnt) return
    this.state = 'burning'
    this.burning = true
    this.burnt = false
    this.burnTime = 0
    this.charring.set(0)
    this.fireVisual.setBurning(true)
    this.syncAppearance()
  }

  extinguish(): void {
    if (this.state !== 'burning') return
    this.state = 'built'
    this.burning = false
    this.burnTime = 0
    this.charring.set(0)
    this.fireVisual.setBurning(false)
    this.syncAppearance()
  }

  setRuin(): void {
    this.state = 'ruin'
    this.burning = false
    this.burnt = true
    this.progress = 0
    this.charring.set(1)
    this.fireVisual.setBurning(false)
    this.syncAppearance()
  }

  setFireLightEnabled(on: boolean): void {
    this.fireVisual.setLightEnabled(on)
  }

  /** A lamp-lit doorway after dark; 0 by day, 1 at full night. */
  setNightLevel(level: number): void {
    const glow = this.state === 'built' ? THREE.MathUtils.clamp(level, 0, 1) : 0
    if (glow === this.doorGlow) return
    this.doorGlow = glow
    this.door.material.emissive.set(PALETTE.lamp)
    this.door.material.emissiveIntensity = glow * 1.9
  }

  flare(seconds = 1, scale = 1.75): void {
    if (!this.burning) return
    this.fireVisual.flare(seconds, scale)
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }

  update(dt: number, qt: number): void {
    if (this.state === 'burning') {
      this.charring.set(Math.min(1, this.charring.amount + dt * 0.5))
    }

    if (qt !== this.lastQt && this.state === 'built') {
      for (const blob of this.smoke) {
        const phase = (qt * 0.22 + blob.userData.phase) % 1
        const curl = Math.sin(phase * Math.PI * 2) * 0.22
        blob.position.set(curl, 1.9 + phase * 1.65, Math.cos(phase * Math.PI * 2) * 0.11)
        blob.scale.setScalar(0.8 + phase * 0.9)
        blob.material.opacity = (1 - phase) * 0.78
      }
    }
    this.fireVisual.update(qt)
    this.lastQt = qt
  }

  private syncAppearance(): void {
    const structureVisible = this.state === 'building' || this.state === 'built' || this.state === 'burning'
    this.base.visible = structureVisible
    this.door.visible = structureVisible
    this.roofKnob.visible = structureVisible
    this.siteStones.visible = this.state === 'site'
      || this.state === 'building'
      || this.state === 'ruin'
      || this.state === 'abandoned'
    for (const blob of this.smoke) blob.visible = this.state === 'built'

    const scale = this.state === 'building' ? Math.max(this.progress, 0.01) : 1
    this.base.scale.set(scale, scale * 0.75, scale)
    this.door.scale.setScalar(scale)
    this.roofKnob.scale.set(scale, scale * 0.8, scale)
  }
}

export class Campfire {
  group = new THREE.Group()
  progress: number
  readonly id = 'campfire'
  readonly kind = 'campfire' as const
  burning = false
  burnt = false
  burnTime = 0

  private flames: THREE.Mesh[] = []
  private logs: THREE.Mesh[] = []
  private stones: THREE.InstancedMesh
  private light: THREE.PointLight
  private lightEnabled = true
  private lastQt = Number.NEGATIVE_INFINITY
  private flareTime = 0
  private flareScale = 1
  private nightLevel = 0

  constructor(
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    lowFx = false,
    public state: CampfireState = 'lit',
  ) {
    this.progress = state === 'site' || state === 'building' ? 0 : 1
    this.group.position.set(x, y, z)
    this.stones = ringMesh(6, 0.7, 0.19, rng, lowFx)
    this.stones.name = 'campfire-stones'
    this.group.add(this.stones)

    for (let i = 0; i < 2; i++) {
      const log = new THREE.Mesh(
        wobble(new THREE.CylinderGeometry(0.12, 0.14, 1.35, 9, 3), rng, 0.035),
        clayMaterial(PALETTE.bark),
      )
      log.name = 'campfire-log'
      log.rotation.z = Math.PI / 2
      log.rotation.y = (i === 0 ? 1 : -1) * Math.PI / 4
      log.position.y = 0.22
      setShadow(log, lowFx)
      this.logs.push(log)
      this.group.add(log)
    }

    const colors = [PALETTE.flame, PALETTE.ember, PALETTE.flame]
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(
        wobble(new THREE.SphereGeometry(0.27 - i * 0.035, 10, 8), rng, 0.045),
        glowingClay(colors[i]!, CAMPFIRE_DAY_GLOW),
      )
      flame.name = 'campfire-flame'
      flame.userData.index = i
      flame.position.y = 0.52 + i * 0.2
      flame.scale.y = 1.45
      setShadow(flame, lowFx)
      this.flames.push(flame)
      this.group.add(flame)
    }

    this.light = new THREE.PointLight(PALETTE.flame, CAMPFIRE_DAY_LIGHT, 10)
    // Above the flame tips, so the light pools on the ground instead of
    // blowing out the flames from inside.
    this.light.position.y = 1.7
    this.light.castShadow = false
    this.group.add(this.light)
    addBlobShadow(this.group, 1.05, lowFx)
    if (state === 'scattered') this.scatterPieces()
    this.syncAppearance()
  }

  get lit(): boolean {
    return this.state === 'lit'
  }

  get scattered(): boolean {
    return this.state === 'scattered'
  }

  buildTick(amount: number): void {
    if (amount <= 0 || (this.state !== 'site' && this.state !== 'building')) return
    this.state = 'building'
    this.progress = Math.min(1, this.progress + amount)
    this.burning = false
    this.burnt = false
    this.burnTime = 0
    if (this.progress >= 1) this.state = 'lit'
    this.syncAppearance()
  }

  flare(seconds = 1, scale = 1.75): void {
    if (this.state === 'site' || this.state === 'building' || this.scattered) return
    this.state = 'lit'
    this.progress = 1
    this.flareTime = seconds
    this.flareScale = scale
    this.syncAppearance()
  }

  ignite(): void {
    if (this.state === 'site' || this.state === 'building' || this.scattered) return
    this.burning = true
    this.burnTime = 0
    this.flare()
  }

  douse(): void {
    if (this.state === 'lit') this.state = 'doused'
    this.burning = false
    this.burnTime = 0
    this.flareTime = 0
    this.flareScale = 1
    this.syncAppearance()
  }

  scatter(): void {
    this.burning = false
    this.burnTime = 0
    this.flareTime = 0
    this.flareScale = 1
    this.state = 'scattered'
    this.progress = 1
    this.scatterPieces()
    this.syncAppearance()
  }

  private scatterPieces(): void {
    const dummy = new THREE.Object3D()
    for (let i = 0; i < this.stones.count; i++) {
      const angle = (i / this.stones.count) * Math.PI * 2 + (i % 2 === 0 ? -0.18 : 0.14)
      const radius = 1.05 + (i % 3) * 0.16
      dummy.position.set(Math.cos(angle) * radius, 0.12, Math.sin(angle) * radius)
      dummy.rotation.set(i * 0.17, -angle, i % 2 === 0 ? 0.22 : -0.16)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      this.stones.setMatrixAt(i, dummy.matrix)
    }
    this.stones.instanceMatrix.needsUpdate = true
    this.logs.forEach((log, index) => {
      const side = index === 0 ? -1 : 1
      log.position.set(side * 0.48, 0.18, side * -0.42)
      log.rotation.z = Math.PI / 2 + side * 0.2
      log.rotation.y = side * 0.92
    })
  }

  extinguish(): void {
    this.douse()
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }

  setFireLightEnabled(on: boolean): void {
    this.lightEnabled = on
    this.light.visible = this.lit && on
  }

  update(dt: number, qt: number): void {
    this.flareTime = Math.max(0, this.flareTime - dt)
    const flareScale = this.flareTime > 0 ? this.flareScale : 1
    for (const flame of this.flames) flame.visible = this.lit
    this.light.visible = this.lit && this.lightEnabled
    this.light.intensity = this.lit ? this.baseLight() * flareScale : 0

    if (!this.lit || qt === this.lastQt) return
    const frame = Math.floor(qt * 12)
    for (const flame of this.flames) {
      const i = flame.userData.index as number
      const jx = hash(frame * 7.1 + i * 13.7)
      const jz = hash(frame * 11.3 + i * 19.1)
      const jy = hash(frame * 17.9 + i * 5.3)
      flame.position.set(jx * 0.1, 0.48 + i * 0.18 + Math.abs(jy) * 0.1, jz * 0.1)
      flame.scale.set(flareScale * (0.9 + Math.abs(jz) * 0.18), flareScale * (1.35 + Math.abs(jx) * 0.3), flareScale)
    }
    this.lastQt = qt
  }

  /**
   * Restores the flames to their construction transforms. Flicker leaves them on
   * a jittered frame, which the prologue handoff compares against a freshly
   * built gameplay campfire and rejects.
   */
  settleFlames(): void {
    this.flareTime = 0
    this.lastQt = -1
    this.flames.forEach((flame, index) => {
      flame.position.set(0, 0.52 + index * 0.2, 0)
      flame.scale.set(1, 1.45, 1)
    })
  }

  private syncAppearance(): void {
    const logsVisible = this.state !== 'site'
    const logScale = this.state === 'building' ? Math.max(this.progress, 0.01) : 1
    this.stones.visible = true
    for (const log of this.logs) {
      log.visible = logsVisible
      log.scale.setScalar(logScale)
    }
    for (const flame of this.flames) flame.visible = this.lit
    this.light.visible = this.lit && this.lightEnabled
    this.light.intensity = this.lit ? this.baseLight() : 0
  }

  /** 0 by day, 1 at full night: the fire throws a wider warm pool after dark. */
  setNightLevel(level: number): void {
    const next = THREE.MathUtils.clamp(level, 0, 1)
    if (next === this.nightLevel) return
    this.nightLevel = next
    const glow = THREE.MathUtils.lerp(CAMPFIRE_DAY_GLOW, CAMPFIRE_NIGHT_GLOW, next)
    for (const flame of this.flames) {
      (flame.material as THREE.MeshToonMaterial).emissiveIntensity = glow
    }
  }

  private baseLight(): number {
    return THREE.MathUtils.lerp(CAMPFIRE_DAY_LIGHT, CAMPFIRE_NIGHT_LIGHT, this.nightLevel)
  }
}

/**
 * Grid spacing of the water surface, in metres. The clipped boundary cuts each
 * cell as a straight chord, so the shoreline wobbles by roughly the sagitta of
 * that chord: at half a metre the edge visibly steps, and it only reads as a
 * smooth bank below about a quarter of a metre. The mesh is built once when the
 * pond floods, never per frame, so a fine grid costs nothing to run.
 */
const WATER_CELL = 0.2

/**
 * How far the water body's underside floats above the ground it rests on. The
 * two surfaces are the same shape, so without a gap they z-fight; lifting the
 * water a centimetre keeps the bed visible through it rather than tearing.
 */
const WATER_BED_LIFT = 0.02

/** A grid node: `depth` is how deep the water stands over the ground here. */
type Corner = { x: number; z: number; depth: number }

/** Where the waterline falls between a submerged corner and a dry one. */
function waterline(wet: Corner, dry: Corner): Corner {
  const span = wet.depth - dry.depth
  const t = span === 0 ? 0.5 : wet.depth / span
  return {
    x: wet.x + (dry.x - wet.x) * t,
    z: wet.z + (dry.z - wet.z) * t,
    depth: 0,
  }
}

/** The underside of the body, hugging the bed. Zero at the shore, so they meet. */
function bedY(point: Corner): number {
  return Math.min(0, WATER_BED_LIFT - point.depth)
}

/**
 * Triangulate one clipped cell as a slab: a flat lid at the surface and a bed
 * following the ground beneath it, wound so both faces point outward. Where the
 * water thins to nothing at the bank the two collapse onto each other, closing
 * the body without a seam.
 */
function pushSlab(top: number[], bed: number[], ring: Corner[]): void {
  for (let i = 1; i + 1 < ring.length; i++) {
    const a = ring[0]!
    const b = ring[i]!
    const c = ring[i + 1]!
    // Upward winding: the lid is visible from above, never as a flat underside.
    top.push(a.x, 0, a.z, c.x, 0, c.z, b.x, 0, b.z)
    // The bed is also seen from above, through the translucent water.
    bed.push(a.x, bedY(a), a.z, c.x, bedY(c), c.z, b.x, bedY(b), b.z)
  }
}

/**
 * Build the water in a basin as a BODY, not a sheet: a flat lid at the water
 * level, and a bed under it following the drowned ground. Seen from a low angle
 * the two surfaces are visibly apart, so the water has a thickness that deepens
 * toward the middle of the bowl and tapers to nothing at the bank — a single
 * plane, however well shaped, always reads edge-on as exactly what it is.
 *
 * Each grid cell is clipped against the waterline rather than kept or dropped
 * whole. Dropping partial cells left a half-metre staircase around the shore and
 * pulled the water short of the bank; interpolating the boundary onto the true
 * waterline puts the edge exactly where the ground surfaces, and lets the lid and
 * the bed meet cleanly there.
 */
function waterBody(
  basin: Basin,
  groundY: (x: number, z: number) => number,
): { top: THREE.BufferGeometry; bed: THREE.BufferGeometry; shoreline: { x: number; z: number }[] } {
  const cells = Math.max(2, Math.ceil((basin.radius * 2) / WATER_CELL))
  const step = (basin.radius * 2) / cells
  const origin = -basin.radius

  // Depth of water over the ground at a grid node: positive is submerged. Points
  // outside every crater are dry by definition, so the water never spills past
  // the bowls even where the surrounding ground dips below the water level.
  const corner = (i: number, j: number): Corner => {
    const localX = origin + i * step
    const localZ = origin + j * step
    const x = basin.x + localX
    const z = basin.z + localZ
    const inside = craterAt(x, z, basin.craters) !== null
    return {
      x: localX,
      z: localZ,
      depth: inside ? basin.waterLevel - groundY(x, z) : -1,
    }
  }

  const topPositions: number[] = []
  const bedPositions: number[] = []
  const shoreline: { x: number; z: number }[] = []
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      // Corners in winding order around the cell, so the clipped ring stays convex.
      const square = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)]
      if (square.every(point => point.depth <= 0)) continue

      // Sutherland–Hodgman against the single plane depth = 0: keep the wet
      // corners, and where an edge crosses the waterline, emit the crossing.
      const ring: Corner[] = []
      for (let k = 0; k < 4; k++) {
        const current = square[k]!
        const next = square[(k + 1) % 4]!
        if (current.depth > 0) ring.push(current)
        if ((current.depth > 0) !== (next.depth > 0)) {
          const wet = current.depth > 0 ? current : next
          const dry = current.depth > 0 ? next : current
          ring.push(waterline(wet, dry))
          // The dry grid corner is at most one cell from the rendered waterline.
          // Reusing it gives fishers a stable bank position that agrees with the
          // clipped mesh instead of approximating the shore from crater radii.
          shoreline.push({ x: basin.x + dry.x, z: basin.z + dry.z })
        }
      }
      if (ring.length >= 3) pushSlab(topPositions, bedPositions, ring)
    }
  }

  const build = (positions: number[]): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    return geometry
  }
  return { top: build(topPositions), bed: build(bedPositions), shoreline }
}

export const MAX_POND_FISH = 3

type PondFish = {
  mesh: THREE.Mesh
  anchorX: number
  anchorZ: number
  radius: number
  phase: number
  direction: -1 | 1
}

/** One terrain-clipped water surface for a connected crater basin. */
export class Pond {
  readonly group = new THREE.Group()
  readonly x: number
  readonly z: number
  readonly radius: number

  private readonly water: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private readonly bed: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private readonly shoreline: { x: number; z: number }[]
  private readonly fishSchool = new THREE.Group()
  private readonly fish: PondFish[] = []
  private fishPopulation: number
  private fishStunTime = 0
  private lastQt = Number.NEGATIVE_INFINITY

  constructor(
    public readonly basin: Basin,
    private readonly groundY: (x: number, z: number) => number,
    rng: RNG,
    lowFx = false,
    initialFishCount = MAX_POND_FISH,
  ) {
    this.fishPopulation = Math.max(
      0,
      Math.min(MAX_POND_FISH, Math.floor(initialFishCount)),
    )
    this.x = basin.x
    this.z = basin.z
    this.radius = basin.radius
    this.group.name = 'pond'
    this.group.position.set(basin.x, basin.waterLevel, basin.z)

    const { top, bed, shoreline } = waterBody(basin, groundY)
    this.shoreline = shoreline

    // The drowned floor, in deep water-colour. Opaque and drawn first, so the
    // translucent lid layers over it: you look THROUGH the surface and see the
    // bed fall away beneath, which is what gives the water its depth.
    const bedMaterial = clayMaterial(PALETTE.water, { flat: true })
    bedMaterial.color.multiplyScalar(0.45)
    this.bed = new THREE.Mesh(bed, bedMaterial)
    this.bed.name = 'pond-bed'
    this.bed.renderOrder = -1
    this.bed.receiveShadow = !lowFx
    this.group.add(this.bed)

    const material = clayMaterial(PALETTE.water, { flat: true })
    material.transparent = true
    material.opacity = 0.72
    material.depthWrite = false
    material.side = THREE.FrontSide
    this.water = new THREE.Mesh(top, material)
    this.water.name = 'pond-water'
    this.water.receiveShadow = !lowFx
    this.group.add(this.water)

    this.fishSchool.name = 'pond-fish'
    const fishGeometry = wobble(new THREE.SphereGeometry(0.19, 8, 6), rng, 0.025)
    const fishMaterial = clayMaterial(PALETTE.fish)
    for (let i = 0; i < MAX_POND_FISH; i++) {
      const crater = basin.craters[i % basin.craters.length]!
      const mesh = new THREE.Mesh(fishGeometry, fishMaterial)
      mesh.name = `pond-fish-${i}`
      mesh.scale.set(1.35, 0.45, 0.72)
      mesh.castShadow = !lowFx
      mesh.visible = i < this.fishPopulation
      const anchorX = crater.x - basin.x
      const anchorZ = crater.z - basin.z
      this.fish.push({
        mesh,
        anchorX,
        anchorZ,
        radius: this.containedSwimRadius(
          anchorX,
          anchorZ,
          Math.min(0.42, crater.radius * 0.14),
        ),
        phase: (i / MAX_POND_FISH) * Math.PI * 2 + rng.range(-0.2, 0.2),
        direction: i % 2 === 0 ? 1 : -1,
      })
      this.fishSchool.add(mesh)
    }
    this.group.add(this.fishSchool)
  }

  contains(x: number, z: number): boolean {
    return isSubmerged(x, z, [this.basin], this.groundY)
  }

  shoreNear(x: number, z: number): { x: number; z: number } {
    let nearest: { x: number; z: number } | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    let fallback: { x: number; z: number } | null = null
    let fallbackDistance = Number.POSITIVE_INFINITY

    for (const candidate of this.shoreline) {
      if (this.contains(candidate.x, candidate.z)) continue
      const candidateDistance = Math.hypot(candidate.x - x, candidate.z - z)
      if (candidateDistance < fallbackDistance) {
        fallback = candidate
        fallbackDistance = candidateDistance
      }
      if (Math.hypot(candidate.x, candidate.z) > WALK_RADIUS) continue
      if (candidateDistance >= nearestDistance) continue
      nearest = candidate
      nearestDistance = candidateDistance
    }

    return nearest ?? fallback ?? { x, z }
  }

  private containedSwimRadius(anchorX: number, anchorZ: number, requested: number): number {
    let radius = requested
    for (let attempt = 0; attempt < 10; attempt++) {
      let fits = true
      for (let sample = 0; sample < 32; sample++) {
        const angle = sample / 32 * Math.PI * 2
        const localX = anchorX + Math.cos(angle) * radius
        const localZ = anchorZ + Math.sin(angle) * radius * 0.68
        const worldX = this.x + localX
        const worldZ = this.z + localZ
        const depth = this.basin.waterLevel - this.groundY(worldX, worldZ)
        if (depth < 0.2 || !this.contains(worldX, worldZ)) {
          fits = false
          break
        }
      }
      if (fits) return radius
      radius *= 0.65
    }
    return 0
  }

  get fishCount(): number {
    return this.fishPopulation
  }

  get hasFish(): boolean {
    return this.fishPopulation > 0
  }

  get fishStunned(): boolean {
    return this.fishStunTime > 0
  }

  catchFish(): boolean {
    if (this.fishPopulation <= 0) return false
    const caught = this.fish[this.fishPopulation - 1]
    if (!caught) return false
    this.fishPopulation--
    caught.mesh.visible = false
    if (this.fishPopulation === 0) this.fishStunTime = 0
    return true
  }

  restoreFish(): boolean {
    const changed = this.fishPopulation !== MAX_POND_FISH
    this.fishPopulation = MAX_POND_FISH
    this.fishStunTime = 0
    this.lastQt = Number.NEGATIVE_INFINITY
    for (const fish of this.fish) fish.mesh.visible = true
    return changed
  }

  stunFish(): boolean {
    if (!this.hasFish) return false
    this.fishStunTime = 2
    this.lastQt = Number.NEGATIVE_INFINITY
    return true
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }

  update(dt: number, qt: number): void {
    const wasStunned = this.fishStunned
    this.fishStunTime = Math.max(0, this.fishStunTime - dt)
    const stunEnded = wasStunned && !this.fishStunned
    if (qt === this.lastQt && !stunEnded) return
    const frame = Math.floor(qt * TIMING.fps)
    this.water.material.opacity = 0.69 + Math.sin(frame * 0.32) * 0.035

    for (let i = 0; i < this.fish.length; i++) {
      const fish = this.fish[i]!
      if (!fish.mesh.visible) continue
      const angle = fish.phase + frame * 0.035 * fish.direction
      const localX = fish.anchorX + Math.cos(angle) * fish.radius
      const localZ = fish.anchorZ + Math.sin(angle) * fish.radius * 0.68
      const depth = Math.max(
        0,
        this.basin.waterLevel - this.groundY(this.x + localX, this.z + localZ),
      )

      fish.mesh.position.x = localX
      fish.mesh.position.z = localZ
      const tangentX = -Math.sin(angle) * fish.direction
      const tangentZ = Math.cos(angle) * 0.68 * fish.direction
      fish.mesh.rotation.y = Math.atan2(-tangentZ, tangentX)
      fish.mesh.position.y = this.fishStunned
        ? 0.035 + ((frame + i) % 4 < 2 ? 0.025 : 0)
        : -Math.min(0.28, Math.max(0.1, depth * 0.45), Math.max(0.08, depth - 0.12))
    }
    this.lastQt = qt
  }
}

export class Grave {
  readonly group = new THREE.Group()
  fresh = true

  private age = 0

  get expired(): boolean { return this.age >= 180 }

  constructor(
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    lowFx = false,
  ) {
    this.group.name = 'grave'
    this.group.position.set(x, y, z)
    this.group.rotation.y = rng.range(-0.28, 0.28)
    const slab = new THREE.Mesh(
      wobble(new THREE.BoxGeometry(0.58, 0.86, 0.18, 3, 4, 2), rng, 0.035),
      clayMaterial(PALETTE.stone),
    )
    slab.name = 'grave-slab'
    slab.position.y = 0.39
    slab.rotation.z = rng.range(-0.09, 0.09)
    slab.castShadow = !lowFx
    this.group.add(slab)
    addBlobShadow(this.group, 0.42, lowFx)
  }

  update(dt: number): void {
    this.age += dt
    if (this.age >= 60) this.fresh = false
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }
}

export function applyNightLighting(
  huts: readonly Hut[],
  campfire: Campfire | null | undefined,
  level: number,
): void {
  for (const hut of huts) hut.setNightLevel(level)
  campfire?.setNightLevel(level)
}

/** A wind-dropped fruit resting on the ground until gathered or spoiled. */
export class GroundFruit {
  readonly group = new THREE.Group()

  private age = 0

  /** Uneaten fruit spoils on the same 60-second clock as fruit in a crown. */
  get expired(): boolean { return this.age >= 60 }

  constructor(
    public readonly id: string,
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    lowFx = false,
  ) {
    this.group.name = 'ground-fruit'
    this.group.position.set(x, y, z)
    const fruit = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.12, 8, 6), rng, 0.018),
      clayMaterial(PALETTE.smockA),
    )
    fruit.name = 'ground-fruit-blob'
    fruit.position.y = 0.1
    fruit.castShadow = !lowFx
    this.group.add(fruit)
  }

  update(dt: number): void { this.age += dt }

  dispose(): void { disposeObjectResources(this.group) }
}

export class FlowerPatch {
  readonly group = new THREE.Group()

  constructor(
    public x: number,
    public z: number,
    public radius: number,
    sampleHeight: (x: number, z: number) => number,
    canPlace: (x: number, z: number) => boolean,
    rng: RNG,
    lowFx = false,
  ) {
    this.group.name = 'flowers'
    const count = 36
    const geometry = wobble(new THREE.SphereGeometry(0.085, 7, 5), rng, 0.015)
    const flowers = new THREE.InstancedMesh(geometry, clayMaterial(PALETTE.bloom), count)
    flowers.name = 'flower-patch'
    flowers.castShadow = !lowFx
    const dummy = new THREE.Object3D()
    let placed = 0
    for (let i = 0; i < count; i++) {
      let px = 0
      let pz = 0
      let found = false
      for (let attempt = 0; attempt < 40; attempt++) {
        const angle = rng.range(0, Math.PI * 2)
        const distance = Math.sqrt(rng.next()) * radius
        const candidateX = x + Math.cos(angle) * distance
        const candidateZ = z + Math.sin(angle) * distance
        if (Math.hypot(candidateX, candidateZ) > ISLAND_RADIUS) continue
        if (!canPlace(candidateX, candidateZ)) continue
        px = candidateX
        pz = candidateZ
        found = true
        break
      }
      if (!found) continue
      dummy.position.set(px, sampleHeight(px, pz) + rng.range(0.08, 0.16), pz)
      const scale = rng.range(0.7, 1.35)
      dummy.scale.set(scale, scale * rng.range(0.85, 1.35), scale)
      dummy.rotation.set(rng.range(-0.25, 0.25), rng.range(0, Math.PI * 2), rng.range(-0.25, 0.25))
      dummy.updateMatrix()
      flowers.setMatrixAt(placed, dummy.matrix)
      placed++
    }
    flowers.count = placed
    flowers.instanceMatrix.needsUpdate = true
    this.group.add(flowers)
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }
}

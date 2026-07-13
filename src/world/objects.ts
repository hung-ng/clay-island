import * as THREE from 'three'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE, TIMING } from '../ui/tokens'
import { ISLAND_RADIUS } from './island'

export type TreeState = 'normal' | 'chopped' | 'burning' | 'burnt'
export type HutState = 'site' | 'building' | 'built' | 'burning' | 'ruin'

const SCORCH = new THREE.Color(PALETTE.scorch)

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

function addBlobShadow(group: THREE.Group, radius: number, lowFx: boolean): void {
  if (!lowFx) return
  const material = new THREE.MeshBasicMaterial({
    color: PALETTE.scorch,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  })
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), material)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.025
  shadow.renderOrder = 1
  group.add(shadow)
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

class BurningVisual {
  readonly group = new THREE.Group()

  private readonly flames: THREE.Mesh[] = []
  private readonly smoke: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[] = []
  private readonly light: THREE.PointLight
  private lightEnabled = false
  private lastQt = Number.NEGATIVE_INFINITY

  constructor(seed: number, baseY: number, radius: number, lowFx: boolean) {
    const rng = new RNG(seed)
    this.group.name = 'burning-fx'
    this.group.visible = false

    const flameCount = rng.int(3, 5)
    for (let i = 0; i < flameCount; i++) {
      const size = rng.range(radius * 0.55, radius)
      const flame = new THREE.Mesh(
        wobble(new THREE.SphereGeometry(size, 9, 7), rng, size * 0.15),
        clayMaterial(i % 2 === 0 ? PALETTE.flame : PALETTE.ember),
      )
      flame.name = 'fire-flame'
      const angle = rng.range(0, Math.PI * 2)
      const spread = rng.range(0, radius * 0.9)
      flame.userData.baseX = Math.cos(angle) * spread
      flame.userData.baseY = baseY + rng.range(-radius * 0.2, radius * 0.55)
      flame.userData.baseZ = Math.sin(angle) * spread
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
      blob.userData.baseY = baseY
      blob.castShadow = false
      this.smoke.push(blob)
      this.group.add(blob)
    }

    this.light = new THREE.PointLight(PALETTE.flame, lowFx ? 0.8 : 1.2, 5)
    this.light.name = 'fire-point-light'
    this.light.position.y = baseY + radius
    this.light.castShadow = false
    this.light.visible = false
    this.group.add(this.light)
  }

  setBurning(on: boolean): void {
    this.group.visible = on
    this.light.visible = on && this.lightEnabled
    if (!on) this.lastQt = Number.NEGATIVE_INFINITY
  }

  setLightEnabled(on: boolean): void {
    this.lightEnabled = on
    this.light.visible = this.group.visible && on
  }

  update(qt: number): void {
    if (!this.group.visible || qt === this.lastQt) return
    const frame = Math.floor(qt * 12)
    for (let i = 0; i < this.flames.length; i++) {
      const flame = this.flames[i]
      const phase = flame.userData.phase as number
      const jx = hash(frame * 7.1 + phase)
      const jy = hash(frame * 13.7 + phase * 1.7)
      const jz = hash(frame * 19.3 + phase * 2.3)
      flame.position.set(
        (flame.userData.baseX as number) + jx * 0.12,
        (flame.userData.baseY as number) + Math.abs(jy) * 0.12,
        (flame.userData.baseZ as number) + jz * 0.12,
      )
      flame.scale.set(0.85 + Math.abs(jz) * 0.2, 1.25 + Math.abs(jx) * 0.45, 0.85)
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
    this.lastQt = qt
  }
}

export class Tree {
  state: TreeState = 'normal'
  group = new THREE.Group()
  readonly kind = 'tree' as const
  burning = false
  burnt = false
  burnTime = 0

  private crown = new THREE.Group()
  private crownMaterials: THREE.MeshToonMaterial[] = []
  private crownColors: THREE.Color[] = []
  private recoveryTime = 0
  private shrinkFrames = 0
  private lastQt = Number.NEGATIVE_INFINITY
  private burnMix = 0
  private fruit: THREE.InstancedMesh | null = null
  private fruitTime = 0
  private fireVisual: BurningVisual

  constructor(
    public id: string,
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    private lowFx = false,
  ) {
    this.group.position.set(x, y, z)

    const trunkGeometry = wobble(new THREE.CylinderGeometry(0.18, 0.28, 1.1, 10, 3), rng, 0.045)
    const trunk = new THREE.Mesh(trunkGeometry, clayMaterial(PALETTE.bark))
    trunk.position.y = 0.55
    setShadow(trunk, lowFx)
    this.group.add(trunk)

    const leafColors = [PALETTE.leafA, PALETTE.grassDark, PALETTE.leafB]
    const crownCount = rng.int(2, 3)
    for (let i = 0; i < crownCount; i++) {
      const radius = rng.range(0.7, 1)
      const color = rng.pick(leafColors)
      const material = clayMaterial(color)
      const geometry = wobble(new THREE.SphereGeometry(radius, 14, 10), rng, 0.08)
      const blob = new THREE.Mesh(geometry, material)
      blob.position.set(
        rng.range(-0.42, 0.42),
        rng.range(-0.08, 0.42),
        rng.range(-0.35, 0.35),
      )
      blob.scale.set(rng.range(0.9, 1.15), rng.range(0.8, 1.05), rng.range(0.9, 1.15))
      blob.rotation.set(rng.range(-0.18, 0.18), rng.range(0, Math.PI * 2), rng.range(-0.18, 0.18))
      setShadow(blob, lowFx)
      this.crownMaterials.push(material)
      this.crownColors.push(new THREE.Color(color))
      this.crown.add(blob)
    }
    this.crown.position.y = 1.45
    this.crown.rotation.y = rng.range(0, Math.PI * 2)
    this.group.add(this.crown)
    this.fireVisual = new BurningVisual(seedFromId(id), 1.25, 0.34, lowFx)
    this.group.add(this.fireVisual.group)
    addBlobShadow(this.group, 1.05, lowFx)
  }

  chop(): void {
    if (this.state === 'burning') return
    this.state = 'chopped'
    this.beginRecovery()
  }

  ignite(): void {
    if (this.state === 'burning' || this.state === 'burnt') return
    this.state = 'burning'
    this.burning = true
    this.burnt = false
    this.burnTime = 0
    this.burnMix = 0
    this.fireVisual.setBurning(true)
  }

  extinguish(): void {
    if (this.state !== 'burning') return
    this.state = 'normal'
    this.burning = false
    this.burnTime = 0
    this.burnMix = 0
    this.fireVisual.setBurning(false)
    this.resetCrownColors()
  }

  setBurnt(): void {
    this.state = 'burnt'
    this.burning = false
    this.burnt = true
    this.burnMix = 1
    this.fireVisual.setBurning(false)
    this.beginRecovery()
    for (const material of this.crownMaterials) material.color.copy(SCORCH)
  }

  setFireLightEnabled(on: boolean): void {
    this.fireVisual.setLightEnabled(on)
  }

  growFruit(): boolean {
    if (this.fruit) {
      this.fruitTime = 60
      return false
    }
    const geometry = wobble(new THREE.SphereGeometry(0.12, 8, 6), new RNG(this.id.length * 97), 0.018)
    const fruit = new THREE.InstancedMesh(geometry, clayMaterial(PALETTE.smockA), 4)
    const matrix = new THREE.Matrix4()
    const positions = [
      [-0.52, 0.02, 0.28],
      [0.5, 0.12, 0.18],
      [-0.18, -0.38, 0.5],
      [0.26, -0.34, -0.44],
    ]
    for (let i = 0; i < positions.length; i++) {
      const [px, py, pz] = positions[i]
      matrix.makeTranslation(px, py, pz)
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
    return this.fruit !== null
  }

  update(dt: number, qt: number): void {
    if (this.state === 'burning') {
      this.burnMix = Math.min(1, this.burnMix + dt * 0.65)
      this.crownMaterials.forEach((material, i) => {
        material.color.copy(this.crownColors[i]).lerp(SCORCH, this.burnMix)
      })
    }

    if (this.state === 'chopped' || this.state === 'burnt') {
      this.recoveryTime += dt
      if (qt !== this.lastQt && this.shrinkFrames < 4) this.shrinkFrames++
      const collapsed = THREE.MathUtils.lerp(1, 0.15, this.shrinkFrames / 4)
      const regrowth = Math.min(1, this.recoveryTime / 120)
      const scale = THREE.MathUtils.lerp(collapsed, 1, regrowth)
      this.crown.scale.setScalar(scale)
      if (this.state === 'burnt') {
        this.crownMaterials.forEach((material, i) => {
          material.color.copy(SCORCH).lerp(this.crownColors[i], regrowth)
        })
      }
      if (regrowth >= 1) {
        this.state = 'normal'
        this.burnt = false
        this.burnTime = 0
        this.crown.scale.setScalar(1)
        this.resetCrownColors()
      }
    }
    this.lastQt = qt

    if (this.fruit) {
      this.fruitTime -= dt
      if (this.fruitTime <= 0) {
        this.crown.remove(this.fruit)
        disposeObjectResources(this.fruit)
        this.fruit = null
      }
    }
    this.fireVisual.update(qt)
  }

  private beginRecovery(): void {
    this.recoveryTime = 0
    this.shrinkFrames = 0
    this.lastQt = Number.NEGATIVE_INFINITY
  }

  private resetCrownColors(): void {
    this.crownMaterials.forEach((material, i) => material.color.copy(this.crownColors[i]))
  }
}

export class Hut {
  group = new THREE.Group()
  progress: number
  readonly kind = 'hut' as const
  burning = false
  burnt = false
  burnTime = 0

  private base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private door: THREE.Mesh
  private roofKnob: THREE.Mesh
  private siteStones: THREE.InstancedMesh
  private smoke: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[] = []
  private lastQt = Number.NEGATIVE_INFINITY
  private burnMix = 0
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

    const baseMaterial = clayMaterial(PALETTE.hutClay)
    this.base = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(1.1, 18, 12), rng, 0.1),
      baseMaterial,
    )
    this.base.position.y = 0.82
    setShadow(this.base, lowFx)

    this.door = new THREE.Mesh(
      wobble(new THREE.BoxGeometry(0.52, 0.74, 0.14, 3, 3, 2), rng, 0.025),
      clayMaterial(PALETTE.scorch),
    )
    this.door.position.set(0, 0.6, 0.96)
    setShadow(this.door, lowFx)

    this.roofKnob = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.25, 10, 8), rng, 0.04),
      clayMaterial(PALETTE.hutClay),
    )
    this.roofKnob.position.y = 1.72
    this.roofKnob.scale.y = 0.8
    setShadow(this.roofKnob, lowFx)

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
    this.fireVisual = new BurningVisual(seedFromId(id), 1.05, 0.42, lowFx)
    this.group.add(this.fireVisual.group)
    addBlobShadow(this.group, 1.35, lowFx)
    this.syncAppearance()
  }

  buildTick(): void {
    if (this.state !== 'site' && this.state !== 'building' && this.state !== 'ruin') return
    if (this.state === 'ruin') {
      this.burnt = false
      this.burnTime = 0
    }
    this.state = 'building'
    this.progress = Math.min(1, this.progress + 0.34)
    if (this.progress >= 1) this.state = 'built'
    this.syncAppearance()
  }

  ignite(): void {
    if (this.state !== 'built' || this.burnt) return
    this.state = 'burning'
    this.burning = true
    this.burnt = false
    this.burnTime = 0
    this.burnMix = 0
    this.fireVisual.setBurning(true)
    this.syncAppearance()
  }

  extinguish(): void {
    if (this.state !== 'burning') return
    this.state = 'built'
    this.burning = false
    this.burnTime = 0
    this.burnMix = 0
    this.base.material.color.set(PALETTE.hutClay)
    this.fireVisual.setBurning(false)
    this.syncAppearance()
  }

  setRuin(): void {
    this.state = 'ruin'
    this.burning = false
    this.burnt = true
    this.progress = 0
    this.burnMix = 1
    this.fireVisual.setBurning(false)
    this.syncAppearance()
  }

  setFireLightEnabled(on: boolean): void {
    this.fireVisual.setLightEnabled(on)
  }

  update(dt: number, qt: number): void {
    if (this.state === 'burning') {
      this.burnMix = Math.min(1, this.burnMix + dt * 0.5)
      this.base.material.color.set(PALETTE.hutClay).lerp(SCORCH, this.burnMix)
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
    this.siteStones.visible = this.state === 'site' || this.state === 'building' || this.state === 'ruin'
    for (const blob of this.smoke) blob.visible = this.state === 'built'

    const scale = this.state === 'building' ? Math.max(this.progress, 0.01) : 1
    this.base.scale.set(scale, scale * 0.75, scale)
    this.door.scale.setScalar(scale)
    this.roofKnob.scale.set(scale, scale * 0.8, scale)
  }
}

export class Campfire {
  group = new THREE.Group()
  lit = true
  scattered = false
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

  constructor(
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    lowFx = false,
  ) {
    this.group.position.set(x, y, z)
    this.stones = ringMesh(6, 0.7, 0.19, rng, lowFx)
    this.group.add(this.stones)

    for (let i = 0; i < 2; i++) {
      const log = new THREE.Mesh(
        wobble(new THREE.CylinderGeometry(0.12, 0.14, 1.35, 9, 3), rng, 0.035),
        clayMaterial(PALETTE.bark),
      )
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
        clayMaterial(colors[i]),
      )
      flame.userData.index = i
      flame.position.y = 0.52 + i * 0.2
      flame.scale.y = 1.45
      setShadow(flame, lowFx)
      this.flames.push(flame)
      this.group.add(flame)
    }

    this.light = new THREE.PointLight(PALETTE.flame, 1.5, 6)
    this.light.position.y = 1.05
    this.light.castShadow = false
    this.group.add(this.light)
    addBlobShadow(this.group, 1.05, lowFx)
  }

  flare(seconds = 1, scale = 1.75): void {
    if (this.scattered) return
    this.lit = true
    this.flareTime = seconds
    this.flareScale = scale
  }

  ignite(): void {
    if (this.scattered) return
    this.burning = true
    this.burnTime = 0
    this.flare()
  }

  douse(): void {
    this.lit = false
    this.burning = false
    this.burnTime = 0
    this.flareTime = 0
    this.flareScale = 1
  }

  scatter(): void {
    this.douse()
    this.scattered = true
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

  setFireLightEnabled(on: boolean): void {
    this.lightEnabled = on
    this.light.visible = this.lit && on
  }

  update(dt: number, qt: number): void {
    this.flareTime = Math.max(0, this.flareTime - dt)
    const flareScale = this.flareTime > 0 ? this.flareScale : 1
    for (const flame of this.flames) flame.visible = this.lit
    this.light.visible = this.lit && this.lightEnabled
    this.light.intensity = this.lit ? 1.5 * flareScale : 0

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
}

export class Pond {
  readonly group = new THREE.Group()
  hasFish = true

  private readonly water: THREE.Mesh<THREE.CircleGeometry, THREE.MeshToonMaterial>
  private readonly floatingFish = new THREE.Group()
  private lastQt = Number.NEGATIVE_INFINITY

  constructor(
    public x: number,
    public z: number,
    public radius: number,
    y: number,
    rng: RNG,
    lowFx = false,
  ) {
    this.group.name = 'pond'
    this.group.position.set(x, y, z)

    const material = clayMaterial(PALETTE.water, { flat: true })
    material.transparent = true
    material.opacity = 0.72
    material.depthWrite = false
    material.side = THREE.DoubleSide
    this.water = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.86, 40), material)
    this.water.name = 'pond-water'
    this.water.rotation.x = -Math.PI / 2
    this.water.position.y = 0.025
    this.water.receiveShadow = !lowFx
    this.group.add(this.water)

    const fishGeometry = wobble(new THREE.SphereGeometry(0.19, 8, 6), rng, 0.025)
    const fishMaterial = clayMaterial(PALETTE.ghost)
    for (let i = 0; i < 3; i++) {
      const fish = new THREE.Mesh(fishGeometry, fishMaterial)
      fish.name = 'floating-fish'
      const angle = (i / 3) * Math.PI * 2 + rng.range(-0.25, 0.25)
      fish.position.set(Math.cos(angle) * radius * 0.38, 0.1, Math.sin(angle) * radius * 0.38)
      fish.scale.set(1.35, 0.45, 0.72)
      fish.rotation.y = angle + Math.PI / 2
      fish.castShadow = !lowFx
      this.floatingFish.add(fish)
    }
    this.floatingFish.visible = false
    this.group.add(this.floatingFish)
  }

  floatFish(): boolean {
    if (!this.hasFish) return false
    this.hasFish = false
    this.floatingFish.visible = true
    return true
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }

  update(qt: number): void {
    if (qt === this.lastQt) return
    const frame = Math.floor(qt * TIMING.fps)
    const pulse = 1 + Math.sin(frame * 0.45) * 0.012
    this.water.scale.setScalar(pulse)
    this.water.material.opacity = 0.69 + Math.sin(frame * 0.32) * 0.035
    if (this.floatingFish.visible) {
      this.floatingFish.position.y = 0.035 + (frame % 4 < 2 ? 0.025 : 0)
      this.floatingFish.rotation.y = Math.sin(frame * 0.2) * 0.035
    }
    this.lastQt = qt
  }
}

export class Grave {
  readonly group = new THREE.Group()
  fresh = true

  private age = 0

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
    if (!this.fresh) return
    this.age += dt
    if (this.age >= 60) this.fresh = false
  }
}

export class FlowerPatch {
  readonly group = new THREE.Group()

  constructor(
    public x: number,
    public z: number,
    public radius: number,
    sampleHeight: (x: number, z: number) => number,
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
    for (let i = 0; i < count; i++) {
      let px = x
      let pz = z
      for (let attempt = 0; attempt < 40; attempt++) {
        const angle = rng.range(0, Math.PI * 2)
        const distance = Math.sqrt(rng.next()) * radius
        const candidateX = x + Math.cos(angle) * distance
        const candidateZ = z + Math.sin(angle) * distance
        if (Math.hypot(candidateX, candidateZ) > ISLAND_RADIUS) continue
        px = candidateX
        pz = candidateZ
        break
      }
      dummy.position.set(px, sampleHeight(px, pz) + rng.range(0.08, 0.16), pz)
      const scale = rng.range(0.7, 1.35)
      dummy.scale.set(scale, scale * rng.range(0.85, 1.35), scale)
      dummy.rotation.set(rng.range(-0.25, 0.25), rng.range(0, Math.PI * 2), rng.range(-0.25, 0.25))
      dummy.updateMatrix()
      flowers.setMatrixAt(i, dummy.matrix)
    }
    flowers.instanceMatrix.needsUpdate = true
    this.group.add(flowers)
  }

  dispose(): void {
    disposeObjectResources(this.group)
  }
}

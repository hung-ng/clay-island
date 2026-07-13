import * as THREE from 'three'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'

export type TreeState = 'normal' | 'chopped' | 'burning' | 'burnt'
export type HutState = 'site' | 'building' | 'built' | 'burning' | 'ruin'

const SCORCH = new THREE.Color(PALETTE.scorch)

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

export class Tree {
  state: TreeState = 'normal'
  group = new THREE.Group()

  private crown = new THREE.Group()
  private crownMaterials: THREE.MeshToonMaterial[] = []
  private crownColors: THREE.Color[] = []
  private recoveryTime = 0
  private shrinkFrames = 0
  private lastQt = Number.NEGATIVE_INFINITY
  private burnMix = 0
  private fruit: THREE.InstancedMesh | null = null
  private fruitTime = 0

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
    addBlobShadow(this.group, 1.05, lowFx)
  }

  chop(): void {
    if (this.state === 'burning') return
    this.state = 'chopped'
    this.beginRecovery()
  }

  ignite(): void {
    if (this.state === 'burnt') return
    this.state = 'burning'
    this.burnMix = 0
  }

  extinguish(): void {
    if (this.state !== 'burning') return
    this.state = 'normal'
    this.burnMix = 0
    this.resetCrownColors()
  }

  setBurnt(): void {
    this.state = 'burnt'
    this.burnMix = 1
    this.beginRecovery()
    for (const material of this.crownMaterials) material.color.copy(SCORCH)
  }

  growFruit(): void {
    if (this.fruit) this.crown.remove(this.fruit)
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
        this.crown.scale.setScalar(1)
        this.resetCrownColors()
      }
    }
    this.lastQt = qt

    if (this.fruit) {
      this.fruitTime -= dt
      if (this.fruitTime <= 0) {
        this.crown.remove(this.fruit)
        this.fruit = null
      }
    }
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

  private base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private door: THREE.Mesh
  private roofKnob: THREE.Mesh
  private siteStones: THREE.InstancedMesh
  private smoke: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[] = []
  private lastQt = Number.NEGATIVE_INFINITY
  private burnMix = 0

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
    addBlobShadow(this.group, 1.35, lowFx)
    this.syncAppearance()
  }

  buildTick(): void {
    if (this.state !== 'site' && this.state !== 'building' && this.state !== 'ruin') return
    this.state = 'building'
    this.progress = Math.min(1, this.progress + 0.34)
    if (this.progress >= 1) this.state = 'built'
    this.syncAppearance()
  }

  ignite(): void {
    if (this.state !== 'built') return
    this.state = 'burning'
    this.burnMix = 0
    this.syncAppearance()
  }

  extinguish(): void {
    if (this.state !== 'burning') return
    this.state = 'built'
    this.burnMix = 0
    this.base.material.color.set(PALETTE.hutClay)
    this.syncAppearance()
  }

  setRuin(): void {
    this.state = 'ruin'
    this.progress = 0
    this.burnMix = 1
    this.syncAppearance()
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

  private flames: THREE.Mesh[] = []
  private light: THREE.PointLight
  private lastQt = Number.NEGATIVE_INFINITY
  private flareTime = 0

  constructor(
    public x: number,
    public z: number,
    y: number,
    rng: RNG,
    lowFx = false,
  ) {
    this.group.position.set(x, y, z)
    this.group.add(ringMesh(6, 0.7, 0.19, rng, lowFx))

    for (let i = 0; i < 2; i++) {
      const log = new THREE.Mesh(
        wobble(new THREE.CylinderGeometry(0.12, 0.14, 1.35, 9, 3), rng, 0.035),
        clayMaterial(PALETTE.bark),
      )
      log.rotation.z = Math.PI / 2
      log.rotation.y = (i === 0 ? 1 : -1) * Math.PI / 4
      log.position.y = 0.22
      setShadow(log, lowFx)
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

  flare(): void {
    this.lit = true
    this.flareTime = 1
  }

  douse(): void {
    this.lit = false
    this.flareTime = 0
  }

  update(dt: number, qt: number): void {
    this.flareTime = Math.max(0, this.flareTime - dt)
    const flareScale = this.flareTime > 0 ? 1.75 : 1
    for (const flame of this.flames) flame.visible = this.lit
    this.light.visible = this.lit
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

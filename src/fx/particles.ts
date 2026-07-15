import * as THREE from 'three'
import { RNG } from '../core/rng'
import { PALETTE } from '../ui/tokens'
import { clayMaterial } from './clayMaterial'
import { wobble } from './wobble'

export type BurstOptions = {
  x: number
  y: number
  z: number
  n: number
  color: THREE.ColorRepresentation
  speed: number
  gravity: number
  size?: number
  life: number
}

export class ParticleBurst {
  readonly mesh: THREE.InstancedMesh
  private readonly rng = new RNG(83)
  private readonly dummy = new THREE.Object3D()
  private readonly position: Float32Array
  private readonly velocity: Float32Array
  private readonly rotation: Float32Array
  private readonly spin: Float32Array
  private readonly age: Float32Array
  private readonly lifetime: Float32Array
  private readonly gravity: Float32Array
  private readonly size: Float32Array
  private cursor = 0

  constructor(parent: THREE.Object3D, private readonly max = 400) {
    const geometry = wobble(new THREE.IcosahedronGeometry(0.1, 0), this.rng, 0.035)
    const material = clayMaterial(PALETTE.unmodulated)
    this.mesh = new THREE.InstancedMesh(geometry, material, max)
    this.mesh.name = 'clay-particle-pool'
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false

    this.position = new Float32Array(max * 3)
    this.velocity = new Float32Array(max * 3)
    this.rotation = new Float32Array(max * 3)
    this.spin = new Float32Array(max * 3)
    this.age = new Float32Array(max)
    this.lifetime = new Float32Array(max)
    this.gravity = new Float32Array(max)
    this.size = new Float32Array(max)

    this.dummy.scale.setScalar(0)
    this.dummy.updateMatrix()
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.dummy.matrix)
    this.mesh.instanceMatrix.needsUpdate = true
    parent.add(this.mesh)
  }

  burst(options: BurstOptions): void {
    if (options.n <= 0 || options.life <= 0) return
    const color = new THREE.Color(options.color)
    const baseSize = options.size ?? 1
    let spawned = 0
    let scanned = 0
    let index = this.cursor

    while (spawned < options.n && scanned < this.max) {
      if (this.lifetime[index] <= 0) {
        this.spawn(index, options, baseSize)
        this.mesh.setColorAt(index, color)
        spawned++
        this.cursor = (index + 1) % this.max
      }
      index = (index + 1) % this.max
      scanned++
    }

    if (spawned > 0) {
      this.mesh.instanceMatrix.needsUpdate = true
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }
  }

  update(dt: number): void {
    let changed = false
    for (let i = 0; i < this.max; i++) {
      const life = this.lifetime[i]
      if (life <= 0) continue
      this.age[i] += dt
      if (this.age[i] >= life) {
        this.lifetime[i] = 0
        this.writeMatrix(i, 0)
        changed = true
        continue
      }

      const offset = i * 3
      this.velocity[offset + 1] -= this.gravity[i] * dt
      this.position[offset] += this.velocity[offset] * dt
      this.position[offset + 1] += this.velocity[offset + 1] * dt
      this.position[offset + 2] += this.velocity[offset + 2] * dt
      this.rotation[offset] += this.spin[offset] * dt
      this.rotation[offset + 1] += this.spin[offset + 1] * dt
      this.rotation[offset + 2] += this.spin[offset + 2] * dt

      const remaining = 1 - this.age[i] / life
      this.writeMatrix(i, this.size[i] * remaining)
      changed = true
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true
  }

  private spawn(index: number, options: BurstOptions, baseSize: number): void {
    const offset = index * 3
    const angle = this.rng.range(0, Math.PI * 2)
    const horizontalSpeed = options.speed * this.rng.range(0.25, 0.8)
    this.position[offset] = options.x + this.rng.range(-0.12, 0.12) * baseSize
    this.position[offset + 1] = options.y + this.rng.range(0, 0.16) * baseSize
    this.position[offset + 2] = options.z + this.rng.range(-0.12, 0.12) * baseSize
    this.velocity[offset] = Math.cos(angle) * horizontalSpeed
    this.velocity[offset + 1] = options.speed * this.rng.range(0.55, 1.1)
    this.velocity[offset + 2] = Math.sin(angle) * horizontalSpeed
    this.rotation[offset] = this.rng.range(0, Math.PI * 2)
    this.rotation[offset + 1] = this.rng.range(0, Math.PI * 2)
    this.rotation[offset + 2] = this.rng.range(0, Math.PI * 2)
    this.spin[offset] = this.rng.range(-8, 8)
    this.spin[offset + 1] = this.rng.range(-8, 8)
    this.spin[offset + 2] = this.rng.range(-8, 8)
    this.age[index] = 0
    this.lifetime[index] = options.life * this.rng.range(0.8, 1.2)
    this.gravity[index] = options.gravity
    this.size[index] = baseSize * this.rng.range(0.65, 1.4)
    this.writeMatrix(index, this.size[index])
  }

  private writeMatrix(index: number, scale: number): void {
    const offset = index * 3
    this.dummy.position.fromArray(this.position, offset)
    this.dummy.rotation.set(
      this.rotation[offset],
      this.rotation[offset + 1],
      this.rotation[offset + 2],
    )
    this.dummy.scale.setScalar(scale)
    this.dummy.updateMatrix()
    this.mesh.setMatrixAt(index, this.dummy.matrix)
  }
}

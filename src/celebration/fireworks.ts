import * as THREE from 'three'
import { ParticleBurst } from '../fx/particles'
import { clayMaterial } from '../fx/clayMaterial'
import { PALETTE } from '../ui/tokens'

export type CelebrationSoundCue = 'launch' | 'pop' | 'finale' | 'cheer'
export type FireworkOrigin = { x: number; y: number; z: number }

export type FireworkLaunch = {
  at: number
  wave: 1 | 2 | 3 | 4
  x: number
  z: number
  height: number
  color: string
  finale: boolean
}

export const FIREWORK_LAUNCHES: readonly FireworkLaunch[] = [
  { at: 4.0, wave: 1, x: -2.8, z: -0.6, height: 7.2, color: PALETTE.flame, finale: false },
  { at: 4.3, wave: 1, x: 0.0, z: 2.6, height: 8.0, color: PALETTE.smockB, finale: false },
  { at: 4.6, wave: 1, x: 2.8, z: -0.4, height: 7.5, color: PALETTE.ember, finale: false },
  { at: 6.2, wave: 2, x: -2.1, z: 1.8, height: 8.4, color: PALETTE.bloom, finale: false },
  { at: 6.5, wave: 2, x: 0.8, z: -2.5, height: 7.6, color: PALETTE.leafA, finale: false },
  { at: 6.8, wave: 2, x: 2.6, z: 1.4, height: 8.2, color: PALETTE.smockC, finale: false },
  { at: 8.4, wave: 3, x: -2.9, z: 0.5, height: 8.0, color: PALETTE.smockA, finale: false },
  { at: 8.7, wave: 3, x: -0.2, z: -2.7, height: 8.7, color: PALETTE.water, finale: false },
  { at: 9.0, wave: 3, x: 2.9, z: 0.6, height: 8.1, color: PALETTE.ember, finale: false },
  { at: 12.0, wave: 4, x: 0.0, z: 0.3, height: 9.2, color: PALETTE.cloud, finale: true },
] as const

type RocketSlot = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshToonMaterial>
  material: THREE.MeshToonMaterial
  cue: FireworkLaunch | null
  age: number
  trailElapsed: number
}

const ROCKET_SECONDS = 0.72

export class CelebrationFireworks {
  readonly group = new THREE.Group()
  readonly poolCapacity: number
  private readonly pool: ParticleBurst
  private readonly tubes = new THREE.Group()
  private readonly rockets: RocketSlot[] = []
  private elapsed = 0
  private nextLaunch = 0
  private disposed = false
  launchedCount = 0

  constructor(
    parent: THREE.Object3D,
    private readonly options: { lowFx: boolean; reducedMotion(): boolean },
  ) {
    this.group.name = 'celebration-fireworks'
    this.group.visible = false
    this.poolCapacity = options.lowFx ? 120 : 320
    this.pool = new ParticleBurst(this.group, this.poolCapacity, 1515)

    for (const [index, x] of [-0.48, 0, 0.48].entries()) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.15, 0.52, 7),
        clayMaterial([PALETTE.smockA, PALETTE.smockB, PALETTE.smockC][index]!),
      )
      tube.position.set(x, 0.26, 0)
      tube.rotation.z = (index - 1) * -0.12
      tube.castShadow = !options.lowFx
      this.tubes.add(tube)
    }
    this.tubes.position.set(0, 0, 1.1)
    this.group.add(this.tubes)

    for (let index = 0; index < 4; index++) {
      const material = clayMaterial(PALETTE.ember)
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 7, 5),
        material,
      )
      mesh.visible = false
      mesh.castShadow = !options.lowFx
      this.group.add(mesh)
      this.rockets.push({ mesh, material, cue: null, age: 0, trailElapsed: 0 })
    }
    parent.add(this.group)
  }

  get activeParticleCount(): number { return this.pool.activeCount }

  begin(centre: FireworkOrigin): void {
    if (this.disposed) return
    this.reset()
    this.group.position.set(centre.x, centre.y, centre.z)
    this.group.visible = true
  }

  update(dt: number): CelebrationSoundCue[] {
    if (this.disposed || !this.group.visible) return []
    const cues: CelebrationSoundCue[] = []
    this.elapsed += Math.max(0, dt)

    while (this.nextLaunch < FIREWORK_LAUNCHES.length) {
      const launch = FIREWORK_LAUNCHES[this.nextLaunch]!
      if (launch.at > this.elapsed) break
      const slot = this.rockets.find(candidate => candidate.cue === null)
      if (!slot) break
      slot.cue = launch
      slot.age = 0
      slot.trailElapsed = 0
      slot.mesh.visible = true
      slot.mesh.position.set(launch.x, 0.55, launch.z)
      slot.material.color.set(launch.color)
      slot.material.emissive.set(launch.color).multiplyScalar(0.14)
      this.nextLaunch++
      this.launchedCount++
      cues.push('launch')
    }

    for (const slot of this.rockets) {
      const launch = slot.cue
      if (!launch) continue
      slot.age += dt
      const progress = Math.min(1, slot.age / ROCKET_SECONDS)
      slot.mesh.position.y = 0.55 + launch.height * progress
      slot.trailElapsed += dt
      const trailStep = this.options.reducedMotion() ? 0.18 : 0.08
      while (slot.trailElapsed >= trailStep && slot.age < ROCKET_SECONDS) {
        slot.trailElapsed -= trailStep
        this.pool.burst({
          x: slot.mesh.position.x,
          y: slot.mesh.position.y - 0.08,
          z: slot.mesh.position.z,
          n: 1,
          color: launch.color,
          speed: 0.15,
          gravity: 0.1,
          life: this.options.reducedMotion() ? 0.12 : 0.28,
          size: 0.34,
        })
      }
      if (slot.age < ROCKET_SECONDS) continue

      slot.mesh.visible = false
      const density = this.options.lowFx
        ? (launch.finale ? 54 : 22)
        : (launch.finale ? 120 : 42)
      const reducedDensity = this.options.reducedMotion() ? Math.ceil(density * 0.55) : density
      const colors = launch.finale
        ? [PALETTE.flame, PALETTE.smockB, PALETTE.ember]
        : [launch.color]
      for (const color of colors) {
        this.pool.burst({
          x: launch.x,
          y: slot.mesh.position.y,
          z: launch.z,
          n: Math.ceil(reducedDensity / colors.length),
          color,
          speed: this.options.reducedMotion() ? 2.2 : 3.2,
          gravity: 1.4,
          life: this.options.reducedMotion() ? 0.75 : 1.15,
          size: launch.finale ? 1.15 : 0.9,
          shape: 'sphere',
        })
      }
      cues.push(launch.finale ? 'finale' : 'pop')
      slot.cue = null
      slot.trailElapsed = 0
    }

    this.pool.update(dt)
    return cues
  }

  reset(): void {
    if (this.disposed) return
    this.elapsed = 0
    this.nextLaunch = 0
    this.launchedCount = 0
    this.pool.clear()
    for (const slot of this.rockets) {
      slot.cue = null
      slot.age = 0
      slot.trailElapsed = 0
      slot.mesh.visible = false
    }
    this.group.visible = false
  }

  dispose(): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
    this.pool.dispose()
    this.group.removeFromParent()
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object === this.pool.mesh) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    })
  }
}

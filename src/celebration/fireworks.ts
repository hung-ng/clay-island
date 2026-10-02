import * as THREE from 'three'
import { ParticleBurst, type BurstOptions } from '../fx/particles'
import { clayMaterial } from '../fx/clayMaterial'
import { PALETTE } from '../ui/tokens'

export type CelebrationSoundCue = 'launch' | 'pop' | 'crackle' | 'finale' | 'cheer'
export type FireworkOrigin = { x: number; y: number; z: number }
export type FireworkPattern = 'peony' | 'ring' | 'willow' | 'finale'

export type FireworkLaunch = {
  at: number
  wave: 1 | 2 | 3 | 4
  x: number
  z: number
  height: number
  color: string
  pattern: FireworkPattern
  echo: boolean
  finale: boolean
}

export const FIREWORK_LAUNCHES: readonly FireworkLaunch[] = [
  { at: 4.00, wave: 1, x: -3.2, z: -0.7, height: 8.0, color: PALETTE.flame, pattern: 'peony', echo: true, finale: false },
  { at: 4.25, wave: 1, x: 0.0, z: 2.7, height: 9.2, color: PALETTE.cloud, pattern: 'ring', echo: false, finale: false },
  { at: 4.50, wave: 1, x: 3.2, z: -0.5, height: 8.3, color: PALETTE.smockB, pattern: 'peony', echo: true, finale: false },
  { at: 5.80, wave: 2, x: -2.6, z: 1.8, height: 9.8, color: PALETTE.bloom, pattern: 'willow', echo: false, finale: false },
  { at: 6.15, wave: 2, x: 2.7, z: 1.5, height: 8.9, color: PALETTE.leafA, pattern: 'ring', echo: true, finale: false },
  { at: 6.80, wave: 2, x: 0.0, z: -2.6, height: 10.3, color: PALETTE.ember, pattern: 'peony', echo: true, finale: false },
  { at: 7.70, wave: 3, x: -3.8, z: 0.5, height: 8.9, color: PALETTE.smockA, pattern: 'ring', echo: false, finale: false },
  { at: 7.95, wave: 3, x: -1.3, z: -1.8, height: 10.4, color: PALETTE.water, pattern: 'peony', echo: true, finale: false },
  { at: 8.20, wave: 3, x: 1.3, z: -1.8, height: 9.7, color: PALETTE.smockC, pattern: 'willow', echo: false, finale: false },
  { at: 9.25, wave: 3, x: 3.7, z: 0.6, height: 9.1, color: PALETTE.ember, pattern: 'ring', echo: true, finale: false },
  { at: 10.00, wave: 3, x: -2.1, z: 0.8, height: 10.7, color: PALETTE.bloom, pattern: 'peony', echo: true, finale: false },
  { at: 10.35, wave: 3, x: 2.1, z: 0.8, height: 10.9, color: PALETTE.flame, pattern: 'willow', echo: false, finale: false },
  { at: 11.25, wave: 4, x: 0.0, z: 0.3, height: 11.6, color: PALETTE.cloud, pattern: 'finale', echo: false, finale: true },
  { at: 11.70, wave: 4, x: -4.2, z: 0.5, height: 9.4, color: PALETTE.flame, pattern: 'finale', echo: false, finale: true },
  { at: 11.70, wave: 4, x: -2.1, z: -0.1, height: 10.5, color: PALETTE.smockB, pattern: 'finale', echo: false, finale: true },
  { at: 11.70, wave: 4, x: 0.0, z: -0.5, height: 9.8, color: PALETTE.ember, pattern: 'finale', echo: false, finale: true },
  { at: 11.70, wave: 4, x: 2.1, z: -0.1, height: 10.5, color: PALETTE.smockC, pattern: 'finale', echo: false, finale: true },
  { at: 11.70, wave: 4, x: 4.2, z: 0.5, height: 9.4, color: PALETTE.bloom, pattern: 'finale', echo: false, finale: true },
] as const

type RocketSlot = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshToonMaterial>
  material: THREE.MeshToonMaterial
  cue: FireworkLaunch | null
  age: number
  trailElapsed: number
  startX: number
  startZ: number
}

type EchoSlot = {
  active: boolean
  at: number
  x: number
  y: number
  z: number
  color: string
}

type FlashSlot = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  material: THREE.MeshBasicMaterial
  age: number
  life: number
}

const ROCKET_SECONDS = 0.72
const TUBE_X = [-0.48, 0, 0.48] as const
const TUBE_Z = 1.1
const ANTICIPATION_START = 2.55
const FIRST_LAUNCH = FIREWORK_LAUNCHES[0]!.at
const BURST_LIGHT = {
  height: 10,
  distance: 34,
  peak: 5,
  finalePeak: 8,
  maxIntensity: 12,
  decaySeconds: 0.5,
} as const

export class CelebrationFireworks {
  readonly group = new THREE.Group()
  readonly poolCapacity: number
  private readonly pool: ParticleBurst
  private readonly burstLight: THREE.PointLight | null
  private readonly tubes = new THREE.Group()
  private readonly tubeMaterials: THREE.MeshToonMaterial[] = []
  private readonly rockets: RocketSlot[] = []
  private readonly echoes: EchoSlot[] = Array.from({ length: 8 }, () => ({
    active: false, at: 0, x: 0, y: 0, z: 0, color: PALETTE.cloud,
  }))
  private readonly flashes: FlashSlot[] = []
  private readonly flashGeometry = new THREE.SphereGeometry(0.38, 7, 5)
  private elapsed = 0
  private nextLaunch = 0
  private sputterElapsed = 0
  private nextTube = 0
  private disposed = false
  launchedCount = 0

  constructor(
    parent: THREE.Object3D,
    private readonly options: {
      lowFx: boolean
      reducedMotion(): boolean
    },
  ) {
    this.group.name = 'celebration-fireworks'
    this.group.visible = false
    this.poolCapacity = options.lowFx ? 200 : 560
    this.pool = new ParticleBurst(this.group, this.poolCapacity, 1515)
    this.burstLight = options.lowFx ? null : new THREE.PointLight(PALETTE.cloud, 0, BURST_LIGHT.distance)
    if (this.burstLight) {
      this.burstLight.name = 'celebration-burst-light'
      this.burstLight.visible = false
      parent.add(this.burstLight)
    }

    for (const [index, x] of TUBE_X.entries()) {
      const material = clayMaterial([PALETTE.smockA, PALETTE.smockB, PALETTE.smockC][index]!)
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.15, 0.52, 7),
        material,
      )
      tube.position.set(x, 0.26, 0)
      tube.rotation.z = (index - 1) * -0.12
      tube.castShadow = !options.lowFx
      this.tubeMaterials.push(material)
      this.tubes.add(tube)
    }
    this.tubes.position.set(0, 0, TUBE_Z)
    this.group.add(this.tubes)

    for (let index = 0; index < 6; index++) {
      const material = clayMaterial(PALETTE.ember)
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 7, 5),
        material,
      )
      mesh.visible = false
      mesh.castShadow = !options.lowFx
      this.group.add(mesh)
      this.rockets.push({
        mesh,
        material,
        cue: null,
        age: 0,
        trailElapsed: 0,
        startX: 0,
        startZ: TUBE_Z,
      })
    }

    for (let index = 0; index < 8; index++) {
      const material = new THREE.MeshBasicMaterial({
        color: PALETTE.cloud,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(this.flashGeometry, material)
      mesh.visible = false
      mesh.renderOrder = 4
      this.group.add(mesh)
      this.flashes.push({ mesh, material, age: 0, life: 0 })
    }
    parent.add(this.group)
  }

  get activeParticleCount(): number { return this.pool.activeCount }

  begin(centre: FireworkOrigin): void {
    if (this.disposed) return
    this.reset()
    this.group.position.set(centre.x, centre.y, centre.z)
    this.burstLight?.position.set(centre.x, centre.y + BURST_LIGHT.height, centre.z)
    this.group.visible = true
  }

  update(dt: number): CelebrationSoundCue[] {
    if (this.disposed || !this.group.visible) return []
    const delta = Math.max(0, dt)
    this.updateBurstLight(delta)
    const before = this.elapsed
    this.elapsed += delta
    let launched = false
    let popped = false
    let crackled = false
    let finaled = false

    this.updateAnticipation(before, this.elapsed)
    this.updateFlashes(delta)

    while (this.nextLaunch < FIREWORK_LAUNCHES.length) {
      const launch = FIREWORK_LAUNCHES[this.nextLaunch]!
      if (launch.at > this.elapsed) break
      const slot = this.rockets.find(candidate => candidate.cue === null)
      if (!slot) break
      const tubeIndex = this.nextLaunch % TUBE_X.length
      slot.cue = launch
      slot.age = 0
      slot.trailElapsed = 0
      slot.startX = TUBE_X[tubeIndex]!
      slot.startZ = TUBE_Z
      slot.mesh.visible = true
      slot.mesh.position.set(slot.startX, 0.55, slot.startZ)
      slot.material.color.set(launch.color)
      slot.material.emissive.set(launch.color)
      slot.material.emissiveIntensity = 0.18
      this.nextLaunch++
      this.launchedCount++
      launched = true
    }

    for (const slot of this.rockets) {
      const launch = slot.cue
      if (!launch) continue
      slot.age += delta
      const progress = Math.min(1, slot.age / ROCKET_SECONDS)
      const outward = 1 - (1 - progress) ** 3
      slot.mesh.position.x = THREE.MathUtils.lerp(slot.startX, launch.x, outward)
      slot.mesh.position.y = 0.55 + launch.height * progress
      slot.mesh.position.z = THREE.MathUtils.lerp(slot.startZ, launch.z, outward)
      slot.trailElapsed += delta
      const trailStep = this.options.reducedMotion() ? 0.18 : this.options.lowFx ? 0.12 : 0.07
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
      this.emitBurst(launch, slot.mesh.position.x, slot.mesh.position.y, slot.mesh.position.z)
      this.flash(slot.mesh.position.x, slot.mesh.position.y, slot.mesh.position.z, launch.color)
      if (this.burstLight) {
        this.burstLight.color.set(launch.color)
        const added = launch.finale ? BURST_LIGHT.finalePeak : BURST_LIGHT.peak
        this.burstLight.intensity = Math.min(BURST_LIGHT.maxIntensity, this.burstLight.intensity + added)
        this.burstLight.visible = true
      }
      if (launch.echo && !this.options.reducedMotion()) {
        this.scheduleEcho(slot.mesh.position.x, slot.mesh.position.y, slot.mesh.position.z, launch.color)
      }
      if (launch.finale) finaled = true
      else popped = true
      slot.cue = null
      slot.trailElapsed = 0
    }

    for (const echo of this.echoes) {
      if (!echo.active || echo.at > this.elapsed) continue
      echo.active = false
      this.pool.burst({
        x: echo.x,
        y: echo.y,
        z: echo.z,
        n: this.options.lowFx ? 5 : 12,
        color: echo.color,
        speed: 0.9,
        gravity: 0.8,
        life: 0.55,
        size: 0.45,
        shape: 'sphere',
      })
      crackled = true
    }

    this.pool.update(delta)
    const cues: CelebrationSoundCue[] = []
    if (launched) cues.push('launch')
    if (popped) cues.push('pop')
    if (crackled) cues.push('crackle')
    if (finaled) cues.push('finale')
    return cues
  }

  reset(): void {
    if (this.disposed) return
    this.elapsed = 0
    this.nextLaunch = 0
    this.sputterElapsed = 0
    this.nextTube = 0
    this.launchedCount = 0
    this.pool.clear()
    for (const material of this.tubeMaterials) {
      material.emissive.set(0x000000)
      material.emissiveIntensity = 1
    }
    for (const slot of this.rockets) {
      slot.cue = null
      slot.age = 0
      slot.trailElapsed = 0
      slot.mesh.visible = false
    }
    for (const echo of this.echoes) echo.active = false
    for (const flash of this.flashes) {
      flash.age = 0
      flash.life = 0
      flash.mesh.visible = false
      flash.material.opacity = 0
    }
    this.group.visible = false
    if (this.burstLight) {
      this.burstLight.intensity = 0
      this.burstLight.visible = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
    this.pool.dispose()
    this.burstLight?.removeFromParent()
    this.burstLight?.dispose()
    for (const flash of this.flashes) {
      flash.mesh.removeFromParent()
      flash.material.dispose()
    }
    this.flashGeometry.dispose()
    this.group.removeFromParent()
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    })
  }

  private updateBurstLight(dt: number): void {
    if (!this.burstLight?.visible) return
    this.burstLight.intensity = Math.max(
      0,
      this.burstLight.intensity - (BURST_LIGHT.peak / BURST_LIGHT.decaySeconds) * dt,
    )
    if (this.burstLight.intensity <= 0.01) {
      this.burstLight.intensity = 0
      this.burstLight.visible = false
    }
  }

  private updateAnticipation(before: number, after: number): void {
    const anticipation = THREE.MathUtils.clamp(
      (after - ANTICIPATION_START) / (FIRST_LAUNCH - ANTICIPATION_START),
      0,
      1,
    )
    const pulse = this.options.reducedMotion() ? 0 : Math.max(0, Math.sin(after * 18)) * 0.1
    for (const material of this.tubeMaterials) {
      if (after < FIRST_LAUNCH) {
        material.emissive.copy(material.color)
        material.emissiveIntensity = anticipation * (0.18 + pulse)
      } else {
        material.emissive.set(0x000000)
        material.emissiveIntensity = 1
      }
    }

    const activeSeconds = Math.max(
      0,
      Math.min(after, FIRST_LAUNCH) - Math.max(before, ANTICIPATION_START),
    )
    if (activeSeconds <= 0) return
    this.sputterElapsed += activeSeconds
    const interval = this.options.reducedMotion() ? 0.42 : this.options.lowFx ? 0.28 : 0.18
    while (this.sputterElapsed >= interval) {
      this.sputterElapsed -= interval
      const tube = this.nextTube % TUBE_X.length
      this.pool.burst({
        x: TUBE_X[tube]!,
        y: 0.58,
        z: TUBE_Z,
        n: 1,
        color: tube === 1 ? PALETTE.cloud : PALETTE.ember,
        speed: 0.55,
        gravity: 0.35,
        life: this.options.reducedMotion() ? 0.22 : 0.34,
        size: 0.4,
      })
      this.nextTube++
    }
  }

  private updateFlashes(dt: number): void {
    for (const flash of this.flashes) {
      if (!flash.mesh.visible) continue
      flash.age += dt
      if (flash.age >= flash.life) {
        flash.mesh.visible = false
        flash.material.opacity = 0
        continue
      }
      const progress = flash.age / flash.life
      flash.mesh.scale.setScalar(0.65 + progress * 2)
      flash.material.opacity = (1 - progress) * 0.92
    }
  }

  private emitBurst(launch: FireworkLaunch, x: number, y: number, z: number): void {
    if (launch.pattern === 'peony') {
      this.emitLayer(x, y, z, 38, launch.color, 3.4, 1.35, 1.2, 0.9, 'sphere')
      return
    }
    if (launch.pattern === 'ring') {
      this.emitLayer(x, y, z, 32, launch.color, 3.3, 0.9, 1.2, 0.8, 'ring')
      this.emitLayer(x, y, z, 8, PALETTE.cloud, 1.5, 1.2, 0.75, 0.55, 'sphere')
      return
    }
    if (launch.pattern === 'willow') {
      this.emitLayer(x, y, z, 38, launch.color, 2.7, 1.8, 1.75, 0.7, 'sphere')
      this.emitLayer(x, y, z, 8, PALETTE.flame, 1.7, 1.55, 1.3, 0.58, 'sphere')
      return
    }
    this.emitLayer(x, y, z, 48, launch.color, 3.8, 1.3, 1.4, 1, 'sphere')
    this.emitLayer(x, y, z, 18, PALETTE.flame, 4.2, 1, 1.25, 0.82, 'ring')
  }

  private emitLayer(
    x: number,
    y: number,
    z: number,
    enhancedCount: number,
    color: string,
    speed: number,
    gravity: number,
    life: number,
    size: number,
    shape: NonNullable<BurstOptions['shape']>,
  ): void {
    const qualityCount = this.options.lowFx
      ? Math.ceil(enhancedCount * 0.36)
      : enhancedCount
    const reduced = this.options.reducedMotion()
    const count = reduced ? Math.ceil(qualityCount * 0.55) : qualityCount
    this.pool.burst({
      x,
      y,
      z,
      n: count,
      color,
      speed: reduced ? speed * 0.72 : speed,
      gravity,
      life: reduced ? life * 0.68 : life,
      size,
      shape,
    })
  }

  private scheduleEcho(x: number, y: number, z: number, color: string): void {
    const echo = this.echoes.find(candidate => !candidate.active)
    if (!echo) return
    echo.active = true
    echo.at = this.elapsed + 0.22
    echo.x = x
    echo.y = y
    echo.z = z
    echo.color = color
  }

  private flash(x: number, y: number, z: number, color: string): void {
    const flash = this.flashes.find(candidate => !candidate.mesh.visible)
      ?? this.flashes[0]!
    flash.age = 0
    flash.life = this.options.reducedMotion() ? 0.1 : 0.16
    flash.mesh.position.set(x, y, z)
    flash.mesh.scale.setScalar(0.65)
    flash.mesh.visible = true
    flash.material.color.set(color)
    flash.material.opacity = this.options.reducedMotion() ? 0.5 : 0.92
  }
}

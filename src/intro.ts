import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { prefersReducedMotion } from './core/motion'
import type { World } from './world/world'

type IntroOptions = {
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  tray: HTMLElement
  world: World
}

export class Intro {
  private elapsed = 0
  private finished = false
  private fireCaught = false
  private readonly reduced = prefersReducedMotion()
  private readonly restCamera = new THREE.Vector3()
  private readonly startCamera = new THREE.Vector3()

  constructor(private readonly options: IntroOptions) {
    this.restCamera.copy(options.camera.position)
    this.startCamera.copy(this.restCamera).setY(this.restCamera.y - 4).multiplyScalar(1.12)
    options.tray.classList.add('intro-hidden')
    options.tray.inert = true
    options.controls.enabled = false
    if (!this.reduced) options.camera.position.copy(this.startCamera)
    for (const villager of options.world.villagers) villager.setIntroWake(0)
  }

  get done(): boolean { return this.finished }

  update(dt: number): void {
    if (this.finished) return
    this.elapsed = Math.min(4, this.elapsed + dt)
    if (!this.reduced) {
      const progress = THREE.MathUtils.smoothstep(this.elapsed, 0, 4)
      this.options.camera.position.lerpVectors(this.startCamera, this.restCamera, progress)
      this.options.world.island.group.rotation.y += dt * 0.055
    }
    this.options.world.villagers.forEach((villager, index) => {
      const progress = THREE.MathUtils.clamp((this.elapsed - 1.05 - index * 0.17) / 0.5, 0, 1)
      villager.setIntroWake(progress)
    })
    if (!this.fireCaught && this.elapsed >= 1.35) {
      this.fireCaught = true
      this.options.world.campfire.flare(1.1, 1.45)
    }
    if (this.elapsed >= 4) this.skip()
  }

  skip(): void {
    if (this.finished) return
    this.finished = true
    this.options.camera.position.copy(this.restCamera)
    this.options.controls.enabled = true
    this.options.controls.update()
    for (const villager of this.options.world.villagers) villager.setIntroWake(1)
    this.options.tray.classList.remove('intro-hidden')
    this.options.tray.inert = false
  }
}

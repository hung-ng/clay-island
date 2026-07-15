import { Vector3, type Camera } from 'three'
import { valueNoise2 } from '../core/noise'

export class Shake {
  private trauma = 0
  private amount = 0
  private duration = 1
  private time = 0
  private readonly previousOffset = new Vector3()

  constructor(private readonly reducedMotion: () => boolean = () => false) {}

  add(amount: number, seconds: number): void {
    if (amount <= 0 || seconds <= 0) return
    const remaining = this.trauma * this.duration
    this.trauma = 1
    this.amount = Math.max(this.amount, amount)
    this.duration = Math.max(remaining, seconds)
  }

  beginFrame(camera: Camera): void {
    camera.position.sub(this.previousOffset)
    this.previousOffset.set(0, 0, 0)
  }

  update(dt: number, camera: Camera): void {
    this.beginFrame(camera)

    if (this.trauma <= 0) return
    this.time += dt
    this.trauma = Math.max(0, this.trauma - dt / this.duration)
    if (this.reducedMotion()) {
      this.trauma = 0
      this.amount = 0
      return
    }

    const strength = this.trauma ** 2 * this.amount
    this.previousOffset.set(
      valueNoise2(this.time * 30, 0) * strength,
      valueNoise2(0, this.time * 30) * strength,
      0,
    )
    camera.position.add(this.previousOffset)
    if (this.trauma === 0) this.amount = 0
  }
}

let flashElement: HTMLDivElement | null = null
let flashAnimation: Animation | null = null

export function flash(color: string, seconds: number, reducedMotion = false): void {
  if (!flashElement) {
    flashElement = document.createElement('div')
    flashElement.id = 'fx-flash'
    Object.assign(flashElement.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '8',
      pointerEvents: 'none',
      opacity: '0',
    })
    const overlay = document.getElementById('ui') ?? document.body
    overlay.appendChild(flashElement)
  }

  flashAnimation?.cancel()
  flashElement.style.background = color
  const reduced = reducedMotion
  const duration = reduced ? Math.max(200, seconds * 1000) : Math.max(16, seconds * 1000)
  const keyframes: Keyframe[] = reduced
    ? [{ opacity: 0 }, { opacity: 0.3, offset: 0.45 }, { opacity: 0 }]
    : [{ opacity: 1 }, { opacity: 0 }]
  flashAnimation = flashElement.animate(keyframes, {
    duration,
    easing: reduced ? 'ease-in-out' : 'ease-out',
    fill: 'forwards',
  })
}

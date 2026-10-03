import * as THREE from 'three'
import { RNG } from '../core/rng'
import { PALETTE } from '../ui/tokens'

/** Deterministic dome of stars on the upper hemisphere, clear of the horizon. */
export function starPositions(count: number, radius: number, seed: number): Float32Array {
  const rng = new RNG(seed)
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const azimuth = rng.range(0, Math.PI * 2)
    const elevation = Math.asin(rng.range(0.08, 1))
    positions[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * radius
    positions[i * 3 + 1] = Math.sin(elevation) * radius
    positions[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius
  }
  return positions
}

/** Home points for firefly drift: a low ring between village and forest edge. */
export function fireflyBasePositions(count: number, seed: number): Float32Array {
  const rng = new RNG(seed)
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2)
    const radius = rng.range(3, 8)
    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = rng.range(0.5, 2.5)
    positions[i * 3 + 2] = Math.sin(angle) * radius
  }
  return positions
}

/** A soft round dot, drawn once: without a map, points render as hard squares. */
let glowDot: THREE.Texture | null = null
function glowDotTexture(): THREE.Texture {
  if (glowDot) return glowDot
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.85)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  glowDot = new THREE.CanvasTexture(canvas)
  return glowDot
}

/** Fireflies are tiny lights: past 1.0 so the bloom pass haloes them. */
const FIREFLY_GLOW = 3.5

const STAR_COUNT = 300
const STAR_COUNT_LOWFX = 120
const FIREFLY_COUNT = 14

export class NightSky {
  private readonly stars: THREE.Points
  private readonly starMaterial: THREE.PointsMaterial
  private readonly fireflies: THREE.Points | null = null
  private readonly fireflyMaterial: THREE.PointsMaterial | null = null
  private readonly fireflyBase: Float32Array | null = null
  private readonly fireflyPhases: number[] = []
  private starLevel = 0
  private fireflyLevel = 0
  private elapsed = 0

  constructor(scene: THREE.Scene, stageRoot: THREE.Object3D, lowFx: boolean) {
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(
      starPositions(lowFx ? STAR_COUNT_LOWFX : STAR_COUNT, 90, 4242),
      3,
    ))
    this.starMaterial = new THREE.PointsMaterial({
      color: PALETTE.cloud,
      map: glowDotTexture(),
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.stars = new THREE.Points(starGeometry, this.starMaterial)
    // The camera looks down at the island, so its visible backdrop intersects
    // the lower half of an island-centred dome. Mirror the generated upper
    // hemisphere for rendering while keeping the pure generator intuitive.
    this.stars.scale.y = -1
    this.stars.visible = false
    scene.add(this.stars)

    if (!lowFx) {
      this.fireflyBase = fireflyBasePositions(FIREFLY_COUNT, 11)
      const fireflyGeometry = new THREE.BufferGeometry()
      fireflyGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(this.fireflyBase.slice(), 3),
      )
      this.fireflyMaterial = new THREE.PointsMaterial({
        color: PALETTE.ember,
        map: glowDotTexture(),
        size: 0.42,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      this.fireflyMaterial.color.multiplyScalar(FIREFLY_GLOW)
      this.fireflies = new THREE.Points(fireflyGeometry, this.fireflyMaterial)
      this.fireflies.visible = false
      const rng = new RNG(23)
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        this.fireflyPhases.push(rng.range(0, Math.PI * 2))
      }
      stageRoot.add(this.fireflies)
    }
  }

  setLevels(starOpacity: number, fireflyLevel: number): void {
    this.starLevel = starOpacity
    this.fireflyLevel = fireflyLevel
  }

  update(dt: number, reducedMotion: boolean): void {
    this.elapsed += dt

    const twinkle = reducedMotion ? 1 : 0.9 + Math.sin(this.elapsed * 1.7) * 0.1
    this.starMaterial.opacity = this.starLevel * twinkle
    this.stars.visible = this.starLevel > 0.01

    if (!this.fireflies || !this.fireflyMaterial || !this.fireflyBase) return
    const pulse = 0.55 + Math.sin(this.elapsed * 2.3) * 0.45
    this.fireflyMaterial.opacity = this.fireflyLevel * pulse
    this.fireflies.visible = this.fireflyLevel > 0.01
    if (!reducedMotion && this.fireflies.visible) {
      const attribute = this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        const phase = this.fireflyPhases[i]!
        attribute.setX(
          i,
          this.fireflyBase[i * 3]! + Math.sin(this.elapsed * 0.6 + phase) * 0.6,
        )
        attribute.setY(
          i,
          this.fireflyBase[i * 3 + 1]! + Math.sin(this.elapsed * 0.9 + phase * 2) * 0.3,
        )
        attribute.setZ(
          i,
          this.fireflyBase[i * 3 + 2]! + Math.cos(this.elapsed * 0.5 + phase) * 0.6,
        )
      }
      attribute.needsUpdate = true
    }
  }
}

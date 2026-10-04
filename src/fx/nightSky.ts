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

const STAR_COUNT = 420
const STAR_COUNT_LOWFX = 120
const FIREFLY_COUNT = 26

function rgba(color: THREE.ColorRepresentation, alpha: number): string {
  const value = new THREE.Color(color)
  return `rgba(${Math.round(value.r * 255)},${Math.round(value.g * 255)},${Math.round(value.b * 255)},${alpha})`
}

/** Soft round dot: a point sprite with a bright core and a feathered edge. */
function glowSprite(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return null
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, rgba(PALETTE.cloud, 1))
  gradient.addColorStop(0.28, rgba(PALETTE.cloud, 0.85))
  gradient.addColorStop(0.6, rgba(PALETTE.cloud, 0.22))
  gradient.addColorStop(1, rgba(PALETTE.cloud, 0))
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Per-star brightness: most are faint, a few carry enough to bloom. */
function starColors(count: number, seed: number): Float32Array {
  const rng = new RNG(seed)
  const colors = new Float32Array(count * 3)
  const cool = new THREE.Color(PALETTE.cloud)
  const warm = new THREE.Color(PALETTE.ember)
  const color = new THREE.Color()
  for (let i = 0; i < count; i++) {
    const roll = rng.next()
    const brightness = roll > 0.94 ? rng.range(1.6, 2.4) : rng.range(0.45, 1.1)
    color.copy(cool).lerp(warm, rng.range(0, 0.25)).multiplyScalar(brightness)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  return colors
}

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
    const sprite = glowSprite()
    const starCount = lowFx ? STAR_COUNT_LOWFX : STAR_COUNT
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(
      starPositions(starCount, 90, 4242),
      3,
    ))
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors(starCount, 4243), 3))
    this.starMaterial = new THREE.PointsMaterial({
      size: sprite ? 3.2 : 0.7,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      ...(sprite ? { map: sprite } : {}),
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
      fireflyGeometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(FIREFLY_COUNT * 3).fill(1), 3),
      )
      this.fireflyMaterial = new THREE.PointsMaterial({
        // Over-bright so the bloom pass gives each one a halo.
        color: new THREE.Color(PALETTE.ember).multiplyScalar(3.2),
        size: sprite ? 0.55 : 0.28,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        ...(sprite ? { map: sprite } : {}),
      })
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
    this.fireflyMaterial.opacity = this.fireflyLevel
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
      // Each one blinks on its own slow beat rather than the swarm pulsing as one.
      const glow = this.fireflies.geometry.getAttribute('color') as THREE.BufferAttribute
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        const phase = this.fireflyPhases[i]!
        const blink = Math.max(0, Math.sin(this.elapsed * (1.1 + (i % 5) * 0.23) + phase * 3))
        const level = 0.15 + blink * blink * 0.85
        glow.setXYZ(i, level, level, level)
      }
      glow.needsUpdate = true
    }
  }
}

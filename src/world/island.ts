import * as THREE from 'three'
import { fbm2 } from '../core/noise'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { PALETTE } from '../ui/tokens'
import { craterOffset, type Crater } from './craters'

export const ISLAND_RADIUS = 15
export const WALK_RADIUS = 12

export function islandSurfaceY(x: number, z: number): number {
  const r = Math.hypot(x, z)
  if (r >= ISLAND_RADIUS) return 0
  const t = r / ISLAND_RADIUS
  const dome = (1 - t * t) * 2.0
  const bumps = fbm2(x * 0.14 + 7, z * 0.14 + 3) * 0.9 * (1 - t * 0.6)
  return dome + bumps
}

const GRASS_A = new THREE.Color(PALETTE.grassDark)
const GRASS_B = new THREE.Color(PALETTE.grassLight)
const DIRT = new THREE.Color(PALETTE.dirt)

export class Island {
  group = new THREE.Group()
  topMesh: THREE.Mesh
  craters: Crater[] = []
  /** Per-vertex scorch amount 0..1, painted in Task 10, mixed into vertex colors. */
  private scorchAmt: Float32Array
  private baseColors: Float32Array
  private rings = 40
  private segs = 80

  constructor(_rng: RNG) {
    // --- top: radial grid displaced by islandSurfaceY, vertex-colored grass
    const { rings, segs } = this
    const positions: number[] = [], colors: number[] = [], index: number[] = []
    for (let i = 0; i <= rings; i++) {
      const r = (i / rings) * ISLAND_RADIUS
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2
        const x = Math.cos(a) * r, z = Math.sin(a) * r
        positions.push(x, islandSurfaceY(x, z), z)
        const patch = (fbm2(x * 0.3, z * 0.3) + 1) / 2
        const c = GRASS_A.clone().lerp(GRASS_B, patch)
        if (r > ISLAND_RADIUS - 1.2) c.lerp(DIRT, (r - (ISLAND_RADIUS - 1.2)) / 1.2)
        colors.push(c.r, c.g, c.b)
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + segs + 1
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
    const topGeo = new THREE.BufferGeometry()
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    topGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    topGeo.setIndex(index)
    topGeo.computeVertexNormals()
    // White base so the per-vertex grass colors come through unmodulated.
    const topMat = clayMaterial(PALETTE.unmodulated); topMat.vertexColors = true
    this.topMesh = new THREE.Mesh(topGeo, topMat)
    this.topMesh.receiveShadow = true
    this.group.add(this.topMesh)

    this.baseColors = Float32Array.from(colors)
    this.scorchAmt = new Float32Array(positions.length / 3)

    // --- underside: lathe cone with chunky noise, rock colored
    const profile: THREE.Vector2[] = []
    const depth = 10
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      const noise = fbm2(t * 5, 3.7) * 0.15 * Math.sin(t * Math.PI)
      const r = ISLAND_RADIUS * (1 - t * t) * (1 + noise)
      profile.push(new THREE.Vector2(Math.max(r, 0.01), -t * depth))
    }
    const underGeo = new THREE.LatheGeometry(profile, 48)
    const under = new THREE.Mesh(underGeo, clayMaterial(PALETTE.rock))
    under.castShadow = false
    this.group.add(under)
  }

  /** The one true ground height. Everything that stands on the island calls this. */
  sampleHeight(x: number, z: number): number {
    return islandSurfaceY(x, z) - craterOffset(x, z, this.craters)
  }

  // addCrater() and scorch() are implemented in Task 10; they push to `craters`,
  // rewrite the position/color attributes, and recompute normals.
}

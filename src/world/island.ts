import * as THREE from 'three'
import { fbm2 } from '../core/noise'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { accumulateScorch, blendChannel } from '../fx/decals'
import { PALETTE } from '../ui/tokens'
import { craterInfluenceRadius, craterOffset, type Crater } from './craters'

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

const UNDER_DEPTH = 10
const UNDER_STEPS = 48
const UNDER_AROUND = 112

/** Strata from the topsoil down: [thickness in metres, colour]. The last repeats. */
const STRATA: readonly [number, THREE.Color][] = [
  [0.75, new THREE.Color(PALETTE.dirt)],
  [1.1, new THREE.Color(PALETTE.strataLight)],
  [0.6, new THREE.Color(PALETTE.rock)],
  [1.5, new THREE.Color(PALETTE.dirt)],
  [0.8, new THREE.Color(PALETTE.strataLight)],
  [1.3, new THREE.Color(PALETTE.rock)],
  [10, new THREE.Color(PALETTE.strataDeep)],
]

function strataColor(depthBelow: number, out: THREE.Color): THREE.Color {
  let top = 0
  for (let i = 0; i < STRATA.length; i++) {
    const [thickness, color] = STRATA[i]!
    const bottom = top + thickness
    if (depthBelow < bottom || i === STRATA.length - 1) {
      out.copy(color)
      // Soften each boundary over a few centimetres so bands don't alias.
      const next = STRATA[i + 1]?.[1]
      const blend = next ? THREE.MathUtils.smoothstep(depthBelow, bottom - 0.12, bottom + 0.12) : 0
      if (next) out.lerp(next, blend)
      return out
    }
    top = bottom
  }
  return out
}

/**
 * Lumps the lathe's smooth cone and paints it in wavy horizontal strata, so the
 * underside reads as a slab of layered clay pulled off a bigger block. The rim
 * ring is left exactly in place so it still meets the grass top.
 */
function sculptStrata(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)
  const color = new THREE.Color()
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    const below = -y
    // Two decorrelated samples, as in wobble(): continuous all the way round,
    // so the lathe seam does not show.
    const lump = (fbm2(x * 0.32 + 5, z * 0.32 - y * 0.25) + fbm2(y * 0.45 + 9, x * 0.21 - z * 0.27)) * 0.5
    // Lumps fade in over the first few metres: near the rim they would stand
    // proud of the grass disk and read as jagged ledges.
    const hold = THREE.MathUtils.smoothstep(below, 0.3, 3)
    const scale = 1 + lump * 0.09 * hold
    position.setXYZ(i, x * scale, y, z * scale)
    const wave = fbm2(x * 0.18 + 31, z * 0.18 + 17) * 0.55
    strataColor(Math.max(0, below + wave * hold), color)
    // A little darker toward the tip, which the sun never reaches.
    color.multiplyScalar(1 - 0.25 * (below / UNDER_DEPTH))
    colors.set([color.r, color.g, color.b], i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

const GRASS_A = new THREE.Color(PALETTE.grassDark)
const GRASS_B = new THREE.Color(PALETTE.grassLight)
const DIRT = new THREE.Color(PALETTE.dirt)
const SCORCH = new THREE.Color(PALETTE.scorch)

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
    const topMat = clayMaterial(PALETTE.unmodulated, { rim: 0 }); topMat.vertexColors = true
    this.topMesh = new THREE.Mesh(topGeo, topMat)
    this.topMesh.receiveShadow = true
    this.group.add(this.topMesh)

    this.baseColors = Float32Array.from(colors)
    this.scorchAmt = new Float32Array(positions.length / 3)

    // --- underside: lumpy lathe cone of stacked clay strata
    const profile: THREE.Vector2[] = []
    for (let i = 0; i <= UNDER_STEPS; i++) {
      const t = i / UNDER_STEPS
      const noise = fbm2(t * 5, 3.7) * 0.15 * Math.sin(t * Math.PI)
      const r = ISLAND_RADIUS * (1 - t * t) * (1 + noise)
      profile.push(new THREE.Vector2(Math.max(r, 0.01), -t * UNDER_DEPTH))
    }
    const underGeo = sculptStrata(new THREE.LatheGeometry(profile, UNDER_AROUND))
    const underMat = clayMaterial(PALETTE.unmodulated); underMat.vertexColors = true
    const under = new THREE.Mesh(underGeo, underMat)
    under.castShadow = false
    this.group.add(under)
  }

  /** The one true ground height. Everything that stands on the island calls this. */
  sampleHeight(x: number, z: number): number {
    return islandSurfaceY(x, z) - craterOffset(x, z, this.craters, islandSurfaceY)
  }

  addCrater(crater: Crater): void {
    this.craters.push(crater)
    const geometry = this.topMesh.geometry
    const positions = geometry.getAttribute('position')
    const colors = geometry.getAttribute('color')
    const ringStep = ISLAND_RADIUS / this.rings

    const influenceRadius = craterInfluenceRadius(crater)
    this.forEachVertexNear(crater.x, crater.z, influenceRadius + ringStep, (index, x, z, distance) => {
      positions.setY(index, this.sampleHeight(x, z))
      if (distance >= crater.radius || crater.radius <= 0) return

      const exposed = 1 - distance / crater.radius
      const colorIndex = index * 3
      this.baseColors[colorIndex] = blendChannel(this.baseColors[colorIndex]!, DIRT.r, exposed)
      this.baseColors[colorIndex + 1] = blendChannel(this.baseColors[colorIndex + 1]!, DIRT.g, exposed)
      this.baseColors[colorIndex + 2] = blendChannel(this.baseColors[colorIndex + 2]!, DIRT.b, exposed)
      this.writeVisibleColor(colors, index)
    })

    positions.needsUpdate = true
    colors.needsUpdate = true
    geometry.computeVertexNormals()
  }

  scorch(x: number, z: number, radius: number): void {
    if (radius <= 0) return
    const colors = this.topMesh.geometry.getAttribute('color')
    let painted = false

    this.forEachVertexNear(x, z, radius, (index, _vx, _vz, distance) => {
      const current = this.scorchAmt[index]!
      const next = accumulateScorch(current, distance, radius)
      if (next === current) return
      this.scorchAmt[index] = next
      this.writeVisibleColor(colors, index)
      painted = true
    })

    if (painted) colors.needsUpdate = true
  }

  private forEachVertexNear(
    x: number,
    z: number,
    radius: number,
    visit: (index: number, x: number, z: number, distance: number) => void,
  ): void {
    if (radius <= 0) return
    const positions = this.topMesh.geometry.getAttribute('position')
    const ringStep = ISLAND_RADIUS / this.rings
    const centreRadius = Math.hypot(x, z)
    const firstRing = Math.max(0, Math.floor((centreRadius - radius) / ringStep))
    const lastRing = Math.min(this.rings, Math.ceil((centreRadius + radius) / ringStep))

    for (let ring = firstRing; ring <= lastRing; ring++) {
      const ringStart = ring * (this.segs + 1)
      for (let segment = 0; segment <= this.segs; segment++) {
        const index = ringStart + segment
        const vx = positions.getX(index)
        const vz = positions.getZ(index)
        const distance = Math.hypot(vx - x, vz - z)
        if (distance <= radius) visit(index, vx, vz, distance)
      }
    }
  }

  private writeVisibleColor(colors: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number): void {
    const colorIndex = index * 3
    const amount = this.scorchAmt[index]!
    colors.setXYZ(
      index,
      blendChannel(this.baseColors[colorIndex]!, SCORCH.r, amount),
      blendChannel(this.baseColors[colorIndex + 1]!, SCORCH.g, amount),
      blendChannel(this.baseColors[colorIndex + 2]!, SCORCH.b, amount),
    )
  }
}

import * as THREE from 'three'
import { fbm2 } from '../core/noise'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'

/**
 * The parts of the island nobody stands on: the stratified underside, the
 * rolled grass lip that hides the seam between top and cliff, dangling roots,
 * and a few satellite islets. Purely decorative — gameplay only ever touches
 * the top surface, so none of this needs to track craters or scorch.
 */
export type IslandShellOptions = {
  radius: number
  /** Height of the grass surface at a ground point (zero outside the island). */
  surfaceY(x: number, z: number): number
  /** Meadow colour at a ground point, so the lip continues the grass seamlessly. */
  grassColor(x: number, z: number): THREE.Color
  rng: RNG
  lowFx: boolean
  reducedMotion: () => boolean
}

const UNDER_SEGMENTS = 96
const UNDER_RINGS = 30
const UNDER_DEPTH = 10.5
const LIP_SEGMENTS = 180

const STRATA = [
  new THREE.Color(PALETTE.soil),
  new THREE.Color(PALETTE.dirt),
  new THREE.Color(PALETTE.strataLight),
  new THREE.Color(PALETTE.rock),
  new THREE.Color(PALETTE.dirt),
  new THREE.Color(PALETTE.strataDark),
]

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Island-relative grass height at the rim, sampled just inside the edge. */
function rimHeight(options: IslandShellOptions, angle: number): number {
  const r = options.radius - 0.001
  return options.surfaceY(Math.cos(angle) * r, Math.sin(angle) * r)
}

/** Inverted-mountain silhouette: steep cliff band under the lip, then a lumpy taper. */
function undersideProfile(v: number): number {
  return Math.pow(Math.max(0, 1 - Math.pow(v, 1.8)), 0.7)
}

function buildUnderside(options: IslandShellOptions): THREE.Mesh {
  const { radius } = options
  const positions: number[] = []
  const colors: number[] = []
  const index: number[] = []
  const color = new THREE.Color()

  for (let ring = 0; ring <= UNDER_RINGS; ring++) {
    const v = ring / UNDER_RINGS
    for (let segment = 0; segment <= UNDER_SEGMENTS; segment++) {
      const angle = (segment / UNDER_SEGMENTS) * Math.PI * 2
      const ca = Math.cos(angle)
      const sa = Math.sin(angle)
      // Lobes grow with depth so the rim stays locked under the grass lip.
      const lobe = fbm2(ca * 1.6 + 11, sa * 1.6 + v * 2.2, 3) * 0.32 * smoothstep(0.02, 0.5, v)
      const grain = fbm2(ca * 6 + v * 9, sa * 6 + 3, 2) * 0.05 * smoothstep(0, 0.2, v)
      // Terraced ledges read as pressed layers under toon shading.
      const band = v * 6.5 + fbm2(ca * 2.1 + 5, sa * 2.1, 2) * 0.7
      const ledge = smoothstep(0.78, 1, band - Math.floor(band)) * 0.035 * smoothstep(0.04, 0.12, v)
      const r = ring === UNDER_RINGS
        ? 0
        : radius * (undersideProfile(v) * (1 + lobe + grain) - ledge) * (ring === 0 ? 0.985 : 1)
      const top = rimHeight(options, angle) - 0.18
      // Drips: the lower third sags into a few hanging points instead of one tip.
      const sag = Math.max(0, fbm2(ca * 2.4 + 2, sa * 2.4 + 8, 2)) * 2.6 * smoothstep(0.55, 1, v)
      const y = top - v * UNDER_DEPTH - sag
      positions.push(ca * r, y, sa * r)

      const strataIndex = Math.min(STRATA.length - 1, Math.max(0, Math.floor(band)))
      color.copy(STRATA[strataIndex]!)
      if (v < 0.06) color.copy(STRATA[0]!)
      // Darken toward the tip so the island reads heavy at the bottom.
      color.multiplyScalar(1 - smoothstep(0.35, 1, v) * 0.32)
      colors.push(color.r, color.g, color.b)
    }
  }

  for (let ring = 0; ring < UNDER_RINGS; ring++) {
    for (let segment = 0; segment < UNDER_SEGMENTS; segment++) {
      const a = ring * (UNDER_SEGMENTS + 1) + segment
      const b = a + UNDER_SEGMENTS + 1
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  const material = clayMaterial(PALETTE.unmodulated)
  material.vertexColors = true
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'island-underside'
  return mesh
}

/**
 * A rolled lip of grass around the rim. Each slice is the same rounded cross
 * section, with a noise-driven drip that occasionally hangs lower — the way
 * soft clay sags when pressed over an edge.
 */
function buildLip(options: IslandShellOptions): THREE.Mesh {
  const { radius } = options
  // Starts buried just under the meadow so only the rolled edge shows.
  const section: Array<{ dr: number; dy: number; drip: number; shade: number; surface: boolean }> = [
    { dr: -0.7, dy: -0.05, drip: 0, shade: 1, surface: true },
    { dr: -0.28, dy: 0.0, drip: 0, shade: 1, surface: true },
    { dr: 0.02, dy: 0.06, drip: 0, shade: 1, surface: false },
    { dr: 0.24, dy: 0.0, drip: 0, shade: 0.94, surface: false },
    { dr: 0.34, dy: -0.18, drip: 0.35, shade: 0.84, surface: false },
    { dr: 0.28, dy: -0.4, drip: 0.8, shade: 0.72, surface: false },
    { dr: 0.1, dy: -0.52, drip: 1, shade: 0.62, surface: false },
    { dr: -0.12, dy: -0.46, drip: 0.85, shade: 0.55, surface: false },
    { dr: -0.3, dy: -0.3, drip: 0.4, shade: 0.55, surface: false },
  ]
  const positions: number[] = []
  const colors: number[] = []
  const index: number[] = []
  const dark = new THREE.Color(PALETTE.lipShadow)
  const color = new THREE.Color()
  const columns = section.length

  for (let segment = 0; segment <= LIP_SEGMENTS; segment++) {
    const angle = (segment / LIP_SEGMENTS) * Math.PI * 2
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    const edge = rimHeight(options, angle)
    const dripNoise = Math.max(0, fbm2(ca * 4.5 + 31, sa * 4.5 + 17, 3) + 0.08)
    const drip = Math.pow(dripNoise, 1.6) * 2.1
    const swell = fbm2(ca * 9 + 3, sa * 9 + 41, 2) * 0.06
    const rimR = radius - 0.3
    const grass = options.grassColor(ca * rimR, sa * rimR)

    for (const point of section) {
      const r = radius + point.dr + swell * (point.surface ? 0 : 1)
      const base = point.surface
        ? options.surfaceY(ca * r, sa * r)
        : edge
      const y = base + point.dy - point.drip * drip
      positions.push(ca * r, y, sa * r)
      color.copy(grass).lerp(dark, 1 - point.shade)
      colors.push(color.r, color.g, color.b)
    }
  }

  for (let segment = 0; segment < LIP_SEGMENTS; segment++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = segment * columns + column
      const b = a + columns
      index.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  const material = clayMaterial(PALETTE.unmodulated)
  material.vertexColors = true
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'island-grass-lip'
  mesh.receiveShadow = !options.lowFx
  return mesh
}

/** Stubby bark-coloured roots poking out under the lip. */
function buildRoots(options: IslandShellOptions, rng: RNG): THREE.Group {
  const group = new THREE.Group()
  group.name = 'island-roots'
  const material = clayMaterial(PALETTE.bark)
  const count = 11
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.18, 0.18)
    const length = rng.range(0.45, 1.05)
    const geometry = new THREE.CylinderGeometry(0.11, 0.035, length, 7, 3)
    geometry.translate(0, -length / 2, 0)
    const root = new THREE.Mesh(wobble(geometry, rng, 0.02), material)
    const r = options.radius - 0.05
    root.position.set(Math.cos(angle) * r, rimHeight(options, angle) - 0.5, Math.sin(angle) * r)
    // Tip outward about the rim tangent, as if the roots slid over the edge.
    const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle))
    root.quaternion.setFromAxisAngle(tangent, rng.range(0.15, 0.5))
    group.add(root)
  }
  return group
}

/** A pebble-sized floating island: lumpy rock body, grass cap, sometimes a shrub. */
function buildIslet(rng: RNG, size: number, withShrub: boolean, lowFx: boolean): THREE.Group {
  const group = new THREE.Group()
  group.name = 'floating-islet'
  // Same inverted-mountain silhouette as the main island, just pocket-sized.
  const profile: THREE.Vector2[] = []
  for (let i = 0; i <= 8; i++) {
    const v = i / 8
    profile.push(new THREE.Vector2(Math.max(0.01, size * undersideProfile(v)), -v * size * 1.7))
  }
  const rock = wobble(new THREE.LatheGeometry(profile, 12), rng, size * 0.22)
  const under = new THREE.Mesh(rock, clayMaterial(rng.chance(0.5) ? PALETTE.dirt : PALETTE.rock))
  group.add(under)

  const capGeometry = wobble(new THREE.SphereGeometry(size * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), rng, size * 0.06)
  capGeometry.scale(1, 0.32, 1)
  const cap = new THREE.Mesh(capGeometry, clayMaterial(PALETTE.grassDark))
  cap.position.y = -0.02
  group.add(cap)

  if (withShrub) {
    const shrub = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(size * 0.42, 10, 8), rng, size * 0.05),
      clayMaterial(PALETTE.leafA),
    )
    shrub.position.set(size * 0.2, size * 0.36, -size * 0.1)
    shrub.castShadow = !lowFx
    group.add(shrub)
  }
  return group
}

export function floatingIsletY(
  baseY: number,
  phase: number,
  timeMs: number,
  reducedMotion: boolean,
): number {
  return reducedMotion ? baseY : baseY + Math.sin(timeMs * 0.00055 + phase) * 0.28
}

function buildIslets(options: IslandShellOptions, rng: RNG): THREE.Group {
  const group = new THREE.Group()
  group.name = 'floating-islets'
  const specs = [
    { angle: 0.6, distance: 20.5, y: -2.4, size: 1.5, shrub: true },
    { angle: 2.3, distance: 23, y: -5.2, size: 1.0, shrub: false },
    { angle: 3.4, distance: 19.5, y: -1.2, size: 0.75, shrub: false },
    { angle: 4.5, distance: 22, y: -3.6, size: 1.8, shrub: true },
    { angle: 5.6, distance: 25, y: -6.5, size: 0.9, shrub: false },
  ]
  for (const [i, spec] of specs.entries()) {
    const islet = buildIslet(rng, spec.size, spec.shrub, options.lowFx)
    islet.position.set(Math.cos(spec.angle) * spec.distance, spec.y, Math.sin(spec.angle) * spec.distance)
    islet.rotation.y = rng.range(0, Math.PI * 2)
    const baseY = spec.y
    const phase = i * 1.7
    // Bob from the render clock, like the other ambient props; slow enough that
    // a still photo never catches it mid-lurch.
    const driver = islet.children[0]!
    driver.onBeforeRender = () => {
      islet.position.y = floatingIsletY(baseY, phase, performance.now(), options.reducedMotion())
    }
    group.add(islet)
  }
  return group
}

export function buildIslandShell(options: IslandShellOptions): THREE.Group {
  const shell = new THREE.Group()
  shell.name = 'island-shell'
  const rng = new RNG(options.rng.int(1, 1_000_000))
  shell.add(buildUnderside(options), buildLip(options), buildRoots(options, rng), buildIslets(options, rng))
  return shell
}

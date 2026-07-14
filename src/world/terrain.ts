import { craterAt, type Crater } from './craters'
import { WALK_RADIUS } from './island'

/** A connected group of crater bowls sharing one water surface. */
export type Basin = {
  craters: Crater[]
  /** World-space height of the basin's water surface. */
  waterLevel: number
  x: number
  z: number
  /** Distance from the centroid to the furthest crater rim. */
  radius: number
}

/** A new building needs this much room clear of other props. */
export const BUILD_CLEARANCE = 2

/**
 * How far the water sits below the rim it would pour over.
 *
 * This is what keeps a visible bank of earth standing above the waterline. Filled
 * flush to the lip, a pond has no bank at all, and seen edge-on it reads as a flat
 * lid laid over the ground rather than water held in a hollow.
 *
 * Craters now bank a levelled ejecta lip (see `craterOffset`), which is what buys
 * the room for this: on the old un-levelled bowl, freeboard came straight out of
 * the pond's width and stranded it in a dry hole. With a level rim, 0.50 leaves
 * roughly three-fifths of the surface radius and about 1m of water in a standard
 * 1.5m bowl.
 */
const FREEBOARD = 0.5
const MAX_SLOPE = 0.55

export type GroundQuery = {
  basins: readonly Basin[]
  craters: readonly Crater[]
  occupied: readonly { x: number; z: number }[]
}

/** Bowls must overlap with non-zero area to exchange water below their rims. */
function overlaps(a: Crater, b: Crater): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < a.radius + b.radius
}

/** How many points around a crater's lip we test to find its lowest point. */
const RIM_SAMPLES = 48

/**
 * The height of the lowest lip the basin would pour over.
 *
 * The rim must be sampled around each crater's circumference, not at its centre.
 * The island is a dome, so a crater's rim is a tilted ring, and its downhill lip
 * sits well below the ground at the centre — by 7cm at the summit and over half a
 * metre out near the shore. Taking the centre height let the water stand proud of
 * the land on the downhill side and spill out of the bowl.
 *
 * Where a basin's craters overlap, the lip of one lies inside another: that point
 * is a submerged saddle between two bowls, not a shore the lake can drain over, so
 * it is skipped. Otherwise a merged lake would settle at the level of its own
 * interior and never fill.
 */
function waterLevelOf(
  craters: readonly Crater[],
  surfaceY: (x: number, z: number) => number,
): number {
  let lowestRim = Number.POSITIVE_INFINITY

  for (const crater of craters) {
    for (let sample = 0; sample < RIM_SAMPLES; sample++) {
      const angle = (sample / RIM_SAMPLES) * Math.PI * 2
      const x = crater.x + Math.cos(angle) * crater.radius
      const z = crater.z + Math.sin(angle) * crater.radius
      const swallowed = craters.some(other => (
        other !== crater
        && Math.hypot(x - other.x, z - other.z) < other.radius
      ))
      if (swallowed) continue
      lowestRim = Math.min(lowestRim, surfaceY(x, z))
    }
  }

  // Every lip swallowed by a neighbour (a crater fully inside another): fall back
  // to the containing bowls' own rims, which the loop above has already measured.
  if (!Number.isFinite(lowestRim)) {
    for (const crater of craters) {
      lowestRim = Math.min(lowestRim, surfaceY(crater.x, crater.z))
    }
  }

  return lowestRim - FREEBOARD
}

function centroidOf(craters: readonly Crater[]): { x: number; z: number } {
  let x = 0
  let z = 0
  for (const crater of craters) {
    x += crater.x
    z += crater.z
  }
  return { x: x / craters.length, z: z / craters.length }
}

function spanOf(craters: readonly Crater[], x: number, z: number): number {
  let radius = 0
  for (const crater of craters) {
    radius = Math.max(radius, Math.hypot(crater.x - x, crater.z - z) + crater.radius)
  }
  return radius
}

/** Group craters by transitive overlap so each connected bowl has one level. */
export function groupBasins(
  craters: Crater[],
  surfaceY: (x: number, z: number) => number,
): Basin[] {
  const unassigned = [...craters]
  const basins: Basin[] = []

  while (unassigned.length > 0) {
    const first = unassigned.shift()
    if (!first) break
    const group = [first]

    for (let i = 0; i < group.length; i++) {
      for (let j = unassigned.length - 1; j >= 0; j--) {
        if (!overlaps(group[i], unassigned[j])) continue
        group.push(unassigned[j])
        unassigned.splice(j, 1)
      }
    }

    const { x, z } = centroidOf(group)
    basins.push({
      craters: group,
      waterLevel: waterLevelOf(group, surfaceY),
      x,
      z,
      radius: spanOf(group, x, z),
    })
  }

  return basins
}

/** Return the water surface at a point in a flooded basin. */
export function waterLevelAt(
  x: number,
  z: number,
  basins: readonly Basin[],
): number | null {
  for (const basin of basins) {
    if (craterAt(x, z, basin.craters)) return basin.waterLevel
  }
  return null
}

/** Whether terrain at this point lies below its basin's water surface. */
export function isSubmerged(
  x: number,
  z: number,
  basins: readonly Basin[],
  groundY: (x: number, z: number) => number,
): boolean {
  const water = waterLevelAt(x, z, basins)
  return water !== null && groundY(x, z) < water
}

/** Maximum sampled rise over one metre along either world axis. */
function slopeAt(
  x: number,
  z: number,
  groundY: (x: number, z: number) => number,
): number {
  const here = groundY(x, z)
  return Math.max(
    Math.abs(groundY(x + 1, z) - here),
    Math.abs(groundY(x, z + 1) - here),
  )
}

/** The shared gate for placing buildings on valid, clear ground. */
export function isBuildable(
  x: number,
  z: number,
  query: GroundQuery,
  groundY: (x: number, z: number) => number,
): boolean {
  if (Math.hypot(x, z) > WALK_RADIUS) return false
  if (isSubmerged(x, z, query.basins, groundY)) return false
  if (craterAt(x, z, query.craters)) return false
  if (slopeAt(x, z, groundY) > MAX_SLOPE) return false
  for (const prop of query.occupied) {
    if (Math.hypot(prop.x - x, prop.z - z) < BUILD_CLEARANCE) return false
  }
  return true
}

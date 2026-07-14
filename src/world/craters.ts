export type Crater = { x: number; z: number; radius: number; depth: number }

/**
 * How far the ejecta lip reaches past the rim, as a multiple of the crater radius.
 */
export const CRATER_LIP_REACH = 1.45

/** Furthest horizontal distance at which this crater can move the ground. */
export function craterInfluenceRadius(crater: Crater): number {
  return crater.radius * CRATER_LIP_REACH
}

/** The deepest bowl excavation contributed by any crater at this point. */
export function craterBowlDepthAt(
  x: number,
  z: number,
  craters: readonly Crater[],
): number {
  let depth = 0
  for (const crater of craters) {
    const t = Math.hypot(x - crater.x, z - crater.z) / crater.radius
    if (t >= 1) continue
    depth = Math.max(depth, crater.depth * Math.cos(t * Math.PI * 0.5) ** 2)
  }
  return depth
}

/** How far the levelled lip stands above the highest ground on the natural rim. */
const LIP_BOOST = 0.1

/**
 * The ejecta lip's strength at a given distance from the crater centre: nothing at
 * the centre, full at the rim, fading to nothing by `LIP_REACH`. Squaring both
 * ramps keeps the lip tangent to the ground at either end, so it blends into the
 * terrain instead of creasing it.
 */
function lipProfile(t: number): number {
  if (t >= CRATER_LIP_REACH) return 0
  if (t <= 1) return t * t
  const u = (t - 1) / (CRATER_LIP_REACH - 1)
  return (1 - u) ** 2
}

/**
 * The height an impact throws its rim up to. A crater dug into a hillside would
 * drain straight out of its downhill side and hold almost no water — so an impact
 * banks its ejecta into a LEVEL lip, as a real crater does, taking the highest
 * point of the natural rim as the target. That is what lets a crater on a slope
 * hold a pond at all.
 */
function lipTargetY(
  crater: Crater,
  surfaceY: (x: number, z: number) => number,
): number {
  let highest = Number.NEGATIVE_INFINITY
  for (let sample = 0; sample < 24; sample++) {
    const angle = (sample / 24) * Math.PI * 2
    highest = Math.max(highest, surfaceY(
      crater.x + Math.cos(angle) * crater.radius,
      crater.z + Math.sin(angle) * crater.radius,
    ))
  }
  return highest + LIP_BOOST
}

/**
 * Signed vertical displacement at (x,z) from all craters: positive digs the bowl
 * down, negative banks the ejecta lip up.
 *
 * Overlapping craters do NOT add. Excavation and ejecta both take the extreme, not
 * the sum: the deepest bowl wins, and the highest lip wins. Summing them gouged the
 * saddle between two craters into a pit and stacked their lips into a ridge that
 * stood above either lip alone.
 *
 * `surfaceY` is the undeformed ground, needed to work out how high to bank the lip
 * on a slope. It is optional so that callers which only want the bowl — and the
 * tests that predate the lip — keep working.
 */
export function craterOffset(
  x: number,
  z: number,
  craters: Crater[],
  surfaceY?: (x: number, z: number) => number,
): number {
  const dig = craterBowlDepthAt(x, z, craters)
  let raise = 0

  for (const c of craters) {
    const t = Math.hypot(x - c.x, z - c.z) / c.radius

    if (surfaceY) {
      const lip = lipProfile(t)
      if (lip > 0) {
        const wanted = Math.max(0, lipTargetY(c, surfaceY) - surfaceY(x, z)) * lip
        raise = Math.max(raise, wanted)
      }
    }
  }

  // Each term is already the max across craters, so neither stacks; the bowl then
  // simply cuts down through whatever the lip banked up.
  return dig - raise
}

/**
 * The ground as it would be if every bowl were filled back in, but the ejecta lips
 * left standing: the shape of the land the water has to stay inside.
 *
 * This is what a basin's water level is measured against. Using the plain dome
 * would ignore the lip and pin the water to the bottom of the pit; using the dug
 * ground would measure the hole itself rather than the brink it pours over.
 */
export function craterRimY(
  x: number,
  z: number,
  craters: Crater[],
  surfaceY: (x: number, z: number) => number,
): number {
  let raise = 0
  for (const c of craters) {
    const lip = lipProfile(Math.hypot(x - c.x, z - c.z) / c.radius)
    if (lip <= 0) continue
    raise = Math.max(raise, Math.max(0, lipTargetY(c, surfaceY) - surfaceY(x, z)) * lip)
  }
  return surfaceY(x, z) + raise
}

/** True if the point is inside any crater's rim — used by resolveTarget + pond fill. */
export function craterAt(x: number, z: number, craters: readonly Crater[]): Crater | null {
  for (const c of craters) if (Math.hypot(x - c.x, z - c.z) < c.radius) return c
  return null
}

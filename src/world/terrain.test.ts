import { describe, expect, it } from 'vitest'
import { craterRimY, type Crater } from './craters'
import {
  BUILD_CLEARANCE,
  groupBasins,
  isBuildable,
  isSubmerged,
  waterLevelAt,
  type GroundQuery,
} from './terrain'

const flat = (): number => 0

/** The cratered ground under a flat rim surface. */
function dish(craters: Crater[]) {
  return (x: number, z: number): number => {
    let depth = 0
    for (const crater of craters) {
      const t = Math.hypot(x - crater.x, z - crater.z) / crater.radius
      if (t < 1) {
        depth = Math.max(depth, crater.depth * Math.cos(t * Math.PI * 0.5) ** 2)
      }
    }
    return -depth
  }
}

describe('groupBasins', () => {
  it('returns nothing for no craters', () => {
    expect(groupBasins([], flat)).toEqual([])
  })

  it('makes one basin from one crater', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const basins = groupBasins(craters, flat)

    expect(basins).toHaveLength(1)
    expect(basins[0].craters).toEqual(craters)
  })

  it('keeps overlapping crater rims separate when their water has a dry saddle', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ]

    expect(dish(craters)(2, 0)).toBeGreaterThan(-0.5)
    expect(groupBasins(craters, flat)).toHaveLength(2)
  })

  it('merges overlapping craters when water covers the saddle between them', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 3, z: 0, radius: 3, depth: 1.5 },
    ]
    const basins = groupBasins(craters, flat)

    expect(dish(craters)(1.5, 0)).toBeLessThan(-0.5)
    expect(basins).toHaveLength(1)
    expect(basins[0].craters).toHaveLength(2)
  })

  it('keeps two separate craters as two basins', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 2, depth: 1 },
      { x: 10, z: 0, radius: 2, depth: 1 },
    ]

    expect(groupBasins(craters, flat)).toHaveLength(2)
  })

  it('keeps craters separate when their rims only touch', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 2.5, depth: 1 },
      { x: 0, z: 5, radius: 2.5, depth: 1 },
    ]

    // Water below the rims cannot cross a zero-area tangent point.
    expect(groupBasins(craters, flat)).toHaveLength(2)
  })

  it('merges transitively', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 2, depth: 1 },
      { x: 1.5, z: 0, radius: 2, depth: 1 },
      { x: 3, z: 0, radius: 2, depth: 1 },
    ]
    const basins = groupBasins(craters, flat)

    expect(basins).toHaveLength(1)
    expect(basins[0].craters).toHaveLength(3)
  })

  it('uses one water level at the lowest lip of the merged bowl', () => {
    const sloped = (x: number): number => -x * 0.1
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 2, z: 0, radius: 3, depth: 1.5 },
    ]
    const basins = groupBasins(craters, sloped)

    expect(basins).toHaveLength(1)
    // The lowest lip of the merged bowl is the far shore at x = 5, not either
    // crater's centre. Sampling centres put the level near -0.4 and stood the
    // water above the downhill bank.
    expect(basins[0].waterLevel).toBeLessThanOrEqual(-1)
  })

  it('leaves a bank of earth standing above the waterline', () => {
    // A pond filled flush to its lip has no bank, and seen edge-on it reads as a
    // flat lid laid over the ground rather than water held in a hollow. The level
    // must sit clearly below the rim the whole way round — but not so far that the
    // water strands itself in the bottom of the bowl.
    const dome = (x: number, z: number): number => {
      const t = Math.hypot(x, z) / 15
      return t >= 1 ? 0 : (1 - t * t) * 2
    }
    const crater: Crater = { x: 9, z: 0, radius: 2.8, depth: 1.3 }
    const craters = [crater]
    const rim = (x: number, z: number): number => craterRimY(x, z, craters, dome)
    const [basin] = groupBasins(craters, rim)

    let lowestRim = Number.POSITIVE_INFINITY
    for (let sample = 0; sample < 48; sample++) {
      const angle = (sample / 48) * Math.PI * 2
      lowestRim = Math.min(lowestRim, rim(
        crater.x + Math.cos(angle) * crater.radius,
        crater.z + Math.sin(angle) * crater.radius,
      ))
    }

    const bank = lowestRim - basin.waterLevel
    expect(bank).toBeCloseTo(0.5)
  })

  it('never stands the water above the land at the shoreline', () => {
    // The island is a dome, so a crater's rim is a tilted ring. Sampling the rim
    // at the crater's CENTRE height let the water stand up to half a metre proud
    // of the downhill bank and spill out of the bowl. Measured against the real
    // rim — the ejecta lip included, since that is what holds the water in — the
    // level must sit at or below the land the whole way round.
    const dome = (x: number, z: number): number => {
      const t = Math.hypot(x, z) / 15
      return t >= 1 ? 0 : (1 - t * t) * 2
    }
    const craters: Crater[] = [{ x: 8, z: 0, radius: 2.8, depth: 1.3 }]
    const rim = (x: number, z: number): number => craterRimY(x, z, craters, dome)
    const [basin] = groupBasins(craters, rim)

    for (let sample = 0; sample < 64; sample++) {
      const angle = (sample / 64) * Math.PI * 2
      const x = 8 + Math.cos(angle) * 2.8
      const z = Math.sin(angle) * 2.8
      expect(basin.waterLevel).toBeLessThanOrEqual(rim(x, z))
    }
  })

  it('keeps water between the crater floor and rim', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, flat)

    expect(basin.waterLevel).toBeLessThanOrEqual(0)
    expect(basin.waterLevel).toBeGreaterThan(-1.5)
  })

  it('sits close enough under the rim to still fill the bowl', () => {
    // The bowl floor is a cosine, so it climbs steeply near the rim: every extra
    // centimetre of freeboard costs a disproportionate slice of water surface.
    // The bank has to be paid for out of the pond's width, so this is the other
    // half of the trade — deepen the freeboard too far and the water strands
    // itself in a dry hole, which is the bug that started all this.
    const depth = 1.5
    const [basin] = groupBasins([{ x: 0, z: 0, radius: 3, depth }], flat)
    const freeboard = 0 - basin.waterLevel

    // Solve -depth * cos(t * PI/2)^2 = waterLevel for t, the fraction of the
    // crater radius the water reaches.
    const reach = Math.acos(Math.sqrt(freeboard / depth)) / (Math.PI / 2)

    expect(reach).toBeGreaterThan(0.58)
    expect(reach).toBeLessThan(0.63)
  })

  it('spans the merged bowl from its centroid to the far rim', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 3, z: 0, radius: 3, depth: 1.5 },
    ]
    const [basin] = groupBasins(craters, flat)

    expect(basin.x).toBeCloseTo(1.5)
    expect(basin.z).toBeCloseTo(0)
    expect(basin.radius).toBeCloseTo(4.5)
  })

  it('is deterministic', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ]

    expect(groupBasins(craters, flat)).toEqual(groupBasins(craters, flat))
  })
})

const oneCrater: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
const dished = (x: number, z: number): number => {
  const distance = Math.hypot(x, z)
  return distance < 3
    ? -1.5 * Math.cos((distance / 3) * Math.PI * 0.5) ** 2
    : 0
}

describe('waterLevelAt', () => {
  it('is null on dry ground', () => {
    const basins = groupBasins(oneCrater, flat)
    expect(waterLevelAt(10, 10, basins)).toBeNull()
  })

  it('returns the basin water level inside a basin', () => {
    const basins = groupBasins(oneCrater, flat)
    expect(waterLevelAt(0, 0, basins)).toBeCloseTo(basins[0].waterLevel)
  })

  it('is null when there are no basins', () => {
    expect(waterLevelAt(0, 0, [])).toBeNull()
  })
})

describe('isSubmerged', () => {
  const basins = groupBasins(oneCrater, flat)

  it('is true at the bottom of a flooded crater', () => {
    expect(isSubmerged(0, 0, basins, dished)).toBe(true)
  })

  it('is false on dry ground outside it', () => {
    expect(isSubmerged(10, 0, basins, dished)).toBe(false)
  })

  it('is false everywhere when nothing is flooded', () => {
    expect(isSubmerged(0, 0, [], dished)).toBe(false)
  })
})

describe('isBuildable', () => {
  const dry: GroundQuery = { basins: [], craters: [], occupied: [] }

  it('accepts open, dry, flat ground', () => {
    expect(isBuildable(5, 5, dry, flat)).toBe(true)
  })

  it('rejects submerged ground', () => {
    const query: GroundQuery = {
      basins: groupBasins(oneCrater, flat),
      craters: oneCrater,
      occupied: [],
    }
    expect(isBuildable(0, 0, query, dished)).toBe(false)
  })

  it('rejects a dry crater', () => {
    const query: GroundQuery = { basins: [], craters: oneCrater, occupied: [] }
    expect(isBuildable(0, 0, query, dished)).toBe(false)
  })

  it('rejects ground occupied by something else', () => {
    const query: GroundQuery = { basins: [], craters: [], occupied: [{ x: 5, z: 5 }] }
    expect(isBuildable(5, 5, query, flat)).toBe(false)
    expect(isBuildable(5 + BUILD_CLEARANCE + 0.1, 5, query, flat)).toBe(true)
  })

  it('rejects ground off the walkable island', () => {
    expect(isBuildable(50, 0, dry, flat)).toBe(false)
  })

  it('rejects ground too steep to build on', () => {
    const cliff = (x: number): number => x * 5
    expect(isBuildable(5, 5, dry, cliff)).toBe(false)
  })
})

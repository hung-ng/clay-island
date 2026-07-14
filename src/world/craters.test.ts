import { describe, it, expect } from 'vitest'
import { craterAt, craterInfluenceRadius, craterOffset, type Crater } from './craters'

const c: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]

describe('craterOffset', () => {
  it('is deepest at the centre', () => expect(craterOffset(0, 0, c)).toBeCloseTo(1.5))
  it('is zero at and beyond the rim', () => {
    expect(craterOffset(3, 0, c)).toBeCloseTo(0)
    expect(craterOffset(9, 0, c)).toBe(0)
  })
  it('only digs down when no ejecta lip is asked for', () => {
    for (let i = 0; i < 50; i++) expect(craterOffset(i * 0.2 - 5, 0, c)).toBeGreaterThanOrEqual(0)
  })
  it('does NOT stack: overlapping bowls take the deepest, not the sum', () => {
    // Summing gouged the saddle between two craters into a pit deeper than either
    // crater dug on its own, and stacked their ejecta into a ridge.
    const other: Crater = { x: 1, z: 0, radius: 3, depth: 1.5 }
    const two: Crater[] = [...c, other]
    for (let x = -4; x <= 5; x += 0.25) {
      const both = craterOffset(x, 0, two)
      const deepest = Math.max(craterOffset(x, 0, c), craterOffset(x, 0, [other]))
      expect(both).toBeCloseTo(deepest)
    }
  })
  it('is zero with no craters', () => expect(craterOffset(0, 0, [])).toBe(0))
})

describe('craterInfluenceRadius', () => {
  it('includes the complete ejecta lip beyond the excavated bowl', () => {
    expect(craterInfluenceRadius({ x: 0, z: 0, radius: 2.8, depth: 1.3 })).toBeCloseTo(4.06)
  })
})

describe('ejecta lip', () => {
  // A dome: the ground slopes away from the origin, so a crater's rim is tilted.
  const dome = (x: number, z: number): number => {
    const t = Math.hypot(x, z) / 15
    return t >= 1 ? 0 : (1 - t * t) * 2
  }
  const ground = (x: number, z: number, craters: Crater[]): number =>
    dome(x, z) - craterOffset(x, z, craters, dome)

  it('banks a rim that stands above the surrounding ground', () => {
    const crater: Crater[] = [{ x: 9, z: 0, radius: 2.8, depth: 1.3 }]
    // Just outside the bowl, on the downhill side, the lip must rise above the
    // bare dome — that bank is the only thing holding water in on a slope.
    expect(ground(11.8, 0, crater)).toBeGreaterThan(dome(11.8, 0))
  })

  it('levels the rim so a crater on a slope can hold water', () => {
    const crater: Crater[] = [{ x: 9, z: 0, radius: 2.8, depth: 1.3 }]
    let lowest = Number.POSITIVE_INFINITY
    let highest = Number.NEGATIVE_INFINITY
    for (let sample = 0; sample < 48; sample++) {
      const angle = (sample / 48) * Math.PI * 2
      const y = ground(9 + Math.cos(angle) * 2.8, Math.sin(angle) * 2.8, crater)
      lowest = Math.min(lowest, y)
      highest = Math.max(highest, y)
    }
    // Without the lip the uphill rim stood 0.9m above the downhill one, so the
    // water pinned to the low side and hid at the bottom of the pit.
    expect(highest - lowest).toBeLessThan(0.05)
  })

  it('does NOT stack where two lips overlap', () => {
    // Bowls 6.5 apart do not touch (radii sum to 5.6) but their lips do, so any
    // rise here is pure lip-on-lip stacking: a ridge between the craters.
    const a: Crater = { x: 0, z: 0, radius: 2.8, depth: 1.3 }
    const b: Crater = { x: 6.5, z: 0, radius: 2.8, depth: 1.3 }
    for (let x = 2.5; x <= 4; x += 0.1) {
      const both = ground(x, 0, [a, b])
      const tallest = Math.max(ground(x, 0, [a]), ground(x, 0, [b]))
      expect(both).toBeLessThanOrEqual(tallest + 0.001)
    }
  })
})

describe('craterAt', () => {
  it('finds the crater containing a point', () => expect(craterAt(1, 1, c)).toBe(c[0]))
  it('returns null outside', () => expect(craterAt(5, 5, c)).toBeNull())
})

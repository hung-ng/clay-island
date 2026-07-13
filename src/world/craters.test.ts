import { describe, it, expect } from 'vitest'
import { craterOffset, craterAt, type Crater } from './craters'

const c: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]

describe('craterOffset', () => {
  it('is deepest at the centre', () => expect(craterOffset(0, 0, c)).toBeCloseTo(1.5))
  it('is zero at and beyond the rim', () => {
    expect(craterOffset(3, 0, c)).toBeCloseTo(0)
    expect(craterOffset(9, 0, c)).toBe(0)
  })
  it('is never negative and never lifts terrain', () => {
    for (let i = 0; i < 50; i++) expect(craterOffset(i * 0.2 - 5, 0, c)).toBeGreaterThanOrEqual(0)
  })
  it('accumulates across overlapping craters', () => {
    const two: Crater[] = [...c, { x: 1, z: 0, radius: 3, depth: 1.5 }]
    expect(craterOffset(0.5, 0, two)).toBeGreaterThan(craterOffset(0.5, 0, c))
  })
  it('is zero with no craters', () => expect(craterOffset(0, 0, [])).toBe(0))
})

describe('craterAt', () => {
  it('finds the crater containing a point', () => expect(craterAt(1, 1, c)).toBe(c[0]))
  it('returns null outside', () => expect(craterAt(5, 5, c)).toBeNull())
})

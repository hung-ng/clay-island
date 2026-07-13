import { describe, expect, it } from 'vitest'
import { accumulateScorch, blendChannel } from './decals'

describe('accumulateScorch', () => {
  it('adds a radial falloff inside the painted radius', () => {
    expect(accumulateScorch(0, 0, 4)).toBe(1)
    expect(accumulateScorch(0, 2, 4)).toBeCloseTo(0.5)
  })

  it('does not paint at or beyond the edge', () => {
    expect(accumulateScorch(0.25, 4, 4)).toBe(0.25)
    expect(accumulateScorch(0.25, 8, 4)).toBe(0.25)
    expect(accumulateScorch(0.25, 0, 0)).toBe(0.25)
  })

  it('accumulates repeated paint without exceeding one', () => {
    expect(accumulateScorch(0.7, 2, 4)).toBe(1)
    expect(accumulateScorch(1, 0, 4)).toBe(1)
  })
})

describe('blendChannel', () => {
  it('interpolates from the preserved base toward the decal color', () => {
    expect(blendChannel(0.8, 0.2, 0)).toBeCloseTo(0.8)
    expect(blendChannel(0.8, 0.2, 0.5)).toBeCloseTo(0.5)
    expect(blendChannel(0.8, 0.2, 1)).toBeCloseTo(0.2)
  })
})

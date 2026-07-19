import { describe, expect, it } from 'vitest'
import { fireflyBasePositions, starPositions } from './nightSky'

describe('starPositions', () => {
  it('is deterministic for a seed and sized three floats per star', () => {
    const a = starPositions(300, 90, 4242)
    const b = starPositions(300, 90, 4242)
    expect(a).toEqual(b)
    expect(a.length).toBe(900)
  })

  it('places every star on the upper hemisphere at the given radius', () => {
    const positions = starPositions(120, 90, 7)
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!]
      expect(y).toBeGreaterThan(4)
      expect(Math.hypot(x, y, z)).toBeCloseTo(90, 0)
    }
  })
})

describe('fireflyBasePositions', () => {
  it('keeps fireflies in a low ring around the village', () => {
    const positions = fireflyBasePositions(14, 11)
    expect(positions.length).toBe(42)
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!]
      const radius = Math.hypot(x, z)
      expect(radius).toBeGreaterThanOrEqual(3)
      expect(radius).toBeLessThanOrEqual(8)
      expect(y).toBeGreaterThanOrEqual(0.5)
      expect(y).toBeLessThanOrEqual(2.5)
    }
  })
})

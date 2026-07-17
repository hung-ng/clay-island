import { describe, expect, it } from 'vitest'
import { findCelebrationSite, findCelebrationSlots } from './slots'

describe('findCelebrationSlots', () => {
  it('assigns deterministic separated points around the centre', () => {
    const a = findCelebrationSlots({ x: 1, z: -2 }, 6, () => true)
    const b = findCelebrationSlots({ x: 1, z: -2 }, 6, () => true)
    expect(a).toEqual(b)
    expect(a).toHaveLength(6)
    expect(a.every(Boolean)).toBe(true)
    for (const point of a) {
      expect(Math.hypot(point!.x - 1, point!.z + 2)).toBeCloseTo(2.2)
    }
  })

  it('searches wider rings when the preferred ring is blocked', () => {
    const points = findCelebrationSlots(
      { x: 0, z: 0 },
      2,
      point => Math.hypot(point.x, point.z) >= 2.8,
    )
    expect(points.every(point => point && Math.hypot(point.x, point.z) >= 2.8)).toBe(true)
  })

  it('returns a nullable slot instead of blocking when no point is safe', () => {
    expect(findCelebrationSlots({ x: 0, z: 0 }, 1, () => false)).toEqual([null])
  })
})

describe('findCelebrationSite', () => {
  it('chooses the launchable candidate with the most safe viewing slots', () => {
    const anchors = [{ x: 0, z: 0 }, { x: 20, z: 0 }]
    const site = findCelebrationSite(
      anchors,
      3,
      point => anchors.some(anchor => Math.hypot(point.x - anchor.x, point.z - anchor.z) < 0.001),
      point => point.x > 10,
    )

    expect(site).toEqual({
      centre: { x: 20, z: 0 },
      slots: expect.arrayContaining([
        expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) }),
      ]),
    })
    expect(site?.slots.every(Boolean)).toBe(true)
  })

  it('is deterministic and returns null instead of choosing an unsafe launcher', () => {
    const anchors = [{ x: 1, z: -2 }]
    const canLaunch = (point: { x: number; z: number }): boolean => point.x > 0
    const a = findCelebrationSite(anchors, 4, canLaunch, () => true)
    const b = findCelebrationSite(anchors, 4, canLaunch, () => true)

    expect(a).toEqual(b)
    expect(findCelebrationSite(anchors, 4, () => false, () => true)).toBeNull()
  })
})

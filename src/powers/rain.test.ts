import { describe, expect, it } from 'vitest'
import { RNG } from '../core/rng'
import { ISLAND_RADIUS } from '../world/island'
import { rainOffset } from './rain'

describe('rain placement', () => {
  it('keeps every recycled droplet over the island at rim casts', () => {
    const rng = new RNG(17)

    for (let i = 0; i < 500; i++) {
      const offset = rainOffset(ISLAND_RADIUS, 0, rng)
      expect(Math.hypot(ISLAND_RADIUS + offset.x, offset.z)).toBeLessThanOrEqual(ISLAND_RADIUS)
    }
  })
})

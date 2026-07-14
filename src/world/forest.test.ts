import { describe, expect, it } from 'vitest'
import { RNG } from '../core/rng'
import { MAX_TREES, holdsPlace, isLiving, seedSite, type Seedling } from './forest'
import type { GroundQuery } from './terrain'

const flat = (): number => 0
const open: GroundQuery = { basins: [], craters: [], occupied: [] }

describe('isLiving', () => {
  it('counts a sapling and a grown tree as forest', () => {
    expect(isLiving('sapling')).toBe(true)
    expect(isLiving('normal')).toBe(true)
  })

  it('does NOT count falling trees, felled logs, or stumps as forest', () => {
    expect(isLiving('toppling')).toBe(false)
    expect(isLiving('stump')).toBe(false)
    expect(isLiving('felled')).toBe(false)
  })

  it('counts a BURNING tree as living — it is still standing, and still fuel', () => {
    expect(isLiving('burning')).toBe(true)
  })

})

describe('holdsPlace', () => {
  it('counts standing trees against the cap', () => {
    expect(holdsPlace('sapling')).toBe(true)
    expect(holdsPlace('normal')).toBe(true)
    expect(holdsPlace('burning')).toBe(true)
  })

  it('releases the spot as soon as a tree starts to go over', () => {
    expect(holdsPlace('toppling')).toBe(false)
  })

  it('never counts dead wood', () => {
    expect(holdsPlace('toppling')).toBe(false)
    expect(holdsPlace('felled')).toBe(false)
    expect(holdsPlace('stump')).toBe(false)
  })
})

describe('seedSite', () => {
  it('sprouts NEAR a surviving tree, so the forest creeps rather than respawns', () => {
    const parent: Seedling = { x: 4, z: 0, state: 'normal' }
    const site = seedSite([parent], open, flat, new RNG(1))

    expect(site).not.toBeNull()
    const distance = Math.hypot(site!.x - parent.x, site!.z - parent.z)
    expect(distance).toBeGreaterThanOrEqual(2.5)
    expect(distance).toBeLessThanOrEqual(5)
  })

  it('seeds from a LIVING parent, never from a stump', () => {
    const trees: Seedling[] = [
      { x: 0, z: 0, state: 'normal' },
      { x: -11, z: 0, state: 'stump' },
    ]
    for (let i = 0; i < 40; i++) {
      const site = seedSite(trees, open, flat, new RNG(i))
      expect(site).not.toBeNull()
      expect(Math.hypot(site!.x, site!.z)).toBeLessThanOrEqual(5)
    }
  })

  it('MERCY RULE: seeds anywhere buildable when every tree is gone', () => {
    const site = seedSite([], open, flat, new RNG(1))

    expect(site).not.toBeNull()
    expect(Math.hypot(site!.x, site!.z)).toBeLessThanOrEqual(12)
  })

  it('applies the mercy rule when only dead wood remains', () => {
    const site = seedSite([{ x: 0, z: 0, state: 'stump' }], open, flat, new RNG(1))
    expect(site).not.toBeNull()
  })

  it('never seeds on ground that is not buildable', () => {
    const parent: Seedling = { x: 0, z: 0, state: 'normal' }
    const crowded: GroundQuery = {
      basins: [],
      craters: [],
      occupied: Array.from({ length: 72 }, (_, i) => ({
        x: Math.cos((i / 36) * Math.PI) * (2.5 + (i % 2) * 2.5),
        z: Math.sin((i / 36) * Math.PI) * (2.5 + (i % 2) * 2.5),
      })),
    }
    expect(seedSite([parent], crowded, flat, new RNG(1))).toBeNull()
  })

  it('keeps saplings on the walkable island', () => {
    const parent: Seedling = { x: 11.5, z: 0, state: 'normal' }
    for (let i = 0; i < 60; i++) {
      const site = seedSite([parent], open, flat, new RNG(i))
      if (!site) continue
      expect(Math.hypot(site.x, site.z)).toBeLessThanOrEqual(12)
    }
  })

  it('is deterministic', () => {
    const trees: Seedling[] = [{ x: 3, z: 3, state: 'normal' }]
    expect(seedSite(trees, open, flat, new RNG(7)))
      .toEqual(seedSite(trees, open, flat, new RNG(7)))
  })

  it('caps the forest at 13', () => {
    expect(MAX_TREES).toBe(13)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { resolveInteraction } from './matrix'
import { groundNudge } from './nudge'
import { applyInteractions } from './outcomes'
import type { CastCtx } from './power'

const ctx = (
  overrides: Partial<Parameters<typeof groundNudge>[0]> = {},
): Parameters<typeof groundNudge>[0] => ({
  needsFire: false,
  living: 2,
  capacity: 6,
  huts: 3,
  buildable: true,
  ...overrides,
})

describe('ground nudge resolves from the village needs', () => {
  it('builds the campfire first when there is no fire', () => {
    expect(groundNudge(ctx({ needsFire: true, living: 6, capacity: 6 }))).toBe('makeFire')
  })

  it('founds a hut when housing is full and there is room to grow', () => {
    expect(groundNudge(ctx({ living: 6, capacity: 6, huts: 3 }))).toBe('build')
  })

  it('does not found a hut when the village is not full', () => {
    expect(groundNudge(ctx({ living: 2, capacity: 6 }))).toBe('gather')
  })

  it('does not found a hut beyond the six-hut cap', () => {
    expect(groundNudge(ctx({ living: 12, capacity: 12, huts: 6 }))).toBe('gather')
  })

  it('gathers on ground that cannot be built on', () => {
    expect(groundNudge(ctx({ needsFire: true, buildable: false }))).toBe('gather')
  })
})

describe('nudge outcomes', () => {
  it('founds a hut before suggesting build when full housing can grow', () => {
    const order: string[] = []
    const world = {
      huts: [{ state: 'built' }, { state: 'built' }, { state: 'built' }],
      groundQuery: () => ({ basins: [], craters: [], occupied: [] }),
      needsFire: () => false,
      living: () => 6,
      capacity: () => 6,
      foundHutAt: vi.fn(() => { order.push('found'); return {} }),
      suggest: vi.fn(() => { order.push('suggested'); return 1 }),
    }
    const ctx = {
      x: 4,
      z: 0,
      kind: 'ground',
      power: 'nudge',
      world,
      island: { sampleHeight: () => 0 },
      rng: {},
      lowFx: false,
    } as unknown as CastCtx

    applyInteractions(resolveInteraction('nudge', 'ground'), ctx, 0)

    expect(world.foundHutAt).toHaveBeenCalledWith(4, 0, ctx.rng, false)
    expect(world.suggest).toHaveBeenCalledWith(4, 0, 'build')
    expect(order).toEqual(['found', 'suggested'])
  })
})

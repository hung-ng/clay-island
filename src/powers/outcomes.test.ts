import { describe, expect, it, vi } from 'vitest'
import type { EventBus } from '../core/events'
import type { Pond } from '../world/objects'
import type { CastCtx } from './power'
import { OUTCOME_HANDLERS } from './outcomes'

describe('pond power outcomes', () => {
  it('stuns existing fish and emits the compatibility event without consuming them', () => {
    const pond = { stunFish: vi.fn(() => true) } as unknown as Pond
    const emit = vi.fn()
    const ctx = {
      x: 1,
      z: 2,
      world: { pondAt: () => pond },
      bus: { emit } as unknown as EventBus,
    } as unknown as CastCtx

    OUTCOME_HANDLERS.stunFish(ctx, 0)

    expect(pond.stunFish).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({ type: 'fish:floated' })
  })

  it('does not emit a fish event for an empty pond', () => {
    const pond = { stunFish: vi.fn(() => false) } as unknown as Pond
    const emit = vi.fn()
    const ctx = {
      x: 1,
      z: 2,
      world: { pondAt: () => pond },
      bus: { emit } as unknown as EventBus,
    } as unknown as CastCtx

    OUTCOME_HANDLERS.stunFish(ctx, 0)

    expect(emit).not.toHaveBeenCalled()
  })
})

describe('pond Nudge outcomes', () => {
  const cast = (hasFish: boolean): ReturnType<typeof vi.fn> => {
    const suggest = vi.fn()
    const ctx = {
      kind: 'pond',
      x: 4,
      z: -2,
      world: {
        pondAt: () => ({ hasFish }),
        suggest,
      },
    } as unknown as CastCtx

    OUTCOME_HANDLERS.suggest(ctx, 0)
    return suggest
  }

  it('suggests fishing at a stocked pond', () => {
    expect(cast(true)).toHaveBeenCalledWith(4, -2, 'fish')
  })

  it('suggests drinking at an empty pond', () => {
    expect(cast(false)).toHaveBeenCalledWith(4, -2, 'drink')
  })
})

describe('tree Nudge outcomes', () => {
  const cast = (hasFruit: boolean, actionable = true): ReturnType<typeof vi.fn> => {
    const suggest = vi.fn()
    const tree = { id: 'tree-selected', hasFruit }
    const ctx = {
      kind: 'tree',
      x: 3,
      z: -1,
      world: {
        treeAt: () => tree,
        actionableTreeAt: () => actionable ? tree : null,
        suggest,
      },
    } as unknown as CastCtx

    OUTCOME_HANDLERS.suggest(ctx, 0)
    return suggest
  }

  it('suggests harvesting from a fruiting tree', () => {
    expect(cast(true)).toHaveBeenCalledWith(3, -1, 'harvest', 'tree-selected')
  })

  it('suggests chopping a bare tree', () => {
    expect(cast(false)).toHaveBeenCalledWith(3, -1, 'chop', 'tree-selected')
  })

  it('does not redirect a Nudge from an invalid tree to another tree', () => {
    expect(cast(false, false)).not.toHaveBeenCalled()
  })
})

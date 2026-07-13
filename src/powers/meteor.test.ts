import { describe, expect, it, vi } from 'vitest'
import type { CastCtx } from './power'
import { applyMeteorOutcome } from './meteor'

function context(kind: CastCtx['kind']): CastCtx {
  return {
    x: 2,
    z: 3,
    kind,
    world: {
      igniteTarget: vi.fn(),
      destroyTarget: vi.fn(),
      killVillagerNear: vi.fn(),
      emptyPondAt: vi.fn(() => true),
      scatterCampfire: vi.fn(),
    },
    island: { group: { position: { y: 0.25 } } },
    fx: { particles: { burst: vi.fn() } },
  } as unknown as CastCtx
}

describe('Meteor target outcomes', () => {
  it('ignites and destroys a directly hit tree', () => {
    const ctx = context('tree')

    applyMeteorOutcome(ctx, 1.5)

    expect(ctx.world.igniteTarget).toHaveBeenCalledWith('tree', 2, 3)
    expect(ctx.world.destroyTarget).toHaveBeenCalledWith('tree', 2, 3)
  })

  it('destroys a directly hit hut', () => {
    const ctx = context('hut')

    applyMeteorOutcome(ctx, 1.5)

    expect(ctx.world.destroyTarget).toHaveBeenCalledWith('hut', 2, 3)
  })

  it('kills a villager caught at the impact point', () => {
    const ctx = context('villager')

    applyMeteorOutcome(ctx, 1.5)

    expect(ctx.world.killVillagerNear).toHaveBeenCalledWith(2, 3, 3, 'meteor')
  })

  it('empties a pond and releases a visible steam burst', () => {
    const ctx = context('pond')

    applyMeteorOutcome(ctx, 1.5)

    expect(ctx.world.emptyPondAt).toHaveBeenCalledWith(2, 3)
    expect(ctx.fx.particles.burst).toHaveBeenCalledWith(expect.objectContaining({
      x: 2,
      y: 1.75,
      z: 3,
    }))
  })

  it('scatters a directly hit campfire', () => {
    const ctx = context('campfire')

    applyMeteorOutcome(ctx, 1.5)

    expect(ctx.world.scatterCampfire).toHaveBeenCalled()
  })

  it.each(['ground', 'crater'] as const)('leaves %s to the crater effect', (kind) => {
    const ctx = context(kind)

    applyMeteorOutcome(ctx, 1.5)

    expect(ctx.world.destroyTarget).not.toHaveBeenCalled()
    expect(ctx.world.killVillagerNear).not.toHaveBeenCalled()
    expect(ctx.world.emptyPondAt).not.toHaveBeenCalled()
    expect(ctx.world.scatterCampfire).not.toHaveBeenCalled()
  })
})

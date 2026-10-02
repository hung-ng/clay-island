import { describe, expect, it } from 'vitest'
import { EventBus } from '../core/events'
import { RNG } from '../core/rng'
import { Timeline } from '../core/timeline'
import { PowerManager, type Power, type CastCtx, type PowerContext } from './power'

class TestPower implements Power {
  readonly id = 'meteor' as const
  readonly cooldown = 2
  casts = 0
  hits: string[] = []

  cast(ctx: CastCtx): Timeline {
    this.casts++
    expect(ctx.kind).toBe('ground')
    expect(ctx.power).toBe('meteor')
    return new Timeline()
      .at(0, () => this.hits.push('anticipation'))
      .at(0.5, () => this.hits.push('impact'))
      .at(1, () => this.hits.push('aftermath'))
  }
}

function context(): PowerContext {
  return {
    world: { resolveTarget: () => 'ground' },
    island: {},
    scene: {},
    fx: { particles: {}, shake: {}, flash: () => {} },
    bus: new EventBus(),
    rng: new RNG(9),
    lowFx: false,
  } as unknown as PowerContext
}

describe('PowerManager', () => {
  it('stages one timeline and rejects recasts during cooldown', () => {
    const power = new TestPower()
    const manager = new PowerManager([power], context())

    expect(manager.ready('meteor')).toBe(true)
    expect(manager.ready('lightning')).toBe(false)
    expect(manager.effectsActive).toBe(false)
    manager.cast('meteor', 2, 3)
    expect(manager.effectsActive).toBe(true)
    manager.cast('meteor', 2, 3)

    expect(power.casts).toBe(1)
    expect(manager.ready('meteor')).toBe(false)
    expect(manager.cooldown01('meteor')).toBe(1)

    manager.update(0.01)
    expect(manager.effectsActive).toBe(true)
    expect(power.hits).toEqual(['anticipation'])
    manager.update(0.49)
    expect(manager.effectsActive).toBe(true)
    expect(power.hits).toEqual(['anticipation', 'impact'])
    manager.update(0.5)
    expect(manager.effectsActive).toBe(false)
    expect(power.hits).toEqual(['anticipation', 'impact', 'aftermath'])
    expect(manager.cooldown01('meteor')).toBeCloseTo(0.5)

    manager.update(1)
    expect(manager.ready('meteor')).toBe(true)
    expect(manager.cooldown01('meteor')).toBe(0)
    manager.cast('meteor', 4, 5)
    expect(power.casts).toBe(2)
  })
})

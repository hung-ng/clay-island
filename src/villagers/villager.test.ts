import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import { WALK_RADIUS } from '../world/island'
import type { Pond } from '../world/objects'
import type { World } from '../world/world'
import { fleeTarget, Villager } from './villager'

describe('villager fleeing', () => {
  it('moves directly away from a nearby danger', () => {
    expect(fleeTarget({ x: 2, z: 0 }, { x: 1, z: 0 }, new RNG(1))).toEqual({ x: 7, z: 0 })
  })

  it('chooses a deterministic escape direction when standing on the danger point', () => {
    const a = fleeTarget({ x: 2, z: 3 }, { x: 2, z: 3 }, new RNG(7))
    const b = fleeTarget({ x: 2, z: 3 }, { x: 2, z: 3 }, new RNG(7))

    expect(a).toEqual(b)
    expect(Math.hypot(a.x - 2, a.z - 3)).toBeCloseTo(5)
  })

  it('never sends a villager beyond the walkable island', () => {
    const target = fleeTarget({ x: 11.5, z: 0 }, { x: 10, z: 0 }, new RNG(1))

    expect(Math.hypot(target.x, target.z)).toBeLessThanOrEqual(WALK_RADIUS)
  })
})

describe('villager persistent activities', () => {
  type ActivityHarness = {
    state: 'sitAtFire' | 'fish'
    targetPond: Pond | null
    enter: ReturnType<typeof vi.fn>
    performActivity(dt: number, ticked: boolean, world: World): void
  }

  function harness(state: ActivityHarness['state'], targetPond: Pond | null = null): ActivityHarness {
    const villager = Object.create(Villager.prototype) as ActivityHarness
    villager.state = state
    villager.targetPond = targetPond
    villager.enter = vi.fn()
    return villager
  }

  it('leaves the campfire when it is no longer lit', () => {
    const villager = harness('sitAtFire')
    const world = { campfire: { lit: false } } as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })

  it('stops fishing when its pond has been emptied', () => {
    const pond = {} as Pond
    const villager = harness('fish', pond)
    const world = { ponds: [] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })
})

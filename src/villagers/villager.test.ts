import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import { WALK_RADIUS } from '../world/island'
import type { Campfire, Hut, Pond } from '../world/objects'
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

describe('villager deferred construction', () => {
  type BuildHarness = {
    state: 'buildHut' | 'makeFire'
    x: number
    z: number
    arrived: boolean
    actionTimer: number
    rebuildingRuin: boolean
    targetHut: Hut | null
    targetCampfire: Campfire | null
    arms: Array<{ rotation: { z: number }; userData: { baseRotation: number } }>
    enter: ReturnType<typeof vi.fn>
    performActivity(dt: number, ticked: boolean, world: World): void
  }

  function harness(state: BuildHarness['state']): BuildHarness {
    const villager = Object.create(Villager.prototype) as BuildHarness
    Object.assign(villager, {
      state,
      x: 0,
      z: 0,
      arrived: false,
      actionTimer: 1,
      rebuildingRuin: false,
      targetHut: null,
      targetCampfire: null,
      arms: [
        { rotation: { z: 0 }, userData: { baseRotation: 0 } },
        { rotation: { z: 0 }, userData: { baseRotation: 0 } },
      ],
      enter: vi.fn(),
    })
    return villager
  }

  it('reveals a reserved hut site only when the builder arrives', () => {
    const villager = harness('buildHut')
    const site = { x: 0, z: 0, state: 'site' } as Hut
    villager.targetHut = site
    const world = {
      huts: [],
      commitBuildSite: vi.fn(() => true),
    } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(world.commitBuildSite).toHaveBeenCalledWith(site)
  })

  it('reveals a reserved campfire site immediately before its first build tick', () => {
    const villager = harness('makeFire')
    const buildTick = vi.fn()
    const site = {
      x: 0, z: 0, state: 'site', lit: false, scattered: false, buildTick,
    } as unknown as Campfire
    villager.targetCampfire = site
    const world = {
      campfire: { state: 'scattered' },
      needsFire: vi.fn(() => true),
      isCampfireBuildTarget: vi.fn(() => true),
      commitCampfireSite: vi.fn(() => true),
    } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(world.commitCampfireSite).toHaveBeenCalledWith(site)
    expect(buildTick).toHaveBeenCalledOnce()
    expect(buildTick.mock.calls[0][0]).toBeCloseTo(1 / 75)
  })
})

describe('villager performance outcomes', () => {
  type ZapHarness = {
    alive: boolean
    zapTime: number
    zapLastQt: number
    x: number
    z: number
    model: { scale: { setScalar: ReturnType<typeof vi.fn> } }
    arms: Array<{ rotation: { z: number } }>
    group: { rotation: { z: number } }
    ghost: { visible: boolean; position: { set: ReturnType<typeof vi.fn> } }
    ghostArm: { rotation: { z: number } }
    ghostMaterials: Array<{ opacity: number }>
    island: { sampleHeight(): number }
    visualMaterials: Array<{ color: { copy: ReturnType<typeof vi.fn> } }>
    visualColors: unknown[]
    resetPose: ReturnType<typeof vi.fn>
    enter: ReturnType<typeof vi.fn>
    world: World
    updateZap(dt: number, qt: number): void
  }

  it('recovers alive after the full comic lightning zap', () => {
    const villager = Object.create(Villager.prototype) as ZapHarness
    Object.assign(villager, {
      alive: true,
      zapTime: 2.4,
      zapLastQt: Number.NEGATIVE_INFINITY,
      x: 1,
      z: 2,
      model: { scale: { setScalar: vi.fn() } },
      arms: [{ rotation: { z: 0 } }, { rotation: { z: 0 } }],
      group: { rotation: { z: 0 } },
      ghost: { visible: true, position: { set: vi.fn() } },
      ghostArm: { rotation: { z: 0 } },
      ghostMaterials: [{ opacity: 1 }],
      island: { sampleHeight: () => 0 },
      visualMaterials: [{ color: { copy: vi.fn() } }],
      visualColors: [{}],
      resetPose: vi.fn(),
      enter: vi.fn(),
      world: {} as World,
    })

    villager.updateZap(0.1, 3)

    expect(villager.alive).toBe(true)
    expect(villager.zapTime).toBe(-1)
    expect(villager.enter).toHaveBeenCalledWith('wander', villager.world)
  })
})

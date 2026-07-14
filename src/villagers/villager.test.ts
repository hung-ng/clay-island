import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import { WALK_RADIUS } from '../world/island'
import type { Campfire, Hut, Pond, Tree } from '../world/objects'
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

  it('fans around a submerged escape target', () => {
    const target = fleeTarget(
      { x: -2, z: 0 },
      { x: -3, z: 0 },
      new RNG(1),
      point => point.z === 0,
    )

    expect(target.z).not.toBe(0)
  })
})

describe('meteor panic', () => {
  type StartleHarness = {
    alive: boolean
    zapTime: number
    state: 'wander'
    performance: string
    performanceTime: number
    performanceFrom: { x: number; z: number }
    emote: ReturnType<typeof vi.fn>
    panic: ReturnType<typeof vi.fn>
    resetPose: ReturnType<typeof vi.fn>
    startle(from: { x: number; z: number }): void
    updatePerformance(dt: number, qt: number, island: unknown): boolean
  }

  it('startles briefly, then flees under its own steam', () => {
    const villager = Object.create(Villager.prototype) as unknown as StartleHarness
    Object.assign(villager, {
      alive: true,
      zapTime: -1,
      state: 'wander',
      performance: 'none',
      performanceTime: 0,
      rainTime: 0,
      rainLeaf: { visible: false },
      emote: vi.fn(),
      panic: vi.fn(),
      resetPose: vi.fn(),
    })

    villager.startle({ x: 0, z: 0 })
    expect(villager.performance).toBe('startle')
    expect(villager.performanceTime).toBeCloseTo(0.25)
    expect(villager.panic).not.toHaveBeenCalled()

    villager.updatePerformance(0.25, 0.25, {})
    expect(villager.panic).toHaveBeenCalledWith({ x: 0, z: 0 })
  })
})

describe('villagers keep out of the water', () => {
  it('is pushed away from a pond it would otherwise walk into', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      x: number
      z: number
      tx: number
      tz: number
      speed: number
      state: 'wander'
      steer(dt: number, world: World): void
    }
    Object.assign(villager, { x: -2, z: 0, tx: 2, tz: 0, speed: 0.86, state: 'wander' })
    const world = {
      objectsNear: () => [],
      waterDepthAt: (x: number) => Math.abs(x) < 1.5 ? 1 : 0,
      submerged: (x: number) => Math.abs(x) < 1.5,
    } as unknown as World

    for (let i = 0; i < 200; i++) villager.steer(1 / 60, world)

    expect(world.submerged(villager.x, villager.z)).toBe(false)
  })

  it('takes a tangent around a round pond instead of sticking at the shore', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      x: number
      z: number
      tx: number
      tz: number
      speed: number
      state: 'wander'
      steer(dt: number, world: World): void
    }
    Object.assign(villager, { x: -3, z: 0, tx: 3, tz: 0, speed: 0.86, state: 'wander' })
    const depth = (x: number, z: number): number => Math.hypot(x, z) < 1.5 ? 1 : 0
    const world = {
      objectsNear: () => [],
      waterDepthAt: depth,
      submerged: (x: number, z: number) => depth(x, z) > 0,
    } as unknown as World

    for (let i = 0; i < 900; i++) villager.steer(1 / 60, world)

    expect(villager.x).toBeGreaterThan(1.5)
    expect(world.submerged(villager.x, villager.z)).toBe(false)
  })
})

describe('villager persistent activities', () => {
  type ActivityHarness = {
    state: 'sitAtFire' | 'fish'
    targetPond: Pond | null
    rod: { visible: boolean }
    enter: ReturnType<typeof vi.fn>
    performActivity(dt: number, ticked: boolean, world: World): void
  }

  function harness(state: ActivityHarness['state'], targetPond: Pond | null = null): ActivityHarness {
    const villager = Object.create(Villager.prototype) as ActivityHarness
    villager.state = state
    villager.targetPond = targetPond
    villager.rod = { visible: false }
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

describe('villager needs', () => {
  it('resumes interrupted labour after drinking', () => {
    const pond = {} as Pond
    const villager = Object.create(Villager.prototype) as unknown as {
      state: 'drink'
      targetPond: Pond
      arrived: boolean
      actionTimer: number
      resumeState: 'buildHut'
      model: { scale: { set: ReturnType<typeof vi.fn> } }
      head: { rotation: { x: number } }
      emote: ReturnType<typeof vi.fn>
      enter: ReturnType<typeof vi.fn>
      targetDistance(): number
      performActivity(dt: number, ticked: boolean, world: World): void
    }
    Object.assign(villager, {
      state: 'drink',
      targetPond: pond,
      arrived: false,
      actionTimer: 0,
      resumeState: 'buildHut',
      model: { scale: { set: vi.fn() } },
      head: { rotation: { x: 0 } },
      emote: vi.fn(),
      enter: vi.fn(),
      targetDistance: () => 0,
    })
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(2.1, true, world)

    expect(villager.enter).toHaveBeenCalledWith('buildHut', world)
  })
})

describe('villagers use the world', () => {
  it('shelters under a nearer tree without the leaf hat', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      alive: boolean
      zapTime: number
      x: number
      z: number
      rainLeaf: { visible: boolean }
      arms: Array<{ rotation: { z: number } }>
      resetPose: ReturnType<typeof vi.fn>
      emote: ReturnType<typeof vi.fn>
      setTarget: ReturnType<typeof vi.fn>
      grumpAtRain(world: World): void
    }
    Object.assign(villager, {
      alive: true,
      zapTime: -1,
      x: 0,
      z: 0,
      rainLeaf: { visible: true },
      arms: [{ rotation: { z: 0 } }],
      resetPose: vi.fn(),
      emote: vi.fn(),
      setTarget: vi.fn(),
    })
    const tree = { state: 'normal', x: 1.5, z: 0 }
    const world = {
      huts: [{ state: 'built', x: 10, z: 0 }],
      trees: [tree],
    } as unknown as World

    villager.grumpAtRain(world)

    expect(villager.rainLeaf.visible).toBe(false)
    expect(villager.setTarget).toHaveBeenCalledWith(tree)
  })

  it('lands four chopping blows before felling the tree', () => {
    const tree = {
      x: 0,
      z: 0,
      state: 'normal',
      shudder: vi.fn(),
      chop: vi.fn(),
    } as unknown as Tree
    const villager = Object.create(Villager.prototype) as unknown as {
      state: 'chopTree'
      x: number
      z: number
      arrived: boolean
      chopFrames: number
      targetTree: Tree
      arms: Array<{ rotation: { z: number }; userData: { baseRotation: number } }>
      axe: { rotation: { z: number } }
      enter: ReturnType<typeof vi.fn>
      performActivity(dt: number, ticked: boolean, world: World): void
    }
    Object.assign(villager, {
      state: 'chopTree',
      x: 0,
      z: 0,
      arrived: false,
      chopFrames: 0,
      targetTree: tree,
      arms: [
        { rotation: { z: 0 }, userData: { baseRotation: 0 } },
        { rotation: { z: 0 }, userData: { baseRotation: 0 } },
      ],
      axe: { rotation: { z: 0 } },
      enter: vi.fn(),
    })
    const world = { chipsAt: vi.fn() } as unknown as World

    for (let i = 0; i < 8; i++) villager.performActivity(1 / 12, true, world)

    expect(tree.shudder).toHaveBeenCalledTimes(4)
    expect(world.chipsAt).toHaveBeenCalledTimes(4)
    expect(tree.chop).toHaveBeenCalledOnce()
  })

  it('pauses at an old grave but leaves fresh graves to mourners', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      state: 'wander'
      x: number
      z: number
      arrived: boolean
      graveGlance: number
      rng: { chance(): boolean }
      emote: ReturnType<typeof vi.fn>
      setTarget: ReturnType<typeof vi.fn>
      targetDistance(): number
      performActivity(dt: number, ticked: boolean, world: World): void
    }
    Object.assign(villager, {
      state: 'wander',
      x: 0,
      z: 0,
      arrived: false,
      graveGlance: 0,
      rng: { chance: () => false },
      emote: vi.fn(),
      setTarget: vi.fn(),
      targetDistance: () => 5,
    })
    const world = { graves: [{ x: 0.5, z: 0, fresh: false }] } as unknown as World

    villager.performActivity(1 / 60, true, world)

    expect(villager.graveGlance).toBeGreaterThan(0)
    expect(villager.emote).toHaveBeenCalledWith('sad')
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

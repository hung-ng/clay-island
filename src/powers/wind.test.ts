import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../core/events'
import { RNG } from '../core/rng'
import type { CastCtx } from './power'
import { gustDirection, WIND, Wind } from './wind'

vi.mock('../fx/clayMaterial', async () => {
  const actual = await import('three')
  return { clayMaterial: vi.fn(() => new actual.MeshToonMaterial()) }
})

vi.mock('../fx/wobble', () => ({
  wobble: <T>(geometry: T): T => geometry,
}))

describe('gustDirection', () => {
  it('points outward from the island centre through the cast point', () => {
    expect(gustDirection(3, 4)).toEqual({ x: 0.6, z: 0.8 })
    expect(gustDirection(-5, 0)).toEqual({ x: -1, z: 0 })
  })

  it('falls back to a fixed direction at the exact centre', () => {
    expect(gustDirection(0, 0)).toEqual({ x: 1, z: 0 })
  })

  it('keeps the spec timing: 6 m radius, 0.8 s + 2.5 s beats, 3 s cooldown', () => {
    expect(WIND.radius).toBe(6)
    expect(WIND.anticipationSeconds).toBeCloseTo(0.8)
    expect(WIND.fruitDropDelaySeconds).toBeCloseTo(0.25)
    expect(WIND.gustSeconds).toBeCloseTo(2.5)
    expect(WIND.cooldown).toBe(3)
    expect(WIND.emberRadius).toBe(4.5)
    expect(WIND.emberChance).toBe(1)
    expect(WIND.emberHalfAngle * 180 / Math.PI).toBeCloseTo(50)
  })
})

type StubTree = {
  x: number
  z: number
  burning?: boolean
  flare?: ReturnType<typeof vi.fn>
  sway: ReturnType<typeof vi.fn>
}
type StubHut = {
  x: number
  z: number
  burning: boolean
  flare: ReturnType<typeof vi.fn>
}
type StubVillager = { x: number; z: number; tumble: ReturnType<typeof vi.fn> }

function castContext(target: string, options: {
  campfire?: { x: number; z: number; lit?: boolean }
  reduced?: boolean
  trees?: StubTree[]
  huts?: StubHut[]
  villagers?: StubVillager[]
  x?: number
  z?: number
} = {}): {
  ctx: CastCtx
  world: {
    campfire: { x: number; z: number; lit: boolean; flare: ReturnType<typeof vi.fn> }
    dropFruitNear: ReturnType<typeof vi.fn>
    emberIgnite: ReturnType<typeof vi.fn>
    villagerAt: ReturnType<typeof vi.fn>
  }
  burst: ReturnType<typeof vi.fn>
} {
  const burst = vi.fn()
  const x = options.x ?? 4
  const z = options.z ?? 0
  const campfirePosition = options.campfire
    ?? (target === 'campfire' ? { x, z, lit: true } : { x: 99, z: 99, lit: true })
  const villagers = options.villagers ?? []
  const world = {
    trees: options.trees ?? [],
    huts: options.huts ?? [],
    villagers,
    campfire: {
      ...campfirePosition,
      id: 'campfire',
      kind: 'campfire',
      lit: campfirePosition.lit ?? true,
      flare: vi.fn(),
    },
    resolveTarget: vi.fn(() => target),
    dropFruitNear: vi.fn(),
    emberIgnite: vi.fn(() => false),
    villagerAt: vi.fn((targetX: number, targetZ: number, radius = 1.2) => (
      villagers.find(villager => Math.hypot(villager.x - targetX, villager.z - targetZ) <= radius)
      ?? null
    )),
  }
  const ctx = {
    x,
    z,
    kind: target,
    power: 'wind',
    world,
    island: { sampleHeight: () => 0, group: new THREE.Group() },
    scene: new THREE.Scene(),
    fx: { particles: { burst } },
    bus: new EventBus(),
    rng: new RNG(11),
    lowFx: false,
    reducedMotion: () => options.reduced ?? false,
  } as unknown as CastCtx
  return { ctx, world: world as never, burst }
}

describe('Wind', () => {
  it('drops fruit through the gust radius once when directly targeting a tree', () => {
    const { ctx, world } = castContext('tree')
    const events: string[] = []
    ctx.bus.on(event => events.push(event.type))

    const timeline = new Wind().cast(ctx)
    timeline.update(0)
    expect(events).toEqual(['power:anticipate'])
    expect(world.dropFruitNear).not.toHaveBeenCalled()

    timeline.update(0.8)
    expect(events).toEqual(['power:anticipate', 'power:impact'])
    expect(world.dropFruitNear).not.toHaveBeenCalled()

    timeline.update(0.24)
    expect(world.dropFruitNear).not.toHaveBeenCalled()

    timeline.update(0.01)
    expect(world.dropFruitNear).toHaveBeenCalledWith(4, 0, 6, ctx.rng, false)
    expect(world.dropFruitNear).toHaveBeenCalledTimes(1)
  })

  it('drops fruit through the gust radius when targeting nearby ground', () => {
    const { ctx, world } = castContext('ground')

    const timeline = new Wind().cast(ctx)
    timeline.update(0.8)
    expect(world.dropFruitNear).not.toHaveBeenCalled()

    timeline.update(0.25)

    expect(world.dropFruitNear).toHaveBeenCalledWith(4, 0, 6, ctx.rng, false)
    expect(world.dropFruitNear).toHaveBeenCalledTimes(1)
  })

  it('sways only trees inside the gust, along the outward direction', () => {
    const inside: StubTree = { x: 5, z: 1, sway: vi.fn() }
    const outside: StubTree = { x: 4, z: 9, sway: vi.fn() }
    const { ctx } = castContext('ground', { trees: [inside, outside] })

    new Wind().cast(ctx).update(0.8)

    expect(inside.sway).toHaveBeenCalledWith(1, 0, 2.5)
    expect(outside.sway).not.toHaveBeenCalled()
  })

  it('shortens the bounded gust under reduced motion, same outcomes', () => {
    const tree: StubTree = { x: 5, z: 1, sway: vi.fn() }
    const { ctx, world } = castContext('tree', { reduced: true, trees: [tree] })

    new Wind().cast(ctx).update(1.05)

    expect(tree.sway).toHaveBeenCalledWith(1, 0, 1.2)
    expect(world.dropFruitNear).toHaveBeenCalled()
  })

  it('rolls an ember when the gust contains the campfire, even from nearby ground', () => {
    const campfire = castContext('campfire')
    new Wind().cast(campfire.ctx).update(0.8)
    expect(campfire.world.campfire.flare).toHaveBeenCalledTimes(1)
    expect(campfire.world.emberIgnite).toHaveBeenCalledWith(
      campfire.world.campfire,
      campfire.ctx.rng,
      1,
      4.5,
      { x: 1, z: 0 },
      WIND.emberHalfAngle,
    )

    const nearbyGround = castContext('ground', {
      x: 5.9,
      z: 0,
      campfire: { x: 0, z: 0 },
    })
    new Wind().cast(nearbyGround.ctx).update(0.8)
    expect(nearbyGround.world.campfire.flare).toHaveBeenCalledTimes(1)
    expect(nearbyGround.world.emberIgnite).toHaveBeenCalledWith(
      nearbyGround.world.campfire,
      nearbyGround.ctx.rng,
      1,
      4.5,
      { x: 1, z: 0 },
      WIND.emberHalfAngle,
    )

    const distantGround = castContext('ground', {
      x: 6.1,
      z: 0,
      campfire: { x: 0, z: 0 },
    })
    new Wind().cast(distantGround.ctx).update(0.8)
    expect(distantGround.world.campfire.flare).not.toHaveBeenCalled()
    expect(distantGround.world.emberIgnite).not.toHaveBeenCalled()

    const dousedNearby = castContext('ground', {
      x: 4,
      z: 0,
      campfire: { x: 0, z: 0, lit: false },
    })
    new Wind().cast(dousedNearby.ctx).update(0.8)
    expect(dousedNearby.world.campfire.flare).not.toHaveBeenCalled()
    expect(dousedNearby.world.emberIgnite).not.toHaveBeenCalled()

    const dousedDirect = castContext('campfire', {
      campfire: { x: 4, z: 0, lit: false },
    })
    new Wind().cast(dousedDirect.ctx).update(0.8)
    expect(dousedDirect.world.campfire.flare).not.toHaveBeenCalled()
    expect(dousedDirect.world.emberIgnite).not.toHaveBeenCalled()
  })

  it('fans every pre-existing burning tree and hut in the gust as an ember source', () => {
    const burningTree: StubTree = {
      x: 2,
      z: 0,
      burning: true,
      flare: vi.fn(),
      sway: vi.fn(),
    }
    const newlyIgnited: StubTree = {
      x: 3,
      z: 0,
      burning: false,
      flare: vi.fn(),
      sway: vi.fn(),
    }
    const burningHut: StubHut = { x: 6, z: 0, burning: true, flare: vi.fn() }
    const outsideHut: StubHut = { x: 11, z: 0, burning: true, flare: vi.fn() }
    const { ctx, world } = castContext('ground', {
      x: 4,
      z: 0,
      campfire: { x: 99, z: 99 },
      trees: [burningTree, newlyIgnited],
      huts: [burningHut, outsideHut],
    })
    world.emberIgnite.mockImplementationOnce(() => {
      newlyIgnited.burning = true
      return true
    })

    new Wind().cast(ctx).update(0.8)

    expect(burningTree.flare).toHaveBeenCalledWith(2, 3)
    expect(burningHut.flare).toHaveBeenCalledWith(2, 3)
    expect(newlyIgnited.flare).not.toHaveBeenCalled()
    expect(outsideHut.flare).not.toHaveBeenCalled()
    expect(world.emberIgnite).toHaveBeenCalledTimes(2)
    expect(world.emberIgnite).toHaveBeenNthCalledWith(
      1,
      burningTree,
      ctx.rng,
      1,
      4.5,
      { x: 1, z: 0 },
      WIND.emberHalfAngle,
    )
    expect(world.emberIgnite).toHaveBeenNthCalledWith(
      2,
      burningHut,
      ctx.rng,
      1,
      4.5,
      { x: 1, z: 0 },
      WIND.emberHalfAngle,
    )
  })

  it('tumbles every villager inside the gust exactly once, including on a direct target', () => {
    const targeted: StubVillager = { x: 4, z: 0, tumble: vi.fn() }
    const nearby: StubVillager = { x: 7, z: 0, tumble: vi.fn() }
    const outside: StubVillager = { x: 10.1, z: 0, tumble: vi.fn() }
    const { ctx } = castContext('villager', {
      villagers: [targeted, nearby, outside],
    })

    new Wind().cast(ctx).update(0.8)

    expect(targeted.tumble).toHaveBeenCalledTimes(1)
    expect(nearby.tumble).toHaveBeenCalledTimes(1)
    expect(outside.tumble).not.toHaveBeenCalled()
  })

  it('tumbles villagers inside the gust when the reticle resolves to something else', () => {
    const first: StubVillager = { x: 2, z: 0, tumble: vi.fn() }
    const second: StubVillager = { x: 8, z: 0, tumble: vi.fn() }
    const { ctx } = castContext('ground', {
      villagers: [first, second],
      x: 4,
      z: 0,
    })

    new Wind().cast(ctx).update(0.8)

    expect(first.tumble).toHaveBeenCalledTimes(1)
    expect(second.tumble).toHaveBeenCalledTimes(1)
  })

  it('keeps pond and crater mutations radius-based while staging their particles', () => {
    for (const target of ['pond', 'crater'] as const) {
      const { ctx, world, burst } = castContext(target)
      new Wind().cast(ctx).update(1.05)
      expect(burst).toHaveBeenCalled()
      expect(world.dropFruitNear).toHaveBeenCalledWith(4, 0, 6, ctx.rng, false)
      expect(world.emberIgnite).not.toHaveBeenCalled()
      expect(world.villagerAt).not.toHaveBeenCalled()
    }
  })

  it('finishes its choreography inside the cooldown-plus-aftermath window', () => {
    const { ctx } = castContext('ground')
    const timeline = new Wind().cast(ctx)
    timeline.update(10)
    expect(timeline.done).toBe(true)
    expect(new Wind().cooldown).toBe(3)
  })
})

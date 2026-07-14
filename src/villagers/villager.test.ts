import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { EventBus } from '../core/events'
import { RNG } from '../core/rng'
import { WALK_RADIUS } from '../world/island'
import type { Campfire, Hut, Pond, Tree } from '../world/objects'
import type { World } from '../world/world'
import type { Suggestion } from './fsm'
import {
  DRINK_TIME,
  FISH_CAST_TIME,
  fleeTarget,
  MODEL_SCALE,
  THIRST_LIMIT,
  Villager,
} from './villager'

type ActivityHarness = {
  state: 'sitAtFire' | 'fish' | 'harvest' | 'drink' | 'gather' | 'chopTree'
  suggestion: Suggestion | null
  targetPond: Pond | null
  targetTree: Tree | null
  rod: THREE.Object3D
  rodTip: THREE.Vector3
  heldFruit: THREE.Object3D
  eating: number
  arrived: boolean
  actionTimer: number
  timer: number
  thirst: number
  resumeState: string | null
  gatheringBySuggestion: boolean
  x: number
  z: number
  bus: EventBus
  model: THREE.Object3D
  head: THREE.Object3D
  arms: THREE.Object3D[]
  group: THREE.Object3D
  emote: ReturnType<typeof vi.fn>
  enter: ReturnType<typeof vi.fn>
  targetDistance(): number
  alignFishingRig(pond: Pond): void
  updateHeldFruit(dt: number, ticked: boolean): boolean
  performActivity(dt: number, ticked: boolean, world: World): void
}

function activityHarness(
  state: ActivityHarness['state'],
  targetPond: Pond | null = null,
): ActivityHarness {
  const villager = Object.create(Villager.prototype) as ActivityHarness
  const bone = (): THREE.Object3D => new THREE.Object3D()
  villager.state = state
  villager.suggestion = null
  villager.targetPond = targetPond
  villager.targetTree = null
  villager.eating = 0
  villager.arrived = false
  villager.actionTimer = 0
  villager.timer = 5
  villager.thirst = 0
  villager.resumeState = null
  villager.gatheringBySuggestion = false
  villager.x = 0
  villager.z = 0
  villager.model = bone()
  villager.head = bone()
  villager.arms = [bone(), bone()]
  villager.group = bone()
  villager.head.position.y = 0.94
  villager.arms[0].position.set(-0.28, 0.51, 0)
  villager.arms[1].position.set(0.28, 0.51, 0)
  villager.group.add(villager.model)
  villager.model.add(villager.head, ...villager.arms)
  villager.model.scale.setScalar(MODEL_SCALE)
  villager.emote = vi.fn()
  villager.enter = vi.fn()
  const rod = bone()
  rod.name = 'fishing-rig'
  rod.visible = false
  const pole = bone()
  pole.name = 'fishing-rod'
  pole.position.set(0.3, 0.8, 0.42)
  pole.rotation.set(1.05, 0, -0.18)
  const line = bone()
  line.name = 'fishing-line'
  const fishingFloat = bone()
  fishingFloat.name = 'fishing-float'
  rod.add(pole, line, fishingFloat)
  villager.rod = rod
  villager.rodTip = new THREE.Vector3()
  villager.group.add(rod)
  const heldFruit = bone()
  heldFruit.name = 'held-fruit'
  heldFruit.visible = false
  heldFruit.position.set(0, -0.18, 0.06)
  villager.heldFruit = heldFruit
  villager.arms[0].add(heldFruit)
  villager.targetDistance = () => 0
  return villager
}

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
  it('leaves the campfire when it is no longer lit', () => {
    const villager = activityHarness('sitAtFire')
    const world = { campfire: { lit: false } } as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })

  it('stops fishing when its pond has been emptied', () => {
    const pond = {} as Pond
    const villager = activityHarness('fish', pond)
    const world = { ponds: [] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })
})

describe('fishing population', () => {
  it('starts one four-second cast after reaching the bank', () => {
    const pond = {
      x: 0,
      z: 0,
      hasFish: true,
      group: { position: { y: 0 } },
    } as unknown as Pond
    const villager = activityHarness('fish', pond)
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(0, true, world)

    expect(villager.actionTimer).toBe(FISH_CAST_TIME)
    expect(villager.rod.visible).toBe(true)
  })

  it('catches exactly one fish after a completed cast', () => {
    const emit = vi.fn()
    const pond = {
      x: 0,
      z: 0,
      hasFish: true,
      catchFish: vi.fn(() => true),
      group: { position: { y: 0 } },
    } as unknown as Pond
    const villager = activityHarness('fish', pond)
    villager.arrived = true
    villager.actionTimer = 0.1
    villager.bus = { emit } as unknown as EventBus
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(0.11, true, world)

    expect(pond.catchFish).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({ type: 'villager:fished' })
    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })

  it('switches to drinking when another villager takes the last fish', () => {
    const pond = {
      x: 0,
      z: 0,
      hasFish: false,
      catchFish: vi.fn(() => false),
    } as unknown as Pond
    const villager = activityHarness('fish', pond)
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.enter).toHaveBeenCalledWith('drink', world, pond)
    expect(pond.catchFish).not.toHaveBeenCalled()
  })

  it('abandons fishing when the pond itself disappears', () => {
    const pond = { hasFish: true } as Pond
    const villager = activityHarness('fish', pond)
    const world = { ponds: [] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })

  it('does not let the generic state timer cut short a cast already under way', () => {
    const enter = vi.fn()
    const villager = Object.create(Villager.prototype) as unknown as {
      alive: boolean
      suggestion: null
      huddleTime: number
      zapTime: number
      rainTime: number
      lastQt: number
      state: 'fish'
      timer: number
      thirst: number
      arrived: boolean
      actionTimer: number
      eating: number
      normalizeSuggestion: ReturnType<typeof vi.fn>
      updatePerformance: ReturnType<typeof vi.fn>
      updateFleeTarget: ReturnType<typeof vi.fn>
      performActivity: ReturnType<typeof vi.fn>
      context: ReturnType<typeof vi.fn>
      enter: ReturnType<typeof vi.fn>
      update(dt: number, qt: number, world: World, island: never): void
    }
    Object.assign(villager, {
      alive: true,
      suggestion: null,
      huddleTime: 0,
      zapTime: -1,
      rainTime: 0,
      lastQt: 0,
      state: 'fish',
      timer: 0.05,
      thirst: 0,
      arrived: true,
      actionTimer: FISH_CAST_TIME,
      eating: 0,
      normalizeSuggestion: vi.fn(),
      updatePerformance: vi.fn(() => false),
      updateFleeTarget: vi.fn(),
      performActivity: vi.fn(),
      context: vi.fn(() => ({
        state: 'fish',
        fireNear: false,
        freshGrave: false,
        hasRuin: false,
        hasSite: false,
        hasPond: true,
        hasFishPond: true,
        hasTree: false,
        campfireLit: false,
        needsFire: false,
        hasFruitTree: false,
        fireOut: false,
        suggestion: null,
        rng: new RNG(1),
      })),
      enter,
    })
    const world = {
      nearestBurning: () => null,
      ponds: [],
      graves: [],
      huts: [],
    } as unknown as World

    villager.update(0.1, 0, world, {} as never)

    expect(enter).not.toHaveBeenCalled()
  })
})

describe('held prop alignment', () => {
  it('aligns the fishing float to the target water level', () => {
    const pond = {
      group: { position: { y: -0.5 } },
    } as Pond
    const villager = activityHarness('fish', pond)
    villager.group.position.y = 0.2

    villager.alignFishingRig(pond)

    const fishingFloat = villager.rod.getObjectByName('fishing-float')!
    const line = villager.rod.getObjectByName('fishing-line')!
    const pole = villager.rod.getObjectByName('fishing-rod')!
    const poleTip = new THREE.Vector3(0, 0.65, 0)
      .applyEuler(pole.rotation)
      .add(pole.position)
    const lineTop = new THREE.Vector3(
      line.position.x,
      line.position.y + line.scale.y / 2,
      line.position.z,
    )
    expect(fishingFloat.position.y).toBeCloseTo(-0.68)
    expect(line.position.y).toBeGreaterThan(fishingFloat.position.y)
    expect(line.scale.y).toBeGreaterThan(0)
    expect(lineTop.distanceTo(poleTip)).toBeLessThan(0.001)
  })

  it('keeps held fruit on the carrying arm through the bite pose', () => {
    const tree = {
      x: 0,
      z: 0,
      state: 'normal',
      hasFruit: true,
      pickFruit: vi.fn(() => true),
    }
    const villager = activityHarness('harvest')
    villager.targetTree = tree as unknown as Tree
    const world = { ponds: [], trees: [tree] } as unknown as World

    villager.performActivity(1.3, true, world)
    villager.updateHeldFruit(0, true)
    villager.group.updateMatrixWorld(true)

    expect(villager.heldFruit.parent).toBe(villager.arms[0])
    expect(villager.heldFruit.visible).toBe(true)
    expect(villager.heldFruit.position.y).toBeLessThan(0)
    expect(villager.heldFruit.getWorldPosition(new THREE.Vector3()).distanceTo(
      villager.head.getWorldPosition(new THREE.Vector3()),
    )).toBeLessThan(0.3)
  })
})

describe('completion-based suggestions', () => {
  it('does not expire a suggestion merely because time passes', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: Suggestion | null
      update(dt: number, qt: number, world: World, island: never): void
      alive: boolean
      huddleTime: number
      zapTime: number
      rainTime: number
      lastQt: number
      state: 'wander'
      timer: number
      thirst: number
      arrived: boolean
      updatePerformance: ReturnType<typeof vi.fn>
      updateFleeTarget: ReturnType<typeof vi.fn>
      steer: ReturnType<typeof vi.fn>
      performActivity: ReturnType<typeof vi.fn>
      enter: ReturnType<typeof vi.fn>
    }
    Object.assign(villager, {
      suggestion: { kind: 'chop', x: 1, z: 2 },
      alive: true,
      huddleTime: 0,
      zapTime: -1,
      rainTime: 0,
      lastQt: 0,
      state: 'wander',
      timer: 10,
      thirst: 0,
      arrived: true,
      updatePerformance: vi.fn(() => false),
      updateFleeTarget: vi.fn(),
      steer: vi.fn(),
      performActivity: vi.fn(),
      enter: vi.fn(),
    })
    const world = {
      nearestBurning: () => null,
      ponds: [],
      trees: [{ state: 'normal' }],
      graves: [],
      huts: [],
    } as unknown as World

    villager.update(7, 0, world, {} as never)

    expect(villager.suggestion).toEqual({ kind: 'chop', x: 1, z: 2 })
  })

  it('preserves a suggestion while panic overrides the current state', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: Suggestion | null
      state: 'wander' | 'flee'
      rng: RNG
      world: { submerged(): boolean }
      timer: number
      retargetTimer: number
      x: number
      z: number
      setTarget: ReturnType<typeof vi.fn>
      emote: ReturnType<typeof vi.fn>
      panic(from: { x: number; z: number }): void
    }
    Object.assign(villager, {
      suggestion: { kind: 'chop', x: 1, z: 2 },
      state: 'wander',
      rng: new RNG(1),
      world: { submerged: () => false },
      timer: 0,
      retargetTimer: 0,
      x: 0,
      z: 0,
      setTarget: vi.fn(),
      emote: vi.fn(),
    })

    villager.panic({ x: 0.5, z: 0 })

    expect(villager.state).toBe('flee')
    expect(villager.suggestion).toEqual({ kind: 'chop', x: 1, z: 2 })
  })

  it('preserves a suggestion while Rain sends the villager to shelter', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: Suggestion | null
      alive: boolean
      zapTime: number
      rainTime: number
      state: 'wander'
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
      suggestion: { kind: 'chop', x: 1, z: 2 },
      alive: true,
      zapTime: -1,
      rainTime: 0,
      state: 'wander',
      x: 0,
      z: 0,
      rainLeaf: { visible: false },
      arms: [{ rotation: { z: 0 } }],
      resetPose: vi.fn(),
      emote: vi.fn(),
      setTarget: vi.fn(),
    })
    const world = {
      huts: [{ state: 'built', x: 1, z: 0 }],
      trees: [],
    } as unknown as World

    villager.grumpAtRain(world)

    expect(villager.suggestion).toEqual({ kind: 'chop', x: 1, z: 2 })
  })

  it.each([
    { freshGrave: true, hasRuin: false, expected: 'mourn' },
    { freshGrave: false, hasRuin: true, expected: 'rebuild' },
  ])('lets $expected interrupt accepted work without clearing its suggestion', ({
    freshGrave,
    hasRuin,
    expected,
  }) => {
    const suggestion: Suggestion = { kind: 'fish', x: 0, z: 0 }
    const enter = vi.fn()
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: Suggestion | null
      alive: boolean
      huddleTime: number
      zapTime: number
      rainTime: number
      lastQt: number
      state: 'fish'
      timer: number
      thirst: number
      arrived: boolean
      normalizeSuggestion: ReturnType<typeof vi.fn>
      updatePerformance: ReturnType<typeof vi.fn>
      updateFleeTarget: ReturnType<typeof vi.fn>
      performActivity: ReturnType<typeof vi.fn>
      context: ReturnType<typeof vi.fn>
      enter: ReturnType<typeof vi.fn>
      update(dt: number, qt: number, world: World, island: never): void
    }
    Object.assign(villager, {
      suggestion,
      alive: true,
      huddleTime: 0,
      zapTime: -1,
      rainTime: 0,
      lastQt: 0,
      state: 'fish',
      timer: 20,
      thirst: 0,
      arrived: true,
      normalizeSuggestion: vi.fn(),
      updatePerformance: vi.fn(() => false),
      updateFleeTarget: vi.fn(),
      performActivity: vi.fn(),
      context: vi.fn(() => ({
        state: 'fish',
        fireNear: false,
        freshGrave,
        hasRuin,
        hasSite: false,
        hasPond: true,
        hasFishPond: true,
        hasTree: false,
        campfireLit: true,
        needsFire: false,
        hasFruitTree: false,
        fireOut: false,
        suggestion,
        rng: new RNG(1),
      })),
      enter,
    })
    const world = {
      nearestBurning: () => null,
      ponds: [],
      graves: freshGrave ? [{ x: 0, z: 0, fresh: true }] : [],
      huts: hasRuin ? [{ state: 'ruin' }] : [],
    } as unknown as World

    villager.update(0.1, 0, world, {} as never)

    expect(enter).toHaveBeenCalledWith(expected, world)
    expect(villager.suggestion).toBe(suggestion)
  })

  it('clears a suggestion only when its matching action completes', () => {
    const pond = {
      x: 0,
      z: 0,
      hasFish: true,
      catchFish: vi.fn(() => true),
      group: { position: { y: 0 } },
    } as unknown as Pond
    const villager = activityHarness('fish', pond)
    villager.suggestion = { kind: 'fish', x: 0, z: 0 }
    villager.arrived = true
    villager.actionTimer = 0.01
    villager.bus = { emit: vi.fn() } as unknown as EventBus
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(0.02, true, world)

    expect(villager.suggestion).toBeNull()
  })

  it('does not clear a suggestion when an unrelated action completes', () => {
    const pond = { x: 0, z: 0 } as Pond
    const villager = activityHarness('drink', pond)
    villager.suggestion = { kind: 'chop', x: 1, z: 2 }
    villager.arrived = true
    villager.actionTimer = 0.01
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(0.02, true, world)

    expect(villager.suggestion).toEqual({ kind: 'chop', x: 1, z: 2 })
  })

  it('converts a depleted fishing suggestion into one completed drink', () => {
    const pond = { x: 0, z: 0, hasFish: false } as Pond
    const villager = activityHarness('fish', pond)
    villager.suggestion = { kind: 'fish', x: 0, z: 0 }
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.suggestion?.kind).toBe('drink')
    expect(villager.enter).toHaveBeenCalledWith('drink', world, pond)
  })

  it('cancels the accepted suggestion when its selected target disappears', () => {
    const pond = { x: 0, z: 0, hasFish: true } as Pond
    const otherPond = { x: 4, z: 0, hasFish: true } as Pond
    const villager = activityHarness('fish', pond)
    villager.suggestion = { kind: 'fish', x: 0, z: 0 }
    const world = { ponds: [otherPond] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.suggestion).toBeNull()
    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })

  it('cancels a chop suggestion with a stale target even if another tree exists', () => {
    const stale = { state: 'felled' } as Tree
    const villager = Object.create(Villager.prototype) as unknown as {
      state: 'chopTree'
      suggestion: Suggestion | null
      targetTree: Tree
      enter: ReturnType<typeof vi.fn>
      performActivity(dt: number, ticked: boolean, world: World): void
    }
    Object.assign(villager, {
      state: 'chopTree',
      suggestion: { kind: 'chop', x: 0, z: 0 },
      targetTree: stale,
      enter: vi.fn(),
    })
    const world = { trees: [{ state: 'normal' }] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.suggestion).toBeNull()
  })

  it('does not complete gathering before reaching and performing at the target', () => {
    const villager = activityHarness('gather')
    villager.suggestion = { kind: 'gather', x: 4, z: 0 }
    villager.gatheringBySuggestion = true
    villager.targetDistance = () => 5
    const world = {
      campfire: { x: 0, z: 0 },
      fireOut: () => false,
    } as unknown as World

    villager.performActivity(10, true, world)
    expect(villager.suggestion).not.toBeNull()

    villager.targetDistance = () => 0
    villager.performActivity(0, true, world)
    expect(villager.suggestion).not.toBeNull()

    villager.performActivity(2.5, true, world)
    expect(villager.suggestion).toBeNull()
  })

  it('turns a direct campfire Nudge into a reachable point outside the solid prop', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      x: number
      z: number
      rng: RNG
      suggestedGatherTarget(suggestion: Suggestion, world: World): { x: number; z: number }
    }
    Object.assign(villager, { x: 4, z: 0, rng: new RNG(1) })
    const campfire = { x: 0, z: 0, scattered: false }
    const world = { campfire } as unknown as World

    const target = villager.suggestedGatherTarget(
      { kind: 'gather', x: 0.4, z: 0 },
      world,
    )

    expect(Math.hypot(target.x - campfire.x, target.z - campfire.z)).toBeCloseTo(1.5)
    expect(target.x).toBeGreaterThan(0)
  })

  it('keeps an interrupted gather reachable if the campfire scatters before resumption', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      x: number
      z: number
      rng: RNG
      suggestedGatherTarget(suggestion: Suggestion, world: World): { x: number; z: number }
    }
    Object.assign(villager, { x: 4, z: 0, rng: new RNG(1) })
    const campfire = { x: 0, z: 0, scattered: true }

    const target = villager.suggestedGatherTarget(
      { kind: 'gather', x: 0.4, z: 0 },
      { campfire } as unknown as World,
    )

    expect(Math.hypot(target.x - campfire.x, target.z - campfire.z)).toBeCloseTo(1.5)
  })

  it('restarts an autonomous gather when that same villager accepts a gather Nudge', () => {
    const world = {} as World
    const enter = vi.fn()
    const villager = Object.create(Villager.prototype) as unknown as {
      alive: boolean
      zapTime: number
      performance: 'none'
      suggestion: Suggestion | null
      state: 'gather'
      timer: number
      world: World
      emote: ReturnType<typeof vi.fn>
      enter: ReturnType<typeof vi.fn>
      suggest(suggestion: Suggestion): void
    }
    Object.assign(villager, {
      alive: true,
      zapTime: -1,
      performance: 'none',
      suggestion: null,
      state: 'gather',
      timer: 5,
      world,
      emote: vi.fn(),
      enter,
    })

    villager.suggest({ kind: 'gather', x: 2, z: 3 })

    expect(enter).toHaveBeenCalledWith('gather', world)
  })

  it('selects empty water nearest the Nudge location rather than the villager', () => {
    const intended = { x: 1, z: 0, hasFish: false } as Pond
    const unrelated = { x: 9, z: 0, hasFish: false } as Pond
    const villager = Object.create(Villager.prototype) as unknown as {
      x: number
      z: number
      suggestion: Suggestion | null
      selectPond(kind: 'fish' | 'drink', world: World, preferred?: Pond | null): Pond | null
    }
    Object.assign(villager, {
      x: 9,
      z: 0,
      suggestion: { kind: 'drink', x: 1.2, z: 0 },
    })
    const world = {
      ponds: [unrelated, intended],
      pondAt: () => null,
    } as unknown as World

    expect(villager.selectPond('drink', world)).toBe(intended)
  })

  it('selects fruit nearest the Nudge location rather than the villager', () => {
    const intended = { x: 1, z: 0, state: 'normal', hasFruit: true } as Tree
    const unrelated = { x: 9, z: 0, state: 'normal', hasFruit: true } as Tree
    const villager = Object.create(Villager.prototype) as unknown as {
      x: number
      z: number
      suggestion: Suggestion | null
      selectHarvestTree(world: World): Tree | null
    }
    Object.assign(villager, {
      x: 9,
      z: 0,
      suggestion: { kind: 'harvest', x: 1.2, z: 0 },
    })
    const world = { trees: [unrelated, intended] } as unknown as World

    expect(villager.selectHarvestTree(world)).toBe(intended)
  })

  it('keeps harvesting the exact chop target when that tree grows fruit', () => {
    const grownTarget = { x: 9, z: 0, state: 'normal', hasFruit: true } as Tree
    const nearerFruit = { x: 1, z: 0, state: 'normal', hasFruit: true } as Tree
    const villager = Object.create(Villager.prototype) as unknown as {
      x: number
      z: number
      suggestion: Suggestion | null
      selectHarvestTree(world: World, preferred?: Tree | null): Tree | null
    }
    Object.assign(villager, { x: 0, z: 0, suggestion: null })
    const world = { trees: [nearerFruit, grownTarget] } as unknown as World

    expect(villager.selectHarvestTree(world, grownTarget)).toBe(grownTarget)
  })

  it('never selects a fruiting tree for a suggested chop', () => {
    const fruiting = { x: 1, z: 0, state: 'normal', hasFruit: true } as Tree
    const bare = { x: 2, z: 0, state: 'normal', hasFruit: false } as Tree
    const villager = Object.create(Villager.prototype) as unknown as {
      x: number
      z: number
      suggestion: Suggestion | null
      selectChopTree(world: World): Tree | null
    }
    Object.assign(villager, {
      x: 9,
      z: 0,
      suggestion: { kind: 'chop', x: 1, z: 0 },
    })
    const world = { trees: [fruiting, bare] } as unknown as World

    expect(villager.selectChopTree(world)).toBe(bare)
  })

  it('clears a suggestion whose required world resource no longer exists', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: Suggestion | null
      targetPond: Pond | null
      normalizeSuggestion(world: World): void
    }
    villager.suggestion = { kind: 'drink', x: 0, z: 0 }
    villager.targetPond = null

    villager.normalizeSuggestion({ ponds: [] } as unknown as World)

    expect(villager.suggestion).toBeNull()
  })

  it('cancels a harvest suggestion when its fruit is gone before pickup', () => {
    const tree = { state: 'normal', hasFruit: false } as Tree
    const villager = activityHarness('harvest')
    villager.suggestion = { kind: 'harvest', x: 0, z: 0 }
    villager.targetTree = tree
    const world = { trees: [tree] } as unknown as World

    villager.performActivity(1 / 30, false, world)

    expect(villager.suggestion).toBeNull()
    expect(villager.enter).toHaveBeenCalledWith('wander', world)
  })

  it('keeps a harvest suggestion while already-picked fruit is being eaten', () => {
    const tree = { x: 0, z: 0, state: 'normal', hasFruit: false } as Tree
    const villager = Object.create(Villager.prototype) as unknown as {
      suggestion: Suggestion | null
      targetTree: Tree | null
      eating: number
      normalizeSuggestion(world: World): void
    }
    Object.assign(villager, {
      suggestion: { kind: 'harvest', x: 0, z: 0 },
      targetTree: null,
      eating: 0.8,
    })
    const world = { trees: [tree] } as unknown as World

    villager.normalizeSuggestion(world)

    expect(villager.suggestion?.kind).toBe('harvest')
  })
})

describe('villager needs', () => {
  it('reserves enough state time to finish drinking after the walk', () => {
    const villager = Object.create(Villager.prototype) as unknown as {
      alive: boolean
      huddleTime: number
      suggestion: null
      zapTime: number
      rainTime: number
      lastQt: number
      arrived: boolean
      timer: number
      state: 'drink'
      thirst: number
      updatePerformance: ReturnType<typeof vi.fn>
      updateFleeTarget: ReturnType<typeof vi.fn>
      steer: ReturnType<typeof vi.fn>
      performActivity: ReturnType<typeof vi.fn>
      update(dt: number, qt: number, world: World, island: never): void
    }
    Object.assign(villager, {
      alive: true,
      huddleTime: 0,
      suggestion: null,
      zapTime: -1,
      rainTime: 0,
      lastQt: 0,
      arrived: false,
      timer: 0,
      state: 'drink',
      thirst: 0,
      updatePerformance: vi.fn(() => false),
      updateFleeTarget: vi.fn(),
      steer: vi.fn(),
      performActivity: vi.fn(),
    })
    const world = {
      nearestBurning: () => null,
      ponds: [],
      graves: [],
      huts: [],
    } as unknown as World

    villager.update(1 / 30, 0, world, {} as never)

    expect(villager.timer).toBeGreaterThan(DRINK_TIME)
  })

  it('resumes interrupted labour after drinking', () => {
    const pond = { x: 0, z: 0 } as Pond
    const villager = activityHarness('drink', pond)
    villager.resumeState = 'buildHut'
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(DRINK_TIME + 0.1, true, world)

    expect(villager.enter).toHaveBeenCalledWith('buildHut', world)
  })

  it('gets thirsty enough to actually stop working', () => {
    expect(THIRST_LIMIT).toBeLessThan(20)
  })
})

describe('harvesting', () => {
  it('switches a targeted chop to harvesting when that tree grows fruit', () => {
    const tree = {
      x: 0,
      z: 0,
      state: 'normal',
      hasFruit: true,
      chop: vi.fn(),
    } as unknown as Tree
    const villager = activityHarness('chopTree')
    villager.suggestion = { kind: 'chop', x: 0, z: 0 }
    villager.targetTree = tree
    const world = { trees: [tree] } as unknown as World

    villager.performActivity(1 / 30, true, world)

    expect(villager.suggestion?.kind).toBe('harvest')
    expect(villager.enter).toHaveBeenCalledWith('harvest', world, null, tree)
    expect(tree.chop).not.toHaveBeenCalled()
  })

  it('clears a harvest suggestion only after the picked fruit is swallowed', () => {
    const emit = vi.fn()
    const villager = activityHarness('harvest')
    villager.bus = { emit } as unknown as EventBus
    villager.suggestion = { kind: 'harvest', x: 0, z: 0 }
    villager.eating = 0.1

    expect(villager.updateHeldFruit(0.05, true)).toBe(false)
    expect(villager.suggestion).not.toBeNull()

    expect(villager.updateHeldFruit(0.05, true)).toBe(true)
    expect(villager.suggestion).toBeNull()
  })

  it('does not let the generic state timer discard fruit during the chew', () => {
    const enter = vi.fn()
    const villager = Object.create(Villager.prototype) as unknown as {
      alive: boolean
      suggestion: null
      huddleTime: number
      zapTime: number
      rainTime: number
      lastQt: number
      state: 'harvest'
      timer: number
      thirst: number
      eating: number
      arrived: boolean
      heldFruit: { visible: boolean }
      normalizeSuggestion: ReturnType<typeof vi.fn>
      updatePerformance: ReturnType<typeof vi.fn>
      updateFleeTarget: ReturnType<typeof vi.fn>
      performActivity: ReturnType<typeof vi.fn>
      context: ReturnType<typeof vi.fn>
      enter: ReturnType<typeof vi.fn>
      update(dt: number, qt: number, world: World, island: never): void
    }
    Object.assign(villager, {
      alive: true,
      suggestion: null,
      huddleTime: 0,
      zapTime: -1,
      rainTime: 0,
      lastQt: 0,
      state: 'harvest',
      timer: 0.05,
      thirst: 0,
      eating: 1.6,
      arrived: true,
      heldFruit: { visible: true },
      normalizeSuggestion: vi.fn(),
      updatePerformance: vi.fn(() => false),
      updateFleeTarget: vi.fn(),
      performActivity: vi.fn(),
      context: vi.fn(() => ({
        state: 'harvest',
        fireNear: false,
        freshGrave: false,
        hasRuin: false,
        hasSite: false,
        hasPond: false,
        hasFishPond: false,
        hasTree: true,
        campfireLit: false,
        needsFire: false,
        hasFruitTree: true,
        fireOut: false,
        suggestion: null,
        rng: new RNG(1),
      })),
      enter,
    })
    const world = {
      nearestBurning: () => null,
      ponds: [],
      graves: [],
      huts: [],
    } as unknown as World

    villager.update(0.1, 0, world, {} as never)

    expect(villager.eating).toBeCloseTo(1.5)
    expect(villager.heldFruit.visible).toBe(true)
    expect(enter).not.toHaveBeenCalled()
  })

  it('carries the fruit before it eats it, and only then is anyone fed', () => {
    const emit = vi.fn()
    const tree = { x: 0, z: 0, state: 'normal', hasFruit: true, pickFruit: vi.fn(() => true) }
    const villager = activityHarness('harvest')
    villager.bus = { emit } as unknown as EventBus
    villager.targetTree = tree as unknown as Tree
    const world = { ponds: [], trees: [tree] } as unknown as World

    villager.performActivity(1.3, true, world)

    expect(tree.pickFruit).toHaveBeenCalledWith(villager.x, villager.z)
    expect(villager.group.getObjectByName('held-fruit')!.visible).toBe(true)
    expect(emit).not.toHaveBeenCalledWith({ type: 'villager:ate' })

    villager.updateHeldFruit(1.6, true)

    expect(emit).toHaveBeenCalledWith({ type: 'villager:ate' })
    expect(villager.group.getObjectByName('held-fruit')!.visible).toBe(false)
  })

  it('keeps a picked fruit alive across an override until the swallow event', () => {
    const emit = vi.fn()
    const villager = activityHarness('harvest')
    villager.state = 'harvest'
    villager.bus = { emit } as unknown as EventBus
    villager.eating = 1.6
    villager.heldFruit.visible = true

    ;(villager as unknown as { state: string }).state = 'flee'
    expect(villager.updateHeldFruit(0.8, true)).toBe(false)
    expect(villager.heldFruit.visible).toBe(true)
    expect(emit).not.toHaveBeenCalledWith({ type: 'villager:ate' })

    expect(villager.updateHeldFruit(0.8, true)).toBe(true)
    expect(villager.heldFruit.visible).toBe(false)
    expect(emit).toHaveBeenCalledWith({ type: 'villager:ate' })
  })
})

describe('drinking', () => {
  it('kneels and dips every frame, not only on the animation tick', () => {
    const pond = { x: 0, z: 0, shoreNear: () => ({ x: 0, z: 0 }) }
    const villager = activityHarness('drink', pond as unknown as Pond)
    const world = { ponds: [pond] } as unknown as World

    villager.performActivity(0.1, true, world)
    expect(villager.model.scale.y).toBeLessThan(MODEL_SCALE)

    villager.model.scale.setScalar(MODEL_SCALE)
    villager.performActivity(0.1, false, world)

    expect(villager.model.scale.y).toBeLessThan(MODEL_SCALE)
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

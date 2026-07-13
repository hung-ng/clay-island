import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import type { Villager } from '../villagers/villager'
import type { Island } from './island'
import type { Campfire, FlowerPatch, Hut, Pond, Tree } from './objects'
import { repopulationHome, World } from './world'

function makeWorld(): World {
  const island = {
    craters: [],
    sampleHeight: () => 0,
    group: { add: vi.fn(), remove: vi.fn() },
  } as unknown as Island
  return new World(island)
}

describe('World targeting', () => {
  it('does not resolve dead villagers as invisible targets', () => {
    const world = makeWorld()
    world.villagers.push({ x: 2, z: 3, alive: false } as Villager)

    expect(world.resolveTarget(2, 3)).toBe('ground')
  })

  it('does not let a destroyed campfire mask a pond created in its crater', () => {
    const world = makeWorld()
    world.campfire = { x: 2, z: 3, scattered: true } as Campfire
    world.ponds.push({ x: 2, z: 3, radius: 2 } as Pond)

    expect(world.resolveTarget(2, 3)).toBe('pond')
  })
})

describe('World impact consequences', () => {
  it('re-grounds standing props after terrain deformation', () => {
    const world = makeWorld()
    world.island.sampleHeight = (x, z) => x - z
    const tree = { x: 3, z: 1, group: { position: { y: 99 } } }
    const hut = { x: -2, z: 1, group: { position: { y: 99 } } }
    const grave = { x: 4, z: -1, group: { position: { y: 99 } } }
    const campfire = { x: 0, z: 2, group: { position: { y: 99 } } }
    world.trees.push(tree as unknown as Tree)
    world.huts.push(hut as unknown as Hut)
    world.graves.push(grave as never)
    world.campfire = campfire as unknown as Campfire

    world.reground()

    expect(tree.group.position.y).toBe(2)
    expect(hut.group.position.y).toBe(-3)
    expect(grave.group.position.y).toBe(5)
    expect(campfire.group.position.y).toBe(-2)
  })

  it.each([
    ['tree', 'setBurnt'],
    ['hut', 'setRuin'],
  ] as const)('destroys the nearest %s and emits its burnt event', (kind, method) => {
    const world = makeWorld()
    const target = { x: 2, z: 3, [method]: vi.fn() }
    const farther = { x: 2.8, z: 3, [method]: vi.fn() }
    if (kind === 'tree') world.trees.push(target as unknown as Tree, farther as unknown as Tree)
    else world.huts.push(target as unknown as Hut, farther as unknown as Hut)
    const events: string[] = []
    world.bus.on(event => events.push(event.type))

    expect(world.destroyTarget(kind, 2, 3)).toBe(true)

    expect(target[method]).toHaveBeenCalledOnce()
    expect(farther[method]).not.toHaveBeenCalled()
    expect(events).toContain('burnt')
  })

  it('kills only the nearest living villager in the impact radius', () => {
    const world = makeWorld()
    const dead = { x: 2, z: 3, alive: false, die: vi.fn() }
    const near = { x: 2.4, z: 3, alive: true, die: vi.fn() }
    const far = { x: 4, z: 3, alive: true, die: vi.fn() }
    world.villagers.push(
      dead as unknown as Villager,
      far as unknown as Villager,
      near as unknown as Villager,
    )

    expect(world.killVillagerNear(2, 3, 3, 'meteor')).toBe(true)

    expect(dead.die).not.toHaveBeenCalled()
    expect(near.die).toHaveBeenCalledWith('meteor')
    expect(far.die).not.toHaveBeenCalled()
  })

  it('removes and disposes an emptied pond so rain can refill its crater', () => {
    const world = makeWorld()
    const pond = { x: 2, z: 3, radius: 2, group: {}, dispose: vi.fn() }
    world.ponds.push(pond as unknown as Pond)
    const events: string[] = []
    world.bus.on(event => events.push(event.type))

    expect(world.emptyPondAt(2, 3)).toBe(true)

    expect(world.ponds).toHaveLength(0)
    expect(world.island.group.remove).toHaveBeenCalledWith(pond.group)
    expect(pond.dispose).toHaveBeenCalledOnce()
    expect(events).toContain('pond:emptied')
  })

  it('delegates a campfire hit to its persistent scattered state', () => {
    const world = makeWorld()
    const campfire = { scatter: vi.fn() }
    world.campfire = campfire as unknown as Campfire

    world.scatterCampfire()

    expect(campfire.scatter).toHaveBeenCalledOnce()
  })

  it('removes and disposes flower patches intersecting a new crater', () => {
    const world = makeWorld()
    const hit = { x: 2, z: 3, radius: 4, group: {}, dispose: vi.fn() }
    const safe = { x: 12, z: 3, radius: 2, group: {}, dispose: vi.fn() }
    world.flowerPatches.push(hit as unknown as FlowerPatch, safe as unknown as FlowerPatch)

    expect(world.clearFlowersNear(2, 3, 2.8)).toBe(1)

    expect(world.flowerPatches).toEqual([safe])
    expect(world.island.group.remove).toHaveBeenCalledWith(hit.group)
    expect(hit.dispose).toHaveBeenCalledOnce()
    expect(safe.dispose).not.toHaveBeenCalled()
  })
})

describe('World restorative consequences', () => {
  it('reuses an existing flower patch instead of stacking identical rain blooms', () => {
    const world = makeWorld()
    const patch = { x: 2, z: 3, radius: 4 }
    world.flowerPatches.push(patch as FlowerPatch)
    const events: string[] = []
    world.bus.on(event => events.push(event.type))

    const result = world.bloomNear(2.5, 3, 4, new RNG(1))

    expect(result).toBe(patch)
    expect(world.flowerPatches).toHaveLength(1)
    expect(events).not.toContain('flower:bloomed')
  })
})

describe('population recovery', () => {
  const built = { state: 'built' } as Hut
  const ruin = { state: 'ruin' } as Hut

  it('uses a built hut whenever one is available', () => {
    expect(repopulationHome(2, [ruin, built])).toBe(built)
  })

  it('uses a ruined hut as a last-resort origin when nobody remains to rebuild', () => {
    expect(repopulationHome(0, [ruin])).toBe(ruin)
  })

  it('waits for living villagers to rebuild rather than spawning from a ruin', () => {
    expect(repopulationHome(1, [ruin])).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import type { Villager } from '../villagers/villager'
import type { Island } from './island'
import type { Campfire, FlowerPatch, Hut, Pond, Tree } from './objects'
import { repopulationHome, World } from './world'

vi.mock('../fx/clayMaterial', async () => {
  const THREE = await import('three')
  return { clayMaterial: vi.fn(() => new THREE.MeshToonMaterial()) }
})

function makeWorld(): World {
  const island = {
    craters: [],
    sampleHeight: () => 0,
    group: { add: vi.fn(), remove: vi.fn() },
  } as unknown as Island
  return new World(island)
}

function floodedWorld(
  craters: { x: number; z: number; radius: number; depth: number }[],
): World {
  const island = {
    craters,
    sampleHeight: (x: number, z: number) => {
      let depth = 0
      for (const crater of craters) {
        const distance = Math.hypot(x - crater.x, z - crater.z) / crater.radius
        if (distance < 1) {
          depth = Math.max(
            depth,
            crater.depth * Math.cos(distance * Math.PI * 0.5) ** 2,
          )
        }
      }
      return -depth
    },
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
    world.ponds.push({ x: 2, z: 3, radius: 2, contains: vi.fn(() => true) } as unknown as Pond)

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
    const pond = {
      x: 2,
      z: 3,
      radius: 2,
      contains: vi.fn(() => true),
      group: {},
      dispose: vi.fn(),
    }
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

describe('World refloodBasins', () => {
  it('spreads an existing lake into a new crater dug beside it', () => {
    const craters = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const world = floodedWorld(craters)
    world.fillCratersNear(0, 0, 10, new RNG(1))
    expect(world.ponds).toHaveLength(1)

    // A meteor digs a second crater overlapping the first. No rain falls.
    craters.push({ x: 4, z: 0, radius: 3, depth: 1.5 })
    world.refloodBasins(new RNG(1))

    // The lake must grow to cover BOTH bowls, not ignore the new hole.
    expect(world.ponds).toHaveLength(1)
    expect(world.ponds[0].basin.craters).toHaveLength(2)
    expect(world.ponds[0].contains(4, 0)).toBe(true)
  })

  it('merges two separate lakes when a crater bridges them', () => {
    const craters = [
      { x: 0, z: 0, radius: 2.5, depth: 1.5 },
      { x: 9, z: 0, radius: 2.5, depth: 1.5 },
    ]
    const world = floodedWorld(craters)
    world.fillCratersNear(0, 0, 20, new RNG(1))
    expect(world.ponds).toHaveLength(2)

    craters.push({ x: 4.5, z: 0, radius: 2.5, depth: 1.5 })
    world.refloodBasins(new RNG(1))

    expect(world.ponds).toHaveLength(1)
    expect(world.ponds[0].basin.craters).toHaveLength(3)
  })

  it('leaves a dry crater dry — water only spreads from water', () => {
    const craters = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const world = floodedWorld(craters)

    // Nothing has ever been flooded, so a new crater stays a dry hole.
    craters.push({ x: 4, z: 0, radius: 3, depth: 1.5 })
    world.refloodBasins(new RNG(1))

    expect(world.ponds).toHaveLength(0)
  })

  it('does not disturb a lake that no new crater touches', () => {
    const craters = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const world = floodedWorld(craters)
    world.fillCratersNear(0, 0, 10, new RNG(1))
    const original = world.ponds[0]

    world.refloodBasins(new RNG(1))

    // Same pond object: unchanged basins are left alone, so fish are not reset.
    expect(world.ponds[0]).toBe(original)
  })
})

describe('World ponds', () => {
  it('makes one pond from two overlapping craters', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ])

    world.fillCratersNear(2, 0, 10, new RNG(1))

    expect(world.ponds).toHaveLength(1)
  })

  it('gives the merged pond one water level', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ])

    world.fillCratersNear(2, 0, 10, new RNG(1))

    expect(world.ponds[0].group.position.y).toBeCloseTo(world.ponds[0].basin.waterLevel)
  })

  it('keeps separate craters as separate ponds', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 2, depth: 1 },
      { x: 9, z: 0, radius: 2, depth: 1 },
    ])

    world.fillCratersNear(0, 0, 20, new RNG(1))

    expect(world.ponds).toHaveLength(2)
  })

  it('does not double-fill an existing basin', () => {
    const world = floodedWorld([{ x: 0, z: 0, radius: 3, depth: 1.5 }])

    world.fillCratersNear(0, 0, 10, new RNG(1))
    world.fillCratersNear(0, 0, 10, new RNG(1))

    expect(world.ponds).toHaveLength(1)
  })

  it('does not call dry ground inside a basin bounding radius a pond', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 2.5, depth: 1.5 },
      { x: 0, z: 3.5, radius: 2.5, depth: 1.5 },
    ])
    world.fillCratersNear(0, 1.75, 12, new RNG(1))

    expect(world.resolveTarget(0, 0)).toBe('pond')
    expect(world.resolveTarget(4, 1.75)).not.toBe('pond')
  })

  it('places a fishing shore outside every overlapping crater', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ])
    world.fillCratersNear(2, 0, 10, new RNG(1))
    const pond = world.ponds[0]

    const shore = pond.shoreNear(2, 0)

    expect(pond.contains(shore.x, shore.z)).toBe(false)
  })
})

describe('World hut relocation', () => {
  it('abandons a ruin that is underwater instead of rebuilding in the lake', () => {
    const crater = { x: 5, z: 0, radius: 3, depth: 1.5 }
    const world = floodedWorld([crater])
    const drowned = { id: 'hut-0', x: 5, z: 0, state: 'ruin', group: { position: { y: 0 } } }
    world.huts.push(drowned as unknown as Hut)
    world.fillCratersNear(5, 0, 10, new RNG(1))

    world.relocateDrownedRuins(new RNG(1))

    expect(drowned.state).toBe('abandoned')
  })

  it('adds a replacement site on dry ground when it abandons a ruin', () => {
    const crater = { x: 5, z: 0, radius: 3, depth: 1.5 }
    const world = floodedWorld([crater])
    world.huts.push(
      { id: 'hut-0', x: 5, z: 0, state: 'ruin', group: { position: { y: 0 } } } as unknown as Hut,
    )
    world.fillCratersNear(5, 0, 10, new RNG(1))

    world.relocateDrownedRuins(new RNG(1))

    const site = world.huts.find(hut => hut.state === 'site')
    expect(site).toBeDefined()
    expect(world.island.sampleHeight(site!.x, site!.z)).toBeGreaterThanOrEqual(0)
  })

  it('leaves a ruin on good dry ground rebuildable', () => {
    const world = floodedWorld([])
    const fine = { id: 'hut-0', x: 5, z: 0, state: 'ruin', group: { position: { y: 0 } } }
    world.huts.push(fine as unknown as Hut)

    world.relocateDrownedRuins(new RNG(1))

    expect(fine.state).toBe('ruin')
  })

  it('never offers an abandoned ruin as a build site', () => {
    const world = floodedWorld([])
    world.huts.push({ id: 'hut-0', x: 5, z: 0, state: 'abandoned' } as unknown as Hut)

    expect(world.buildSite()).toBeNull()
  })
})

describe('World campfire recovery', () => {
  it('reports a missing, doused, or scattered fire as needing recovery', () => {
    const world = makeWorld()
    expect(world.needsFire()).toBe(true)

    world.campfire = { lit: false, scattered: false } as Campfire
    expect(world.needsFire()).toBe(true)

    world.campfire = { lit: true, scattered: true } as Campfire
    expect(world.needsFire()).toBe(true)

    world.campfire = { lit: true, scattered: false } as Campfire
    expect(world.needsFire()).toBe(false)
  })

  it('relights an intact doused fire without replacing it', () => {
    const world = makeWorld()
    const campfire = { lit: false, scattered: false, flare: vi.fn() }
    world.campfire = campfire as unknown as Campfire

    expect(world.rebuildCampfireAt(4, 5, new RNG(1))).toBe(true)

    expect(world.campfire).toBe(campfire)
    expect(campfire.flare).toHaveBeenCalledWith(1.5, 1.4)
  })

  it('replaces and disposes a scattered fire', () => {
    const world = makeWorld()
    const old = { lit: false, scattered: true, group: {}, dispose: vi.fn() }
    world.campfire = old as unknown as Campfire

    world.rebuildCampfireAt(4, 5, new RNG(1))

    expect(world.campfire).not.toBe(old)
    expect(world.campfire.x).toBe(4)
    expect(world.campfire.z).toBe(5)
    expect(world.campfire.lit).toBe(true)
    expect(world.island.group.remove).toHaveBeenCalledWith(old.group)
    expect(old.dispose).toHaveBeenCalledOnce()
    expect(world.island.group.add).toHaveBeenCalledWith(world.campfire.group)
  })

  it('does not replace a scattered fire on ground that became unbuildable', () => {
    const world = floodedWorld([{ x: 4, z: 5, radius: 3, depth: 1.5 }])
    const old = { lit: false, scattered: true, group: {}, dispose: vi.fn() }
    world.campfire = old as unknown as Campfire

    expect(world.rebuildCampfireAt(4, 5, new RNG(1))).toBe(false)

    expect(world.campfire).toBe(old)
    expect(old.dispose).not.toHaveBeenCalled()
    expect(world.island.group.remove).not.toHaveBeenCalled()
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

  it('never respawns from an abandoned ruin', () => {
    const abandoned = { state: 'abandoned' } as Hut
    expect(repopulationHome(0, [abandoned])).toBeNull()
  })

  it('uses a replacement site as the zero-population fallback', () => {
    const abandoned = { state: 'abandoned' } as Hut
    const site = { state: 'site' } as Hut

    expect(repopulationHome(0, [abandoned, site])).toBe(site)
  })
})

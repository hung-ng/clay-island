import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import type { Villager } from '../villagers/villager'
import { MAX_TREES } from './forest'
import type { Island } from './island'
import { Campfire, Hut, Tree, type FlowerPatch, type Pond } from './objects'
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

function addTree(world: World, id: string, x: number, z: number): Tree {
  const tree = new Tree(id, x, z, 0, new RNG(1))
  world.trees.push(tree)
  return tree
}

function addHut(
  world: World,
  id: string,
  x: number,
  z: number,
  state: ConstructorParameters<typeof Hut>[3] = 'built',
): Hut {
  const hut = new Hut(id, x, z, state, 0, new RNG(1))
  world.huts.push(hut)
  return hut
}

function advanceTree(tree: Tree, seconds: number, from = 0): number {
  const step = 1 / 12
  let qt = from
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    qt += step
    tree.update(step, qt)
  }
  return qt
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

  it('removes and disposes the nearest meteor-hit tree', () => {
    const world = makeWorld()
    const target = addTree(world, 'tree-0', 2, 3)
    const farther = addTree(world, 'tree-1', 2.8, 3)
    const dispose = vi.spyOn(target, 'dispose')
    const events: string[] = []
    world.bus.on(event => events.push(event.type))

    expect(world.destroyTarget('tree', 2, 3)).toBe(true)

    expect(world.trees).toEqual([farther])
    expect(target.expired).toBe(true)
    expect(target.state).toBe('normal')
    expect(world.island.group.remove).toHaveBeenCalledWith(target.group)
    expect(dispose).toHaveBeenCalledOnce()
    expect(events).toContain('burnt')
  })

  it('turns the nearest meteor-hit hut into a ruin', () => {
    const world = makeWorld()
    const target = { x: 2, z: 3, setRuin: vi.fn() }
    const farther = { x: 2.8, z: 3, setRuin: vi.fn() }
    world.huts.push(target as unknown as Hut, farther as unknown as Hut)

    expect(world.destroyTarget('hut', 2, 3)).toBe(true)

    expect(target.setRuin).toHaveBeenCalledOnce()
    expect(farther.setRuin).not.toHaveBeenCalled()
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
    craters.push({ x: 3, z: 0, radius: 3, depth: 1.5 })
    world.refloodBasins(new RNG(1))

    // The lake must grow to cover BOTH bowls, not ignore the new hole.
    expect(world.ponds).toHaveLength(1)
    expect(world.ponds[0].basin.craters).toHaveLength(2)
    expect(world.ponds[0].contains(3, 0)).toBe(true)
  })

  it('merges two separate lakes when a crater bridges them', () => {
    const craters = [
      { x: 0, z: 0, radius: 2.5, depth: 1.5 },
      { x: 6, z: 0, radius: 2.5, depth: 1.5 },
    ]
    const world = floodedWorld(craters)
    world.fillCratersNear(0, 0, 20, new RNG(1))
    expect(world.ponds).toHaveLength(2)

    craters.push({ x: 3, z: 0, radius: 2.5, depth: 1.5 })
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
  it('reports flooded ground as submerged and measures its depth', () => {
    const world = floodedWorld([{ x: 0, z: 0, radius: 3, depth: 1.5 }])
    world.fillCratersNear(0, 0, 10, new RNG(1))

    expect(world.submerged(0, 0)).toBe(true)
    expect(world.waterDepthAt(0, 0)).toBeGreaterThan(0)
    expect(world.submerged(10, 10)).toBe(false)
    expect(world.waterDepthAt(10, 10)).toBe(0)
  })

  it('makes one pond from two craters joined below the waterline', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 3, z: 0, radius: 3, depth: 1.5 },
    ])

    world.fillCratersNear(1.5, 0, 10, new RNG(1))

    expect(world.ponds).toHaveLength(1)
  })

  it('does not carry rain across a dry saddle between overlapping crater rims', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ])

    world.fillCratersNear(0, 0, 0.5, new RNG(1))

    expect(world.ponds).toHaveLength(1)
    expect(world.ponds[0].basin.craters).toEqual([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
    ])
    expect(world.ponds[0].contains(4, 0)).toBe(false)
  })

  it('gives the merged pond one water level', () => {
    const world = floodedWorld([
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 3, z: 0, radius: 3, depth: 1.5 },
    ])

    world.fillCratersNear(1.5, 0, 10, new RNG(1))

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

  it('does not add a replacement site until a villager claims the work', () => {
    const crater = { x: 5, z: 0, radius: 3, depth: 1.5 }
    const world = floodedWorld([crater])
    const drowned = {
      id: 'hut-0', x: 5, z: 0, state: 'ruin', group: { position: { y: 0 } }, dispose: vi.fn(),
    }
    world.huts.push(drowned as unknown as Hut)
    world.fillCratersNear(5, 0, 10, new RNG(1))

    world.relocateDrownedRuins(new RNG(1))

    expect(drowned.state).toBe('abandoned')
    expect(world.huts).toEqual([drowned])
    expect(world.huts.some(hut => hut.state === 'site')).toBe(false)
    expect(drowned.dispose).not.toHaveBeenCalled()
  })

  it('leaves a ruin on good dry ground rebuildable', () => {
    const world = floodedWorld([])
    const fine = { id: 'hut-0', x: 5, z: 0, state: 'ruin', group: { position: { y: 0 } } }
    world.huts.push(fine as unknown as Hut)

    world.relocateDrownedRuins(new RNG(1))

    expect(fine.state).toBe('ruin')
  })

  it('reserves replacement ground invisibly, then reveals it when building starts', () => {
    const world = floodedWorld([])
    const abandoned = {
      id: 'hut-0', x: 5, z: 0, state: 'abandoned', group: {}, dispose: vi.fn(),
    }
    world.huts.push(abandoned as unknown as Hut)
    vi.spyOn(world, 'findBuildSite').mockReturnValue({ x: -4, z: 2 })

    const site = world.claimBuildSite(new RNG(1))

    expect(site?.state).toBe('site')
    expect(world.claimBuildSite(new RNG(2))).toBe(site)
    expect(world.huts).toEqual([abandoned])
    expect(world.groundQuery().occupied).toContain(site)
    expect(world.island.group.remove).not.toHaveBeenCalled()
    expect(world.island.group.add).not.toHaveBeenCalled()
    expect(abandoned.dispose).not.toHaveBeenCalled()

    expect(world.commitBuildSite(site!)).toBe(true)
    expect(world.huts).toEqual([site])
    expect(world.island.group.remove).toHaveBeenCalledWith(abandoned.group)
    expect(abandoned.dispose).toHaveBeenCalledOnce()
    expect(world.island.group.add).toHaveBeenCalledWith(site?.group)
  })

  it('cancels an invalidated hut reservation without removing abandoned stones', () => {
    const world = floodedWorld([])
    const abandoned = {
      id: 'hut-0', x: 5, z: 0, state: 'abandoned', group: {}, dispose: vi.fn(),
    }
    world.huts.push(abandoned as unknown as Hut)
    vi.spyOn(world, 'findBuildSite').mockReturnValue({ x: -4, z: 2 })
    const site = world.claimBuildSite(new RNG(1))!
    const dispose = vi.spyOn(site, 'dispose')
    world.island.craters.push({ x: -4, z: 2, radius: 1, depth: 1 })

    expect(world.commitBuildSite(site)).toBe(false)

    expect(world.huts).toEqual([abandoned])
    expect(abandoned.dispose).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
    expect(world.island.group.remove).not.toHaveBeenCalled()
    expect(world.island.group.add).not.toHaveBeenCalled()
  })

  it('keeps abandoned stones when no valid replacement ground exists', () => {
    const world = floodedWorld([])
    const abandoned = {
      id: 'hut-0', x: 5, z: 0, state: 'abandoned', group: {}, dispose: vi.fn(),
    }
    world.huts.push(abandoned as unknown as Hut)
    vi.spyOn(world, 'findBuildSite').mockReturnValue(null)

    expect(world.claimBuildSite(new RNG(1))).toBeNull()
    expect(world.huts).toEqual([abandoned])
    expect(abandoned.dispose).not.toHaveBeenCalled()
  })

  it('reports abandoned stones as deferred hut work', () => {
    const world = floodedWorld([])
    world.huts.push({ state: 'abandoned' } as Hut)

    expect(world.hasHutWork()).toBe(true)
  })
})

describe('World campfire recovery', () => {
  it('scatters a doused campfire when its ground becomes submerged', () => {
    const crater = { x: 5, z: 0, radius: 3, depth: 1.5 }
    const world = floodedWorld([crater])
    const campfire = new Campfire(5, 0, -1.5, new RNG(1), false, 'doused')
    world.campfire = campfire
    world.fillCratersNear(5, 0, 10, new RNG(1))

    expect(world.ponds[0].contains(campfire.x, campfire.z)).toBe(true)

    world.relocateDrownedRuins(new RNG(1))

    expect(campfire.state).toBe('scattered')
  })

  it('needs work for every state except lit', () => {
    const world = makeWorld()
    expect(world.needsFire()).toBe(true)

    for (const state of ['site', 'building', 'doused', 'scattered'] as const) {
      world.campfire = new Campfire(0, 0, 0, new RNG(1), false, state)
      expect(world.needsFire()).toBe(true)
    }

    world.campfire = new Campfire(0, 0, 0, new RNG(1), false, 'lit')
    expect(world.needsFire()).toBe(false)
  })

  it('relights an intact doused fire without replacing it', () => {
    const world = makeWorld()
    const campfire = new Campfire(0, 0, 0, new RNG(1), false, 'doused')
    const flare = vi.spyOn(campfire, 'flare')
    world.campfire = campfire as unknown as Campfire

    expect(world.rebuildCampfireAt(4, 5, new RNG(1))).toBe(true)

    expect(world.campfire).toBe(campfire)
    expect(flare).toHaveBeenCalledWith(1.5, 1.4)
    expect(campfire.state).toBe('lit')
  })

  it('reserves a site invisibly, then reveals it when campfire building starts', () => {
    const world = makeWorld()
    const old = new Campfire(0, 0, 0, new RNG(1), false, 'lit')
    old.scatter()
    const dispose = vi.spyOn(old, 'dispose')
    world.campfire = old
    vi.spyOn(world, 'findBuildSite').mockReturnValue({ x: 4, z: 5 })

    const site = world.claimCampfireSite(new RNG(1))

    expect(site?.state).toBe('site')
    expect(site?.x).toBe(4)
    expect(site?.z).toBe(5)
    expect(world.claimCampfireSite(new RNG(2))).toBe(site)
    expect(world.campfire).toBe(old)
    expect(world.groundQuery().occupied).toContain(site)
    expect(world.isCampfireBuildTarget(site!)).toBe(true)
    expect(world.island.group.remove).not.toHaveBeenCalled()
    expect(world.island.group.add).not.toHaveBeenCalled()
    expect(dispose).not.toHaveBeenCalled()

    expect(world.commitCampfireSite(site!)).toBe(true)
    expect(world.campfire).toBe(site)
    expect(world.island.group.remove).toHaveBeenCalledWith(old.group)
    expect(dispose).toHaveBeenCalledOnce()
    expect(world.island.group.add).toHaveBeenCalledWith(world.campfire.group)
  })

  it('cancels an invalidated campfire reservation without removing scattered remains', () => {
    const world = makeWorld()
    const old = new Campfire(0, 0, 0, new RNG(1))
    old.scatter()
    const oldDispose = vi.spyOn(old, 'dispose')
    world.campfire = old
    vi.spyOn(world, 'findBuildSite').mockReturnValue({ x: 4, z: 5 })
    const site = world.claimCampfireSite(new RNG(1))!
    const siteDispose = vi.spyOn(site, 'dispose')
    world.island.craters.push({ x: 4, z: 5, radius: 1, depth: 1 })

    expect(world.commitCampfireSite(site)).toBe(false)

    expect(world.campfire).toBe(old)
    expect(oldDispose).not.toHaveBeenCalled()
    expect(siteDispose).toHaveBeenCalledOnce()
    expect(world.island.group.remove).not.toHaveBeenCalled()
    expect(world.island.group.add).not.toHaveBeenCalled()
  })

  it('keeps scattered remains when no valid replacement ground exists', () => {
    const world = makeWorld()
    const old = new Campfire(0, 0, 0, new RNG(1))
    old.scatter()
    const dispose = vi.spyOn(old, 'dispose')
    world.campfire = old
    vi.spyOn(world, 'findBuildSite').mockReturnValue(null)

    expect(world.claimCampfireSite(new RNG(1))).toBeNull()

    expect(world.campfire).toBe(old)
    expect(dispose).not.toHaveBeenCalled()
    expect(world.island.group.remove).not.toHaveBeenCalled()
  })

  it('reserves and reveals a site on demand when the campfire is missing', () => {
    const world = makeWorld()
    vi.spyOn(world, 'findBuildSite').mockReturnValue({ x: 3, z: -2 })

    const site = world.claimCampfireSite(new RNG(1))

    expect(site?.state).toBe('site')
    expect(world.campfire).toBeUndefined()
    expect(world.commitCampfireSite(site!)).toBe(true)
    expect(world.campfire).toBe(site)
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

  it('uses abandoned stones as the zero-population mercy origin', () => {
    const abandoned = { state: 'abandoned' } as Hut
    expect(repopulationHome(0, [abandoned])).toBe(abandoned)
  })

  it('uses a replacement site as the zero-population fallback', () => {
    const abandoned = { state: 'abandoned' } as Hut
    const site = { state: 'site' } as Hut

    expect(repopulationHome(0, [abandoned, site])).toBe(site)
  })
})

describe('housing caps the population', () => {
  it('houses two villagers per built hut', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0)
    addHut(world, 'hut-1', 3, 0)

    expect(world.capacity()).toBe(4)
  })

  it('does not count sites, ruins, or abandoned huts', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0, 'built')
    addHut(world, 'hut-1', 3, 0, 'ruin')
    addHut(world, 'hut-2', 6, 0, 'abandoned')
    addHut(world, 'hut-3', 9, 0, 'site')

    expect(world.capacity()).toBe(2)
  })

  it('never houses more than twelve', () => {
    const world = makeWorld()
    for (let i = 0; i < 8; i++) addHut(world, `hut-${i}`, i * 3, 0)

    expect(world.capacity()).toBe(12)
  })

  it('keeps an over-capacity population stable and admits nobody new', () => {
    const world = makeWorld()
    addHut(world, 'hut-0', 0, 0)
    world.villagers = [
      { alive: true }, { alive: true }, { alive: true }, { alive: true },
    ] as Villager[]

    world.repopulate(60, new RNG(1))

    expect(world.living()).toBe(4)
    expect(world.villagers).toHaveLength(4)
  })
})

describe('World suggestions and village growth', () => {
  it('suggests to only the two nearest idle villagers', () => {
    const world = makeWorld()
    const villagers = [
      { alive: true, x: 5, z: 0, canBeNudged: () => true, suggest: vi.fn() },
      { alive: true, x: 1, z: 0, canBeNudged: () => true, suggest: vi.fn() },
      { alive: true, x: 2, z: 0, canBeNudged: () => true, suggest: vi.fn() },
      { alive: true, x: 0.5, z: 0, canBeNudged: () => false, suggest: vi.fn() },
    ]
    world.villagers = villagers as unknown as Villager[]

    expect(world.suggest(0, 0, 'chop')).toBe(2)

    expect(villagers[1].suggest).toHaveBeenCalledWith({ kind: 'chop', x: 0, z: 0, ttl: 6 })
    expect(villagers[2].suggest).toHaveBeenCalledWith({ kind: 'chop', x: 0, z: 0, ttl: 6 })
    expect(villagers[0].suggest).not.toHaveBeenCalled()
    expect(villagers[3].suggest).not.toHaveBeenCalled()
  })

  it('founds a buildable hut site and emits village growth', () => {
    const world = makeWorld()
    const events: string[] = []
    world.bus.on(event => events.push(event.type))

    const hut = world.foundHutAt(4, 0, new RNG(1))

    expect(hut?.state).toBe('site')
    expect(world.huts).toContain(hut)
    expect(world.island.group.add).toHaveBeenCalledWith(hut?.group)
    expect(events).toContain('village:grew')
  })
})

describe('World forest', () => {
  it('a STUMP is not fuel — a clearing of stumps is not a tinderbox', () => {
    const world = makeWorld()
    const stump = addTree(world, 'tree-0', 0, 0)
    stump.chop()
    advanceTree(stump, 33)
    const alight = addTree(world, 'tree-1', 1, 0)
    alight.ignite()

    const flammables = (world as unknown as {
      flammables(): Array<{ id: string }>
    }).flammables()
    expect(flammables.map(item => item.id)).not.toContain(stump.id)
    expect(flammables.map(item => item.id)).toContain(alight.id)

    for (let i = 0; i < 200; i++) world.updateFire(1 / 12, new RNG(i))

    expect(stump.state).toBe('stump')
    expect(stump.burning).toBe(false)
  })

  it('bridges a spread ignition into the tree visual lifecycle', () => {
    const world = makeWorld()
    const source = addTree(world, 'tree-0', 0, 0)
    const target = addTree(world, 'tree-1', 1, 0)
    source.ignite()

    world.updateFire(1, { chance: () => true } as unknown as RNG)

    expect(target.burning).toBe(true)
    expect(target.state).toBe('burning')
    expect(target.group.getObjectByName('burning-fx')?.visible).toBe(true)
  })

  it('grows a sapling when the forest is below the cap', () => {
    const world = makeWorld()
    addTree(world, 'tree-0', 0, 0)

    for (let i = 0; i < 60; i++) world.reseedForest(1, new RNG(2), false)

    expect(world.trees.length).toBeGreaterThan(1)
    expect(world.trees.some(tree => tree.state === 'sapling')).toBe(true)
  })

  it('stops at MAX_TREES', () => {
    const world = makeWorld()
    for (let i = 0; i < MAX_TREES; i++) addTree(world, `tree-${i}`, i - 6, 0)

    for (let i = 0; i < 200; i++) world.reseedForest(1, new RNG(3), false)

    expect(world.livingTrees()).toHaveLength(MAX_TREES)
  })

  it('does NOT count stumps toward the cap — a cleared island regrows', () => {
    const world = makeWorld()
    for (let i = 0; i < MAX_TREES; i++) {
      const stump = addTree(world, `tree-${i}`, i - 6, 0)
      stump.chop()
      advanceTree(stump, 33)
    }

    for (let i = 0; i < 60; i++) world.reseedForest(1, new RNG(4), false)

    expect(world.livingTrees().length).toBeGreaterThan(0)
  })

  it('a meteor annihilates a tree and leaves no wooden remnant', () => {
    const world = makeWorld()
    const tree = addTree(world, 'tree-0', 2, 2)

    world.destroyTarget('tree', 2, 2)

    expect(world.trees).not.toContain(tree)
    expect(tree.expired).toBe(true)
    expect(tree.state).toBe('normal')
  })

  it('lightning uses the same upright burn as spreading fire', () => {
    const world = makeWorld()
    const tree = addTree(world, 'tree-0', 2, 2)

    world.igniteTarget('tree', 2, 2)

    expect(tree.burning).toBe(true)
    expect(tree.state).toBe('burning')
  })

  it('removes an expired temporary remnant from the registry and scene', () => {
    const world = makeWorld()
    const tree = addTree(world, 'tree-0', 2, 2)
    const dispose = vi.spyOn(tree, 'dispose')
    tree.ignite()
    tree.setBurnt()

    for (let i = 0; i < 34 * 12; i++) world.updateTrees(1 / 12, i / 12)

    expect(world.trees).not.toContain(tree)
    expect(world.island.group.remove).toHaveBeenCalledWith(tree.group)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('removes an expired chopped stump and frees its occupied ground', () => {
    const world = makeWorld()
    const tree = addTree(world, 'tree-0', 2, 2)
    const dispose = vi.spyOn(tree, 'dispose')
    tree.chop()

    expect(world.groundQuery().occupied).toContain(tree)
    for (let i = 0; i < 66 * 12; i++) world.updateTrees(1 / 12, i / 12)

    expect(world.trees).not.toContain(tree)
    expect(world.groundQuery().occupied).not.toContain(tree)
    expect(world.island.group.remove).toHaveBeenCalledWith(tree.group)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('a hut ignited by lightning burns upright', () => {
    const world = makeWorld()
    const hut = new Hut('hut-0', 3, 3, 'built', 0, new RNG(1))
    world.huts.push(hut)

    world.igniteTarget('hut', 3, 3)

    expect(hut.state).toBe('burning')
  })
})

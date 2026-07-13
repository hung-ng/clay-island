import { describe, expect, it } from 'vitest'
import { RNG } from '../core/rng'
import { FIRE_CONFIG, FireSystem, type Flammable } from './fire'
import { placeSites } from './scatter'

function item(
  id: string,
  x: number,
  z: number,
  overrides: Partial<Flammable> = {},
): Flammable {
  return {
    id,
    x,
    z,
    kind: 'tree',
    burning: false,
    burnt: false,
    burnTime: 0,
    ...overrides,
  }
}

function simulate(
  system: FireSystem,
  items: Flammable[],
  rng: RNG,
  seconds: number,
  dt = 1 / 30,
): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) system.update(dt, items, rng)
}

describe('FireSystem', () => {
  it('spreads to a neighbour within radius, given enough time', () => {
    const system = new FireSystem()
    const items = [
      item('source', 0, 0, { burning: true }),
      item('neighbour', 2, 0),
    ]

    simulate(system, items, new RNG(1), 10)

    expect(items[1].burning || items[1].burnt).toBe(true)
  })

  it('never spreads beyond spreadRadius', () => {
    const system = new FireSystem()
    const items = [
      item('source', 0, 0, { burning: true }),
      item('distant', FIRE_CONFIG.spreadRadius + 0.01, 0),
    ]

    simulate(system, items, new RNG(1), 60)

    expect(items[1]).toMatchObject({ burning: false, burnt: false, burnTime: 0 })
  })

  it('burns a tree out after burnSeconds', () => {
    const system = new FireSystem()
    const tree = item('tree', 0, 0, { burning: true })

    const events = system.update(FIRE_CONFIG.burnSeconds, [tree], new RNG(1))

    expect(tree).toMatchObject({ burning: false, burnt: true })
    expect(events).toEqual([{ type: 'burnt', id: 'tree', kind: 'tree' }])
  })

  it('uses the longer hut burn duration', () => {
    const system = new FireSystem()
    const hut = item('hut', 0, 0, { kind: 'hut', burning: true })

    system.update(FIRE_CONFIG.burnSeconds, [hut], new RNG(1))
    expect(hut.burning).toBe(true)
    system.update(FIRE_CONFIG.hutBurnSeconds - FIRE_CONFIG.burnSeconds, [hut], new RNG(1))

    expect(hut).toMatchObject({ burning: false, burnt: true })
  })

  it('does not re-ignite something already burnt', () => {
    const system = new FireSystem()
    const items = [
      item('source', 0, 0, { burning: true }),
      item('burnt', 2, 0, { burnt: true, burnTime: FIRE_CONFIG.burnSeconds }),
    ]

    simulate(system, items, new RNG(2), 10)

    expect(items[1]).toMatchObject({ burning: false, burnt: true })
  })

  it('cannot spread from a burnt item', () => {
    const system = new FireSystem()
    const items = [
      item('burnt-source', 0, 0, { burnt: true, burnTime: FIRE_CONFIG.burnSeconds }),
      item('healthy', 2, 0),
    ]

    simulate(system, items, new RNG(3), 60)

    expect(items[1]).toMatchObject({ burning: false, burnt: false })
  })

  it('douses burning items in range and leaves burnt items burnt', () => {
    const system = new FireSystem()
    const items = [
      item('near', 2, 0, { burning: true, burnTime: 3 }),
      item('far', FIRE_CONFIG.douseRadius + 0.1, 0, { burning: true, burnTime: 3 }),
      item('burnt', 1, 0, { burnt: true, burnTime: FIRE_CONFIG.burnSeconds }),
    ]

    const events = system.douse(0, 0, items)

    expect(items[0]).toMatchObject({ burning: false, burnt: false, burnTime: 0 })
    expect(items[1].burning).toBe(true)
    expect(items[2]).toMatchObject({ burning: false, burnt: true })
    expect(events).toEqual([{ type: 'doused', id: 'near', kind: 'tree' }])
  })

  it('never burns a campfire out', () => {
    const system = new FireSystem()
    const campfire = item('campfire', 0, 0, { kind: 'campfire', burning: true })

    system.update(120, [campfire], new RNG(1))

    expect(campfire).toMatchObject({ burning: true, burnt: false, burnTime: 0 })
  })

  it('is deterministic for a fixed seed', () => {
    function run(): { events: unknown[]; states: Flammable[] } {
      const system = new FireSystem()
      const items = [
        item('a', 0, 0, { burning: true }),
        item('b', 2.6, 0),
        item('c', 5.2, 0),
      ]
      const rng = new RNG(41)
      const events: unknown[] = []
      for (let i = 0; i < 20 * 30; i++) events.push(...system.update(1 / 30, items, rng))
      return { events, states: items }
    }

    expect(run()).toEqual(run())
  })

  it('cannot burn the whole default island from one tree in 60 seconds', () => {
    const trees = placeSites(new RNG(7))
      .filter(placement => placement.kind === 'tree')
      .map((placement, index) => item(`tree-${index}`, placement.x, placement.z))
    trees[0].burning = true

    simulate(new FireSystem(), trees, new RNG(7), 60)

    expect(trees.filter(tree => !tree.burning && !tree.burnt).length).toBeGreaterThanOrEqual(3)
  })
})

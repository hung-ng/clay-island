import { RNG } from '../core/rng'
import { Villager } from '../villagers/villager'
import type { InitialWorldBlueprint } from './blueprint'
import { Island } from './island'
import { Campfire, Hut, Tree } from './objects'
import { World } from './world'

export type GameplayWorldSet = { island: Island; world: World }

export function buildInitialWorld(
  blueprint: InitialWorldBlueprint,
  lowFx: boolean,
): GameplayWorldSet {
  const island = new Island(new RNG(blueprint.islandSeed))
  island.group.name = 'gameplay-island'
  const world = new World(island)

  for (const spec of blueprint.props) {
    const y = island.sampleHeight(spec.x, spec.z)
    if (spec.kind === 'tree') {
      const tree = new Tree(spec.id, spec.x, spec.z, y, new RNG(spec.visualSeed), lowFx)
      tree.group.name = spec.id
      world.trees.push(tree)
      island.group.add(tree.group)
    } else if (spec.kind === 'hut') {
      const hut = new Hut(spec.id, spec.x, spec.z, spec.state, y, new RNG(spec.visualSeed), lowFx)
      hut.group.name = spec.id
      world.huts.push(hut)
      island.group.add(hut.group)
    } else {
      const fire = new Campfire(spec.x, spec.z, y, new RNG(spec.visualSeed), lowFx, spec.state)
      fire.group.name = spec.id
      world.campfire = fire
      island.group.add(fire.group)
    }
  }

  for (const spec of blueprint.villagers) {
    const person = new Villager(
      spec.id,
      spec.x,
      spec.z,
      island,
      new RNG(spec.behaviorSeed),
      world,
      world.bus,
      { lowFx, visualSeed: spec.visualSeed },
    )
    person.group.name = spec.id
    person.group.rotation.y = spec.facing
    world.villagers.push(person)
    island.group.add(person.group)
  }

  return { island, world }
}

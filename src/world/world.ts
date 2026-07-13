import { EventBus, type TargetKind } from '../core/events'
import { RNG } from '../core/rng'
import { Villager, spawnVillagers } from '../villagers/villager'
import { craterAt } from './craters'
import { Island } from './island'
import { Campfire, Hut, Tree } from './objects'
import { placeSites } from './scatter'

type Position = { x: number; z: number }
type PondShape = Position & { radius: number }

function hasPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Position>
  return typeof candidate.x === 'number' && typeof candidate.z === 'number'
}

function isPondShape(value: unknown): value is PondShape {
  if (!hasPosition(value)) return false
  return typeof (value as Partial<PondShape>).radius === 'number'
}

function within(a: Position, x: number, z: number, radius: number): boolean {
  return Math.hypot(a.x - x, a.z - z) <= radius
}

export class World {
  trees: Tree[] = []
  huts: Hut[] = []
  campfire!: Campfire
  graves: unknown[] = []
  ponds: unknown[] = []
  villagers: Villager[] = []
  private repopulateTimer: number | null = null

  constructor(public island: Island, public bus = new EventBus()) {}

  choppableTree(): Tree | null {
    return this.trees.find(tree => tree.state === 'normal') ?? null
  }

  buildSite(): Hut | null {
    return this.huts.find(hut => hut.state === 'site' || hut.state === 'building' || hut.state === 'ruin') ?? null
  }

  nearestBurning(x: number, z: number, radius: number): Position | null {
    let nearest: Position | null = null
    let nearestDistance = radius
    const burning: Array<Tree | Hut> = [
      ...this.trees.filter(tree => tree.state === 'burning'),
      ...this.huts.filter(hut => hut.state === 'burning'),
    ]
    for (const object of burning) {
      const distance = Math.hypot(object.x - x, object.z - z)
      if (distance <= nearestDistance) {
        nearest = { x: object.x, z: object.z }
        nearestDistance = distance
      }
    }
    return nearest
  }

  resolveTarget(x: number, z: number): TargetKind {
    if (this.villagers.some(villager => hasPosition(villager) && within(villager, x, z, 1))) return 'villager'
    if (this.trees.some(tree => within(tree, x, z, 1.2))) return 'tree'
    if (this.huts.some(hut => within(hut, x, z, 1.6))) return 'hut'
    if (this.campfire && within(this.campfire, x, z, 1.5)) return 'campfire'
    if (this.ponds.some(pond => isPondShape(pond) && within(pond, x, z, pond.radius))) return 'pond'
    if (craterAt(x, z, this.island.craters)) return 'crater'
    return 'ground'
  }

  objectsNear(x: number, z: number, radius: number): Array<Tree | Hut | Campfire> {
    const objects: Array<Tree | Hut | Campfire> = [...this.trees, ...this.huts]
    if (this.campfire) objects.push(this.campfire)
    return objects.filter(object => within(object, x, z, radius))
  }

  alarmNear(x: number, z: number, radius: number): void {
    for (const villager of this.villagers) {
      if (villager.alive && within(villager, x, z, radius)) villager.panic({ x, z })
    }
  }

  repopulate(dt: number, rng: RNG, lowFx = false): void {
    const living = this.villagers.filter(villager => villager.alive).length
    if (living >= 6) {
      this.repopulateTimer = null
      return
    }

    const hut = this.huts.find(candidate => candidate.state === 'built')
    if (!hut) return
    if (this.repopulateTimer === null) this.repopulateTimer = rng.range(20, 30)
    this.repopulateTimer -= dt
    if (this.repopulateTimer > 0) return

    spawnVillagers(this, this.island, rng, 1, {
      lowFx,
      origin: { x: hut.x, z: hut.z },
      animateIn: true,
    })
    this.repopulateTimer = null
  }
}

export function scatter(world: World, island: Island, rng: RNG, lowFx = false): void {
  let treeIndex = 0
  let hutIndex = 0
  for (const placement of placeSites(rng)) {
    const y = island.sampleHeight(placement.x, placement.z)
    if (placement.kind === 'tree') {
      const tree = new Tree(`tree-${treeIndex++}`, placement.x, placement.z, y, rng, lowFx)
      world.trees.push(tree)
      island.group.add(tree.group)
      continue
    }
    if (placement.kind === 'hut' || placement.kind === 'site') {
      const hut = new Hut(
        `hut-${hutIndex++}`,
        placement.x,
        placement.z,
        placement.kind === 'site' ? 'site' : 'built',
        y,
        rng,
        lowFx,
      )
      world.huts.push(hut)
      island.group.add(hut.group)
      continue
    }
    const campfire = new Campfire(placement.x, placement.z, y, rng, lowFx)
    world.campfire = campfire
    island.group.add(campfire.group)
  }
}

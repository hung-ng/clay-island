import { EventBus, type TargetKind } from '../core/events'
import { RNG } from '../core/rng'
import { Villager, spawnVillagers } from '../villagers/villager'
import { craterAt } from './craters'
import { FIRE_CONFIG, FireSystem, type FireEvent, type Flammable } from './fire'
import { Island } from './island'
import { Campfire, FlowerPatch, Grave, Hut, Pond, Tree } from './objects'
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

export function repopulationHome(living: number, huts: Hut[]): Hut | null {
  const built = huts.find(hut => hut.state === 'built')
  if (built) return built
  return living === 0 ? huts[0] ?? null : null
}

export class World {
  trees: Tree[] = []
  huts: Hut[] = []
  campfire!: Campfire
  graves: Grave[] = []
  ponds: Pond[] = []
  flowerPatches: FlowerPatch[] = []
  villagers: Villager[] = []
  private repopulateTimer: number | null = null
  private fireSystem = new FireSystem()

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
    const burning: Array<Tree | Hut | Campfire> = [
      ...this.trees.filter(tree => tree.burning),
      ...this.huts.filter(hut => hut.burning),
    ]
    if (this.campfire?.burning) burning.push(this.campfire)
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
    if (this.villagers.some(villager => villager.alive && within(villager, x, z, 1))) return 'villager'
    if (this.trees.some(tree => within(tree, x, z, 1.2))) return 'tree'
    if (this.huts.some(hut => within(hut, x, z, 1.6))) return 'hut'
    if (this.campfire && !this.campfire.scattered && within(this.campfire, x, z, 1.5)) return 'campfire'
    if (this.ponds.some(pond => isPondShape(pond) && within(pond, x, z, pond.radius))) return 'pond'
    if (craterAt(x, z, this.island.craters)) return 'crater'
    return 'ground'
  }

  villagerAt(x: number, z: number, radius = 1): Villager | null {
    return this.villagers
      .filter(villager => villager.alive && within(villager, x, z, radius))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null
  }

  pondAt(x: number, z: number): Pond | null {
    return this.ponds.find(pond => within(pond, x, z, pond.radius)) ?? null
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

  igniteNear(x: number, z: number, radius: number, rng: RNG, chance: number): void {
    const candidates: Array<Tree | Hut | Campfire> = [...this.trees, ...this.huts]
    if (this.campfire) candidates.push(this.campfire)
    for (const object of candidates) {
      if (!within(object, x, z, radius) || !rng.chance(chance)) continue
      const wasBurning = object.burning
      object.ignite()
      if (!wasBurning && object.burning) {
        this.bus.emit({
          type: 'fire:ignited',
          kind: object.kind,
          bySpread: false,
          burning: this.burningCount(),
        })
      }
    }
  }

  igniteTarget(kind: 'tree' | 'hut', x: number, z: number): void {
    const candidates: Array<Tree | Hut> = kind === 'tree' ? this.trees : this.huts
    const object = candidates
      .filter(candidate => within(candidate, x, z, kind === 'tree' ? 1.3 : 1.8))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]
    if (!object) return
    const wasBurning = object.burning
    object.ignite()
    if (wasBurning || !object.burning) return
    this.bus.emit({
      type: 'fire:ignited', kind: object.kind, bySpread: false, burning: this.burningCount(),
    })
    this.alarmNear(object.x, object.z, 7)
  }

  destroyTarget(kind: 'tree' | 'hut', x: number, z: number): boolean {
    const radius = kind === 'tree' ? 1.3 : 1.8
    if (kind === 'tree') {
      const tree = this.trees
        .filter(candidate => within(candidate, x, z, radius))
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]
      if (!tree) return false
      tree.setBurnt()
      this.bus.emit({ type: 'burnt', kind: 'tree' })
      return true
    }

    const hut = this.huts
      .filter(candidate => within(candidate, x, z, radius))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]
    if (!hut) return false
    hut.setRuin()
    this.bus.emit({ type: 'burnt', kind: 'hut' })
    return true
  }

  killVillagerNear(
    x: number,
    z: number,
    radius: number,
    cause: Parameters<Villager['die']>[0],
  ): boolean {
    const villager = this.villagerAt(x, z, radius)
    if (!villager) return false
    villager.die(cause)
    return true
  }

  emptyPondAt(x: number, z: number): boolean {
    const pond = this.pondAt(x, z)
    if (!pond) return false
    this.ponds.splice(this.ponds.indexOf(pond), 1)
    this.island.group.remove(pond.group)
    pond.dispose()
    this.bus.emit({ type: 'pond:emptied' })
    return true
  }

  scatterCampfire(): void {
    this.campfire.scatter()
  }

  clearFlowersNear(x: number, z: number, radius: number): number {
    let removed = 0
    this.flowerPatches = this.flowerPatches.filter((patch) => {
      if (!within(patch, x, z, patch.radius + radius)) return true
      this.island.group.remove(patch.group)
      patch.dispose()
      removed++
      return false
    })
    return removed
  }

  addGrave(x: number, z: number, rng: RNG, lowFx = false): Grave {
    const grave = new Grave(x, z, this.island.sampleHeight(x, z), rng, lowFx)
    this.graves.push(grave)
    this.island.group.add(grave.group)
    return grave
  }

  fillCratersNear(x: number, z: number, radius: number, rng: RNG, lowFx = false): number {
    let created = 0
    for (const crater of this.island.craters) {
      if (Math.hypot(crater.x - x, crater.z - z) + crater.radius > radius) continue
      if (this.ponds.some(pond => Math.hypot(pond.x - crater.x, pond.z - crater.z) < 0.1)) continue
      const waterY = this.island.sampleHeight(crater.x, crater.z) + crater.depth * 0.48
      const pond = new Pond(crater.x, crater.z, crater.radius, waterY, rng, lowFx)
      this.ponds.push(pond)
      this.island.group.add(pond.group)
      this.bus.emit({ type: 'pond:created', x: crater.x, z: crater.z })
      created++
    }
    return created
  }

  growFruitNear(x: number, z: number, radius: number): number {
    let grown = 0
    for (const tree of this.trees) {
      if (tree.state !== 'normal' || !within(tree, x, z, radius) || !tree.growFruit()) continue
      this.bus.emit({ type: 'fruit:grown', treeId: tree.id })
      grown++
    }
    return grown
  }

  bloomNear(x: number, z: number, radius: number, rng: RNG, lowFx = false): FlowerPatch {
    const existing = this.flowerPatches.find(patch => (
      within(patch, x, z, Math.min(patch.radius, radius) * 0.5)
    ))
    if (existing) return existing
    const patch = new FlowerPatch(x, z, radius, (px, pz) => this.island.sampleHeight(px, pz), rng, lowFx)
    this.flowerPatches.push(patch)
    this.island.group.add(patch.group)
    this.bus.emit({ type: 'flower:bloomed' })
    return patch
  }

  grumpNear(x: number, z: number, radius: number): void {
    for (const villager of this.villagers) {
      if (villager.alive && within(villager, x, z, radius)) villager.grumpAtRain(this)
    }
  }

  sadNear(x: number, z: number, radius: number): void {
    for (const villager of this.villagers) {
      if (villager.alive && within(villager, x, z, radius)) villager.emote('sad')
    }
  }

  reground(): void {
    const standing: Array<Tree | Hut | Grave | Campfire> = [
      ...this.trees,
      ...this.huts,
      ...this.graves,
    ]
    if (this.campfire) standing.push(this.campfire)
    for (const object of standing) {
      object.group.position.y = this.island.sampleHeight(object.x, object.z)
    }
  }

  updateGraves(dt: number): void {
    for (const grave of this.graves) grave.update(dt)
  }

  updatePonds(qt: number): void {
    for (const pond of this.ponds) pond.update(qt)
  }

  updateFire(dt: number, rng: RNG): void {
    const events = this.fireSystem.update(dt, this.flammables(), rng)
    for (const event of events) {
      const object = this.fireObject(event.id, event.kind)
      if (!object) continue
      if (event.type === 'ignited') {
        object.ignite()
        this.bus.emit({
          type: 'fire:ignited',
          kind: event.kind,
          bySpread: true,
          burning: this.burningCount(),
        })
        this.alarmNear(object.x, object.z, 7)
        continue
      }
      if (event.type === 'burnt') {
        if (event.kind === 'tree') this.trees.find(tree => tree.id === event.id)?.setBurnt()
        else this.huts.find(hut => hut.id === event.id)?.setRuin()
        this.bus.emit({ type: 'burnt', kind: event.kind })
      }
    }
  }

  douseNear(
    x: number,
    z: number,
    radius: number = FIRE_CONFIG.douseRadius,
    byRain = false,
  ): void {
    const burningBefore = this.burningCount()
    const campfireWasLit = this.campfire?.lit && within(this.campfire, x, z, radius)
    const events = this.fireSystem.douse(x, z, this.flammables(), radius)
    for (const event of events) {
      this.fireObject(event.id, event.kind)?.extinguish()
      this.bus.emit({ type: 'fire:doused', byRain, burning: burningBefore })
    }
    if (campfireWasLit && !events.some(event => event.kind === 'campfire')) {
      this.campfire.douse()
      this.bus.emit({ type: 'fire:doused', byRain, burning: burningBefore })
    }
  }

  updateFireLights(camera: Position): void {
    const candidates: Array<Tree | Hut | Campfire> = [
      ...this.trees.filter(tree => tree.burning),
      ...this.huts.filter(hut => hut.burning),
    ]
    if (this.campfire?.lit) candidates.push(this.campfire)
    candidates.sort((a, b) => (
      (a.x - camera.x) ** 2 + (a.z - camera.z) ** 2
      - (b.x - camera.x) ** 2 - (b.z - camera.z) ** 2
    ))
    const enabled = new Set(candidates.slice(0, 3))
    for (const tree of this.trees) tree.setFireLightEnabled(enabled.has(tree))
    for (const hut of this.huts) hut.setFireLightEnabled(enabled.has(hut))
    if (this.campfire) this.campfire.setFireLightEnabled(enabled.has(this.campfire))
  }

  repopulate(dt: number, rng: RNG, lowFx = false): void {
    const living = this.villagers.filter(villager => villager.alive).length
    if (living >= 6) {
      this.repopulateTimer = null
      return
    }

    const hut = repopulationHome(living, this.huts)
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

  private burningCount(): number {
    return this.trees.filter(tree => tree.burning).length
      + this.huts.filter(hut => hut.burning).length
      + Number(this.campfire?.burning ?? false)
  }

  private flammables(): Flammable[] {
    const items: Flammable[] = [
      ...this.trees,
      ...this.huts.filter(hut => hut.state === 'built' || hut.state === 'burning' || hut.state === 'ruin'),
    ]
    if (this.campfire && !this.campfire.scattered) items.push(this.campfire)
    return items
  }

  private fireObject(id: string, kind: FireEvent['kind']): Tree | Hut | Campfire | null {
    if (kind === 'tree') return this.trees.find(tree => tree.id === id) ?? null
    if (kind === 'hut') return this.huts.find(hut => hut.id === id) ?? null
    return this.campfire?.id === id ? this.campfire : null
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

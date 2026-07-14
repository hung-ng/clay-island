import { EventBus, type TargetKind } from '../core/events'
import { RNG } from '../core/rng'
import { Villager, spawnVillagers } from '../villagers/villager'
import { craterAt, craterRimY, type Crater } from './craters'
import { FIRE_CONFIG, FireSystem, type FireEvent, type Flammable } from './fire'
import { Island, WALK_RADIUS, islandSurfaceY } from './island'
import { Campfire, FlowerPatch, Grave, Hut, Pond, Tree } from './objects'
import { placeSites } from './scatter'
import {
  BUILD_CLEARANCE,
  groupBasins,
  isBuildable,
  type Basin,
  type GroundQuery,
} from './terrain'

type Position = { x: number; z: number }

/** The village can grow to this many active huts. */
export const MAX_HUTS = 6

function hasPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Position>
  return typeof candidate.x === 'number' && typeof candidate.z === 'number'
}

function within(a: Position, x: number, z: number, radius: number): boolean {
  return Math.hypot(a.x - x, a.z - z) <= radius
}

function sameBasin(a: Basin, b: Basin): boolean {
  if (a.craters.length !== b.craters.length) return false
  return a.craters.every(crater => b.craters.includes(crater))
}

export function repopulationHome(living: number, huts: Hut[]): Hut | null {
  const built = huts.find(hut => hut.state === 'built')
  if (built) return built
  return living === 0 ? huts.find(hut => hut.state !== 'abandoned') ?? null : null
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
  private stepFoley: (() => void) | null = null

  constructor(public island: Island, public bus = new EventBus()) {
    this.bus.on((event) => {
      if (event.type !== 'villager:died') return
      for (const villager of this.villagers) villager.huddleAtCampfire()
    })
  }

  setStepFoley(handler: (() => void) | null): void { this.stepFoley = handler }
  playStepFoley(): void { this.stepFoley?.() }

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
    if (this.ponds.some(pond => pond.contains(x, z))) return 'pond'
    if (craterAt(x, z, this.island.craters)) return 'crater'
    return 'ground'
  }

  villagerAt(x: number, z: number, radius = 1): Villager | null {
    return this.villagers
      .filter(villager => villager.alive && within(villager, x, z, radius))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null
  }

  pondAt(x: number, z: number): Pond | null {
    return this.ponds.find(pond => pond.contains(x, z)) ?? null
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

  warnNear(x: number, z: number, radius: number): void {
    for (const villager of this.villagers) {
      if (villager.alive && within(villager, x, z, radius)) villager.lookUp({ x, z })
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
    this.removePond(pond)
    this.bus.emit({ type: 'pond:emptied' })
    return true
  }

  scatterCampfire(): void {
    this.campfire.scatter()
  }

  needsFire(): boolean {
    return !this.campfire || this.campfire.scattered || !this.campfire.lit
  }

  rebuildCampfireAt(x: number, z: number, rng: RNG, lowFx = false): boolean {
    if (this.campfire && !this.campfire.scattered) {
      this.campfire.flare(1.5, 1.4)
      return true
    }
    const groundY = (gx: number, gz: number): number => this.island.sampleHeight(gx, gz)
    if (!isBuildable(x, z, this.groundQuery(), groundY)) return false
    if (this.campfire) {
      this.island.group.remove(this.campfire.group)
      this.campfire.dispose()
    }
    const campfire = new Campfire(x, z, this.island.sampleHeight(x, z), rng, lowFx)
    this.campfire = campfire
    this.island.group.add(campfire.group)
    return true
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
    const reached = this.island.craters.filter(crater => (
      Math.hypot(crater.x - x, crater.z - z) - crater.radius <= radius
    ))
    if (reached.length === 0) return 0
    return this.syncPonds(reached, rng, lowFx)
  }

  /**
   * Resettle the water after the ground moves, the way `reground` resettles
   * everything standing on it. A fresh crater cut beside a lake joins its basin,
   * so the lake must be rebuilt to spread into the new hollow and find its new
   * level — otherwise the water simply ignores the hole dug next to it.
   */
  refloodBasins(rng: RNG, lowFx = false): number {
    return this.syncPonds([], rng, lowFx)
  }

  /**
   * Rebuild every basin that either the rain just reached or that already holds
   * water. Basins are re-derived from the craters rather than patched, because a
   * single new crater can merge two existing lakes into one.
   */
  private syncPonds(wetted: readonly Crater[], rng: RNG, lowFx = false): number {
    const flooded = this.ponds.map(pond => pond.basin)
    // Measured against the lipped rim, not the bare dome: the ejecta bank is what
    // actually holds the water in, and on a slope it is the only thing that does.
    const basins = groupBasins(this.island.craters, (bx, bz) => (
      craterRimY(bx, bz, this.island.craters, islandSurfaceY)
    ))
    const wanted = basins.filter(basin => (
      basin.craters.some(crater => wetted.includes(crater))
      || basin.craters.some(crater => flooded.some(old => old.craters.includes(crater)))
    ))

    let created = 0
    for (const basin of wanted) {
      if (this.ponds.some(pond => sameBasin(pond.basin, basin))) continue

      const absorbed = this.ponds.filter(pond => (
        pond.basin.craters.some(crater => basin.craters.includes(crater))
      ))
      const keepsFish = absorbed.length === 0 || absorbed.some(pond => pond.hasFish)
      for (const pond of absorbed) this.removePond(pond)

      const pond = new Pond(
        basin,
        (px, pz) => this.island.sampleHeight(px, pz),
        rng,
        lowFx,
      )
      pond.hasFish = keepsFish
      this.ponds.push(pond)
      this.island.group.add(pond.group)
      this.bus.emit({ type: 'pond:created', x: basin.x, z: basin.z })
      created++
    }
    return created
  }

  groundQuery(): GroundQuery {
    const occupied: Position[] = [
      ...this.trees,
      ...this.huts.filter(hut => hut.state !== 'abandoned'),
    ]
    if (this.campfire && !this.campfire.scattered) occupied.push(this.campfire)
    return {
      basins: this.ponds.map(pond => pond.basin),
      craters: this.island.craters,
      occupied,
    }
  }

  findBuildSite(rng: RNG, near?: Position): Position | null {
    const query = this.groundQuery()
    const groundY = (x: number, z: number): number => this.island.sampleHeight(x, z)
    const home = near ?? this.villageCentre()

    for (let ring = 0; ring < 6; ring++) {
      const distance = BUILD_CLEARANCE + ring * 1.5
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = rng.range(0, Math.PI * 2)
        const x = home.x + Math.cos(angle) * distance
        const z = home.z + Math.sin(angle) * distance
        if (Math.hypot(x, z) > WALK_RADIUS - 1) continue
        if (isBuildable(x, z, query, groundY)) return { x, z }
      }
    }
    return null
  }

  relocateDrownedRuins(rng: RNG, lowFx = false): void {
    const groundY = (x: number, z: number): number => this.island.sampleHeight(x, z)

    for (const hut of this.huts) {
      if (hut.state !== 'ruin') continue
      const query = this.groundQuery()
      const ground: GroundQuery = {
        ...query,
        occupied: query.occupied.filter(prop => prop !== hut),
      }
      if (isBuildable(hut.x, hut.z, ground, groundY)) continue

      hut.state = 'abandoned'
      const activeHuts = this.huts.filter(candidate => candidate.state !== 'abandoned').length
      if (activeHuts >= MAX_HUTS) continue

      const site = this.findBuildSite(rng)
      if (!site) continue
      const replacement = new Hut(
        `hut-${this.huts.length}`,
        site.x,
        site.z,
        'site',
        this.island.sampleHeight(site.x, site.z),
        rng,
        lowFx,
      )
      this.huts.push(replacement)
      this.island.group.add(replacement.group)
    }
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

  private villageCentre(): Position {
    const homes = this.huts.filter(hut => hut.state !== 'abandoned')
    if (homes.length === 0) return { x: 0, z: 0 }
    let x = 0
    let z = 0
    for (const hut of homes) {
      x += hut.x
      z += hut.z
    }
    return { x: x / homes.length, z: z / homes.length }
  }

  private removePond(pond: Pond): void {
    const index = this.ponds.indexOf(pond)
    if (index === -1) return
    this.ponds.splice(index, 1)
    this.island.group.remove(pond.group)
    pond.dispose()
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

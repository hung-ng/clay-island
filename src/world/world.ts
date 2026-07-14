import { EventBus, type TargetKind } from '../core/events'
import { RNG } from '../core/rng'
import type { SuggestionKind } from '../villagers/fsm'
import { Villager, spawnVillagers } from '../villagers/villager'
import { craterAt, craterRimY, type Crater } from './craters'
import { FIRE_CONFIG, FireSystem, type FireEvent, type Flammable } from './fire'
import { MAX_TREES, seedSite, type Seedling } from './forest'
import { Island, WALK_RADIUS, islandSurfaceY } from './island'
import { Campfire, FlowerPatch, Grave, Hut, Pond, Tree } from './objects'
import { placeSites } from './scatter'
import {
  BUILD_CLEARANCE,
  groupBasins,
  isBuildable,
  isSubmerged,
  waterLevelAt,
  type Basin,
  type GroundQuery,
} from './terrain'

type Position = { x: number; z: number }

/** The village can grow to this many active huts. */
export const MAX_HUTS = 6
/** A nudge is a poke, not a proclamation. Villagers past this never hear it. */
const NUDGE_EARSHOT = 18

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
  if (living !== 0) return null
  return huts.find(hut => hut.state !== 'abandoned')
    ?? huts.find(hut => hut.state === 'abandoned')
    ?? null
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
  private reseedTimer: number | null = null
  private treeSerial = 1000
  private hutSerial = 1000
  private pendingHutSite: { source: Hut; site: Hut } | null = null
  private pendingCampfireSite: { source: Campfire | null; site: Campfire } | null = null
  private fireSystem = new FireSystem()
  private stepFoley: (() => void) | null = null
  private chipFx: ((x: number, z: number) => void) | null = null

  constructor(public island: Island, public bus = new EventBus()) {
    this.bus.on((event) => {
      if (event.type !== 'villager:died') return
      for (const villager of this.villagers) villager.huddleAtCampfire()
    })
  }

  setStepFoley(handler: (() => void) | null): void { this.stepFoley = handler }
  playStepFoley(): void { this.stepFoley?.() }
  setChipFx(handler: ((x: number, z: number) => void) | null): void { this.chipFx = handler }
  chipsAt(x: number, z: number): void { this.chipFx?.(x, z) }

  choppableTree(): Tree | null {
    return this.trees.find(tree => tree.state === 'normal') ?? null
  }

  /** A normal tree currently carrying fruit, for a harvester to walk to. */
  fruitingTree(): Tree | null {
    return this.trees.find(tree => tree.state === 'normal' && tree.hasFruit) ?? null
  }

  /** The fire exists but is dead, so idle villagers drift toward it. */
  fireOut(): boolean {
    return Boolean(this.campfire) && !this.campfire.lit && !this.campfire.scattered
  }

  buildSite(): Hut | null {
    return this.huts.find(hut => hut.state === 'site' || hut.state === 'building' || hut.state === 'ruin') ?? null
  }

  hasHutWork(): boolean {
    return this.huts.some(hut => (
      hut.state === 'site' || hut.state === 'building' || hut.state === 'abandoned'
    ))
  }

  claimBuildSite(rng: RNG, lowFx = false): Hut | null {
    const current = this.huts.find(hut => hut.state === 'site' || hut.state === 'building')
    if (current) return current
    if (this.pendingHutSite) return this.pendingHutSite.site

    const abandoned = this.huts.find(hut => hut.state === 'abandoned')
    if (!abandoned) return null
    const site = this.findBuildSite(rng)
    if (!site) return null

    const siteTarget = new Hut(
      `hut-${this.hutSerial++}`,
      site.x,
      site.z,
      'site',
      this.island.sampleHeight(site.x, site.z),
      rng,
      lowFx,
    )
    this.pendingHutSite = { source: abandoned, site: siteTarget }
    return siteTarget
  }

  commitBuildSite(site: Hut): boolean {
    if (this.huts.includes(site)) return true
    const reservation = this.pendingHutSite
    if (!reservation || reservation.site !== site) return false
    if (!this.huts.includes(reservation.source)
      || reservation.source.state !== 'abandoned'
      || !this.isReservedSiteBuildable(site)) {
      this.pendingHutSite = null
      site.dispose()
      return false
    }

    this.removeHut(reservation.source)
    site.group.position.y = this.island.sampleHeight(site.x, site.z)
    this.huts.push(site)
    this.island.group.add(site.group)
    this.pendingHutSite = null
    return true
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

  /** Warn the curious ring only. Villagers inside `inner` are in the blast. */
  warnNear(x: number, z: number, radius: number, inner = 0): void {
    for (const villager of this.villagers) {
      if (!villager.alive || !within(villager, x, z, radius)) continue
      if (Math.hypot(villager.x - x, villager.z - z) < inner) continue
      villager.lookUp({ x, z })
    }
  }

  /** Startle the blast ring: a glance, then a sprint. */
  startleNear(x: number, z: number, radius: number): void {
    for (const villager of this.villagers) {
      if (villager.alive && within(villager, x, z, radius)) villager.startle({ x, z })
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
      tree.obliterate()
      this.removeTree(tree)
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

  /** Trees a villager could actually chop, within `radius` of a point. */
  treesNear(x: number, z: number, radius: number): number {
    return this.trees.filter(tree => (
      tree.state === 'normal' && Math.hypot(tree.x - x, tree.z - z) <= radius
    )).length
  }

  /** Whether any pond lies within `radius` of a point. */
  pondNear(x: number, z: number, radius: number): boolean {
    return this.ponds.some(pond => Math.hypot(pond.x - x, pond.z - z) <= radius)
  }

  /** A hut founded but not yet finished. The village builds one at a time. */
  pendingSite(): boolean {
    return this.huts.some(hut => hut.state === 'site' || hut.state === 'building')
  }

  claimCampfireSite(rng: RNG, lowFx = false): Campfire | null {
    const current = this.campfire
    if (current && !current.scattered) return current
    if (this.pendingCampfireSite) return this.pendingCampfireSite.site

    const site = this.findBuildSite(rng, current ?? undefined)
    if (!site) return null

    const replacement = new Campfire(
      site.x,
      site.z,
      this.island.sampleHeight(site.x, site.z),
      rng,
      lowFx,
      'site',
    )
    this.pendingCampfireSite = { source: current ?? null, site: replacement }
    return replacement
  }

  isCampfireBuildTarget(site: Campfire): boolean {
    return this.campfire === site || this.pendingCampfireSite?.site === site
  }

  commitCampfireSite(site: Campfire): boolean {
    if (this.campfire === site) return true
    const reservation = this.pendingCampfireSite
    if (!reservation || reservation.site !== site) return false

    const sourceIsCurrent = reservation.source
      ? this.campfire === reservation.source && reservation.source.scattered
      : !this.campfire
    if (!sourceIsCurrent || !this.isReservedSiteBuildable(site)) {
      this.pendingCampfireSite = null
      site.dispose()
      return false
    }

    if (reservation.source) {
      this.island.group.remove(reservation.source.group)
      reservation.source.dispose()
    }
    site.group.position.y = this.island.sampleHeight(site.x, site.z)
    this.campfire = site
    this.island.group.add(site.group)
    this.pendingCampfireSite = null
    return true
  }

  rebuildCampfireAt(_x: number, _z: number, _rng: RNG, _lowFx = false): boolean {
    if (this.campfire && (this.campfire.state === 'doused' || this.campfire.state === 'lit')) {
      this.campfire.flare(1.5, 1.4)
      return true
    }
    return false
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
    if (this.pendingHutSite) occupied.push(this.pendingHutSite.site)
    if (this.pendingCampfireSite) occupied.push(this.pendingCampfireSite.site)
    return {
      basins: this.ponds.map(pond => pond.basin),
      craters: this.island.craters,
      occupied,
    }
  }

  /** Whether this point lies under a pond's surface. Walkers must stay out. */
  submerged(x: number, z: number): boolean {
    return isSubmerged(
      x,
      z,
      this.ponds.map(pond => pond.basin),
      (px, pz) => this.island.sampleHeight(px, pz),
    )
  }

  /** How far below the water this point sits; zero on dry land. */
  waterDepthAt(x: number, z: number): number {
    const level = waterLevelAt(x, z, this.ponds.map(pond => pond.basin))
    if (level === null) return 0
    return Math.max(0, level - this.island.sampleHeight(x, z))
  }

  /**
   * Tag the nearest idle villagers. Returns how many were reached.
   *
   * Four, not two: a nudge that half the village never hears reads as a weak
   * power, and the fix is reach rather than weight — raising SUGGESTION_WEIGHT
   * would only walk the roll toward coercion.
   */
  suggest(x: number, z: number, kind: SuggestionKind): number {
    const idle = this.villagers
      .filter(villager => (
        villager.alive
        && villager.canBeNudged()
        && Math.hypot(villager.x - x, villager.z - z) <= NUDGE_EARSHOT
      ))
      .sort((a, b) => (
        Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)
      ))
      .slice(0, 4)
    for (const villager of idle) villager.suggest({ kind, x, z, ttl: 6 })
    return idle.length
  }

  /** A nudge founds a genuinely new home; no other path grows the village. */
  foundHutAt(x: number, z: number, rng: RNG, lowFx = false): Hut | null {
    // One site at a time: a second nudge must not strand an unbuilt shell.
    if (this.pendingSite()) return null
    if (this.huts.filter(hut => hut.state !== 'abandoned').length >= MAX_HUTS) return null
    if (!isBuildable(
      x,
      z,
      this.groundQuery(),
      (px, pz) => this.island.sampleHeight(px, pz),
    )) return null

    const hut = new Hut(
      `hut-${this.hutSerial++}`,
      x,
      z,
      'site',
      this.island.sampleHeight(x, z),
      rng,
      lowFx,
    )
    this.huts.push(hut)
    this.island.group.add(hut.group)
    this.bus.emit({ type: 'village:grew' })
    return hut
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

  relocateDrownedRuins(_rng: RNG, _lowFx = false): void {
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
    }

    if (this.campfire && !this.campfire.scattered) {
      const query = this.groundQuery()
      const ground: GroundQuery = {
        ...query,
        occupied: query.occupied.filter(prop => prop !== this.campfire),
      }
      if (!isBuildable(this.campfire.x, this.campfire.z, ground, groundY)) {
        this.campfire.scatter()
      }
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

  updateTrees(dt: number, qt: number): void {
    for (const tree of [...this.trees]) {
      tree.update(dt, qt)
      if (tree.expired) this.removeTree(tree)
    }
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

  /** Villagers alive right now. */
  living(): number {
    return this.villagers.filter(villager => villager.alive).length
  }

  /** Two villagers per built hut. Huts are homes, not respawn points. */
  capacity(): number {
    const homes = this.huts.filter(hut => hut.state === 'built').length
    return Math.min(homes, MAX_HUTS) * 2
  }

  repopulate(dt: number, rng: RNG, lowFx = false): void {
    const living = this.living()
    // Crowding is stable. Housing loss pauses arrivals; it never removes people.
    if (living >= this.capacity() && living > 0) {
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

  /** Trees still occupying a place in the forest population. */
  livingTrees(): Tree[] {
    return this.trees.filter(tree => tree.holdsPlace)
  }

  /** Sprout a sapling near survivors while the forest is below its cap. */
  reseedForest(dt: number, rng: RNG, lowFx = false): void {
    if (this.livingTrees().length >= MAX_TREES) {
      this.reseedTimer = null
      return
    }
    if (this.reseedTimer === null) this.reseedTimer = rng.range(25, 40)
    this.reseedTimer -= dt
    if (this.reseedTimer > 0) return
    this.reseedTimer = null

    const seedlings: Seedling[] = this.trees.map(tree => ({
      x: tree.x,
      z: tree.z,
      state: tree.state,
    }))
    const site = seedSite(
      seedlings,
      this.groundQuery(),
      (x, z) => this.island.sampleHeight(x, z),
      rng,
    )
    if (!site) return

    const sapling = new Tree(
      `tree-${this.treeSerial++}`,
      site.x,
      site.z,
      this.island.sampleHeight(site.x, site.z),
      rng,
      lowFx,
      'sapling',
    )
    this.trees.push(sapling)
    this.island.group.add(sapling.group)
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

  private removeTree(tree: Tree): void {
    const index = this.trees.indexOf(tree)
    if (index === -1) return
    this.trees.splice(index, 1)
    this.island.group.remove(tree.group)
    tree.dispose()
  }

  private removeHut(hut: Hut): void {
    const index = this.huts.indexOf(hut)
    if (index === -1) return
    this.huts.splice(index, 1)
    this.island.group.remove(hut.group)
    hut.dispose()
  }

  private isReservedSiteBuildable(site: Position): boolean {
    const query = this.groundQuery()
    const withoutSelf: GroundQuery = {
      ...query,
      occupied: query.occupied.filter(object => object !== site),
    }
    return isBuildable(
      site.x,
      site.z,
      withoutSelf,
      (x, z) => this.island.sampleHeight(x, z),
    )
  }

  private flammables(): Flammable[] {
    const items: Flammable[] = [
      ...this.trees.filter(tree => tree.living),
      ...this.huts.filter(hut => hut.state === 'built' || hut.state === 'burning' || hut.state === 'ruin'),
    ]
    if (this.campfire && this.campfire.state !== 'site' && this.campfire.state !== 'building'
      && !this.campfire.scattered) items.push(this.campfire)
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

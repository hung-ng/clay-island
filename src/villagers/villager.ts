import * as THREE from 'three'
import type { EventBus } from '../core/events'
import { RNG } from '../core/rng'
import { EmoteSprite, type EmoteKind } from '../fx/emotes'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE, TIMING } from '../ui/tokens'
import { WALK_RADIUS, type Island } from '../world/island'
import type { Campfire, Hut, Pond, Tree } from '../world/objects'
import type { World } from '../world/world'
import {
  decideNext,
  stateDuration,
  stateForSuggestion,
  type FsmCtx,
  type Suggestion,
  type VillagerState,
} from './fsm'
import { MODEL_SCALE, VillagerModel } from './model'

export { MODEL_SCALE } from './model'

type Point = { x: number; z: number }
export type VillagerCelebrationPhase = 'gathering' | 'fireworks' | 'finale'

export type CelebrationAssignment = {
  slot: Point
  centre: Point
  order: number
}

type CelebrationOverride = {
  assignment: CelebrationAssignment
  phase: VillagerCelebrationPhase
  reducedMotion: boolean
  snapshot: {
    tx: number
    tz: number
    arrived: boolean
    speed: number
    lastQt: number
    rodVisible: boolean
    heldFruitVisible: boolean
    axeVisible: boolean
    emoteVisible: boolean
  }
}

type GraveLike = Point & { fresh: boolean }
type DeathCause = 'meteor' | 'lightning'

type SpawnOptions = {
  lowFx?: boolean
  origin?: Point
  animateIn?: boolean
}

export type VillagerOptions = {
  lowFx?: boolean
  animateIn?: boolean
  visualSeed: number
}

/** Seconds of unbroken labour before a villager wants a drink. */
export const THIRST_LIMIT = 16
/** How long they kneel at the water. Long enough to read as an action. */
export const DRINK_TIME = 2.6
/** One complete cast always resolves after this many seconds at the bank. */
export const FISH_CAST_TIME = 4
/** Time spent visibly tending a Nudge location after arriving there. */
const SUGGESTED_GATHER_TIME = 2.5
/** Activities that develop per-villager habits. Emergencies stay uniform. */
const PERSONALITY_STATES: VillagerState[] = [
  'wander', 'sitAtFire', 'chopTree', 'buildHut', 'fish', 'harvest',
  'gather', 'chat', 'watchSea', 'dance', 'nap',
]
/** How far two villagers will spot each other for a chat. */
const CHAT_RANGE = 7

function isGrave(value: unknown): value is GraveLike {
  if (typeof value !== 'object' || value === null) return false
  const grave = value as Partial<GraveLike>
  return typeof grave.x === 'number' && typeof grave.z === 'number' && typeof grave.fresh === 'boolean'
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function disposeObjectResources(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    geometries.add(child.geometry)
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of childMaterials) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

function clampToIsland(point: Point): Point {
  const radius = Math.hypot(point.x, point.z)
  if (radius <= WALK_RADIUS) return point
  return { x: point.x * WALK_RADIUS / radius, z: point.z * WALK_RADIUS / radius }
}

export function fleeTarget(
  position: Point,
  danger: Point,
  rng: RNG,
  blocked: (point: Point) => boolean = () => false,
): Point {
  let dx = position.x - danger.x
  let dz = position.z - danger.z
  let length = Math.hypot(dx, dz)
  if (length <= Number.EPSILON) {
    const angle = rng.range(0, Math.PI * 2)
    dx = Math.cos(angle)
    dz = Math.sin(angle)
    length = 1
  }
  const direct = clampToIsland({
    x: position.x + dx / length * 5,
    z: position.z + dz / length * 5,
  })
  if (!blocked(direct)) return direct

  const away = Math.atan2(dz, dx)
  for (let step = 1; step <= 6; step++) {
    for (const side of [-1, 1]) {
      const angle = away + side * step * Math.PI / 12
      const candidate = clampToIsland({
        x: position.x + Math.cos(angle) * 5,
        z: position.z + Math.sin(angle) * 5,
      })
      if (!blocked(candidate)) return candidate
    }
  }
  return { x: position.x, z: position.z }
}

export class Villager {
  state: VillagerState = 'wander'
  alive = true
  group = new THREE.Group()

  private readonly rig: VillagerModel
  private readonly lowFx: boolean
  private emoteSprite = new EmoteSprite()
  private rainLeaf: THREE.Mesh
  private rod: THREE.Group
  private rodTip = new THREE.Vector3()
  private heldFruit: THREE.Mesh
  private rainTime = 0
  private zapTime = -1
  private zapLastQt = Number.NEGATIVE_INFINITY
  private ghost = new THREE.Group()
  private ghostArm: THREE.Mesh
  private ghostMaterials: THREE.Material[] = []
  private tx: number
  private tz: number
  private speed = 0.86
  private timer = 0
  private actionTimer = 0
  private retargetTimer = 0
  private lastQt = Number.NEGATIVE_INFINITY
  private arrived = false
  private chopFrames = 0
  private targetTree: Tree | null = null
  private targetHut: Hut | null = null
  private targetGrave: GraveLike | null = null
  private targetMourningPond: Pond | null = null
  private targetPond: Pond | null = null
  private targetCampfire: Campfire | null = null
  private rebuildingRuin = false
  private spawnFrames: number
  private spawnLastQt = Number.NEGATIVE_INFINITY
  private performance: 'none' | 'meteor' | 'startle' | 'cower' | 'flinch' = 'none'
  private performanceTime = 0
  private performanceFrom: Point = { x: 0, z: 0 }
  private huddleTime = 0
  private thirst = 0
  private eating = 0
  private resumeState: VillagerState | null = null
  private suggestion: Suggestion | null = null
  private graveGlance = 0
  private gatheringBySuggestion = false
  private celebration: CelebrationOverride | null = null
  private chatPartner: Villager | null = null
  private readonly personality: Partial<Record<VillagerState, number>> = {}
  private wanderPauseAt = -1
  private lookAround = 0

  constructor(
    public id: string,
    public x: number,
    public z: number,
    private readonly island: Island,
    private rng: RNG,
    private world: World,
    private bus: EventBus,
    options: VillagerOptions,
  ) {
    this.lowFx = options.lowFx ?? false
    this.rig = new VillagerModel(id, options.visualSeed, this.lowFx)
    this.tx = x
    this.tz = z
    this.spawnFrames = options.animateIn ? 0 : 4
    this.group.position.set(x, island.sampleHeight(x, z), z)
    this.group.scale.setScalar(options.animateIn ? 0.01 : 1)

    const propRng = new RNG([...id].reduce((seed, character) => seed * 31 + character.charCodeAt(0), 17))
    this.rainLeaf = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.3, 9, 6), propRng, 0.035),
      clayMaterial(PALETTE.leafA),
    )
    this.rainLeaf.name = 'rain-leaf'
    this.rainLeaf.position.set(-0.16, 1.22, 0)
    this.rainLeaf.scale.set(1.25, 0.16, 0.9)
    this.rainLeaf.rotation.z = -0.22
    this.rainLeaf.visible = false
    this.rainLeaf.castShadow = !this.lowFx

    this.rod = new THREE.Group()
    this.rod.name = 'fishing-rig'
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 1.3, 5),
      clayMaterial(PALETTE.bark),
    )
    rod.name = 'fishing-rod'
    // The cylinder is Y-up: its tip is +y. Pitch it forward (+z) so the tip
    // leads out over the water, and the butt sits back at the hip.
    rod.position.set(0.3, 0.8, 0.42)
    rod.rotation.set(1.05, 0, -0.18)
    rod.castShadow = !this.lowFx
    const line = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 1, 4),
      clayMaterial(PALETTE.inkSoft, { flat: true }),
    )
    line.name = 'fishing-line'
    // Hangs straight down from the rod tip.
    line.position.set(0.4, 0.86, 0.98)
    line.castShadow = false
    const float = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 6, 4),
      clayMaterial(PALETTE.smockA, { flat: true }),
    )
    float.name = 'fishing-float'
    // At the waterline, directly below the line.
    float.position.set(0.4, 0.55, 0.98)
    float.castShadow = false
    this.rod.add(rod, line, float)
    this.rod.visible = false

    this.heldFruit = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 7, 5),
      clayMaterial(PALETTE.smockA),
    )
    this.heldFruit.name = 'held-fruit'
    this.heldFruit.position.set(0, -0.18, 0.06)
    this.heldFruit.visible = false
    this.heldFruit.castShadow = !this.lowFx
    this.arms[0].add(this.heldFruit)

    const ghostMaterial = clayMaterial(PALETTE.ghost)
    ghostMaterial.transparent = true
    const ghostBody = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.28, 10, 8), propRng, 0.035),
      ghostMaterial,
    )
    ghostBody.name = 'villager-ghost'
    ghostBody.scale.y = 1.2
    const faceMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.scorch, transparent: true })
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), faceMaterial)
      eye.position.set(side * 0.085, 0.055, 0.25)
      this.ghost.add(eye)
    }
    const armMaterial = clayMaterial(PALETTE.ghost)
    armMaterial.transparent = true
    this.ghostArm = new THREE.Mesh(
      wobble(new THREE.CapsuleGeometry(0.045, 0.18, 4, 7), propRng, 0.012),
      armMaterial,
    )
    this.ghostArm.position.set(0.28, 0, 0)
    this.ghostArm.rotation.z = -0.8
    this.ghost.add(ghostBody, this.ghostArm)
    this.ghost.name = 'zap-ghost'
    this.ghost.visible = false
    this.ghostMaterials.push(ghostMaterial, faceMaterial, armMaterial)
    island.group.add(this.ghost)

    this.group.add(this.model, this.emoteSprite.sprite, this.rainLeaf, this.rod)
    if (this.lowFx) this.addBlobShadow()
    for (const state of PERSONALITY_STATES) {
      this.personality[state] = rng.range(0.7, 1.3)
    }
    this.enter('wander', world)
  }

  private get model(): THREE.Group { return this.rig.group }
  private get head(): THREE.Mesh { return this.rig.head }
  private get arms(): [THREE.Mesh, THREE.Mesh] { return this.rig.arms }
  private get axe(): THREE.Group { return this.rig.axe }
  private get visualMaterials(): THREE.MeshToonMaterial[] { return this.rig.materials }

  get celebrating(): boolean { return this.celebration !== null }

  canCelebrate(): boolean {
    return this.alive
      && (this.celebrating || (
        this.zapTime < 0
        && this.rainTime <= 0
        && this.performance === 'none'
        && this.state !== 'flee'
      ))
  }

  beginCelebration(assignment: CelebrationAssignment): boolean {
    if (this.celebrating || !this.canCelebrate()) return false
    this.celebration = {
      assignment,
      phase: 'gathering',
      reducedMotion: false,
      snapshot: {
        tx: this.tx,
        tz: this.tz,
        arrived: this.arrived,
        speed: this.speed,
        lastQt: this.lastQt,
        rodVisible: this.rod.visible,
        heldFruitVisible: this.heldFruit.visible,
        axeVisible: this.axe.visible,
        emoteVisible: this.emoteSprite.sprite.visible,
      },
    }
    this.speed = 1.35
    this.setTarget(assignment.slot)
    this.resetPose()
    this.rod.visible = false
    this.heldFruit.visible = false
    this.axe.visible = false
    this.emoteSprite.sprite.visible = false
    return true
  }

  setCelebrationPhase(
    phase: VillagerCelebrationPhase,
    reducedMotion: boolean,
  ): void {
    if (!this.celebration) return
    this.celebration.phase = phase
    this.celebration.reducedMotion = reducedMotion
  }

  endCelebration(): void {
    const current = this.celebration
    if (!current) return
    this.celebration = null
    this.tx = current.snapshot.tx
    this.tz = current.snapshot.tz
    this.arrived = current.snapshot.arrived
    this.speed = current.snapshot.speed
    this.lastQt = current.snapshot.lastQt
    this.resetPose()
    this.rod.visible = current.snapshot.rodVisible
    this.heldFruit.visible = current.snapshot.heldFruitVisible
    this.axe.visible = current.snapshot.axeVisible
    this.emoteSprite.sprite.visible = current.snapshot.emoteVisible
  }

  update(dt: number, qt: number, world: World, island: Island): void {
    if (!this.alive) return
    if (this.celebration) {
      if (world.hasDangerousFire()) {
        this.endCelebration()
        const fire = world.nearestBurning(this.x, this.z, 8)
        if (fire) this.panic(fire)
      } else {
        this.updateCelebration(dt, qt, world, island)
        return
      }
    }
    this.normalizeSuggestion(world)
    this.huddleTime = Math.max(0, this.huddleTime - dt)
    const ticked = qt !== this.lastQt
    const swallowed = this.updateHeldFruit(dt, ticked)
    if (swallowed && this.state === 'harvest') this.enter('wander', world)
    if (this.zapTime >= 0) {
      this.updateZap(dt, qt)
      return
    }
    if (this.updatePerformance(dt, qt, island)) return
    const fire = world.nearestBurning(this.x, this.z, 7)
    if (fire) {
      if (this.rainTime > 0) {
        this.rainTime = 0
        this.rainLeaf.visible = false
        this.resetPose()
      }
      if (this.state !== 'flee') this.panic(fire)
    }
    if (this.rainTime > 0) {
      this.updateRainReaction(dt, qt, world, island)
      return
    }

    // Narrative work is a live priority, not something that waits for the
    // current state's watchdog to expire. Danger and Rain have already had
    // their higher-priority opportunities above.
    if (this.state !== 'flee') {
      const priorityState = this.narrativePriority(world)
      if (priorityState && this.state !== priorityState) {
        this.enter(priorityState, world)
        return
      }
    }

    this.updateFleeTarget(dt, world)
    if (!this.arrived) this.steer(dt, world)
    this.timer -= dt
    if (this.state === 'drink' && !this.arrived) {
      this.timer = Math.max(this.timer, DRINK_TIME + 0.1)
    }

    const labouring = this.state === 'chopTree'
      || this.state === 'buildHut'
      || this.state === 'rebuild'
    if (labouring) this.thirst += dt
    if (this.thirst >= THIRST_LIMIT && world.ponds.length > 0) {
      this.thirst = 0
      this.resumeState = this.state
      this.enter('drink', world)
    }
    this.performActivity(dt, ticked, world)

    if (this.timer <= 0) {
      const context = this.context(world)
      const priorityOverride = context.fireNear || context.freshGrave || context.hasRuin
      const finishingCast = this.state === 'fish' && this.arrived && this.actionTimer > 0
      const finishingFruit = this.state === 'harvest' && this.eating > 0
      if ((this.suggestionForState(this.state) || finishingCast || finishingFruit)
        && !priorityOverride) {
        this.timer = 0.25
      }
      else this.enter(decideNext(context), world)
    }
    if (!ticked) return
    this.lastQt = qt

    this.updateSpawnScale(qt)
    this.group.position.set(this.x, island.sampleHeight(this.x, this.z), this.z)
    this.group.rotation.y = Math.atan2(this.tx - this.x, this.tz - this.z)
    if (this.arrived && this.targetPond
      && (this.state === 'fish' || this.state === 'drink')) {
      this.group.rotation.y = Math.atan2(
        this.targetPond.x - this.x,
        this.targetPond.z - this.z,
      )
    } else if (this.arrived && this.state === 'mourn' && this.targetGrave) {
      this.group.rotation.y = Math.atan2(
        this.targetGrave.x - this.x,
        this.targetGrave.z - this.z,
      )
    } else if (this.arrived && this.state === 'watchSea') {
      // Face out to sea: away from the island centre.
      this.group.rotation.y = Math.atan2(this.x, this.z)
    } else if (this.arrived && this.state === 'dance') {
      this.group.rotation.y = Math.atan2(
        world.campfire.x - this.x,
        world.campfire.z - this.z,
      )
    } else if (this.arrived && this.state === 'chat' && this.chatPartner) {
      this.group.rotation.y = Math.atan2(
        this.chatPartner.x - this.x,
        this.chatPartner.z - this.z,
      )
    }

    const frame = Math.floor(qt * TIMING.fps) % 4
    const sitting = this.arrived
      && (
        this.state === 'sitAtFire'
        || this.state === 'fish'
        || this.state === 'drink'
        || this.state === 'watchSea'
      )
    if (this.state !== 'drink' && this.state !== 'nap') {
      this.model.scale.set(MODEL_SCALE, MODEL_SCALE * (sitting ? 0.8 : 1), MODEL_SCALE)
    }
    this.group.rotation.z = this.arrived ? 0 : frame === 0 ? 0.09 : frame === 2 ? -0.09 : 0
    this.group.position.y += !this.arrived && frame % 2 === 0 ? 0.03 : 0
    if (this.arrived && this.state === 'dance' && frame % 2 === 0) {
      this.group.position.y += 0.1
    }
    if (!this.arrived && frame % 2 === 0) world.playStepFoley()
    this.emoteSprite.update(qt)
  }

  die(cause: DeathCause): void {
    if (!this.alive) return
    this.alive = false
    this.group.visible = false
    this.rainLeaf.visible = false
    this.ghost.visible = false
    this.world.addGrave(this.x, this.z, this.rng, this.lowFx)
    this.bus.emit({ type: 'villager:died', cause })
  }

  dispose(): void {
    this.group.removeFromParent()
    this.ghost.removeFromParent()
    disposeObjectResources(this.group)
    disposeObjectResources(this.ghost)
    this.emoteSprite.dispose()
  }

  emote(kind: EmoteKind, seconds = 2.2): void {
    this.emoteSprite.show(kind, seconds)
  }

  lookUp(from: Point): void {
    if (!this.alive || this.zapTime >= 0) return
    this.performance = 'meteor'
    this.performanceTime = 1.2
    this.performanceFrom = from
    this.emote('cower')
  }

  /** A blast-radius glance that yields to the sprint instead of replacing it. */
  startle(from: Point): void {
    if (!this.alive || this.zapTime >= 0) return
    if (this.state === 'flee' || this.state === 'mourn') return
    if (this.rainTime > 0) {
      this.rainTime = 0
      this.rainLeaf.visible = false
      this.resetPose()
    }
    this.performance = 'startle'
    this.performanceTime = 0.25
    this.performanceFrom = from
    this.emote('alarm')
  }

  cower(): void {
    if (!this.alive || this.zapTime >= 0) return
    this.performance = 'cower'
    this.performanceTime = 0.85
    this.emote('cower')
  }

  flinch(): void {
    if (!this.alive || this.zapTime >= 0) return
    this.performance = 'flinch'
    this.performanceTime = 0.13
  }

  huddleAtCampfire(): void {
    if (!this.alive) return
    this.huddleTime = 10
    if (this.state !== 'sitAtFire') return
    const dx = this.tx - this.world.campfire.x
    const dz = this.tz - this.world.campfire.z
    const length = Math.hypot(dx, dz) || 1
    this.setTarget({
      x: this.world.campfire.x + dx / length * 0.82,
      z: this.world.campfire.z + dz / length * 0.82,
    })
  }

  setIntroWake(progress: number): void {
    if (!this.alive) return
    const amount = THREE.MathUtils.clamp(progress, 0, 1)
    this.model.scale.set(
      MODEL_SCALE,
      MODEL_SCALE * THREE.MathUtils.lerp(0.68, 1, amount),
      MODEL_SCALE,
    )
    this.group.rotation.z = THREE.MathUtils.lerp(-0.15, 0, amount)
    this.arms[0].rotation.z = THREE.MathUtils.lerp(-1.2, this.arms[0].userData.baseRotation, amount)
    this.arms[1].rotation.z = THREE.MathUtils.lerp(1.2, this.arms[1].userData.baseRotation, amount)
  }

  zap(): void {
    if (!this.alive || this.zapTime >= 0) return
    this.zapTime = 0
    this.zapLastQt = Number.NEGATIVE_INFINITY
    this.rainTime = 0
    this.rainLeaf.visible = false
    this.performance = 'none'
    this.performanceTime = 0
    this.resetPose()
    for (const material of this.visualMaterials) material.color.set(PALETTE.scorch)
    this.arms[0].rotation.z = -Math.PI / 2
    this.arms[1].rotation.z = Math.PI / 2
    this.ghost.visible = false
  }

  grumpAtRain(world: World): void {
    if (!this.alive || this.zapTime >= 0) return
    this.rainTime = 2.6
    this.state = 'wander'
    this.resetPose()
    const hut = world.huts
      .filter(candidate => candidate.state === 'built')
      .sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
    const tree = world.trees
      .filter(candidate => world.isTreeActionable(candidate))
      .sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
    const treeIsNearer = tree !== null
      && (hut === null || distance(this, tree) < distance(this, hut))

    this.rainLeaf.visible = !treeIsNearer
    if (!treeIsNearer) this.arms[0].rotation.z = -2.25
    this.emote('alarm')
    this.setTarget(tree && treeIsNearer ? tree : hut ?? this.randomWalkPoint(world))
  }

  panic(from: Point): void {
    this.state = 'flee'
    this.timer = stateDuration('flee', this.rng)
    this.retargetTimer = 1
    this.setTarget(fleeTarget(this, from, this.rng, point => this.world.submerged(point.x, point.z)))
    this.emote('alarm')
  }

  /** Busy, frightened, grieving or dead villagers do not take suggestions. */
  canBeNudged(): boolean {
    if (!this.alive || this.zapTime >= 0) return false
    if (this.performance !== 'none') return false
    if (this.suggestion) return false
    return this.state === 'wander' || this.state === 'sitAtFire' || this.state === 'gather'
  }

  suggest(suggestion: Suggestion): void {
    if (!this.canBeNudged()) return
    this.suggestion = suggestion
    this.emote('question')
    if (this.state === 'gather' && suggestion.kind === 'gather') {
      this.enter('gather', this.world)
      return
    }
    this.timer = Math.min(this.timer, 0.4)
  }

  /** Pulled into a conversation by an initiator who has already chosen us. */
  joinChat(initiator: Villager, duration: number): void {
    if (!this.canJoinChat()) return
    this.enter('chat', this.world, null, null, initiator)
    this.timer = duration
  }

  private suggestionForState(state: VillagerState): Suggestion | null {
    const suggestion = this.suggestion
    return suggestion && stateForSuggestion(suggestion.kind) === state
      ? suggestion
      : null
  }

  private completeSuggestionFor(state: VillagerState): void {
    if (this.suggestionForState(state)) this.suggestion = null
  }

  private cancelSuggestionFor(state: VillagerState): void {
    if (this.suggestionForState(state)) this.suggestion = null
  }

  private convertFishingSuggestionToDrink(): void {
    if (this.suggestion?.kind !== 'fish') return
    this.suggestion = { ...this.suggestion, kind: 'drink' }
  }

  private convertChopSuggestionToHarvest(): void {
    if (this.suggestion?.kind !== 'chop') return
    this.suggestion = { ...this.suggestion, kind: 'harvest' }
  }

  private normalizeSuggestion(world: World): void {
    const suggestion = this.suggestion
    if (!suggestion) return

    switch (suggestion.kind) {
      case 'chop':
        if (this.targetTree) {
          if (!world.trees.includes(this.targetTree) || !world.isTreeActionable(this.targetTree)) {
            this.suggestion = null
          } else if (this.targetTree.hasFruit) {
            this.convertChopSuggestionToHarvest()
          }
        } else {
          const intended = suggestion.targetId
            ? world.trees.find(tree => tree.id === suggestion.targetId) ?? null
            : world.actionableTreeAt(suggestion.x, suggestion.z)
          if (!intended || !world.isTreeActionable(intended)) {
            this.suggestion = null
          } else if (intended.hasFruit) {
            this.convertChopSuggestionToHarvest()
          }
        }
        return
      case 'harvest': {
        // Once picked, completing the suggestion means swallowing the fruit;
        // the source tree may already be bare or disappear during an override.
        if (this.eating > 0) return
        if (this.targetTree) {
          if (!world.trees.includes(this.targetTree)
            || !world.isTreeActionable(this.targetTree)
            || (!this.targetTree.hasFruit && this.eating <= 0)) {
            this.suggestion = null
          }
          return
        }
        const intended = suggestion.targetId
          ? world.trees.find(tree => tree.id === suggestion.targetId) ?? null
          : world.actionableTreeAt(suggestion.x, suggestion.z)
        if (!intended || !world.isTreeActionable(intended) || !intended.hasFruit) {
          this.suggestion = null
        }
        return
      }
      case 'fish': {
        if (this.targetPond) {
          if (!world.ponds.includes(this.targetPond)) this.suggestion = null
          else if (!this.targetPond.hasFish) this.convertFishingSuggestionToDrink()
          return
        }
        if (world.ponds.length === 0) {
          this.suggestion = null
          return
        }
        const intended = world.pondAt(suggestion.x, suggestion.z)
        if (intended) {
          if (!intended.hasFish) this.convertFishingSuggestionToDrink()
          return
        }
        if (!world.ponds.some(pond => pond.hasFish)) this.convertFishingSuggestionToDrink()
        return
      }
      case 'drink':
        if (this.targetPond && !world.ponds.includes(this.targetPond)) {
          this.suggestion = null
        } else if (!this.targetPond && world.ponds.length === 0) {
          this.suggestion = null
        }
        return
      case 'build':
        if (!world.hasHutWork()) this.suggestion = null
        return
      case 'makeFire':
        if (!world.needsFire()) this.suggestion = null
        return
      case 'gather':
        return
    }
  }

  private updateZap(dt: number, qt: number): void {
    this.zapTime += dt
    const ticked = qt !== this.zapLastQt
    if (ticked) {
      this.zapLastQt = qt
      const frame = Math.floor(this.zapTime * TIMING.fps)
      const blink = frame === 4 || frame === 5 || frame === 9 || frame === 10
      this.model.scale.setScalar(MODEL_SCALE * (blink ? 1.08 : 1))
      this.arms[0].rotation.z = -Math.PI / 2
      this.arms[1].rotation.z = Math.PI / 2
    }

    const tip = THREE.MathUtils.clamp((this.zapTime - 1.05) / 0.5, 0, 1)
    this.group.rotation.z = tip * Math.PI / 2

    if (this.zapTime >= 1.45) {
      const float = THREE.MathUtils.clamp((this.zapTime - 1.45) / 1.05, 0, 1)
      this.ghost.visible = true
      this.ghost.position.set(
        this.x,
        this.island.sampleHeight(this.x, this.z) + 1 + float * 4,
        this.z,
      )
      this.ghostArm.rotation.z = -0.8 + Math.sin(this.zapTime * 18) * 0.55
      const opacity = 1 - Math.max(0, (float - 0.72) / 0.28)
      for (const material of this.ghostMaterials) material.opacity = opacity
    }

    if (this.zapTime < 2.5) return
    this.zapTime = -1
    this.ghost.visible = false
    for (const material of this.ghostMaterials) material.opacity = 1
    this.rig.restoreColors()
    this.resetPose()
    this.enter('wander', this.world)
  }

  private updateRainReaction(dt: number, qt: number, world: World, island: Island): void {
    this.rainTime = Math.max(0, this.rainTime - dt)
    if (!this.arrived) this.steer(dt, world)
    const ticked = qt !== this.lastQt
    if (ticked) {
      this.lastQt = qt
      this.group.position.set(this.x, island.sampleHeight(this.x, this.z), this.z)
      this.group.rotation.y = Math.atan2(this.tx - this.x, this.tz - this.z)
      const frame = Math.floor(qt * TIMING.fps)
      this.group.rotation.z = frame % 4 === 0 ? 0.08 : frame % 4 === 2 ? -0.08 : 0
      this.rainLeaf.position.y = 1.22 + (frame % 2 === 0 ? 0.035 : 0)
      if (this.rainLeaf.visible) this.arms[0].rotation.z = -2.25
      if (!this.arrived && frame % 2 === 0) world.playStepFoley()
      this.emoteSprite.update(qt)
    }
    if (this.rainTime > 0) return
    this.rainLeaf.visible = false
    this.resetPose()
    this.enter('wander', world)
  }

  private addBlobShadow(): void {
    const material = new THREE.MeshBasicMaterial({
      color: PALETTE.scorch,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 18), material)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.018
    shadow.renderOrder = 1
    this.group.add(shadow)
  }

  private steer(dt: number, world: World): void {
    const dx = this.tx - this.x
    const dz = this.tz - this.z
    const targetDistance = Math.hypot(dx, dz)
    if (targetDistance < 0.06) return

    let vx = dx / targetDistance * this.speed
    let vz = dz / targetDistance * this.speed
    if (this.state === 'flee') {
      vx *= 2.2
      vz *= 2.2
    }
    for (const object of world.objectsNear(this.x, this.z, 1.4)) {
      const ox = this.x - object.x
      const oz = this.z - object.z
      const objectDistance = Math.hypot(ox, oz) || 1
      if (objectDistance < 1.4) {
        vx += ox / objectDistance * (1.4 - objectDistance) * 2
        vz += oz / objectDistance * (1.4 - objectDistance) * 2
      }
    }

    // Water is an obstacle, never a hazard. Four depth samples approximate a
    // shoreline gradient and steer walkers away without introducing a navmesh.
    const probe = 0.9
    for (const [ox, oz] of [[probe, 0], [-probe, 0], [0, probe], [0, -probe]] as const) {
      const depth = world.waterDepthAt(this.x + ox, this.z + oz)
      if (depth <= 0) continue
      const push = Math.min(1, depth) * 2.6
      vx -= ox / probe * push
      vz -= oz / probe * push
    }
    const aheadX = this.x + dx / targetDistance * probe
    const aheadZ = this.z + dz / targetDistance * probe
    if (world.waterDepthAt(aheadX, aheadZ) > 0) {
      // A stable tangent breaks the head-on equilibrium at a round shore, so
      // repulsion guides the villager around instead of leaving them vibrating.
      vx -= dz / targetDistance * 1.15
      vz += dx / targetDistance * 1.15
    }
    this.x += vx * dt
    this.z += vz * dt

    const radius = Math.hypot(this.x, this.z)
    if (radius > WALK_RADIUS) {
      this.x *= WALK_RADIUS / radius
      this.z *= WALK_RADIUS / radius
    }
  }

  private performActivity(dt: number, ticked: boolean, world: World): void {
    switch (this.state) {
      case 'wander': {
        if (this.targetDistance() < 0.22) {
          if (!this.arrived && this.rng.chance(0.22)) this.emote('content')
          this.arrived = true
        }
        if (this.wanderPauseAt > 0 && this.timer <= this.wanderPauseAt && !this.arrived) {
          this.wanderPauseAt = -1
          this.lookAround = 1.4
          this.setTarget({ x: this.x, z: this.z })
        }
        if (this.lookAround > 0) {
          this.lookAround -= dt
          if (ticked) {
            this.head.rotation.y = Math.floor(this.timer * TIMING.fps / 3) % 2 === 0
              ? 0.55
              : -0.55
          }
          if (this.lookAround <= 0) {
            this.head.rotation.y = 0
            this.setTarget(this.randomWalkPoint(world))
          }
        }
        if (this.graveGlance <= 0 && !this.arrived) {
          const grave = world.graves.find(candidate => (
            isGrave(candidate) && !candidate.fresh && distance(this, candidate) < 1.1
          ))
          if (grave) {
            this.graveGlance = 2.4
            this.setTarget({ x: this.x, z: this.z })
            this.emote('sad')
          }
        }
        if (this.graveGlance > 0) {
          this.graveGlance -= dt
          if (this.graveGlance <= 0) this.setTarget(this.randomWalkPoint(world))
        }
        return
      }
      case 'nap': {
        if (this.targetDistance() < 0.3) this.arrived = true
        if (this.arrived && ticked) {
          const breathe = Math.floor(this.timer * TIMING.fps / 2) % 2 === 0 ? 1.04 : 1
          this.rig.setNapPose(breathe)
        }
        return
      }
      case 'watchSea': {
        if (this.targetDistance() < 0.35 && !this.arrived) {
          this.arrived = true
          this.emote('content')
        }
        return
      }
      case 'dance': {
        if (!world.campfire?.lit) {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.25) {
          if (!this.arrived) {
            this.arrived = true
            this.emote('music')
          }
          if (ticked) {
            const frame = Math.floor(this.timer * TIMING.fps) % 4
            const lift = frame < 2 ? 2.05 : 1.2
            this.arms[0].rotation.z = -lift
            this.arms[1].rotation.z = lift
          }
        }
        return
      }
      case 'chat': {
        const partner = this.chatPartner
        if (!partner || !partner.alive || partner.state !== 'chat') {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.3) {
          if (!this.arrived) {
            this.arrived = true
            this.emote('happy')
          }
          if (ticked) {
            // Nodding along: head bows on the beat, one arm gestures.
            const frame = Math.floor(this.timer * TIMING.fps) % 4
            this.head.rotation.x = frame < 2 ? 0.18 : -0.06
            this.arms[0].rotation.z = frame === 1
              ? -0.9
              : this.arms[0].userData.baseRotation
          }
        }
        return
      }
      case 'chopTree': {
        if (!this.targetTree || !world.isTreeActionable(this.targetTree)) {
          this.cancelSuggestionFor('chopTree')
          this.enter('wander', world)
          return
        }
        if (this.targetTree.hasFruit) {
          this.convertChopSuggestionToHarvest()
          this.enter('harvest', world, null, this.targetTree)
          return
        }
        if (distance(this, this.targetTree) <= 1.15) {
          this.arrived = true
          if (!ticked) return
          this.chopFrames++
          const raised = this.chopFrames % 2 === 1
          this.arms[0].rotation.z = raised ? -1.9 : this.arms[0].userData.baseRotation
          this.arms[1].rotation.z = raised ? 1.9 : this.arms[1].userData.baseRotation
          this.axe.rotation.z = raised ? -1.2 : -0.35
          if (!raised) {
            this.targetTree.shudder()
            world.chipsAt(this.targetTree.x, this.targetTree.z)
          }
          if (this.chopFrames >= 8) {
            if (!this.suggestionForState('chopTree') && !world.canChopAutomatically()) {
              this.enter('wander', world)
              return
            }
            this.targetTree.chop()
            this.completeSuggestionFor('chopTree')
            this.enter('wander', world)
          }
        }
        return
      }
      case 'buildHut':
      case 'rebuild': {
        if (!this.targetHut || (this.targetHut.state !== 'site' && this.targetHut.state !== 'building' && this.targetHut.state !== 'ruin')) {
          if (this.state === 'buildHut') this.cancelSuggestionFor('buildHut')
          this.enter('wander', world)
          return
        }
        if (distance(this, this.targetHut) <= 1.55) {
          if (!world.huts.includes(this.targetHut) && !world.commitBuildSite(this.targetHut)) {
            if (this.state === 'buildHut') this.cancelSuggestionFor('buildHut')
            this.enter('wander', world)
            return
          }
          this.arrived = true
          this.actionTimer -= dt
          if (this.actionTimer <= 0) {
            if (this.rebuildingRuin) this.targetHut.group.userData.rebuildingRuin = true
            this.targetHut.buildTick()
            this.actionTimer = 1.5
            if (this.targetHut.progress >= 1) {
              if (this.targetHut.group.userData.rebuildingRuin) {
                this.bus.emit({ type: 'hut:rebuilt' })
                delete this.targetHut.group.userData.rebuildingRuin
              }
              if (this.state === 'buildHut') this.completeSuggestionFor('buildHut')
              this.enter('wander', world)
            }
          }
          if (ticked) {
            const swing = Math.floor(this.actionTimer * TIMING.fps) % 2 === 0 ? 0.85 : 0.25
            this.arms[0].rotation.z = -swing
            this.arms[1].rotation.z = swing
          }
        }
        return
      }
      case 'sitAtFire': {
        if (!world.campfire.lit) {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.2) {
          if (!this.arrived && this.rng.chance(0.5)) this.emote('content')
          this.arrived = true
        }
        return
      }
      case 'flee':
        return
      case 'mourn': {
        if (!this.targetGrave || !this.targetGrave.fresh) {
          this.enter('wander', world)
          return
        }
        const pond = world.pondAt(this.targetGrave.x, this.targetGrave.z)
        if (pond !== this.targetMourningPond) {
          this.targetMourningPond = pond
          this.setTarget(pond ? pond.shoreNear(this.x, this.z) : this.targetGrave)
        }
        if (this.targetDistance() < 0.35) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 2.2
            this.emote('sad')
          }
          this.actionTimer -= dt
          if (this.actionTimer <= 0) {
            this.targetGrave.fresh = false
            this.bus.emit({ type: 'villager:mourned' })
            this.enter('wander', world)
          }
        }
        return
      }
      case 'fish': {
        if (!this.targetPond || !world.ponds.includes(this.targetPond)) {
          this.cancelSuggestionFor('fish')
          this.rod.visible = false
          this.enter('wander', world)
          return
        }
        if (!this.targetPond.hasFish) {
          const pond = this.targetPond
          this.convertFishingSuggestionToDrink()
          this.rod.visible = false
          this.enter('drink', world, pond)
          return
        }
        if (this.targetDistance() < 0.25) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = FISH_CAST_TIME
            this.rod.visible = true
            this.emote('fish')
          }
          this.alignFishingRig(this.targetPond)
          this.actionTimer -= dt
          if (this.actionTimer <= 0) {
            if (this.targetPond.catchFish()) {
              this.bus.emit({ type: 'villager:fished' })
              this.completeSuggestionFor('fish')
              this.enter('wander', world)
            } else {
              const pond = this.targetPond
              this.convertFishingSuggestionToDrink()
              this.enter('drink', world, pond)
            }
          }
        }
        return
      }
      case 'drink': {
        if (!this.targetPond || !world.ponds.includes(this.targetPond)) {
          this.cancelSuggestionFor('drink')
          this.resumeState = null
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.25) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = DRINK_TIME
            this.emote('water')
          }
          this.actionTimer -= dt

          // Every frame, not only on `ticked`: `enter()` calls resetPose(), and a
          // pose written once per animation tick is erased in between.
          this.group.rotation.y = Math.atan2(
            this.targetPond.x - this.x,
            this.targetPond.z - this.z,
          )
          // Dip and rise: down to the water, back up to swallow, twice over.
          const progress = 1 - this.actionTimer / DRINK_TIME
          const dip = (Math.sin(progress * Math.PI * 4 - Math.PI / 2) + 1) / 2
          this.model.scale.set(
            MODEL_SCALE,
            MODEL_SCALE * (1 - 0.3 * dip),
            MODEL_SCALE,
          )
          this.head.rotation.x = 0.28 + 0.5 * dip
          this.arms[0].rotation.z = -0.5 - 0.5 * dip
          this.arms[1].rotation.z = 0.5 + 0.5 * dip

          if (this.actionTimer <= 0) {
            const resume = this.resumeState
            this.resumeState = null
            this.completeSuggestionFor('drink')
            this.enter(resume ?? 'wander', world)
          }
        }
        return
      }
      case 'harvest': {
        // Once the fruit is in hand the tree no longer matters — eat it even if
        // the tree burns down mid-chew.
        if (this.eating > 0) return
        if (!this.targetTree || !world.isTreeActionable(this.targetTree) || !this.targetTree.hasFruit) {
          this.cancelSuggestionFor('harvest')
          this.enter('wander', world)
          return
        }
        if (distance(this, this.targetTree) <= 1.2) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 1.2
            this.arms[0].rotation.z = -1.5
          }
          this.actionTimer -= dt
          if (this.actionTimer <= 0) {
            if (this.targetTree.pickFruit(this.x, this.z)) {
              this.heldFruit.visible = true
              this.eating = 1.6
            } else {
              this.cancelSuggestionFor('harvest')
              this.enter('wander', world)
            }
          }
        }
        return
      }
      case 'gather': {
        if (!this.gatheringBySuggestion && !world.fireOut()) {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.3) {
          if (!this.arrived) {
            this.arrived = true
            if (this.gatheringBySuggestion) this.actionTimer = SUGGESTED_GATHER_TIME
            this.emote('question')
          }
          if (this.gatheringBySuggestion) {
            this.actionTimer -= dt
            if (this.actionTimer <= 0) {
              this.completeSuggestionFor('gather')
              this.enter('wander', world)
              return
            }
          }
          if (ticked && world.campfire) {
            // Face the ashes and stoop over them.
            this.group.rotation.y = Math.atan2(
              world.campfire.x - this.x,
              world.campfire.z - this.z,
            )
            const poke = Math.floor(this.timer * TIMING.fps) % 2 === 0
            this.arms[0].rotation.z = poke ? -1.2 : -0.7
            this.head.rotation.x = 0.24
          }
        }
        return
      }
      case 'makeFire': {
        if (!this.targetCampfire || !world.isCampfireBuildTarget(this.targetCampfire)) {
          this.cancelSuggestionFor('makeFire')
          this.enter('wander', world)
          return
        }
        if (this.targetCampfire.lit) {
          this.cancelSuggestionFor('makeFire')
          this.enter('sitAtFire', world)
          return
        }
        if (this.targetCampfire.scattered || !world.needsFire()) {
          this.cancelSuggestionFor('makeFire')
          this.enter('wander', world)
          return
        }
        if (distance(this, this.targetCampfire) <= 1.25) {
          if (world.campfire !== this.targetCampfire
            && !world.commitCampfireSite(this.targetCampfire)) {
            this.cancelSuggestionFor('makeFire')
            this.enter('wander', world)
            return
          }
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 2.5
          }
          this.actionTimer -= dt
          if (ticked) {
            const swing = Math.floor(this.actionTimer * TIMING.fps) % 2 === 0 ? 0.85 : 0.25
            this.arms[0].rotation.z = -swing
            this.arms[1].rotation.z = swing
          }
          if (this.targetCampfire.state === 'site' || this.targetCampfire.state === 'building') {
            this.targetCampfire.buildTick(dt / 2.5)
            if (this.targetCampfire.lit) {
              this.completeSuggestionFor('makeFire')
              this.enter('sitAtFire', world)
            }
            return
          }
          if (this.actionTimer <= 0 && this.targetCampfire.state === 'doused') {
            const rebuilt = world.rebuildCampfireAt(
              this.targetCampfire.x,
              this.targetCampfire.z,
              this.rng,
              this.lowFx,
            )
            if (!rebuilt) {
              this.cancelSuggestionFor('makeFire')
              this.enter('wander', world)
              return
            }
            this.completeSuggestionFor('makeFire')
            this.enter('sitAtFire', world)
          }
        }
        return
      }
    }
  }

  private updateFleeTarget(dt: number, world: World): void {
    if (this.state !== 'flee') return
    this.retargetTimer -= dt
    if (this.retargetTimer > 0) return
    this.retargetTimer = 1
    const fire = world.nearestBurning(this.x, this.z, 8)
    if (fire) this.panic(fire)
  }

  private alignFishingRig(pond: Pond): void {
    const pole = this.rod.getObjectByName('fishing-rod')
    const line = this.rod.getObjectByName('fishing-line')
    const fishingFloat = this.rod.getObjectByName('fishing-float')
    if (!pole || !line || !fishingFloat) return

    this.rodTip.set(0, 0.65, 0)
      .applyQuaternion(pole.quaternion)
      .add(pole.position)
    const waterY = pond.group.position.y - this.group.position.y + 0.02
    fishingFloat.position.set(this.rodTip.x, waterY, this.rodTip.z)
    line.position.set(
      this.rodTip.x,
      (this.rodTip.y + waterY) / 2,
      this.rodTip.z,
    )
    line.scale.y = Math.max(0.05, this.rodTip.y - waterY)
  }

  private updateHeldFruit(dt: number, ticked: boolean): boolean {
    if (!(this.eating > 0)) return false
    this.heldFruit.visible = true
    this.eating = Math.max(0, this.eating - dt)
    if (ticked && this.state === 'harvest') {
      // arms[0] is the villager's left arm; positive Z rotation brings its
      // capsule tip inward toward the mouth.
      this.arms[0].rotation.z = 2.1
      this.head.rotation.x = -0.12
    }
    if (this.eating > 0) return false

    this.heldFruit.visible = false
    this.emote('happy')
    this.bus.emit({ type: 'villager:ate' })
    this.completeSuggestionFor('harvest')
    return true
  }

  private suggestedGatherTarget(suggestion: Suggestion, world: World): Point {
    const fire = world.campfire
    if (!fire || distance(fire, suggestion) > 1.5) {
      return suggestion
    }

    let dx = this.x - fire.x
    let dz = this.z - fire.z
    let length = Math.hypot(dx, dz)
    if (length <= Number.EPSILON) {
      const angle = this.rng.range(0, Math.PI * 2)
      dx = Math.cos(angle)
      dz = Math.sin(angle)
      length = 1
    }
    return {
      x: fire.x + dx / length * 1.5,
      z: fire.z + dz / length * 1.5,
    }
  }

  private selectPond(
    kind: 'fish' | 'drink',
    world: World,
    preferred: Pond | null = null,
  ): Pond | null {
    const ponds = kind === 'fish'
      ? world.ponds.filter(pond => pond.hasFish)
      : [...world.ponds]
    if (preferred && ponds.includes(preferred)) return preferred

    const suggestion = this.suggestion?.kind === kind ? this.suggestion : null
    const direct = suggestion ? world.pondAt(suggestion.x, suggestion.z) : null
    if (direct && ponds.includes(direct)) return direct

    const origin = suggestion ?? this
    return ponds.sort((a, b) => distance(origin, a) - distance(origin, b))[0] ?? null
  }

  private selectHarvestTree(world: World, preferred: Tree | null = null): Tree | null {
    const trees = world.trees.filter(tree => world.isTreeActionable(tree) && tree.hasFruit)
    if (preferred && trees.includes(preferred)) return preferred
    const suggestion = this.suggestion?.kind === 'harvest' ? this.suggestion : null
    if (suggestion?.targetId) {
      return trees.find(tree => tree.id === suggestion.targetId) ?? null
    }
    const origin = suggestion ?? this
    return trees.sort((a, b) => distance(origin, a) - distance(origin, b))[0] ?? null
  }

  private selectChopTree(world: World): Tree | null {
    const trees = world.trees.filter(tree => world.isTreeActionable(tree) && !tree.hasFruit)
    const suggestion = this.suggestion?.kind === 'chop' ? this.suggestion : null
    if (suggestion?.targetId) {
      return trees.find(tree => tree.id === suggestion.targetId) ?? null
    }
    const origin = suggestion ?? this
    return trees.sort((a, b) => distance(origin, a) - distance(origin, b))[0] ?? null
  }

  private enter(
    state: VillagerState,
    world: World,
    preferredPond: Pond | null = null,
    preferredTree: Tree | null = null,
    chatWith: Villager | null = null,
  ): void {
    const suggestion = this.suggestionForState(state)
    if (this.state === 'nap' && state !== 'nap') {
      this.emoteSprite.sprite.visible = false
    }
    if (state !== 'drink') this.resumeState = null
    this.resetPose()
    this.rod.visible = false
    if (this.eating <= 0) this.heldFruit.visible = false
    this.axe.visible = false
    this.state = state
    this.timer = stateDuration(state, this.rng)
    if (state === 'wander' && this.suggestion) {
      this.timer = Math.min(this.timer, 0.4)
    }
    this.arrived = false
    this.actionTimer = 0
    this.chopFrames = 0
    this.targetTree = null
    this.targetHut = null
    this.targetGrave = null
    this.targetMourningPond = null
    this.targetPond = null
    this.targetCampfire = null
    this.rebuildingRuin = false
    this.graveGlance = 0
    this.gatheringBySuggestion = false
    this.chatPartner = null
    this.wanderPauseAt = -1
    this.lookAround = 0

    switch (state) {
      case 'wander':
        // Half of all strolls include a stop to look around partway through.
        this.wanderPauseAt = this.rng.chance(0.5)
          ? this.timer * this.rng.range(0.35, 0.65)
          : -1
        this.setTarget(this.randomWalkPoint(world))
        return
      case 'nap':
        this.setTarget({ x: this.x, z: this.z })
        this.emote('sleep', Number.POSITIVE_INFINITY)
        return
      case 'watchSea': {
        let angle = Math.atan2(this.z, this.x)
        if (Math.hypot(this.x, this.z) < 0.5) {
          angle = this.rng.range(0, Math.PI * 2)
        }
        this.setTarget({
          x: Math.cos(angle) * WALK_RADIUS,
          z: Math.sin(angle) * WALK_RADIUS,
        })
        return
      }
      case 'dance': {
        if (!world.campfire?.lit) return this.enter('wander', world)
        // Outside the sitters' ring (1.25) so dancers weave between them.
        const angle = this.rng.range(0, Math.PI * 2)
        this.setTarget({
          x: world.campfire.x + Math.cos(angle) * 1.7,
          z: world.campfire.z + Math.sin(angle) * 1.7,
        })
        return
      }
      case 'chat': {
        this.chatPartner = chatWith ?? this.findChatPartner(world)
        if (!this.chatPartner) return this.enter('wander', world)
        if (chatWith) {
          // The joiner waits where they are; the initiator walks over.
          this.setTarget({ x: this.x, z: this.z })
          return
        }
        this.chatPartner.joinChat(this, this.timer)
        if (this.chatPartner.state !== 'chat') {
          this.chatPartner = null
          return this.enter('wander', world)
        }
        this.setTarget(this.meetingPoint(this.chatPartner))
        return
      }
      case 'chopTree': {
        this.targetTree = this.selectChopTree(world)
        if (!this.targetTree) {
          this.cancelSuggestionFor('chopTree')
          return this.enter('wander', world)
        }
        this.axe.visible = true
        this.setTarget(this.targetTree)
        return
      }
      case 'buildHut': {
        this.targetHut = world.claimBuildSite(this.rng, this.lowFx)
        if (!this.targetHut) {
          this.cancelSuggestionFor('buildHut')
          return this.enter('wander', world)
        }
        this.setTarget(this.targetHut)
        return
      }
      case 'sitAtFire': {
        const angle = this.rng.range(0, Math.PI * 2)
        const radius = this.huddleTime > 0 ? 0.82 : 1.25
        this.setTarget({
          x: world.campfire.x + Math.cos(angle) * radius,
          z: world.campfire.z + Math.sin(angle) * radius,
        })
        return
      }
      case 'flee': {
        const fire = world.nearestBurning(this.x, this.z, 8)
        if (!fire) return this.enter('wander', world)
        this.panic(fire)
        return
      }
      case 'mourn': {
        const graves = world.graves.filter(isGrave).filter(grave => grave.fresh)
        this.targetGrave = graves.sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
        if (!this.targetGrave) return this.enter('wander', world)
        this.targetMourningPond = world.pondAt(this.targetGrave.x, this.targetGrave.z)
        this.setTarget(this.targetMourningPond
          ? this.targetMourningPond.shoreNear(this.x, this.z)
          : this.targetGrave)
        return
      }
      case 'rebuild': {
        this.targetHut = world.huts.find(hut => hut.state === 'ruin') ?? null
        if (!this.targetHut) return this.enter('wander', world)
        this.rebuildingRuin = true
        this.setTarget(this.targetHut)
        return
      }
      case 'fish': {
        this.targetPond = this.selectPond('fish', world)
        if (!this.targetPond) {
          this.cancelSuggestionFor('fish')
          return this.enter('wander', world)
        }
        this.setTarget(this.targetPond.shoreNear(this.x, this.z))
        return
      }
      case 'makeFire': {
        this.targetCampfire = world.claimCampfireSite(this.rng, this.lowFx)
        if (!this.targetCampfire || this.targetCampfire.lit) {
          this.cancelSuggestionFor('makeFire')
          return this.enter('wander', world)
        }
        const angle = this.rng.range(0, Math.PI * 2)
        this.setTarget({
          x: this.targetCampfire.x + Math.cos(angle) * 1.1,
          z: this.targetCampfire.z + Math.sin(angle) * 1.1,
        })
        return
      }
      case 'drink': {
        this.targetPond = this.selectPond('drink', world, preferredPond)
        if (!this.targetPond) {
          this.cancelSuggestionFor('drink')
          return this.enter('wander', world)
        }
        this.setTarget(this.targetPond.shoreNear(this.x, this.z))
        return
      }
      case 'harvest': {
        this.targetTree = this.selectHarvestTree(world, preferredTree)
        if (!this.targetTree) {
          this.cancelSuggestionFor('harvest')
          return this.enter('wander', world)
        }
        this.setTarget(this.targetTree)
        return
      }
      case 'gather': {
        if (suggestion?.kind === 'gather') {
          this.gatheringBySuggestion = true
          this.setTarget(this.suggestedGatherTarget(suggestion, world))
          return
        }
        if (!world.campfire) return this.enter('wander', world)
        const angle = this.rng.range(0, Math.PI * 2)
        this.setTarget({
          x: world.campfire.x + Math.cos(angle) * 1.5,
          z: world.campfire.z + Math.sin(angle) * 1.5,
        })
        return
      }
    }
  }

  private context(world: World): FsmCtx {
    return {
      state: this.state,
      fireNear: world.nearestBurning(this.x, this.z, 7) !== null,
      freshGrave: world.graves.some(grave => isGrave(grave) && grave.fresh),
      hasRuin: world.huts.some(hut => hut.state === 'ruin'),
      hasSite: world.hasHutWork(),
      hasPond: world.ponds.length > 0,
      hasFishPond: world.ponds.some(pond => pond.hasFish),
      hasTree: world.choppableTree() !== null,
      canChopAutomatically: world.canChopAutomatically(),
      campfireLit: world.campfire?.lit ?? false,
      needsFire: world.needsFire(),
      hasFruitTree: world.fruitingTree() !== null,
      fireOut: world.fireOut(),
      hasChatPartner: this.findChatPartner(world) !== null,
      stateCounts: this.othersByState(world),
      personality: this.personality,
      suggestion: this.suggestion,
      rng: this.rng,
    }
  }

  private othersByState(world: World): Partial<Record<VillagerState, number>> {
    const counts: Partial<Record<VillagerState, number>> = {}
    for (const other of world.villagers) {
      if (other === this || !other.alive) continue
      counts[other.state] = (counts[other.state] ?? 0) + 1
    }
    return counts
  }

  /** Free enough to be pulled into a conversation. */
  private canJoinChat(): boolean {
    return this.alive
      && this.zapTime < 0
      && this.rainTime <= 0
      && this.performance === 'none'
      && this.celebration === null
      && this.suggestion === null
      && (this.state === 'wander' || this.state === 'sitAtFire')
  }

  private findChatPartner(world: World): Villager | null {
    let best: Villager | null = null
    for (const other of world.villagers) {
      if (other === this || !other.canJoinChat()) continue
      const candidateDistance = distance(this, other)
      if (candidateDistance > CHAT_RANGE) continue
      if (!best || candidateDistance < distance(this, best)) best = other
    }
    return best
  }

  /** A spot just short of the partner, so the pair stand face to face. */
  private meetingPoint(partner: Villager): Point {
    const dx = partner.x - this.x
    const dz = partner.z - this.z
    const length = Math.hypot(dx, dz)
    if (length <= 0.7) return { x: this.x, z: this.z }
    return {
      x: partner.x - dx / length * 0.7,
      z: partner.z - dz / length * 0.7,
    }
  }

  private narrativePriority(world: World): 'mourn' | 'rebuild' | null {
    if (world.graves.some(grave => isGrave(grave) && grave.fresh)) return 'mourn'
    if (world.huts.some(hut => hut.state === 'ruin')) return 'rebuild'
    return null
  }

  private randomWalkPoint(world: World): Point {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2)
      const radius = Math.sqrt(this.rng.next()) * WALK_RADIUS * 0.9
      const point = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
      if (!world.submerged(point.x, point.z)) return point
    }
    return { x: this.x, z: this.z }
  }

  private updateCelebration(dt: number, qt: number, world: World, island: Island): void {
    const current = this.celebration
    if (!current) return
    if (!this.arrived) this.steer(dt, world)
    if (this.targetDistance() <= 0.24) this.arrived = true
    if (qt === this.lastQt) return

    this.lastQt = qt
    this.resetPose()
    this.rod.visible = false
    this.heldFruit.visible = false
    this.axe.visible = false
    this.group.position.set(this.x, island.sampleHeight(this.x, this.z), this.z)
    this.group.rotation.y = Math.atan2(
      current.assignment.centre.x - this.x,
      current.assignment.centre.z - this.z,
    )

    const frame = (Math.floor(qt * TIMING.fps) + current.assignment.order) % 4
    if (!this.arrived) {
      this.group.rotation.z = frame === 0 ? 0.09 : frame === 2 ? -0.09 : 0
      if (frame % 2 === 0) world.playStepFoley()
      return
    }

    this.group.rotation.z = 0
    this.head.rotation.x = -0.32
    if (current.phase === 'gathering') {
      if (current.assignment.order % 2 === 0) this.arms[0].rotation.z = -1.72
      else this.arms[1].rotation.z = 1.72
      if (!current.reducedMotion && frame === 1) this.group.position.y += 0.04
      return
    }
    if (current.phase === 'fireworks') {
      const clap = frame < 2 ? 1.42 : 0.72
      this.arms[0].rotation.z = -clap
      this.arms[1].rotation.z = clap
      this.group.rotation.z = (frame < 2 ? -0.035 : 0.035)
        * (current.assignment.order % 2 === 0 ? 1 : -1)
      if (!current.reducedMotion && frame === 1) this.group.position.y += 0.1
      return
    }

    this.arms[0].rotation.z = -2.05
    this.arms[1].rotation.z = 2.05
    if (!current.reducedMotion && frame % 2 === 0) this.group.position.y += 0.18
  }

  private setTarget(point: Point): void {
    const target = clampToIsland(point)
    this.tx = target.x
    this.tz = target.z
    this.arrived = false
  }

  private targetDistance(): number {
    return Math.hypot(this.tx - this.x, this.tz - this.z)
  }

  private resetPose(): void {
    this.rig.resetPose()
    this.group.rotation.z = 0
  }

  private updatePerformance(dt: number, qt: number, island: Island): boolean {
    if (this.performance === 'none') return false
    this.performanceTime = Math.max(0, this.performanceTime - dt)
    if (this.performanceTime <= 0) {
      const wasStartle = this.performance === 'startle'
      this.performance = 'none'
      this.resetPose()
      if (wasStartle) this.panic(this.performanceFrom)
      return false
    }
    if (qt === this.lastQt) return true
    this.lastQt = qt
    this.resetPose()
    this.group.position.set(this.x, island.sampleHeight(this.x, this.z), this.z)

    if (this.performance === 'startle') {
      this.group.rotation.y = Math.atan2(
        this.performanceFrom.x - this.x,
        this.performanceFrom.z - this.z,
      )
      this.head.rotation.x = -0.5
      this.arms[0].rotation.z = -1.1
      this.arms[1].rotation.z = 1.1
    } else if (this.performance === 'flinch') {
      this.group.rotation.z = 0.2
      this.model.scale.set(MODEL_SCALE * 1.04, MODEL_SCALE * 0.88, MODEL_SCALE)
      this.arms[0].rotation.z = -1.45
      this.arms[1].rotation.z = 1.45
    } else {
      this.group.rotation.y = Math.atan2(
        this.performanceFrom.x - this.x,
        this.performanceFrom.z - this.z,
      )
      const looking = this.performance === 'meteor' && this.performanceTime > 0.85
      if (looking) {
        this.head.rotation.x = -0.65
        this.arms[0].rotation.z = -0.85
        this.arms[1].rotation.z = 0.85
      } else {
        this.model.scale.set(MODEL_SCALE, MODEL_SCALE * 0.7, MODEL_SCALE)
        this.arms[0].rotation.z = -2.2
        this.arms[1].rotation.z = 2.2
      }
    }
    this.emoteSprite.update(qt)
    return true
  }

  private updateSpawnScale(qt: number): void {
    if (this.spawnFrames >= 4 || qt === this.spawnLastQt) return
    this.spawnLastQt = qt
    this.spawnFrames++
    this.group.scale.setScalar(this.spawnFrames / 4)
  }
}

export function spawnVillagers(
  world: World,
  island: Island,
  rng: RNG,
  n = 6,
  options: SpawnOptions = {},
): Villager[] {
  const spawned: Villager[] = []
  for (let i = 0; i < n; i++) {
    let point = options.origin ?? { x: 0, z: 0 }
    if (!options.origin) {
      for (let tries = 0; tries < 300; tries++) {
        const angle = rng.range(0, Math.PI * 2)
        const radius = rng.range(2.2, 9.8)
        const candidate = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
        const clearOfObjects = world.objectsNear(candidate.x, candidate.z, 1.6).length === 0
        const clearOfVillagers = world.villagers.every(villager => (
          !villager.alive || distance(candidate, villager) >= 0.75
        ))
        if (clearOfObjects && clearOfVillagers) {
          point = candidate
          break
        }
      }
    }

    const visualSeed = rng.int(1, 0x7fffffff)
    const villagerOptions: VillagerOptions = { visualSeed }
    if (options.lowFx !== undefined) villagerOptions.lowFx = options.lowFx
    if (options.animateIn !== undefined) villagerOptions.animateIn = options.animateIn
    const villager = new Villager(
      world.nextVillagerId(),
      point.x,
      point.z,
      island,
      rng,
      world,
      world.bus,
      villagerOptions,
    )
    world.addVillager(villager)
    spawned.push(villager)
  }
  return spawned
}

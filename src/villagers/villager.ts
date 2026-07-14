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
  type FsmCtx,
  type Suggestion,
  type VillagerState,
} from './fsm'

type Point = { x: number; z: number }
type GraveLike = Point & { fresh: boolean }
type DeathCause = 'meteor' | 'lightning'

type SpawnOptions = {
  lowFx?: boolean
  origin?: Point
  animateIn?: boolean
}

export const MODEL_SCALE = 0.75
/** Seconds of unbroken labour before a villager wants a drink. */
export const THIRST_LIMIT = 16
/** How long they kneel at the water. Long enough to read as an action. */
export const DRINK_TIME = 2.6

function isGrave(value: unknown): value is GraveLike {
  if (typeof value !== 'object' || value === null) return false
  const grave = value as Partial<GraveLike>
  return typeof grave.x === 'number' && typeof grave.z === 'number' && typeof grave.fresh === 'boolean'
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
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

  private model = new THREE.Group()
  private arms: THREE.Mesh[] = []
  private head: THREE.Mesh
  private emoteSprite = new EmoteSprite()
  private visualMaterials: THREE.MeshToonMaterial[] = []
  private visualColors: THREE.Color[] = []
  private rainLeaf: THREE.Mesh
  private rod: THREE.Group
  private heldFruit: THREE.Mesh
  private axe: THREE.Group
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

  constructor(
    public id: string,
    public x: number,
    public z: number,
    private readonly island: Island,
    private rng: RNG,
    private world: World,
    private bus: EventBus,
    private readonly lowFx = false,
    animateIn = false,
  ) {
    this.tx = x
    this.tz = z
    this.spawnFrames = animateIn ? 0 : 4
    this.group.position.set(x, island.sampleHeight(x, z), z)
    this.group.scale.setScalar(animateIn ? 0.01 : 1)

    const smock = rng.pick([PALETTE.smockA, PALETTE.smockB, PALETTE.smockC])
    const body = new THREE.Mesh(
      wobble(new THREE.CapsuleGeometry(0.22, 0.34, 5, 10), rng, 0.035),
      clayMaterial(smock),
    )
    body.position.y = 0.44
    this.addPart(body, lowFx)

    this.head = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.22, 12, 9), rng, 0.035),
      clayMaterial(PALETTE.skin),
    )
    this.head.position.y = 0.94
    this.head.scale.set(1, 0.96, 0.94)
    this.addPart(this.head, lowFx)

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(
        wobble(new THREE.CapsuleGeometry(0.065, 0.2, 4, 8), rng, 0.018),
        clayMaterial(PALETTE.skin),
      )
      arm.position.set(side * 0.28, 0.51, 0)
      arm.rotation.z = side * -0.28
      arm.userData.baseRotation = arm.rotation.z
      this.arms.push(arm)
      this.addPart(arm, lowFx)

      const leg = new THREE.Mesh(
        wobble(new THREE.CapsuleGeometry(0.075, 0.13, 4, 8), rng, 0.018),
        clayMaterial(PALETTE.skin),
      )
      leg.position.set(side * 0.11, 0.12, 0)
      this.addPart(leg, lowFx)
    }

    this.model.scale.setScalar(MODEL_SCALE)
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
    this.rainLeaf.castShadow = !lowFx

    this.rod = new THREE.Group()
    this.rod.name = 'fishing-rig'
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 1.3, 5),
      clayMaterial(PALETTE.bark),
    )
    rod.name = 'fishing-rod'
    // The cylinder is Y-up: its tip is +y. Pitch it forward (+z) so the tip
    // leads out over the water, and the butt sits back at the hip.
    rod.position.set(0.3, 0.92, 0.42)
    rod.rotation.set(1.05, 0, -0.18)
    rod.castShadow = !lowFx
    const line = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.62, 4),
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
      new THREE.SphereGeometry(0.11, 7, 5),
      clayMaterial(PALETTE.smockA),
    )
    this.heldFruit.name = 'held-fruit'
    this.heldFruit.position.set(0.34, 0.78, 0.1)
    this.heldFruit.visible = false
    this.heldFruit.castShadow = !lowFx

    this.axe = new THREE.Group()
    this.axe.name = 'villager-axe'
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.62, 5),
      clayMaterial(PALETTE.bark),
    )
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.12, 0.07),
      clayMaterial(PALETTE.stone),
    )
    head.position.y = 0.3
    handle.castShadow = !lowFx
    head.castShadow = !lowFx
    this.axe.add(handle, head)
    this.axe.position.set(-0.27, 0.62, 0.05)
    this.axe.rotation.z = -0.7
    this.axe.visible = false
    this.model.add(this.axe)

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

    this.group.add(this.model, this.emoteSprite.sprite, this.rainLeaf, this.rod, this.heldFruit)
    if (lowFx) this.addBlobShadow()
    this.enter('wander', world)
  }

  update(dt: number, qt: number, world: World, island: Island): void {
    if (!this.alive) return
    this.huddleTime = Math.max(0, this.huddleTime - dt)
    if (this.suggestion) {
      this.suggestion.ttl -= dt
      if (this.suggestion.ttl <= 0) this.suggestion = null
    }
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
    const ticked = qt !== this.lastQt

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

    if (this.timer <= 0) this.enter(decideNext(this.context(world)), world)
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
    }

    const frame = Math.floor(qt * TIMING.fps) % 4
    const sitting = this.arrived
      && (this.state === 'sitAtFire' || this.state === 'fish' || this.state === 'drink')
    if (this.state !== 'drink') {
      this.model.scale.set(MODEL_SCALE, MODEL_SCALE * (sitting ? 0.8 : 1), MODEL_SCALE)
    }
    this.group.rotation.z = this.arrived ? 0 : frame === 0 ? 0.09 : frame === 2 ? -0.09 : 0
    this.group.position.y += !this.arrived && frame % 2 === 0 ? 0.03 : 0
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

  emote(kind: EmoteKind): void {
    this.emoteSprite.show(kind, 2.2)
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
      .filter(candidate => candidate.state === 'normal')
      .sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
    const treeIsNearer = tree !== null
      && (hut === null || distance(this, tree) < distance(this, hut))

    this.rainLeaf.visible = !treeIsNearer
    if (!treeIsNearer) this.arms[0].rotation.z = -2.25
    this.emote('water')
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
    return this.state === 'wander' || this.state === 'sitAtFire' || this.state === 'gather'
  }

  suggest(suggestion: Suggestion): void {
    if (!this.canBeNudged()) return
    this.suggestion = suggestion
    this.emote('question')
    this.timer = Math.min(this.timer, 0.4)
  }

  private addPart(mesh: THREE.Mesh, lowFx: boolean): void {
    mesh.castShadow = !lowFx
    if (mesh.material instanceof THREE.MeshToonMaterial) {
      this.visualMaterials.push(mesh.material)
      this.visualColors.push(mesh.material.color.clone())
    }
    this.model.add(mesh)
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
    this.visualMaterials.forEach((material, index) => material.color.copy(this.visualColors[index]))
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
    for (const [ox, oz] of [[probe, 0], [-probe, 0], [0, probe], [0, -probe]]) {
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
          if (!this.arrived && this.rng.chance(0.22)) this.emote('sleep')
          this.arrived = true
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
      case 'chopTree': {
        if (!this.targetTree || this.targetTree.state !== 'normal') {
          this.enter('wander', world)
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
            this.targetTree.chop()
            this.enter('wander', world)
          }
        }
        return
      }
      case 'buildHut':
      case 'rebuild': {
        if (!this.targetHut || (this.targetHut.state !== 'site' && this.targetHut.state !== 'building' && this.targetHut.state !== 'ruin')) {
          this.enter('wander', world)
          return
        }
        if (distance(this, this.targetHut) <= 1.55) {
          if (!world.huts.includes(this.targetHut) && !world.commitBuildSite(this.targetHut)) {
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
          if (!this.arrived && this.rng.chance(0.5)) this.emote('sleep')
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
        if (distance(this, this.targetGrave) < 0.35) {
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
        if (!this.targetPond || !world.ponds.some(pond => pond === this.targetPond)) {
          this.rod.visible = false
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.25) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 4
            this.rod.visible = true
            this.emote('fish')
          }
          this.actionTimer -= dt
          if (this.actionTimer <= 0) {
            if (this.rng.chance(0.05) && this.targetPond.floatFish()) {
              this.bus.emit({ type: 'villager:fished' })
            }
            this.actionTimer = 4
          }
        }
        return
      }
      case 'drink': {
        if (!this.targetPond || !world.ponds.includes(this.targetPond)) {
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
            this.enter(resume ?? 'wander', world)
          }
        }
        return
      }
      case 'harvest': {
        // Once the fruit is in hand the tree no longer matters — eat it even if
        // the tree burns down mid-chew.
        if (this.eating > 0) {
          this.eating -= dt
          if (ticked) {
            // Raise it to the mouth and lean into the bite.
            this.arms[0].rotation.z = -2.1
            this.heldFruit.position.set(0.16, 1.06, 0.14)
            this.head.rotation.x = -0.12
          }
          if (this.eating <= 0) {
            this.heldFruit.visible = false
            // `EmoteKind` has no 'happy'; the satisfied-sigh glyph is 'sleep'.
            this.emote('sleep')
            this.bus.emit({ type: 'villager:ate' })
            this.enter('wander', world)
          }
          return
        }
        if (!this.targetTree || !this.targetTree.hasFruit) {
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
              this.heldFruit.position.set(0.34, 0.78, 0.1)
              this.eating = 1.6
            } else {
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
            this.emote('question')
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
          this.enter('wander', world)
          return
        }
        if (this.targetCampfire.lit) {
          this.enter('sitAtFire', world)
          return
        }
        if (this.targetCampfire.scattered || !world.needsFire()) {
          this.enter('wander', world)
          return
        }
        if (distance(this, this.targetCampfire) <= 1.25) {
          if (world.campfire !== this.targetCampfire
            && !world.commitCampfireSite(this.targetCampfire)) {
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
            if (this.targetCampfire.lit) this.enter('sitAtFire', world)
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
              this.enter('wander', world)
              return
            }
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

  private enter(state: VillagerState, world: World): void {
    const suggestion = this.suggestion
    this.suggestion = null
    if (state !== 'drink') this.resumeState = null
    this.resetPose()
    this.rod.visible = false
    this.eating = 0
    this.heldFruit.visible = false
    this.axe.visible = false
    this.state = state
    this.timer = stateDuration(state, this.rng)
    this.arrived = false
    this.actionTimer = 0
    this.chopFrames = 0
    this.targetTree = null
    this.targetHut = null
    this.targetGrave = null
    this.targetPond = null
    this.targetCampfire = null
    this.rebuildingRuin = false
    this.graveGlance = 0
    this.gatheringBySuggestion = false

    switch (state) {
      case 'wander':
        this.setTarget(this.randomWalkPoint(world))
        return
      case 'chopTree': {
        const trees = world.trees.filter(tree => tree.state === 'normal')
        this.targetTree = suggestion?.kind === 'chop'
          ? trees.sort((a, b) => (
            Math.hypot(a.x - suggestion.x, a.z - suggestion.z)
            - Math.hypot(b.x - suggestion.x, b.z - suggestion.z)
          ))[0] ?? null
          : world.choppableTree()
        if (!this.targetTree) return this.enter('wander', world)
        this.axe.visible = true
        this.setTarget(this.targetTree)
        return
      }
      case 'buildHut': {
        this.targetHut = world.claimBuildSite(this.rng, this.lowFx)
        if (!this.targetHut) return this.enter('wander', world)
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
        this.setTarget(this.targetGrave)
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
        const ponds = [...world.ponds]
        this.targetPond = suggestion?.kind === 'fish'
          ? world.pondAt(suggestion.x, suggestion.z)
            ?? ponds.sort((a, b) => (
              Math.hypot(a.x - suggestion.x, a.z - suggestion.z)
              - Math.hypot(b.x - suggestion.x, b.z - suggestion.z)
            ))[0] ?? null
          : ponds.sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
        if (!this.targetPond) return this.enter('wander', world)
        this.setTarget(this.targetPond.shoreNear(this.x, this.z))
        return
      }
      case 'makeFire': {
        this.targetCampfire = world.claimCampfireSite(this.rng, this.lowFx)
        if (!this.targetCampfire || this.targetCampfire.lit) return this.enter('wander', world)
        const angle = this.rng.range(0, Math.PI * 2)
        this.setTarget({
          x: this.targetCampfire.x + Math.cos(angle) * 1.1,
          z: this.targetCampfire.z + Math.sin(angle) * 1.1,
        })
        return
      }
      case 'drink': {
        const ponds = [...world.ponds]
        this.targetPond = ponds.sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
        if (!this.targetPond) return this.enter('wander', world)
        this.setTarget(this.targetPond.shoreNear(this.x, this.z))
        return
      }
      case 'harvest': {
        this.targetTree = world.fruitingTree()
        if (!this.targetTree) return this.enter('wander', world)
        this.setTarget(this.targetTree)
        return
      }
      case 'gather': {
        if (suggestion?.kind === 'gather') {
          this.gatheringBySuggestion = true
          this.setTarget(suggestion)
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
      hasTree: world.trees.some(tree => tree.state === 'normal'),
      campfireLit: world.campfire?.lit ?? false,
      needsFire: world.needsFire(),
      hasFruitTree: world.fruitingTree() !== null,
      fireOut: world.fireOut(),
      suggestion: this.suggestion,
      rng: this.rng,
    }
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
    this.model.scale.setScalar(MODEL_SCALE)
    this.group.rotation.z = 0
    this.head.rotation.set(0, 0, 0)
    for (const arm of this.arms) arm.rotation.z = arm.userData.baseRotation
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
        const clearOfVillagers = world.villagers.every(villager => distance(candidate, villager) >= 0.75)
        if (clearOfObjects && clearOfVillagers) {
          point = candidate
          break
        }
      }
    }

    const villager = new Villager(
      `villager-${world.villagers.length}`,
      point.x,
      point.z,
      island,
      rng,
      world,
      world.bus,
      options.lowFx,
      options.animateIn,
    )
    world.villagers.push(villager)
    island.group.add(villager.group)
    spawned.push(villager)
  }
  return spawned
}

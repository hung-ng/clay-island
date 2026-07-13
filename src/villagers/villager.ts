import * as THREE from 'three'
import type { EventBus } from '../core/events'
import { RNG } from '../core/rng'
import { EmoteSprite, type EmoteKind } from '../fx/emotes'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE, TIMING } from '../ui/tokens'
import { WALK_RADIUS, type Island } from '../world/island'
import type { Hut, Tree } from '../world/objects'
import type { World } from '../world/world'
import { decideNext, stateDuration, type FsmCtx, type VillagerState } from './fsm'

type Point = { x: number; z: number }
type GraveLike = Point & { fresh: boolean }
type PondLike = Point & { radius: number }
type DeathCause = 'meteor' | 'lightning'

type SpawnOptions = {
  lowFx?: boolean
  origin?: Point
  animateIn?: boolean
}

const MODEL_SCALE = 0.75

function isGrave(value: unknown): value is GraveLike {
  if (typeof value !== 'object' || value === null) return false
  const grave = value as Partial<GraveLike>
  return typeof grave.x === 'number' && typeof grave.z === 'number' && typeof grave.fresh === 'boolean'
}

function isPond(value: unknown): value is PondLike {
  if (typeof value !== 'object' || value === null) return false
  const pond = value as Partial<PondLike>
  return typeof pond.x === 'number' && typeof pond.z === 'number' && typeof pond.radius === 'number'
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function clampToIsland(point: Point): Point {
  const radius = Math.hypot(point.x, point.z)
  if (radius <= WALK_RADIUS) return point
  return { x: point.x * WALK_RADIUS / radius, z: point.z * WALK_RADIUS / radius }
}

export class Villager {
  state: VillagerState = 'wander'
  alive = true
  group = new THREE.Group()

  private model = new THREE.Group()
  private arms: THREE.Mesh[] = []
  private emoteSprite = new EmoteSprite()
  private visualMaterials: THREE.MeshToonMaterial[] = []
  private rainLeaf: THREE.Mesh
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
  private targetPond: PondLike | null = null
  private rebuildingRuin = false
  private spawnFrames: number
  private spawnLastQt = Number.NEGATIVE_INFINITY

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

    const head = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.22, 12, 9), rng, 0.035),
      clayMaterial(PALETTE.skin),
    )
    head.position.y = 0.94
    head.scale.set(1, 0.96, 0.94)
    this.addPart(head, lowFx)

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

    this.group.add(this.model, this.emoteSprite.sprite, this.rainLeaf)
    if (lowFx) this.addBlobShadow()
    this.enter('wander', world)
  }

  update(dt: number, qt: number, world: World, island: Island): void {
    if (!this.alive) return
    if (this.zapTime >= 0) {
      this.updateZap(dt, qt)
      return
    }
    if (this.rainTime > 0) {
      this.updateRainReaction(dt, qt, world, island)
      return
    }
    const ticked = qt !== this.lastQt

    this.updateFleeTarget(dt, world)
    if (!this.arrived) this.steer(dt, world)
    this.timer -= dt
    this.performActivity(dt, ticked, world)

    if (this.timer <= 0) this.enter(decideNext(this.context(world)), world)
    if (!ticked) return
    this.lastQt = qt

    this.updateSpawnScale(qt)
    this.group.position.set(this.x, island.sampleHeight(this.x, this.z), this.z)
    this.group.rotation.y = Math.atan2(this.tx - this.x, this.tz - this.z)

    const frame = Math.floor(qt * TIMING.fps) % 4
    const sitting = this.arrived && (this.state === 'sitAtFire' || this.state === 'fish')
    this.model.scale.set(MODEL_SCALE, MODEL_SCALE * (sitting ? 0.8 : 1), MODEL_SCALE)
    this.group.rotation.z = this.arrived ? 0 : frame === 0 ? 0.09 : frame === 2 ? -0.09 : 0
    this.group.position.y += !this.arrived && frame % 2 === 0 ? 0.03 : 0
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

  zap(): void {
    if (!this.alive || this.zapTime >= 0) return
    this.zapTime = 0
    this.zapLastQt = Number.NEGATIVE_INFINITY
    this.rainTime = 0
    this.rainLeaf.visible = false
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
    this.rainLeaf.visible = true
    this.arms[0].rotation.z = -2.25
    this.emote('water')
    const hut = world.huts
      .filter(candidate => candidate.state === 'built')
      .sort((a, b) => distance(this, a) - distance(this, b))[0]
    this.setTarget(hut ?? this.randomWalkPoint())
  }

  panic(from: Point): void {
    const dx = this.x - from.x
    const dz = this.z - from.z
    const length = Math.hypot(dx, dz) || 1
    const target = clampToIsland({ x: this.x + dx / length * 5, z: this.z + dz / length * 5 })
    this.state = 'flee'
    this.timer = stateDuration('flee', this.rng)
    this.setTarget(target)
    this.emote('alarm')
  }

  private addPart(mesh: THREE.Mesh, lowFx: boolean): void {
    mesh.castShadow = !lowFx
    if (mesh.material instanceof THREE.MeshToonMaterial) {
      this.visualMaterials.push(mesh.material)
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
    this.die('lightning')
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
      this.arms[0].rotation.z = -2.25
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
          this.arms[0].rotation.z = raised ? -1.35 : this.arms[0].userData.baseRotation
          this.arms[1].rotation.z = raised ? 1.35 : this.arms[1].userData.baseRotation
          if (this.chopFrames >= 4) {
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
        if (!this.targetPond) {
          this.enter('wander', world)
          return
        }
        if (this.targetDistance() < 0.25) {
          if (!this.arrived) {
            this.arrived = true
            this.actionTimer = 4
            this.emote('fish')
          }
          this.actionTimer -= dt
          if (this.actionTimer <= 0) {
            if (this.rng.chance(0.05)) this.bus.emit({ type: 'villager:fished' })
            this.actionTimer = 4
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
    this.resetPose()
    this.state = state
    this.timer = stateDuration(state, this.rng)
    this.arrived = false
    this.actionTimer = 0
    this.chopFrames = 0
    this.targetTree = null
    this.targetHut = null
    this.targetGrave = null
    this.targetPond = null
    this.rebuildingRuin = false

    switch (state) {
      case 'wander':
        this.setTarget(this.randomWalkPoint())
        return
      case 'chopTree': {
        this.targetTree = world.choppableTree()
        if (!this.targetTree) return this.enter('wander', world)
        this.setTarget(this.targetTree)
        return
      }
      case 'buildHut': {
        this.targetHut = world.buildSite()
        if (!this.targetHut) return this.enter('wander', world)
        this.setTarget(this.targetHut)
        return
      }
      case 'sitAtFire': {
        const angle = this.rng.range(0, Math.PI * 2)
        this.setTarget({
          x: world.campfire.x + Math.cos(angle) * 1.25,
          z: world.campfire.z + Math.sin(angle) * 1.25,
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
        const ponds = world.ponds.filter(isPond)
        this.targetPond = ponds.sort((a, b) => distance(this, a) - distance(this, b))[0] ?? null
        if (!this.targetPond) return this.enter('wander', world)
        const angle = Math.atan2(this.z - this.targetPond.z, this.x - this.targetPond.x)
        this.setTarget({
          x: this.targetPond.x + Math.cos(angle) * this.targetPond.radius,
          z: this.targetPond.z + Math.sin(angle) * this.targetPond.radius,
        })
      }
    }
  }

  private context(world: World): FsmCtx {
    return {
      state: this.state,
      fireNear: world.nearestBurning(this.x, this.z, 7) !== null,
      freshGrave: world.graves.some(grave => isGrave(grave) && grave.fresh),
      hasRuin: world.huts.some(hut => hut.state === 'ruin'),
      hasSite: world.huts.some(hut => hut.state === 'site' || hut.state === 'building'),
      hasPond: world.ponds.some(isPond),
      hasTree: world.trees.some(tree => tree.state === 'normal'),
      rng: this.rng,
    }
  }

  private randomWalkPoint(): Point {
    const angle = this.rng.range(0, Math.PI * 2)
    const radius = Math.sqrt(this.rng.next()) * WALK_RADIUS * 0.9
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
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
    for (const arm of this.arms) arm.rotation.z = arm.userData.baseRotation
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

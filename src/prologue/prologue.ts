import * as THREE from 'three'
import type { CameraController } from '../camera/controller'
import { CAMERA_HOME } from '../camera/policy'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { PALETTE } from '../ui/tokens'
import type { InitialWorldBlueprint } from '../world/blueprint'
import type { GameplayWorldSet } from '../world/initial'
import { Island } from '../world/island'
import { Campfire, Hut, Tree } from '../world/objects'
import { PrologueActor } from './actor'
import {
  crossedPrologueCues,
  HUT_BEATS,
  PROLOGUE_DURATION,
  prologueStateAt,
  type PrologueCue,
  type PrologueState,
} from './choreography'

export type HandoffRecord = {
  id: string
  state: string
  position: readonly number[]
  rotation: readonly number[]
  scale: readonly number[]
  parts: readonly {
    name: string
    visible: boolean
    position: readonly number[]
    rotation: readonly number[]
    scale: readonly number[]
  }[]
}

type Recordable = { id: string; state: string; group: THREE.Object3D }

function rotationOf(object: THREE.Object3D): number[] {
  return [object.rotation.x, object.rotation.y, object.rotation.z]
}

function effectivelyVisible(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    if (current === root) return true
    current = current.parent
  }
  return false
}

function namedVisibleParts(
  root: THREE.Object3D,
  excludedRoots: ReadonlySet<THREE.Object3D> = new Set(),
): HandoffRecord['parts'] {
  const parts: HandoffRecord['parts'][number][] = []

  const visit = (object: THREE.Object3D): void => {
    for (const child of object.children) {
      if (excludedRoots.has(child)) continue
      if (!effectivelyVisible(child, root)) continue
      if (child.name) {
        parts.push({
          name: child.name,
          visible: child.visible,
          position: child.position.toArray(),
          rotation: rotationOf(child),
          scale: child.scale.toArray(),
        })
      }
      visit(child)
    }
  }
  visit(root)
  return parts.sort((a, b) => {
    const byName = a.name.localeCompare(b.name)
    if (byName !== 0) return byName
    return JSON.stringify(a).localeCompare(JSON.stringify(b))
  })
}

function record(
  item: Recordable,
  excludedRoots: ReadonlySet<THREE.Object3D> = new Set(),
): HandoffRecord {
  return {
    id: item.id,
    state: item.state,
    position: item.group.position.toArray(),
    rotation: rotationOf(item.group),
    scale: item.group.scale.toArray(),
    parts: namedVisibleParts(item.group, excludedRoots),
  }
}

function sortedRecords(items: readonly Recordable[]): HandoffRecord[] {
  return items.map(item => record(item)).sort((a, b) => a.id.localeCompare(b.id))
}

function disposeResources(root: THREE.Object3D, excludedRoots: ReadonlySet<THREE.Object3D>): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const visit = (object: THREE.Object3D, isRoot = false): void => {
    if (!isRoot && excludedRoots.has(object)) return
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry)
      const childMaterials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of childMaterials) materials.add(material)
    }
    for (const child of object.children) visit(child)
  }
  visit(root, true)
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

type MaterialPresentation = { opacity: number; transparent: boolean }

function basePresentation(material: THREE.Material): MaterialPresentation {
  const stored = material.userData.prologueBasePresentation
  if (stored && typeof stored.opacity === 'number' && typeof stored.transparent === 'boolean') {
    return stored as MaterialPresentation
  }
  const authored = { opacity: material.opacity, transparent: material.transparent }
  material.userData.prologueBasePresentation = authored
  return authored
}

function setPresentationOpacity(root: THREE.Object3D, amount: number): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      const authored = basePresentation(material)
      material.transparent = amount < 1 || authored.transparent
      material.opacity = authored.opacity * amount
    }
  })
}

function materialPile(
  id: string,
  kind: 'wood' | 'stone',
  x: number,
  y: number,
  z: number,
  lowFx: boolean,
): THREE.Mesh {
  const mesh = kind === 'wood'
    ? new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.11, 0.72, 7),
        clayMaterial(PALETTE.bark),
      )
    : new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.18, 0),
        clayMaterial(PALETTE.stone),
      )
  mesh.name = id
  mesh.position.set(x, y + 0.12, z)
  if (kind === 'wood') mesh.rotation.z = Math.PI / 2
  mesh.castShadow = !lowFx
  return mesh
}

function revealAmount(elapsed: number, beat: number): number {
  return THREE.MathUtils.clamp((elapsed - beat) / 0.12, 0, 1)
}

export class PrologueSet {
  readonly island: Island
  readonly group: THREE.Group
  readonly trees: Tree[] = []
  readonly huts: Hut[] = []
  readonly actors: PrologueActor[] = []
  readonly campfire: Campfire
  private readonly builtHuts: Hut[] = []
  private readonly materialPiles: THREE.Object3D[] = []
  private readonly blueprint: InitialWorldBlueprint
  private readonly reducedMotion: boolean
  private readonly appliedHutStages: [number, number, number] = [0, 0, 0]
  private appliedCampfireProgress = 0
  private disposed = false

  constructor(blueprint: InitialWorldBlueprint, lowFx: boolean, reducedMotion: boolean) {
    this.blueprint = blueprint
    this.reducedMotion = reducedMotion
    this.island = new Island(new RNG(blueprint.islandSeed))
    this.group = this.island.group
    this.group.name = 'prologue-island'

    let campfire: Campfire | null = null
    for (const spec of blueprint.props) {
      const y = this.island.sampleHeight(spec.x, spec.z)
      if (spec.kind === 'tree') {
        const tree = new Tree(spec.id, spec.x, spec.z, y, new RNG(spec.visualSeed), lowFx, 'sapling')
        tree.group.name = spec.id
        this.trees.push(tree)
        this.group.add(tree.group)
      } else if (spec.kind === 'hut') {
        const hut = new Hut(spec.id, spec.x, spec.z, 'site', y, new RNG(spec.visualSeed), lowFx)
        hut.group.name = spec.id
        this.huts.push(hut)
        if (spec.state === 'built') this.builtHuts.push(hut)
        this.group.add(hut.group)
      } else {
        campfire = new Campfire(spec.x, spec.z, y, new RNG(spec.visualSeed), lowFx, 'site')
        campfire.group.name = spec.id
        this.group.add(campfire.group)
      }
    }
    if (!campfire || this.builtHuts.length !== 3) {
      throw new Error('Initial blueprint must contain three built huts and one campfire')
    }
    this.campfire = campfire

    for (const spec of blueprint.villagers) {
      const actor = new PrologueActor(spec, lowFx)
      actor.settle(this.island.sampleHeight(spec.x, spec.z))
      this.actors.push(actor)
      this.group.add(actor.group)
    }
    this.createMaterialPiles(lowFx)
  }

  apply(state: PrologueState): void {
    if (this.disposed) return
    this.applyTrees(state)
    this.applyHuts(state)
    this.applyCampfire(state)
    state.actorStates.forEach((actorState, index) => this.actors[index]?.apply(actorState))
    this.applyMaterialPiles(state)
    this.group.rotation.y = state.finished ? this.blueprint.stageRotationY : this.group.rotation.y
  }

  seekFinal(): void {
    if (this.disposed) return
    this.apply(prologueStateAt(PROLOGUE_DURATION, this.blueprint, this.reducedMotion))
    for (const actor of this.actors) {
      actor.settle(this.island.sampleHeight(actor.spec.x, actor.spec.z))
    }
    for (const pile of this.materialPiles) pile.visible = false
    for (const tree of this.trees) {
      tree.group.visible = true
      tree.setGrowthProgress(1)
      setPresentationOpacity(tree.group, 1)
    }
    for (const hut of this.huts) setPresentationOpacity(hut.group, 1)
    setPresentationOpacity(this.campfire.group, 1)
    this.group.rotation.set(0, this.blueprint.stageRotationY, 0)
  }

  handoffRecords(): HandoffRecord[] {
    const entityRoots = new Set<THREE.Object3D>([
      ...this.trees.map(tree => tree.group),
      ...this.huts.map(hut => hut.group),
      this.campfire.group,
      ...this.actors.map(actor => actor.group),
      ...this.materialPiles,
    ])
    const records: HandoffRecord[] = [
      record({ id: 'island', state: 'ready', group: this.group }, entityRoots),
      ...sortedRecords(this.trees.map(tree => ({ id: tree.id, state: tree.state, group: tree.group }))),
      ...sortedRecords(this.huts.map(hut => ({ id: hut.id, state: hut.state, group: hut.group }))),
      record({ id: this.campfire.id, state: this.campfire.state, group: this.campfire.group }),
      ...sortedRecords(this.actors.map(actor => ({
        id: actor.spec.id,
        state: 'ready',
        group: actor.group,
      }))),
    ]
    return records.sort((a, b) => a.id.localeCompare(b.id))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    for (const actor of this.actors) actor.dispose()
    for (const tree of this.trees) tree.dispose()
    for (const hut of this.huts) hut.dispose()
    this.campfire.dispose()
    for (const pile of this.materialPiles) disposeResources(pile, new Set())
    const entities = new Set<THREE.Object3D>([
      ...this.trees.map(tree => tree.group),
      ...this.huts.map(hut => hut.group),
      this.campfire.group,
      ...this.actors.map(actor => actor.group),
      ...this.materialPiles,
    ])
    disposeResources(this.group, entities)
    this.group.clear()
  }

  private applyTrees(state: PrologueState): void {
    this.trees.forEach((tree, index) => {
      if (!state.reducedMotion) {
        tree.group.visible = true
        tree.setGrowthProgress(state.treeGrowth)
        setPresentationOpacity(tree.group, 1)
        return
      }
      tree.setGrowthProgress(1)
      const revealAt = 0.25 + (index % 4) * 0.42 + Math.floor(index / 4) * 0.18
      const amount = revealAmount(state.elapsed, revealAt)
      tree.group.visible = amount > 0
      if (tree.group.visible) setPresentationOpacity(tree.group, amount)
    })
  }

  private applyHuts(state: PrologueState): void {
    state.hutStages.forEach((stage, index) => {
      const hut = this.builtHuts[index]
      if (!hut) return
      while ((this.appliedHutStages[index] ?? 0) < stage) {
        hut.buildTick()
        this.appliedHutStages[index] = (this.appliedHutStages[index] ?? 0) + 1
      }
      if (!state.reducedMotion || stage === 0) {
        setPresentationOpacity(hut.group, 1)
        return
      }
      const revealAt = HUT_BEATS[index]?.[stage - 1]
      setPresentationOpacity(hut.group, revealAt === undefined ? 1 : revealAmount(state.elapsed, revealAt))
    })
  }

  private applyCampfire(state: PrologueState): void {
    const delta = Math.max(0, state.campfireProgress - this.appliedCampfireProgress)
    if (delta > 0) {
      this.campfire.buildTick(delta)
      this.appliedCampfireProgress = state.campfireProgress
    }
    if (!state.reducedMotion || state.campfireProgress <= 0) {
      setPresentationOpacity(this.campfire.group, 1)
      return
    }
    const beat = state.campfireProgress >= 1
      ? 10
      : state.campfireProgress >= 0.99
        ? 9.6
        : state.campfireProgress >= 0.66
          ? 8.8
          : 8
    setPresentationOpacity(this.campfire.group, revealAmount(state.elapsed, beat))
  }

  private applyMaterialPiles(state: PrologueState): void {
    for (let index = 0; index < 9; index++) {
      const hut = Math.floor(index / 3)
      const stage = index % 3
      const pile = this.materialPiles[index]
      if (pile) pile.visible = this.hutStage(state, hut) <= stage
    }
    for (let index = 0; index < 3; index++) {
      const consumed = state.campfireProgress >= (index + 1) * 0.33
      const pile = this.materialPiles[9 + index]
      if (pile) pile.visible = !consumed
    }
  }

  private hutStage(state: PrologueState, index: number): number {
    return state.hutStages[index] ?? 0
  }

  private createMaterialPiles(lowFx: boolean): void {
    this.builtHuts.forEach((hut, hutIndex) => {
      for (let stage = 0; stage < 3; stage++) {
        const x = hut.x + 1.6 + (stage - 1) * 0.22
        const z = hut.z
        const pile = materialPile(
          `prologue-material-hut-${hutIndex}-${stage}`,
          'wood',
          x,
          this.island.sampleHeight(x, z),
          z,
          lowFx,
        )
        pile.rotation.set(Math.PI / 2, 0, 0)
        this.materialPiles.push(pile)
        this.group.add(pile)
      }
    })
    for (let stage = 0; stage < 3; stage++) {
      const angle = stage / 3 * Math.PI * 2
      const x = Math.cos(angle) * 1.65
      const z = Math.sin(angle) * 1.65
      const pile = materialPile(
        `prologue-material-fire-${stage}`,
        'wood',
        x,
        this.island.sampleHeight(x, z),
        z,
        lowFx,
      )
      this.materialPiles.push(pile)
      this.group.add(pile)
    }
  }
}

export function gameplayHandoffRecords(gameplay: GameplayWorldSet): HandoffRecord[] {
  const { island, world } = gameplay
  const entityRoots = new Set<THREE.Object3D>([
    ...world.trees.map(tree => tree.group),
    ...world.huts.map(hut => hut.group),
    world.campfire.group,
    ...world.villagers.map(villager => villager.group),
  ])
  const records: HandoffRecord[] = [
    record({ id: 'island', state: 'ready', group: island.group }, entityRoots),
    ...sortedRecords(world.trees.map(tree => ({ id: tree.id, state: tree.state, group: tree.group }))),
    ...sortedRecords(world.huts.map(hut => ({ id: hut.id, state: hut.state, group: hut.group }))),
    record({ id: world.campfire.id, state: world.campfire.state, group: world.campfire.group }),
    ...sortedRecords(world.villagers.map(villager => ({
      id: villager.id,
      state: 'ready',
      group: villager.group,
    }))),
  ]
  return records.sort((a, b) => a.id.localeCompare(b.id))
}

export type PrologueDirectorOptions = {
  blueprint: InitialWorldBlueprint
  lowFx: boolean
  stageRoot: THREE.Group
  camera: CameraController
  reducedMotion: () => boolean
  onCue(cue: PrologueCue): void
  onFinished(): void
}

export class PrologueDirector {
  readonly set: PrologueSet
  private elapsed = 0
  private previous = 0
  private finished = false
  private disposed = false

  constructor(private readonly options: PrologueDirectorOptions) {
    this.set = new PrologueSet(options.blueprint, options.lowFx, options.reducedMotion())
    options.stageRoot.add(this.set.group)
    options.camera.lock('prologue')
    const initial = prologueStateAt(0, options.blueprint, options.reducedMotion())
    this.set.apply(initial)
    options.camera.setPose(initial.camera)
  }

  update(dt: number): void {
    if (this.finished || this.disposed) return
    this.previous = this.elapsed
    this.elapsed = Math.min(PROLOGUE_DURATION, this.elapsed + Math.max(0, dt))
    const state = prologueStateAt(
      this.elapsed,
      this.options.blueprint,
      this.options.reducedMotion(),
    )
    this.set.apply(state)
    this.options.camera.setPose(state.camera)
    for (const cue of crossedPrologueCues(this.previous, this.elapsed)) this.options.onCue(cue)
    if (state.finished) this.finish()
  }

  skip(): void {
    if (this.disposed) return
    this.finish()
  }

  finish(): void {
    if (this.finished || this.disposed) return
    this.set.seekFinal()
    this.options.camera.setPose(CAMERA_HOME)
    this.finished = true
    this.options.onFinished()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.set.dispose()
    this.options.camera.unlock('prologue')
  }
}

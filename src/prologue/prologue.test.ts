import * as THREE from 'three'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { CAMERA_HOME, type CameraPose } from '../camera/policy'
import { createInitialWorldBlueprint } from '../world/blueprint'
import { buildInitialWorld } from '../world/initial'
import { HUT_BEATS, PROLOGUE_CUES, PROLOGUE_DURATION, prologueStateAt } from './choreography'
import {
  gameplayHandoffRecords,
  PrologueDirector,
  type PrologueDirectorOptions,
  PrologueSet,
} from './prologue'

vi.mock('../fx/clayMaterial', async () => {
  const actual = await import('three')
  return {
    clayMaterial: vi.fn((color?: THREE.ColorRepresentation) =>
      new actual.MeshToonMaterial({ color: color ?? 0xffffff })),
  }
})

vi.mock('../fx/emotes', async () => {
  const actual = await import('three')
  return {
    EmoteSprite: class {
      sprite = new actual.Sprite()
      show(): void {}
      update(): void {}
    },
  }
})

function fakeCamera() {
  let pose: CameraPose = CAMERA_HOME
  return {
    lock: vi.fn(),
    unlock: vi.fn(),
    setPose: vi.fn((next: CameraPose) => { pose = next }),
    pose: vi.fn(() => pose),
  }
}

function actorPositions(set: PrologueSet): number[][] {
  return set.actors.map(actor => actor.group.position.toArray())
}

function materialPiles(set: PrologueSet): THREE.Object3D[] {
  return set.group.children.filter(child => child.name.startsWith('prologue-material-'))
}

function firstVisibleOpacity(root: THREE.Object3D): number | undefined {
  let opacity: number | undefined
  root.traverse(object => {
    if (opacity !== undefined || !(object instanceof THREE.Mesh) || !object.visible) return
    const material = Array.isArray(object.material) ? object.material[0] : object.material
    opacity = material.opacity
  })
  return opacity
}

describe('PrologueSet', () => {
  it('seeks to the exact gameplay handoff, including visible named geometry', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const gameplay = buildInitialWorld(blueprint, false)
    const prologue = new PrologueSet(blueprint, false, false)

    expect(prologue.huts).toHaveLength(3)
    expect(gameplay.world.huts).toHaveLength(3)

    prologue.seekFinal()
    const records = prologue.handoffRecords()
    expect(records).toEqual(gameplayHandoffRecords(gameplay))
    expect(records.filter(record => record.id.startsWith('hut-'))).toHaveLength(3)
    expect(records.filter(record => record.id.startsWith('hut-')).every(
      record => record.state === 'built',
    )).toBe(true)
    expect(records.find(record => record.id === 'villager-0')?.parts.length).toBeGreaterThan(4)

    const first = prologue.handoffRecords()
    prologue.seekFinal()
    expect(prologue.handoffRecords()).toEqual(first)
    expect(() => { prologue.dispose(); prologue.dispose() }).not.toThrow()
  })

  it('tracks continuous hut growth idempotently', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const set = new PrologueSet(blueprint, false, false)

    expect(set.huts.map(hut => hut.progress)).toEqual([0, 0, 0])
    const state = prologueStateAt(7, blueprint)
    set.apply(state)
    expect(set.huts.map(hut => hut.progress)).toEqual(state.hutStages)
    set.apply(state)
    expect(set.huts.map(hut => hut.progress)).toEqual(state.hutStages)
    set.apply(prologueStateAt(PROLOGUE_DURATION, blueprint))
    expect(set.huts.map(hut => hut.progress)).toEqual([1, 1, 1])
    expect(set.huts.every(hut => hut.state === 'built')).toBe(true)
    set.dispose()
  })

  it('creates nine deterministic hut logs followed by three fire logs', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const set = new PrologueSet(blueprint, false, false)
    const comparison = new PrologueSet(blueprint, false, false)
    const piles = materialPiles(set)
    const expectedNames = [
      ...Array.from({ length: 3 }, (_, hut) =>
        Array.from({ length: 3 }, (_, stage) => `prologue-material-hut-${hut}-${stage}`),
      ).flat(),
      ...Array.from({ length: 3 }, (_, stage) => `prologue-material-fire-${stage}`),
    ]

    expect(piles.map(pile => pile.name)).toEqual(expectedNames)
    expect(materialPiles(comparison).map(pile => [
      pile.name,
      pile.position.toArray(),
      pile.rotation.toArray(),
    ])).toEqual(piles.map(pile => [
      pile.name,
      pile.position.toArray(),
      pile.rotation.toArray(),
    ]))
    expect(piles.slice(9).map(pile => (pile as THREE.Mesh).geometry.type)).toEqual([
      'CylinderGeometry',
      'CylinderGeometry',
      'CylinderGeometry',
    ])
    expect(set.actors.slice(4).map(actor =>
      actor.group.getObjectByName(`${actor.spec.id}-carried-wood`)?.name,
    )).toEqual(['villager-4-carried-wood', 'villager-5-carried-wood'])
    set.huts.forEach((hut, hutIndex) => {
      for (let stage = 0; stage < 3; stage++) {
        const pile = piles[hutIndex * 3 + stage]
        expect(pile.position.x).toBeCloseTo(hut.x + 1.6 + (stage - 1) * 0.22)
        expect(pile.position.z).toBeCloseTo(hut.z)
        expect(pile.rotation.x).toBeCloseTo(Math.PI / 2)
        expect(pile.rotation.z).toBeCloseTo(0)
      }
    })

    set.apply(prologueStateAt(0, blueprint))
    expect(piles.map(pile => pile.visible)).toEqual(Array(12).fill(true))
    // By 7.3s the huts are one stage in and the fire, built during the first
    // night, has already consumed all three of its logs.
    set.apply(prologueStateAt(7.3, blueprint))
    expect(piles.map(pile => pile.visible)).toEqual([
      false, true, true,
      false, true, true,
      false, true, true,
      false, false, false,
    ])
    set.apply(prologueStateAt(PROLOGUE_DURATION, blueprint))
    expect(piles.every(pile => !pile.visible)).toBe(true)

    set.dispose()
    comparison.dispose()
  })

  it('reveals each reduced-motion hut from its exported causal beat', () => {
    const blueprint = createInitialWorldBlueprint(7)

    HUT_BEATS.forEach((beats, hutIndex) => {
      const set = new PrologueSet(blueprint, false, true)
      set.apply(prologueStateAt(beats[0] + 0.06, blueprint, true))
      expect(firstVisibleOpacity(set.huts[hutIndex].group)).toBeCloseTo(0.5)
      set.dispose()
    })
  })

  it('requires exactly three built huts', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const huts = blueprint.props.filter(prop => prop.kind === 'hut')
    const twoHuts = {
      ...blueprint,
      props: blueprint.props.filter(prop => prop.kind !== 'hut' || prop.id !== 'hut-2'),
    }
    const fourHuts = {
      ...blueprint,
      props: [
        ...blueprint.props,
        { ...huts[0], id: 'hut-3', x: huts[0].x + 1 },
      ],
    }

    expect(() => new PrologueSet(twoHuts, false, false)).toThrow(
      'Initial blueprint must contain three built huts and one campfire',
    )
    expect(() => new PrologueSet(fourHuts, false, false)).toThrow(
      'Initial blueprint must contain three built huts and one campfire',
    )
  })

  it('uses stable reduced-motion compositions between causal beats', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const set = new PrologueSet(blueprint, false, true)

    set.apply(prologueStateAt(3.3, blueprint, true))
    const treeScalesBefore = set.trees.map(tree =>
      tree.group.getObjectByName('tree-trunk')!.scale.toArray())
    const actorsBefore = actorPositions(set)
    set.apply(prologueStateAt(3.4, blueprint, true))

    expect(set.trees.map(tree =>
      tree.group.getObjectByName('tree-trunk')!.scale.toArray())).toEqual(treeScalesBefore)
    expect(actorPositions(set)).toEqual(actorsBefore)
    expect(set.trees.every(tree =>
      tree.group.getObjectByName('tree-trunk')!.scale.equals(new THREE.Vector3(1, 1, 1)))).toBe(true)

    set.seekFinal()
    const gameplay = buildInitialWorld(blueprint, false)
    expect(set.handoffRecords()).toEqual(gameplayHandoffRecords(gameplay))
    const finalTrunk = set.trees[0].group.getObjectByName('tree-trunk') as THREE.Mesh
    expect((finalTrunk.material as THREE.Material).transparent).toBe(false)
    set.dispose()
  })

  it('matches the reduced-quality villager blob-shadow presentation', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const gameplay = buildInitialWorld(blueprint, true)
    const prologue = new PrologueSet(blueprint, true, false)
    prologue.seekFinal()

    const visibleDirectMeshes = (root: THREE.Object3D): THREE.Mesh[] =>
      root.children.filter(child => child instanceof THREE.Mesh && child.visible) as THREE.Mesh[]
    const gameplayShadows = visibleDirectMeshes(gameplay.world.villagers[0].group)
    const prologueShadows = visibleDirectMeshes(prologue.actors[0].group)

    expect(prologueShadows.map(mesh => [
      mesh.position.toArray(), mesh.rotation.x, mesh.scale.toArray(),
    ])).toEqual(gameplayShadows.map(mesh => [
      mesh.position.toArray(), mesh.rotation.x, mesh.scale.toArray(),
    ]))
    prologue.dispose()
  })
})

describe('PrologueDirector', () => {
  it('continues the title orbit through Begin and carries its view into handoff', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const camera = fakeCamera()
    const onFinished = vi.fn()
    const director = new PrologueDirector({
      blueprint,
      lowFx: false,
      stageRoot: new THREE.Group(),
      camera: camera as never,
      reducedMotion: () => false,
      onCue: vi.fn(),
      onFinished,
      applyDay: vi.fn(),
    })

    director.updateTitlePreview(PROLOGUE_DURATION / 2)
    const titlePose = camera.pose()
    expect(titlePose.position.x).toBeCloseTo(34)
    expect(titlePose.position.z).toBeCloseTo(0)

    director.update(0)
    expect(camera.pose()).toEqual(titlePose)
    director.update(PROLOGUE_DURATION)

    expect(onFinished).toHaveBeenCalledOnce()
    expect(camera.pose().position.x).toBeCloseTo(-34)
    expect(camera.pose().position.z).toBeCloseTo(0)
    expect(camera.pose()).not.toEqual(CAMERA_HOME)
  })

  it('owns one isolated session, crosses uneven updates once, and cleans up safely', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const stageRoot = new THREE.Group()
    const camera = fakeCamera()
    const onCue = vi.fn()
    const onFinished = vi.fn()
    const director = new PrologueDirector({
      blueprint,
      lowFx: false,
      stageRoot,
      camera: camera as never,
      reducedMotion: () => false,
      onCue,
      onFinished,
      applyDay: vi.fn(),
    })

    const initialSet = director.set
    expect(stageRoot.children).toEqual([initialSet.group])
    expect(onCue).not.toHaveBeenCalled()
    expect(onFinished).not.toHaveBeenCalled()
    expect(camera.setPose).toHaveBeenLastCalledWith(prologueStateAt(0, blueprint).camera)

    director.update(0.7)
    expect(director.set).toBe(initialSet)
    for (const dt of [1.43, 0.92, 2.31, 0.17, 3.08, 0.56, 2.3]) director.update(dt)
    director.update(6)

    expect(onCue.mock.calls.map(([cue]) => cue)).toEqual(PROLOGUE_CUES)
    expect(onFinished).toHaveBeenCalledOnce()
    expect(camera.lock).toHaveBeenCalledWith('prologue')
    expect(camera.setPose).toHaveBeenLastCalledWith(CAMERA_HOME)
    expect(stageRoot.children).toContain(director.set.group)

    director.dispose()
    director.dispose()
    expect(stageRoot.children).not.toContain(director.set.group)
    expect(camera.unlock).toHaveBeenCalledOnce()
  })

  it('can switch to reduced motion without changing elapsed time or causal beats', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const stageRoot = new THREE.Group()
    const camera = fakeCamera()
    let reduced = false
    const onCue = vi.fn()
    const director = new PrologueDirector({
      blueprint,
      lowFx: false,
      stageRoot,
      camera: camera as never,
      reducedMotion: () => reduced,
      onCue,
      onFinished: vi.fn(),
      applyDay: vi.fn(),
    })

    director.update(3.3)
    reduced = true
    director.update(0.1)
    expect(camera.setPose).toHaveBeenLastCalledWith(CAMERA_HOME)
    director.update(13.6)
    expect(onCue.mock.calls.map(([cue]) => cue)).toEqual(PROLOGUE_CUES)
  })

  it('uses the same idempotent final-seek path when an authorized caller skips', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const gameplay = buildInitialWorld(blueprint, false)
    const camera = fakeCamera()
    const onFinished = vi.fn()
    const onCue = vi.fn()
    const director = new PrologueDirector({
      blueprint,
      lowFx: false,
      stageRoot: new THREE.Group(),
      camera: camera as never,
      reducedMotion: () => false,
      onCue,
      onFinished,
      applyDay: vi.fn(),
    })

    director.update(4.1)
    director.skip()
    director.skip()
    director.finish()

    expect(director.set.handoffRecords()).toEqual(gameplayHandoffRecords(gameplay))
    expect(onFinished).toHaveBeenCalledOnce()
    expect(onCue.mock.calls.map(([cue]) => cue)).toEqual(
      PROLOGUE_CUES.filter(cue => cue.at <= 4.1),
    )
    expect(camera.setPose).toHaveBeenLastCalledWith(CAMERA_HOME)
  })

  it('drives scene lighting from the prologue day sweep', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const applied: string[] = []
    const director = new PrologueDirector({
      blueprint,
      lowFx: true,
      stageRoot: new THREE.Group(),
      camera: fakeCamera() as never,
      reducedMotion: () => false,
      onCue: () => {},
      onFinished: () => {},
      applyDay: params => { applied.push(params.kind) },
    })

    for (let step = 0; step < 34; step++) director.update(0.5)

    expect(applied.length).toBeGreaterThan(0)
    expect(applied).toContain('night')
    expect(applied).toContain('day')
    director.dispose()
  })

  it('exposes its current day sample so the render loop can sweep night effects', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const director = new PrologueDirector({
      blueprint,
      lowFx: true,
      stageRoot: new THREE.Group(),
      camera: fakeCamera() as never,
      reducedMotion: () => false,
      onCue: () => {},
      onFinished: () => {},
      applyDay: () => {},
    })

    const kinds = new Set<string>()
    const starLevels: number[] = []
    for (let step = 0; step < 34; step++) {
      director.update(0.5)
      kinds.add(director.dayParams().kind)
      starLevels.push(director.dayParams().starOpacity)
    }

    // The sweep must actually pass through night, not merely dim.
    expect(kinds.has('night')).toBe(true)
    expect(kinds.has('day')).toBe(true)
    // Stars must actually come out, or nights read as dim rather than dark.
    expect(Math.max(...starLevels)).toBeGreaterThan(0.5)
    director.dispose()
  })

  it('has no gameplay-world or event-bus dependency in its constructor contract', () => {
    expectTypeOf<PrologueDirectorOptions>().not.toHaveProperty('world')
    expectTypeOf<PrologueDirectorOptions>().not.toHaveProperty('eventBus')
  })
})

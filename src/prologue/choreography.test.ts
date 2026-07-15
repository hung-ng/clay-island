import { describe, expect, it } from 'vitest'
import { CAMERA_HOME } from '../camera/policy'
import { createInitialWorldBlueprint } from '../world/blueprint'
import {
  crossedPrologueCues,
  HUT_BEATS,
  PROLOGUE_CUES,
  PROLOGUE_DURATION,
  prologueStateAt,
} from './choreography'

describe('prologue choreography', () => {
  const blueprint = createInitialWorldBlueprint(7)

  it('uses the approved causal eleven-second beats', () => {
    expect(PROLOGUE_DURATION).toBe(11)
    expect(HUT_BEATS).toEqual([
      [3.2, 4.8, 6.4],
      [3.4, 5, 6.6],
      [3.6, 5.2, 6.8],
    ])
    expect(prologueStateAt(0, blueprint).treeGrowth).toBe(0)
    expect(prologueStateAt(2.5, blueprint).treeGrowth).toBe(1)
    expect(prologueStateAt(3.19, blueprint).hutStages).toEqual([0, 0, 0])
    expect(prologueStateAt(3.6, blueprint).hutStages).toEqual([1, 1, 1])
    expect(prologueStateAt(6.8, blueprint).hutStages).toEqual([3, 3, 3])
    expect(prologueStateAt(7.49, blueprint).campfireProgress).toBe(0)
    expect(prologueStateAt(10, blueprint).campfireProgress).toBe(1)
    expect(prologueStateAt(10, blueprint).ignited).toBe(true)
  })

  it('keeps each construction beat visibly causal', () => {
    const hutBeats = [
      [3.2, 0, 0], [3.4, 1, 2], [3.6, 2, 4],
      [4.8, 0, 1], [5, 1, 3], [5.2, 2, 5],
      [6.4, 0, 0], [6.6, 1, 2], [6.8, 2, 4],
    ] as const
    for (const [at, hutIndex, actor] of hutBeats) {
      const state = prologueStateAt(at, blueprint)
      expect(state.hutStages[hutIndex]).toBeGreaterThan(0)
      expect(state.actorStates[actor].pose).toBe('hammer')
    }

    for (const [at, actor] of [[8, 4], [8.8, 5], [9.6, 4]] as const) {
      expect(prologueStateAt(at, blueprint).actorStates[actor].pose).toBe('place')
    }

    expect(prologueStateAt(8.4, blueprint).actorStates.slice(4).map(
      actor => actor.carry,
    )).toEqual(['wood', 'wood'])
  })

  it('orbits at constant height, radius, target, and angular speed', () => {
    const samples = [0, 2.75, 5.5, 8.25, 11]
      .map(elapsed => prologueStateAt(elapsed, blueprint).camera)

    for (const pose of samples) {
      expect(pose.position.y).toBe(14)
      expect(Math.hypot(pose.position.x, pose.position.z)).toBeCloseTo(34)
      expect(pose.target).toEqual({ x: 0, y: 0, z: 0 })
    }

    const angles = samples.map(pose => Math.atan2(pose.position.x, pose.position.z))
    const unwrapped = angles.map(angle => angle < 0 ? angle + Math.PI * 2 : angle)
    expect(unwrapped[0]).toBeCloseTo(Math.PI)
    expect(unwrapped[1] - unwrapped[0]).toBeCloseTo(-Math.PI / 4)
    expect(unwrapped[2] - unwrapped[1]).toBeCloseTo(-Math.PI / 4)
    expect(unwrapped[3] - unwrapped[2]).toBeCloseTo(-Math.PI / 4)
    expect(unwrapped[4] - unwrapped[3]).toBeCloseTo(-Math.PI / 4)
    expect(samples.at(-1)).toEqual(CAMERA_HOME)
  })

  it('ends on the exact camera home pose and blueprint frame', () => {
    const final = prologueStateAt(11, blueprint)
    expect(final.camera).toEqual(CAMERA_HOME)
    expect(final.frame).toBe(blueprint.handoffFrame)
    expect(final.finished).toBe(true)
  })

  it('uses stable home framing under reduced motion', () => {
    expect(prologueStateAt(0, blueprint, true).camera).toEqual(CAMERA_HOME)
    expect(prologueStateAt(5.5, blueprint, true).camera).toEqual(CAMERA_HOME)
    expect(prologueStateAt(11, blueprint, true).camera).toEqual(CAMERA_HOME)
  })

  it('emits every crossed cue once, including across a frame hitch', () => {
    expect(crossedPrologueCues(3.1, 5.3).map(cue => cue.kind)).toEqual([
      'hammer', 'hammer', 'hammer', 'hammer', 'hammer', 'hammer',
    ])
    expect(crossedPrologueCues(0, 11)).toEqual(PROLOGUE_CUES)
    expect(crossedPrologueCues(5, 5)).toEqual([])
  })
})

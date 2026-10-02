import { describe, expect, it } from 'vitest'
import { CAMERA_HOME } from '../camera/policy'
import { GOLDEN_T, sampleAt } from '../core/dayClock'
import { createInitialWorldBlueprint } from '../world/blueprint'
import {
  crossedPrologueCues,
  HUT_BEATS,
  PROLOGUE_CUES,
  PROLOGUE_DURATION,
  TREE_CHOPS,
  prologueDayParams,
  prologueStateAt,
} from './choreography'

describe('prologue choreography', () => {
  const blueprint = createInitialWorldBlueprint(7)

  it('uses the approved causal seventeen-second beats', () => {
    expect(PROLOGUE_DURATION).toBe(17)
    expect(HUT_BEATS).toEqual([
      [4.4, 7.6, 10.8],
      [4.8, 8, 11.2],
      [5.2, 8.4, 11.6],
    ])
    expect(prologueStateAt(0, blueprint).treeGrowth).toBe(0)
    expect(prologueStateAt(PROLOGUE_DURATION, blueprint).treeGrowth).toBe(1)
    expect(prologueStateAt(0, blueprint).hutStages[0]).toBe(0)
    expect(prologueStateAt(17, blueprint).hutStages).toEqual([1, 1, 1])
    // The fire is laid and lit during the first night, then burns for the rest.
    expect(prologueStateAt(1.2, blueprint).campfireProgress).toBe(0)
    expect(prologueStateAt(2.7, blueprint).campfireProgress).toBe(1)
    expect(prologueStateAt(2.7, blueprint).ignited).toBe(true)
    expect(prologueStateAt(PROLOGUE_DURATION, blueprint).ignited).toBe(true)
  })

  it('grows huts continuously rather than snapping between stages', () => {
    const samples = Array.from(
      { length: 60 },
      (_, index) => prologueStateAt(1 + index * 0.2, blueprint).hutStages[0],
    )

    for (let index = 1; index < samples.length; index++) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]!)
    }

    for (let index = 1; index < samples.length; index++) {
      expect(samples[index]! - samples[index - 1]!).toBeLessThan(0.2)
    }

    const mid = prologueStateAt(7, blueprint).hutStages
    expect(mid[0]).not.toBeCloseTo(mid[2], 2)
  })

  it('never parks a villager during the build stretch', () => {
    for (let actor = 0; actor < 6; actor++) {
      const positions = Array.from(
        { length: 48 },
        (_, index) => prologueStateAt(3 + index * 0.25, blueprint).actorStates[actor]!.position,
      )

      let longestStill = 0
      let run = 0
      for (let index = 1; index < positions.length; index++) {
        const previous = positions[index - 1]!
        const current = positions[index]!
        const moved = Math.hypot(current.x - previous.x, current.z - previous.z)
        run = moved < 0.01 ? run + 1 : 0
        longestStill = Math.max(longestStill, run)
      }

      expect(longestStill).toBeLessThan(4)
    }
  })

  it('keeps each construction beat visibly causal', () => {
    const hutBeats = [
      [4.4, 0, 0], [4.8, 1, 2], [5.2, 2, 4],
      [7.6, 0, 1], [8, 1, 3], [8.4, 2, 5],
      [10.8, 0, 0], [11.2, 1, 2], [11.6, 2, 4],
    ] as const
    for (const [at, hutIndex, actor] of hutBeats) {
      const state = prologueStateAt(at, blueprint)
      expect(state.hutStages[hutIndex]).toBeGreaterThan(0)
      expect(state.actorStates[actor].pose).toBe('hammer')
    }

    for (const [at, actor] of [[1.3, 4], [1.8, 5], [2.3, 4]] as const) {
      expect(prologueStateAt(at, blueprint).actorStates[actor].pose).toBe('place')
    }

    for (const actor of [4, 5]) {
      const carries = Array.from(
        { length: 40 },
        (_, index) => prologueStateAt(3 + index * 0.2, blueprint).actorStates[actor]!.carry,
      )
      expect(carries).toContain('wood')
      expect(carries).toContain(null)
    }
  })

  it('orbits continuously at constant height, radius, and target', () => {
    const samples = [0, 4.25, 8.5, 12.75, 17]
      .map(elapsed => prologueStateAt(elapsed, blueprint).camera)

    for (const pose of samples) {
      expect(pose.position.y).toBe(14)
      expect(Math.hypot(pose.position.x, pose.position.z)).toBeCloseTo(34)
      expect(pose.target).toEqual({ x: 0, y: 0, z: 0 })
    }

    const angles = samples.map(pose => Math.atan2(pose.position.x, pose.position.z))
    const unwrapped = angles.map(angle => angle < 0 ? angle + Math.PI * 2 : angle)
    expect(unwrapped[0]).toBeCloseTo(Math.PI)
    for (let index = 1; index < unwrapped.length; index++) {
      expect(unwrapped[index]!).toBeLessThan(unwrapped[index - 1]!)
    }
    expect(unwrapped.at(-1)).toBeCloseTo(0)
    expect(samples.at(-1)).toEqual(CAMERA_HOME)
  })

  it('ends on the exact camera home pose and blueprint frame', () => {
    const final = prologueStateAt(17, blueprint)
    expect(final.camera).toEqual(CAMERA_HOME)
    expect(final.frame).toBe(blueprint.handoffFrame)
    expect(final.finished).toBe(true)
  })

  it('uses stable home framing under reduced motion', () => {
    expect(prologueStateAt(0, blueprint, true).camera).toEqual(CAMERA_HOME)
    expect(prologueStateAt(8.5, blueprint, true).camera).toEqual(CAMERA_HOME)
    expect(prologueStateAt(17, blueprint, true).camera).toEqual(CAMERA_HOME)
  })

  it('sweeps three day-night cycles and lands on the golden handoff phase', () => {
    // The sweep opens on the golden phase the title already holds, so the first
    // transition the viewer sees is that evening's sunset.
    expect(prologueDayParams(0).kind).toBe('dusk')
    expect(prologueDayParams(PROLOGUE_DURATION).t).toBeCloseTo(GOLDEN_T, 5)

    const kinds = Array.from(
      { length: 171 },
      (_, index) => prologueDayParams(index / 10).kind,
    )
    let nightRuns = 0
    kinds.forEach((kind, index) => {
      if (kind === 'night' && kinds[index - 1] !== 'night') nightRuns++
    })
    expect(nightRuns).toBe(3)
  })

  it('opens and closes on the canonical golden look with no visible cut', () => {
    // The title holds the canonical golden sample and only advances the preview
    // orbit, so any phase mismatch at t=0 snaps the sky in a single frame. The
    // sweep therefore has to both start and end exactly where the title sits.
    const canonical = sampleAt(GOLDEN_T)
    for (const at of [0, PROLOGUE_DURATION]) {
      const edge = prologueDayParams(at)
      expect(edge.skyHigh).toBe(canonical.skyHigh)
      expect(edge.skyLow).toBe(canonical.skyLow)
      expect(edge.keyIntensity).toBeCloseTo(canonical.keyIntensity, 9)
      expect(edge.starOpacity).toBeCloseTo(canonical.starOpacity, 9)
      expect(edge.fireflyLevel).toBeCloseTo(canonical.fireflyLevel, 9)
    }

    // The opening must ease away from the title look rather than cut to it. Any
    // large single-frame jump is the flash this test exists to catch.
    const early = Array.from({ length: 61 }, (_, index) => prologueDayParams(index / 60))
    expect(early[0]!.starOpacity).toBe(0)
    for (let index = 1; index < early.length; index++) {
      expect(early[index]!.starOpacity - early[index - 1]!.starOpacity).toBeLessThan(0.12)
    }
  })

  it('grows the trees across the whole intro rather than the opening seconds', () => {
    // Trees once finished at 3.6s, so the forest was static for four fifths of
    // the run while everything else kept moving.
    expect(prologueStateAt(3.6, blueprint).treeGrowth).toBeLessThan(0.6)
    expect(prologueStateAt(PROLOGUE_DURATION / 2, blueprint).treeGrowth).toBeLessThan(0.95)
    expect(prologueStateAt(PROLOGUE_DURATION, blueprint).treeGrowth).toBe(1)

    const samples = Array.from(
      { length: 60 },
      (_, index) => prologueStateAt(index * PROLOGUE_DURATION / 59, blueprint).treeGrowth,
    )
    for (let index = 1; index < samples.length; index++) {
      expect(samples[index]!).toBeGreaterThanOrEqual(samples[index - 1]!)
    }
    // Still visibly growing well past the halfway mark.
    expect(samples.at(-1)! - samples[Math.floor(samples.length * 0.7)]!).toBeGreaterThan(0.02)
  })

  it('fells trees for timber and regrows them before the handoff', () => {
    const felled = prologueStateAt(TREE_CHOPS[0].at + 0.25, blueprint).treeGrowths[TREE_CHOPS[0].tree]!
    const standing = prologueStateAt(TREE_CHOPS[0].at - 0.5, blueprint).treeGrowths[TREE_CHOPS[0].tree]!
    expect(felled).toBeLessThan(standing)
    expect(felled).toBeLessThan(0.3)

    // Gameplay builds all twelve trees 'normal', so the prologue has to hand
    // back a full-grown forest however many were cut down along the way.
    const final = prologueStateAt(PROLOGUE_DURATION, blueprint).treeGrowths
    expect(final).toHaveLength(12)
    for (const growth of final) expect(growth).toBe(1)

    // Every chop must land while somebody is actually working, not after.
    for (const chop of TREE_CHOPS) {
      expect(chop.at).toBeGreaterThan(0)
      expect(chop.at).toBeLessThan(PROLOGUE_DURATION - 2)
    }
  })

  it('varies each cycle so the sweep reads as a progression, not a loop', () => {
    const step = PROLOGUE_DURATION / 3400
    const runs: { kind: string; seconds: number }[] = []
    for (let index = 0; index <= 3400; index++) {
      const kind = prologueDayParams(index * step).kind
      const last = runs.at(-1)
      if (last?.kind === kind) last.seconds += step
      else runs.push({ kind, seconds: step })
    }

    const nights = runs.filter(run => run.kind === 'night').map(run => run.seconds)
    expect(nights).toHaveLength(3)
    // Identical cycles read as a pulsing loop; the lengths must actually differ.
    expect(Math.max(...nights) - Math.min(...nights)).toBeGreaterThan(0.3)
  })

  it('dwells on night and twilight instead of racing through them', () => {
    const step = PROLOGUE_DURATION / 1700
    const held: Record<string, number> = { dawn: 0, day: 0, dusk: 0, night: 0 }
    for (let index = 0; index <= 1700; index++) {
      held[prologueDayParams(index * step).kind]! += step
    }

    // A linear sweep leaves ~4.3s of night and ~1.2s of dawn, so nights and
    // sunrises read as a flicker. The shaped sweep trades the flat midday
    // plateau away for the parts of the sky that actually change.
    expect(held.night!).toBeGreaterThan(4.5)
    expect(held.dawn!).toBeGreaterThan(3)
    expect(held.dusk! + held.night! + held.dawn!).toBeGreaterThan(PROLOGUE_DURATION / 2)
    expect(held.day!).toBeLessThan(PROLOGUE_DURATION / 2)

    // The shaping must not disturb the canonical handoff.
    const final = prologueDayParams(PROLOGUE_DURATION)
    expect(final.t).toBeCloseTo(GOLDEN_T, 5)
    expect(final.starOpacity).toBeCloseTo(0, 5)
  })

  it('holds a single daylight sample under reduced motion', () => {
    const samples = [0, 4, 8.5, 13, 17].map(
      elapsed => prologueDayParams(elapsed, true),
    )
    for (const sample of samples) expect(sample.t).toBe(GOLDEN_T)
  })

  it('emits every crossed cue once, including across a frame hitch', () => {
    // The window spans two rounds of hammering and the second tree felling.
    expect(crossedPrologueCues(4.3, 8.5).map(cue => cue.kind)).toEqual([
      'hammer', 'hammer', 'hammer', 'chop', 'hammer', 'hammer', 'hammer',
    ])
    expect(crossedPrologueCues(0, 17)).toEqual(PROLOGUE_CUES)
    expect(crossedPrologueCues(5, 5)).toEqual([])
  })
})

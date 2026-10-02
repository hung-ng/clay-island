import { describe, it, expect } from 'vitest'
import type { PowerId, TargetKind } from '../core/events'
import { INTERACTION_KINDS, resolveInteraction, type InteractionKind } from './matrix'
import { OUTCOME_HANDLERS } from './outcomes'

const POWERS: PowerId[] = ['meteor', 'lightning', 'rain', 'nudge', 'wind']
const TARGETS: TargetKind[] = ['ground', 'tree', 'hut', 'villager', 'pond', 'crater', 'campfire']

const EXPECTED: Record<PowerId, Record<TargetKind, InteractionKind[]>> = {
  meteor: {
    tree: ['destroy'],
    hut: ['destroy'],
    villager: ['kill'],
    pond: ['emptyPond', 'steam'],
    campfire: ['scatter'],
    crater: [],
    ground: [],
  },
  lightning: {
    tree: ['ignite'],
    hut: ['ignite'],
    villager: ['zap'],
    pond: ['stunFish'],
    campfire: ['flare'],
    crater: [],
    ground: [],
  },
  rain: {
    tree: ['growFruit'],
    hut: [],
    villager: ['grumpy'],
    pond: [],
    campfire: [],
    crater: [],
    ground: [],
  },
  nudge: {
    tree: ['suggest'],
    hut: ['suggest'],
    villager: ['startleVillager'],
    pond: ['suggest'],
    campfire: ['suggest'],
    crater: [],
    ground: ['suggest'],
  },
  wind: {
    tree: [],
    hut: ['scatter'],
    villager: ['tumble'],
    pond: [],
    campfire: ['flare'],
    crater: [],
    ground: [],
  },
}

describe('resolveInteraction', () => {
  for (const power of POWERS) {
    for (const target of TARGETS) {
      it(`${power} on ${target}`, () => {
        expect(resolveInteraction(power, target)).toEqual(EXPECTED[power][target])
      })
    }
  }

  it('returns an array for every pair, never undefined', () => {
    for (const power of POWERS) {
      for (const target of TARGETS) {
        expect(Array.isArray(resolveInteraction(power, target))).toBe(true)
      }
    }
  })

  it('leaves a crater unchanged by a nudge', () => {
    expect(resolveInteraction('nudge', 'crater')).toEqual([])
  })
})

describe('matrix completeness', () => {
  it('covers all 35 power-target cells explicitly', () => {
    let cells = 0
    for (const power of POWERS) {
      for (const target of TARGETS) {
        expect(Array.isArray(resolveInteraction(power, target))).toBe(true)
        cells++
      }
    }
    expect(cells).toBe(35)
  })

  it('every kind the matrix can emit has a handler', () => {
    const emitted = new Set<InteractionKind>()
    for (const power of POWERS) {
      for (const target of TARGETS) {
        for (const kind of resolveInteraction(power, target)) emitted.add(kind)
      }
    }
    for (const kind of emitted) {
      expect(OUTCOME_HANDLERS[kind], `no handler for '${kind}'`).toBeTypeOf('function')
    }
  })

  it('every declared kind has a handler', () => {
    for (const kind of INTERACTION_KINDS) {
      expect(OUTCOME_HANDLERS[kind], `no handler for '${kind}'`).toBeTypeOf('function')
    }
  })

  it('declares no kind the matrix can never emit', () => {
    const emitted = new Set<InteractionKind>()
    for (const power of POWERS) {
      for (const target of TARGETS) {
        for (const kind of resolveInteraction(power, target)) emitted.add(kind)
      }
    }
    expect([...INTERACTION_KINDS].sort()).toEqual([...emitted].sort())
  })
})

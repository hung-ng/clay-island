import { describe, it, expect } from 'vitest'
import { RNG } from '../core/rng'
import {
  decideNext,
  stateDuration,
  stateForSuggestion,
  STATES,
  type FsmCtx,
} from './fsm'

const base = (o: Partial<FsmCtx> = {}): FsmCtx => ({
  state: 'wander', fireNear: false, freshGrave: false, hasRuin: false,
  hasSite: false, hasPond: false, hasTree: true, campfireLit: true,
  hasFishPond: false, needsFire: false, hasFruitTree: false, fireOut: false,
  suggestion: null, rng: new RNG(3), ...o,
})

describe('FSM shape', () => {
  it('has exactly 12 states', () => {
    expect(STATES).toHaveLength(12)
    expect([...STATES].sort()).toEqual(
      [
        'buildHut', 'chopTree', 'drink', 'fish', 'flee', 'gather',
        'harvest', 'makeFire', 'mourn', 'rebuild', 'sitAtFire', 'wander',
      ],
    )
  })
})

describe('triggers override everything', () => {
  it('fire nearby always flees, from any state', () => {
    for (const s of STATES) {
      expect(decideNext(base({ state: s, fireNear: true }))).toBe('flee')
    }
  })
  it('fire beats a fresh grave — self-preservation first', () => {
    expect(decideNext(base({ fireNear: true, freshGrave: true }))).toBe('flee')
  })
  it('a fresh grave pulls a mourner', () => {
    expect(decideNext(base({ freshGrave: true }))).toBe('mourn')
  })
  it('a ruin pulls a rebuilder', () => {
    expect(decideNext(base({ hasRuin: true }))).toBe('rebuild')
  })
})

describe('weighted idle selection', () => {
  it('only ever returns states whose preconditions hold', () => {
    for (let seed = 0; seed < 200; seed++) {
      const ctx = base({ rng: new RNG(seed), hasTree: false, hasSite: false, hasPond: false })
      const next = decideNext(ctx)
      expect(['wander', 'sitAtFire']).toContain(next)
    }
  })
  it('fishes only when at least one pond is stocked', () => {
    let fished = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({
        rng: new RNG(seed),
        hasPond: true,
        hasFishPond: true,
      })) === 'fish') fished = true
    }
    expect(fished).toBe(true)

    for (let seed = 0; seed < 300; seed++) {
      expect(decideNext(base({
        rng: new RNG(seed),
        hasPond: true,
        hasFishPond: false,
      }))).not.toBe('fish')
    }
  })
  it('does not gather at a doused campfire', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(decideNext(base({ rng: new RNG(seed), campfireLit: false }))).not.toBe('sitAtFire')
    }
  })
  it('harvests only when a tree is fruiting', () => {
    let harvested = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({ rng: new RNG(seed), hasFruitTree: true })) === 'harvest') {
        harvested = true
      }
    }
    expect(harvested).toBe(true)
    for (let seed = 0; seed < 300; seed++) {
      expect(decideNext(base({ rng: new RNG(seed), hasFruitTree: false }))).not.toBe('harvest')
    }
  })
  it('gathers at the dead fire only when the fire is out', () => {
    let gathered = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({ rng: new RNG(seed), fireOut: true })) === 'gather') gathered = true
      expect(decideNext(base({ rng: new RNG(seed), fireOut: false }))).not.toBe('gather')
    }
    expect(gathered).toBe(true)
  })
  it('never rolls drink from idle but accepts a drink suggestion at a pond', () => {
    for (let seed = 0; seed < 400; seed++) {
      expect(decideNext(base({ rng: new RNG(seed), hasPond: true }))).not.toBe('drink')
    }

    expect(decideNext(base({
      hasPond: true,
      suggestion: { kind: 'drink', x: 0, z: 0 },
      rng: { next: () => 0.5 } as unknown as RNG,
    }))).toBe('drink')
  })

  it('rejects a drink suggestion when no pond exists', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(decideNext(base({
        hasPond: false,
        suggestion: { kind: 'drink', x: 0, z: 0 },
        rng: new RNG(seed),
      }))).not.toBe('drink')
    }
  })
  it('is deterministic for a given seed', () => {
    expect(decideNext(base({ rng: new RNG(11) }))).toBe(decideNext(base({ rng: new RNG(11) })))
  })
})

describe('a nudge suggests, it never commands', () => {
  it('maps every suggestion kind to its activity state', () => {
    expect(stateForSuggestion('chop')).toBe('chopTree')
    expect(stateForSuggestion('fish')).toBe('fish')
    expect(stateForSuggestion('drink')).toBe('drink')
    expect(stateForSuggestion('harvest')).toBe('harvest')
    expect(stateForSuggestion('build')).toBe('buildHut')
    expect(stateForSuggestion('makeFire')).toBe('makeFire')
    expect(stateForSuggestion('gather')).toBe('gather')
  })

  it('usually takes a suggestion', () => {
    let taken = 0
    for (let seed = 0; seed < 300; seed++) {
      const next = decideNext(base({
        rng: new RNG(seed),
        hasTree: true,
        suggestion: { kind: 'chop', x: 0, z: 0 },
      }))
      if (next === 'chopTree') taken++
    }
    expect(taken).toBeGreaterThan(200)
    expect(taken).toBeLessThan(300)
  })

  it('is ignored outright by an emergency', () => {
    expect(decideNext(base({
      fireNear: true,
      suggestion: { kind: 'chop', x: 0, z: 0 },
    }))).toBe('flee')
  })

  it('cannot suggest an impossible activity', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(decideNext(base({
        rng: new RNG(seed),
        hasTree: false,
        suggestion: { kind: 'chop', x: 0, z: 0 },
      }))).not.toBe('chopTree')
    }
  })

  it('accepts harvesting as a suggestion only while fruit exists', () => {
    let taken = 0
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({
        rng: new RNG(seed),
        hasFruitTree: true,
        suggestion: { kind: 'harvest', x: 0, z: 0 },
      })) === 'harvest') taken++
    }
    expect(taken).toBeGreaterThan(200)

    for (let seed = 0; seed < 100; seed++) {
      expect(decideNext(base({
        rng: new RNG(seed),
        hasFruitTree: false,
        suggestion: { kind: 'harvest', x: 0, z: 0 },
      }))).not.toBe('harvest')
    }
  })
})

describe('makeFire', () => {
  it('allows enough time to cross the island and build before its watchdog expires', () => {
    expect(stateDuration('makeFire', new RNG(1))).toBe(35)
  })

  it('is reachable when the village has no usable fire', () => {
    const picked = new Set<string>()
    for (let seed = 0; seed < 200; seed++) {
      picked.add(decideNext(base({
        needsFire: true,
        campfireLit: false,
        hasTree: false,
        rng: new RNG(seed),
      })))
    }
    expect(picked.has('makeFire')).toBe(true)
  })

  it('is never chosen when the fire is already lit', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(decideNext(base({
        needsFire: false,
        campfireLit: true,
        rng: new RNG(seed),
      }))).not.toBe('makeFire')
    }
  })

  it('yields to a nearby fire emergency', () => {
    expect(decideNext(base({ needsFire: true, fireNear: true }))).toBe('flee')
  })
})

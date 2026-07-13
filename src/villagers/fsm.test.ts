import { describe, it, expect } from 'vitest'
import { RNG } from '../core/rng'
import { decideNext, STATES, type FsmCtx } from './fsm'

const base = (o: Partial<FsmCtx> = {}): FsmCtx => ({
  state: 'wander', fireNear: false, freshGrave: false, hasRuin: false,
  hasSite: false, hasPond: false, hasTree: true, rng: new RNG(3), ...o,
})

describe('FSM shape', () => {
  it('has exactly 8 states — the hard cap from the spec', () => {
    expect(STATES).toHaveLength(8)
    expect([...STATES].sort()).toEqual(
      ['buildHut', 'chopTree', 'fish', 'flee', 'mourn', 'rebuild', 'sitAtFire', 'wander'],
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
  it('fishes only when a pond exists', () => {
    let fished = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({ rng: new RNG(seed), hasPond: true })) === 'fish') fished = true
    }
    expect(fished).toBe(true)
    for (let seed = 0; seed < 300; seed++) {
      expect(decideNext(base({ rng: new RNG(seed), hasPond: false }))).not.toBe('fish')
    }
  })
  it('is deterministic for a given seed', () => {
    expect(decideNext(base({ rng: new RNG(11) }))).toBe(decideNext(base({ rng: new RNG(11) })))
  })
})

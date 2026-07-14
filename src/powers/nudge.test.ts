import { describe, expect, it } from 'vitest'
import { RNG } from '../core/rng'
import { groundNudge, type GroundNudgeCtx } from './nudge'

const ctx = (o: Partial<GroundNudgeCtx> = {}): GroundNudgeCtx => ({
  needsFire: false,
  living: 2,
  capacity: 6,
  huts: 3,
  buildable: true,
  pendingSite: false,
  treesNear: 0,
  pondNear: false,
  rng: new RNG(1),
  ...o,
})

/** Every kind this resolver produces across 400 seeds. */
const kinds = (o: Partial<GroundNudgeCtx>): Set<string> => {
  const seen = new Set<string>()
  for (let seed = 0; seed < 400; seed++) {
    seen.add(groundNudge(ctx({ ...o, rng: new RNG(seed) })))
  }
  return seen
}

describe('ground nudge resolves from the village needs', () => {
  it('builds the campfire first when there is no fire — an emergency overrides the roll', () => {
    expect(kinds({ needsFire: true })).toEqual(new Set(['makeFire']))
  })

  it('gathers on ground that cannot be built on', () => {
    expect(groundNudge(ctx({ needsFire: true, buildable: false }))).toBe('gather')
  })

  it('can found a hut when housing is pressed and there is room to grow', () => {
    expect(kinds({ living: 6, capacity: 6, huts: 3 })).toContain('build')
  })

  it('does not always found a hut, even when housing is pressed', () => {
    const seen = kinds({ living: 6, capacity: 6, huts: 3, treesNear: 2, pondNear: true })
    expect(seen.size).toBeGreaterThan(1)
  })

  it('never founds a hut when the village is not full', () => {
    expect(kinds({ living: 2, capacity: 6 })).not.toContain('build')
  })

  it('never founds a hut beyond the six-hut cap', () => {
    expect(kinds({ living: 12, capacity: 12, huts: 6 })).not.toContain('build')
  })

  it('never founds a hut while a site already stands unbuilt', () => {
    expect(kinds({ living: 6, capacity: 6, huts: 3, pendingSite: true })).not.toContain('build')
  })

  it('suggests chopping when the nudge lands among trees', () => {
    expect(kinds({ treesNear: 3 })).toContain('chop')
  })

  it('never suggests chopping where there are no trees', () => {
    expect(kinds({ treesNear: 0 })).not.toContain('chop')
  })

  it('suggests fishing when the nudge lands by the water', () => {
    expect(kinds({ pondNear: true })).toContain('fish')
  })

  it('never suggests fishing away from the water', () => {
    expect(kinds({ pondNear: false })).not.toContain('fish')
  })

  it('always falls back to gathering when nothing else is eligible', () => {
    expect(kinds({})).toEqual(new Set(['gather']))
  })
})

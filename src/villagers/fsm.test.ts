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
  hasFishPond: false, canChopAutomatically: true,
  needsFire: false, hasFruitTree: false, fireOut: false,
  hasChatPartner: false, stateCounts: {}, personality: {},
  dayKind: 'day', nightRole: 'sleeper', hasBuiltHut: false,
  suggestion: null, rng: new RNG(3), ...o,
})

describe('FSM shape', () => {
  it('has exactly 17 states', () => {
    expect(STATES).toHaveLength(17)
    expect([...STATES].sort()).toEqual(
      [
        'buildHut', 'chat', 'chopTree', 'dance', 'drink', 'fish', 'flee',
        'gather', 'harvest', 'makeFire', 'mourn', 'nap', 'rebuild',
        'sitAtFire', 'sleep', 'wander', 'watchSea',
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
      expect(['wander', 'sitAtFire', 'watchSea', 'dance', 'nap']).toContain(next)
    }
  })
  it('does not choose autonomous chopping while the forest reserve is protected', () => {
    for (let seed = 0; seed < 300; seed++) {
      const context = base({
        rng: new RNG(seed),
        hasTree: true,
        canChopAutomatically: false,
      })

      expect(decideNext(context)).not.toBe('chopTree')
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

  it('lets an explicit chop suggestion bypass the autonomous forest reserve', () => {
    let taken = 0
    for (let seed = 0; seed < 300; seed++) {
      const context = base({
        rng: new RNG(seed),
        hasTree: true,
        suggestion: { kind: 'chop', x: 0, z: 0 },
        canChopAutomatically: false,
      })
      if (decideNext(context) === 'chopTree') taken++
    }

    expect(taken).toBeGreaterThan(200)
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

describe('variety rules', () => {
  it('never re-picks the current state when alternatives exist', () => {
    for (let seed = 0; seed < 300; seed++) {
      const next = decideNext(base({
        state: 'fish', hasPond: true, hasFishPond: true, rng: new RNG(seed),
      }))
      expect(next).not.toBe('fish')
    }
  })

  it('repeats the current state when it is the only weighted option', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(decideNext(base({
        state: 'wander', hasTree: false, campfireLit: false,
        personality: { watchSea: 0, nap: 0 },
        rng: new RNG(seed),
      }))).toBe('wander')
    }
  })

  it('a suggestion may re-pick the current state', () => {
    let repicked = 0
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({
        state: 'chopTree', hasTree: true,
        suggestion: { kind: 'chop', x: 0, z: 0 },
        rng: new RNG(seed),
      })) === 'chopTree') repicked++
    }
    expect(repicked).toBeGreaterThan(200)
  })

  it('crowded activities lose appeal', () => {
    const picks = (stateCounts: Partial<FsmCtx['stateCounts']>): number => {
      let count = 0
      for (let seed = 0; seed < 400; seed++) {
        if (decideNext(base({
          hasFruitTree: true, stateCounts, rng: new RNG(seed),
        })) === 'harvest') count++
      }
      return count
    }
    expect(picks({ harvest: 9 })).toBeLessThan(picks({}) / 2)
  })

  it('personality multipliers create habits', () => {
    let naps = 0
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({
        personality: { nap: 100 }, rng: new RNG(seed),
      })) === 'nap') naps++
    }
    expect(naps).toBeGreaterThan(250)
  })
})

describe('new states', () => {
  it('chats only when a partner is available', () => {
    let chatted = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({ hasChatPartner: true, rng: new RNG(seed) })) === 'chat') {
        chatted = true
      }
      expect(decideNext(base({ hasChatPartner: false, rng: new RNG(seed) }))).not.toBe('chat')
    }
    expect(chatted).toBe(true)
  })

  it('dances only by a lit fire', () => {
    let danced = false
    for (let seed = 0; seed < 300; seed++) {
      if (decideNext(base({ campfireLit: true, rng: new RNG(seed) })) === 'dance') danced = true
      expect(decideNext(base({ campfireLit: false, rng: new RNG(seed) }))).not.toBe('dance')
    }
    expect(danced).toBe(true)
  })

  it('watchSea and nap are always available', () => {
    const picked = new Set<string>()
    for (let seed = 0; seed < 500; seed++) {
      picked.add(decideNext(base({
        hasTree: false, campfireLit: false, rng: new RNG(seed),
      })))
    }
    expect(picked.has('watchSea')).toBe(true)
    expect(picked.has('nap')).toBe(true)
  })

  it('gives the new states their designed durations', () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = new RNG(seed)
      const chat = stateDuration('chat', new RNG(seed))
      expect(chat).toBeGreaterThanOrEqual(4)
      expect(chat).toBeLessThanOrEqual(7)
      expect(stateDuration('watchSea', rng)).toBeGreaterThanOrEqual(6)
      expect(stateDuration('dance', rng)).toBeLessThanOrEqual(8)
      const nap = stateDuration('nap', rng)
      expect(nap).toBeGreaterThanOrEqual(12)
      expect(nap).toBeLessThanOrEqual(18)
      const wander = stateDuration('wander', new RNG(seed))
      expect(wander).toBeGreaterThanOrEqual(4)
      expect(wander).toBeLessThanOrEqual(9)
      const fish = stateDuration('fish', new RNG(seed))
      expect(fish).toBeGreaterThanOrEqual(4)
      expect(fish).toBeLessThanOrEqual(6)
    }
  })
})

describe('day-phase scheduling', () => {
  it('sends night sleepers with a built hut to sleep almost always', () => {
    let sleeps = 0
    for (let seed = 0; seed < 50; seed++) {
      const ctx = base({
        dayKind: 'night', nightRole: 'sleeper', hasBuiltHut: true,
        rng: new RNG(seed),
      })
      if (decideNext(ctx) === 'sleep') sleeps++
    }
    expect(sleeps).toBeGreaterThan(40)
  })

  it('never offers sleep during the day or to night owls', () => {
    for (let seed = 0; seed < 50; seed++) {
      const day = base({ dayKind: 'day', hasBuiltHut: true, rng: new RNG(seed) })
      expect(decideNext(day)).not.toBe('sleep')
      const owl = base({
        dayKind: 'night', nightRole: 'owl', hasBuiltHut: true, rng: new RNG(seed),
      })
      expect(decideNext(owl)).not.toBe('sleep')
    }
  })

  it('lets a sleeper keep sleeping across re-rolls', () => {
    const ctx = base({
      state: 'sleep', dayKind: 'night', nightRole: 'sleeper', hasBuiltHut: true,
      rng: new RNG(1),
    })
    expect(decideNext(ctx)).toBe('sleep')
  })

  it('keeps night owls off daytime work states', () => {
    for (let seed = 0; seed < 60; seed++) {
      const ctx = base({
        dayKind: 'night', nightRole: 'owl',
        hasTree: true, canChopAutomatically: true, hasSite: true,
        hasFruitTree: true, campfireLit: true, hasFishPond: true,
        rng: new RNG(seed),
      })
      const next = decideNext(ctx)
      expect(['chopTree', 'buildHut', 'harvest', 'dance']).not.toContain(next)
    }
  })

  it('does not offer hut sleep to a sleeper without a hut', () => {
    const ctx = base({
      dayKind: 'night', nightRole: 'sleeper', hasBuiltHut: false, rng: new RNG(3),
    })
    expect(decideNext(ctx)).not.toBe('sleep')
  })

  it('gives sleep a bounded duration', () => {
    const duration = stateDuration('sleep', new RNG(1))
    expect(duration).toBeGreaterThanOrEqual(20)
    expect(duration).toBeLessThanOrEqual(30)
  })
})

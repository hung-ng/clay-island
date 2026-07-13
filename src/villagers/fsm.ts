import type { RNG } from '../core/rng'

export const STATES = [
  'wander', 'chopTree', 'buildHut', 'sitAtFire', 'flee', 'mourn', 'rebuild', 'fish',
] as const

export type VillagerState = (typeof STATES)[number]

export type FsmCtx = {
  state: VillagerState
  fireNear: boolean
  freshGrave: boolean
  hasRuin: boolean
  hasSite: boolean
  hasPond: boolean
  hasTree: boolean
  campfireLit: boolean
  rng: RNG
}

/** Weighted candidates for the idle roll. Preconditions gate availability. */
const IDLE: { state: VillagerState; weight: number; when: (c: FsmCtx) => boolean }[] = [
  { state: 'wander', weight: 4, when: () => true },
  { state: 'sitAtFire', weight: 3, when: c => c.campfireLit },
  { state: 'chopTree', weight: 3, when: c => c.hasTree },
  { state: 'buildHut', weight: 3, when: c => c.hasSite },
  { state: 'fish', weight: 4, when: c => c.hasPond },
]

export function decideNext(ctx: FsmCtx): VillagerState {
  if (ctx.fireNear) return 'flee'
  if (ctx.freshGrave) return 'mourn'
  if (ctx.hasRuin) return 'rebuild'

  const available = IDLE.filter(option => option.when(ctx))
  const total = available.reduce((sum, option) => sum + option.weight, 0)
  let roll = ctx.rng.next() * total
  for (const option of available) {
    roll -= option.weight
    if (roll < 0) return option.state
  }
  return 'wander'
}

export function stateDuration(state: VillagerState, rng: RNG): number {
  switch (state) {
    case 'flee': return rng.range(2.5, 4)
    case 'mourn': return rng.range(4, 7)
    case 'chopTree': return rng.range(3, 5)
    case 'buildHut':
    case 'rebuild': return rng.range(3, 5)
    case 'fish': return rng.range(5, 9)
    case 'sitAtFire': return rng.range(6, 12)
    case 'wander': return rng.range(3, 6)
  }
}

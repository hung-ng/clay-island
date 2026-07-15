import type { RNG } from '../core/rng'

export const STATES = [
  'wander', 'chopTree', 'buildHut', 'sitAtFire', 'flee', 'mourn', 'rebuild',
  'fish', 'makeFire', 'drink', 'harvest', 'gather',
] as const

export type VillagerState = (typeof STATES)[number]
export type SuggestionKind =
  | 'chop'
  | 'fish'
  | 'drink'
  | 'harvest'
  | 'build'
  | 'makeFire'
  | 'gather'
export type Suggestion = { kind: SuggestionKind; x: number; z: number; targetId?: string }

export type FsmCtx = {
  state: VillagerState
  fireNear: boolean
  freshGrave: boolean
  hasRuin: boolean
  hasSite: boolean
  hasPond: boolean
  hasFishPond: boolean
  hasTree: boolean
  canChopAutomatically: boolean
  campfireLit: boolean
  needsFire: boolean
  hasFruitTree: boolean
  fireOut: boolean
  suggestion: Suggestion | null
  rng: RNG
}

/** Weighted candidates for the idle roll. Preconditions gate availability. */
const IDLE: { state: VillagerState; weight: number; when: (c: FsmCtx) => boolean }[] = [
  { state: 'wander', weight: 4, when: () => true },
  { state: 'sitAtFire', weight: 3, when: c => c.campfireLit },
  {
    state: 'chopTree',
    weight: 3,
    when: c => c.hasTree
      && (c.canChopAutomatically || c.suggestion?.kind === 'chop'),
  },
  { state: 'buildHut', weight: 3, when: c => c.hasSite },
  { state: 'fish', weight: 4, when: c => c.hasFishPond },
  {
    state: 'drink',
    weight: 0,
    when: c => c.hasPond && c.suggestion?.kind === 'drink',
  },
  { state: 'makeFire', weight: 5, when: c => c.needsFire },
  { state: 'harvest', weight: 5, when: c => c.hasFruitTree },
  { state: 'gather', weight: 3, when: c => c.fireOut || c.suggestion?.kind === 'gather' },
]

const SUGGESTED: Record<SuggestionKind, VillagerState> = {
  chop: 'chopTree',
  fish: 'fish',
  drink: 'drink',
  harvest: 'harvest',
  build: 'buildHut',
  makeFire: 'makeFire',
  gather: 'gather',
}

export function stateForSuggestion(kind: SuggestionKind): VillagerState {
  return SUGGESTED[kind]
}

/** A suggestion outweighs the idle roll, but never silences it. */
const SUGGESTION_WEIGHT = 30

export function decideNext(ctx: FsmCtx): VillagerState {
  if (ctx.fireNear) return 'flee'
  if (ctx.freshGrave) return 'mourn'
  if (ctx.hasRuin) return 'rebuild'

  const available = IDLE.filter(option => option.when(ctx))
  const wanted = ctx.suggestion ? SUGGESTED[ctx.suggestion.kind] : null
  const weightOf = (option: { state: VillagerState; weight: number }): number => (
    option.state === wanted ? option.weight + SUGGESTION_WEIGHT : option.weight
  )
  const total = available.reduce((sum, option) => sum + weightOf(option), 0)
  let roll = ctx.rng.next() * total
  for (const option of available) {
    roll -= weightOf(option)
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
    case 'drink': return 4
    case 'harvest': return rng.range(4, 7)
    case 'gather': return rng.range(5, 9)
    // Long enough to cross the walkable island and finish the 2.5s build action.
    // This is a watchdog, not the normal theatrical activity duration.
    case 'makeFire': return 35
    case 'sitAtFire': return rng.range(6, 12)
    case 'wander': return rng.range(3, 6)
  }
}

import type { DayKind } from '../core/dayClock'
import type { RNG } from '../core/rng'

export const STATES = [
  'wander', 'chopTree', 'buildHut', 'sitAtFire', 'flee', 'mourn', 'rebuild',
  'fish', 'makeFire', 'drink', 'harvest', 'gather',
  'chat', 'watchSea', 'dance', 'nap', 'sleep',
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
  hasChatPartner: boolean
  dayKind: DayKind
  nightRole: 'sleeper' | 'owl'
  hasBuiltHut: boolean
  /** Living villagers other than the decider currently in each state. */
  stateCounts: Partial<Record<VillagerState, number>>
  /** Per-villager habit multipliers rolled at spawn; missing entries mean 1. */
  personality: Partial<Record<VillagerState, number>>
  suggestion: Suggestion | null
  rng: RNG
}

/** Weighted candidates for the idle roll. Preconditions gate availability. */
const IDLE: { state: VillagerState; weight: number; when: (c: FsmCtx) => boolean }[] = [
  { state: 'wander', weight: 7, when: () => true },
  { state: 'sitAtFire', weight: 3, when: c => c.campfireLit },
  {
    state: 'chopTree',
    weight: 3,
    when: c => c.hasTree
      && (c.canChopAutomatically || c.suggestion?.kind === 'chop'),
  },
  { state: 'buildHut', weight: 3, when: c => c.hasSite },
  { state: 'fish', weight: 2, when: c => c.hasFishPond },
  {
    state: 'drink',
    weight: 0,
    when: c => c.hasPond && c.suggestion?.kind === 'drink',
  },
  { state: 'makeFire', weight: 5, when: c => c.needsFire },
  { state: 'harvest', weight: 3, when: c => c.hasFruitTree },
  { state: 'gather', weight: 3, when: c => c.fireOut || c.suggestion?.kind === 'gather' },
  { state: 'chat', weight: 3, when: c => c.hasChatPartner },
  { state: 'watchSea', weight: 2, when: () => true },
  { state: 'dance', weight: 3, when: c => c.campfireLit },
  { state: 'nap', weight: 2, when: () => true },
  {
    state: 'sleep',
    weight: 60,
    when: c => c.dayKind === 'night' && c.nightRole === 'sleeper' && c.hasBuiltHut,
  },
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

/** Dusk pulls everyone toward the fire; night mutes daytime work. Missing = 1. */
const DUSK_WEIGHTS: Partial<Record<VillagerState, number>> = {
  sitAtFire: 2.5, dance: 2, chat: 1.6,
}
const NIGHT_WEIGHTS: Partial<Record<VillagerState, number>> = {
  chopTree: 0, buildHut: 0, harvest: 0, dance: 0,
  wander: 0.5, nap: 0.5,
  sitAtFire: 3, fish: 2.5, watchSea: 2.5,
}

function dayFactor(state: VillagerState, ctx: FsmCtx): number {
  if (ctx.dayKind === 'dusk') return DUSK_WEIGHTS[state] ?? 1
  if (ctx.dayKind === 'night') return NIGHT_WEIGHTS[state] ?? 1
  return 1
}

export function decideNext(ctx: FsmCtx): VillagerState {
  if (ctx.fireNear) return 'flee'
  if (ctx.freshGrave) return 'mourn'
  if (ctx.hasRuin) return 'rebuild'

  const wanted = ctx.suggestion ? SUGGESTED[ctx.suggestion.kind] : null
  let available = IDLE.filter(option => option.when(ctx))
  // Variety: never re-roll the current state, unless a suggestion asks for it
  // or nothing else is on offer.
  const fresh = available.filter(option => (
    option.state !== ctx.state || option.state === wanted || option.state === 'sleep'
  ))
  if (fresh.length > 0) available = fresh
  const weightOf = (option: { state: VillagerState; weight: number }): number => {
    const habit = ctx.personality[option.state] ?? 1
    const crowd = 1 + (ctx.stateCounts[option.state] ?? 0)
    const weight = option.weight * habit * dayFactor(option.state, ctx) / crowd
    return option.state === wanted ? weight + SUGGESTION_WEIGHT : weight
  }
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
    case 'fish': return rng.range(4, 6)
    case 'drink': return 4
    case 'harvest': return rng.range(4, 7)
    case 'gather': return rng.range(5, 9)
    // Long enough to cross the walkable island and finish the 2.5s build action.
    // This is a watchdog, not the normal theatrical activity duration.
    case 'makeFire': return 35
    case 'sitAtFire': return rng.range(6, 12)
    case 'wander': return rng.range(4, 9)
    case 'chat': return rng.range(4, 7)
    case 'watchSea': return rng.range(6, 10)
    case 'dance': return rng.range(4, 8)
    case 'nap': return rng.range(12, 18)
    case 'sleep': return rng.range(20, 30)
  }
}

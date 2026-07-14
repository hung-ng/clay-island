import type { PowerId, TargetKind } from '../core/events'

export type InteractionKind =
  | 'ignite'
  | 'destroy'
  | 'kill'
  | 'zap'
  | 'scatter'
  | 'emptyPond'
  | 'steam'
  | 'floatFish'
  | 'flare'
  | 'growFruit'
  | 'grumpy'

export type Interaction = { kind: InteractionKind }

export const INTERACTION_KINDS: readonly InteractionKind[] = [
  'ignite',
  'destroy',
  'kill',
  'zap',
  'scatter',
  'emptyPond',
  'steam',
  'floatFish',
  'flare',
  'growFruit',
  'grumpy',
] as const

const MATRIX: Record<PowerId, Record<TargetKind, InteractionKind[]>> = {
  meteor: {
    // The struck tree is annihilated; blast fire is handled separately nearby.
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
    pond: ['floatFish'],
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
}

export function resolveInteraction(power: PowerId, target: TargetKind): Interaction[] {
  return MATRIX[power][target].map(kind => ({ kind }))
}

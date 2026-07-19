import type { PowerId, TargetKind } from '../core/events'

export type InteractionKind =
  | 'ignite'
  | 'destroy'
  | 'kill'
  | 'zap'
  | 'scatter'
  | 'emptyPond'
  | 'steam'
  | 'stunFish'
  | 'flare'
  | 'growFruit'
  | 'grumpy'
  | 'suggest'
  | 'startleVillager'
  | 'tumble'

export type Interaction = { kind: InteractionKind }

export const INTERACTION_KINDS: readonly InteractionKind[] = [
  'ignite',
  'destroy',
  'kill',
  'zap',
  'scatter',
  'emptyPond',
  'steam',
  'stunFish',
  'flare',
  'growFruit',
  'grumpy',
  'suggest',
  'startleVillager',
  'tumble',
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
    // Gust-wide effects are staged by the wind module; these cells only own
    // consequences unique to the object directly under the reticle.
    tree: [],
    hut: ['scatter'],
    villager: ['tumble'],
    pond: [],
    campfire: ['flare'],
    crater: [],
    ground: [],
  },
}

export function resolveInteraction(power: PowerId, target: TargetKind): Interaction[] {
  return MATRIX[power][target].map(kind => ({ kind }))
}

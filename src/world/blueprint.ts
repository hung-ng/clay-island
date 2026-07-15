import { RNG } from '../core/rng'
import { placeSites, type Placement } from './scatter'

export const INITIAL_HANDOFF_FRAME = 11 * 12

export type InitialPropSpec =
  | { id: string; kind: 'tree'; state: 'normal'; x: number; z: number; visualSeed: number }
  | { id: string; kind: 'hut'; state: 'built'; x: number; z: number; visualSeed: number }
  | { id: 'campfire'; kind: 'campfire'; state: 'lit'; x: number; z: number; visualSeed: number }

export type InitialVillagerSpec = {
  id: string
  x: number
  z: number
  facing: number
  visualSeed: number
  behaviorSeed: number
}

export type InitialWorldBlueprint = {
  seed: number
  islandSeed: number
  stageRotationY: 0
  handoffFrame: number
  props: InitialPropSpec[]
  villagers: InitialVillagerSpec[]
}

function derivedSeed(seed: number, label: string, index: number): number {
  let value = (seed ^ 0x811c9dc5 ^ index) >>> 0
  for (const character of label) {
    value ^= character.charCodeAt(0)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value || 1
}

function propSpecs(seed: number, placements: Placement[]): InitialPropSpec[] {
  let tree = 0
  let hut = 0

  return placements.map((placement, index): InitialPropSpec => {
    const visualSeed = derivedSeed(seed, 'prop', index)
    if (placement.kind === 'tree') {
      return {
        id: `tree-${tree++}`,
        kind: 'tree',
        state: 'normal',
        x: placement.x,
        z: placement.z,
        visualSeed,
      }
    }
    if (placement.kind === 'hut' || placement.kind === 'site') {
      return {
        id: `hut-${hut++}`,
        kind: 'hut',
        state: 'built',
        x: placement.x,
        z: placement.z,
        visualSeed,
      }
    }
    return {
      id: 'campfire',
      kind: 'campfire',
      state: 'lit',
      x: placement.x,
      z: placement.z,
      visualSeed,
    }
  })
}

export function createInitialWorldBlueprint(seed = 7): InitialWorldBlueprint {
  const placements = placeSites(new RNG(seed))
  const props = propSpecs(seed, placements)
  const villagers: InitialVillagerSpec[] = []
  const layout = new RNG(derivedSeed(seed, 'villager-layout', 0))

  for (let index = 0; index < 6; index++) {
    let point = { x: 0, z: 0 }
    for (let attempt = 0; attempt < 300; attempt++) {
      const angle = layout.range(0, Math.PI * 2)
      const radius = layout.range(2.2, 9.8)
      const candidate = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
      const propsClear = props.every(
        prop => Math.hypot(candidate.x - prop.x, candidate.z - prop.z) >= 1.6,
      )
      const peopleClear = villagers.every(
        person => Math.hypot(candidate.x - person.x, candidate.z - person.z) >= 0.75,
      )
      if (propsClear && peopleClear) {
        point = candidate
        break
      }
    }

    villagers.push({
      id: `villager-${index}`,
      ...point,
      facing: Math.atan2(-point.x, -point.z),
      visualSeed: derivedSeed(seed, 'villager-visual', index),
      behaviorSeed: derivedSeed(seed, 'villager-behavior', index),
    })
  }

  return {
    seed,
    islandSeed: derivedSeed(seed, 'island', 0),
    stageRotationY: 0,
    handoffFrame: INITIAL_HANDOFF_FRAME,
    props,
    villagers,
  }
}

import type { RNG } from '../core/rng'
import { WALK_RADIUS } from './island'
import { isBuildable, type GroundQuery } from './terrain'

export type TreeState =
  | 'sapling'
  | 'normal'
  | 'toppling'
  | 'felled'
  | 'stump'
  | 'burning'

/** The island supports this many standing trees. Falling trees and remnants do not count. */
export const MAX_TREES = 13

const SEED_MIN = 2.5
const SEED_MAX = 5

/** A tree, as far as the seeding rule cares. No THREE, no class. */
export type Seedling = { x: number; z: number; state: TreeState }

/** Is this tree still standing matter — forest, and fuel? */
export function isLiving(state: TreeState): boolean {
  return state === 'sapling'
    || state === 'normal'
    || state === 'burning'
}

/** Does this tree hold a place in the forest's population cap? */
export function holdsPlace(state: TreeState): boolean {
  return state === 'sapling' || state === 'normal' || state === 'burning'
}

/** Find the next buildable seed site near a survivor, or use the mercy rule. */
export function seedSite(
  trees: readonly Seedling[],
  query: GroundQuery,
  groundY: (x: number, z: number) => number,
  rng: RNG,
): { x: number; z: number } | null {
  const parents = trees.filter(tree => holdsPlace(tree.state))

  if (parents.length === 0) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const angle = rng.range(0, Math.PI * 2)
      const distance = Math.sqrt(rng.next()) * (WALK_RADIUS - 1)
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      if (isBuildable(x, z, query, groundY)) return { x, z }
    }
    return null
  }

  const parent = rng.pick([...parents])
  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(SEED_MIN, SEED_MAX)
    const x = parent.x + Math.cos(angle) * distance
    const z = parent.z + Math.sin(angle) * distance
    if (Math.hypot(x, z) > WALK_RADIUS - 1) continue
    if (isBuildable(x, z, query, groundY)) return { x, z }
  }
  return null
}

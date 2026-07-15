import { RNG } from '../core/rng'

export type PlacementKind = 'tree' | 'hut' | 'site' | 'campfire'
export type Placement = { kind: PlacementKind; x: number; z: number }

/** Footprint radius per kind — two placements must not have overlapping footprints. */
export const CLEARANCE: Record<PlacementKind, number> = {
  campfire: 2.0,
  hut: 2.0,
  site: 2.0,
  tree: 1.3,
}

export function fitsPlacement(p: Placement, placed: Placement[]): boolean {
  for (const q of placed) {
    const min = CLEARANCE[p.kind] + CLEARANCE[q.kind]
    if (Math.hypot(p.x - q.x, p.z - q.z) < min) return false
  }
  return true
}

/** Campfire at centre, 2 huts + 1 empty site ringing it, then 12 trees in the gaps. */
export function placeSites(rng: RNG): Placement[] {
  const placed: Placement[] = [{ kind: 'campfire', x: 0, z: 0 }]

  const ring: PlacementKind[] = ['hut', 'hut', 'site']
  for (const kind of ring) {
    for (let tries = 0; tries < 200; tries++) {
      const a = rng.range(0, Math.PI * 2)
      const r = rng.range(4, 6)
      const p = { kind, x: Math.cos(a) * r, z: Math.sin(a) * r }
      if (fitsPlacement(p, placed)) {
        placed.push(p)
        break
      }
    }
  }

  let trees = 0
  for (let tries = 0; tries < 4000 && trees < 12; tries++) {
    const a = rng.range(0, Math.PI * 2)
    const r = Math.sqrt(rng.next()) * 10.5
    const p: Placement = { kind: 'tree', x: Math.cos(a) * r, z: Math.sin(a) * r }
    if (fitsPlacement(p, placed)) {
      placed.push(p)
      trees++
    }
  }
  return placed
}

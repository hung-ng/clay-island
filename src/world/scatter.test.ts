import { describe, it, expect } from 'vitest'
import { RNG } from '../core/rng'
import { placeSites } from './scatter'

describe('placeSites', () => {
  const p = placeSites(new RNG(1))

  it('places the campfire, 2 huts, 1 site and 12 trees', () => {
    const n = (k: string) => p.filter(x => x.kind === k).length
    expect(n('campfire')).toBe(1)
    expect(n('hut')).toBe(2)
    expect(n('site')).toBe(1)
    expect(n('tree')).toBe(12)
  })

  it('never overlaps ANY two placements — including tree-into-hut', () => {
    const CLEAR: Record<string, number> = { campfire: 2, hut: 2, site: 2, tree: 1.3 }
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      const d = Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z)
      expect(d).toBeGreaterThanOrEqual(CLEAR[p[i].kind] + CLEAR[p[j].kind] - 1e-9)
    }
  })

  it('keeps everything on walkable ground', () => {
    for (const x of p) expect(Math.hypot(x.x, x.z)).toBeLessThan(12)
  })

  it('is deterministic per seed', () => {
    expect(placeSites(new RNG(9))).toEqual(placeSites(new RNG(9)))
  })
})

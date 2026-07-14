import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import { Island } from './island'

vi.mock('../fx/clayMaterial', async () => {
  const THREE = await import('three')
  return { clayMaterial: vi.fn(() => new THREE.MeshToonMaterial()) }
})

describe('Island crater mesh', () => {
  it('updates visible vertices across the complete ejecta lip', () => {
    const island = new Island(new RNG(1))
    const positions = island.topMesh.geometry.getAttribute('position')
    const ring = 9 // 9 * (15 / 40) = 3.375m, outside the old update radius.
    const vertex = ring * (80 + 1)
    const x = positions.getX(vertex)
    const z = positions.getZ(vertex)
    const before = positions.getY(vertex)

    island.addCrater({ x: 0, z: 0, radius: 2.8, depth: 1.3 })

    expect(positions.getY(vertex)).toBeCloseTo(island.sampleHeight(x, z), 5)
    expect(positions.getY(vertex)).toBeGreaterThan(before)
  })
})

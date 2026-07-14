import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../core/events'
import { RNG } from '../core/rng'
import { ISLAND_RADIUS } from '../world/island'
import type { CastCtx } from './power'
import { Rain, rainOffset } from './rain'

vi.mock('../fx/clayMaterial', async () => {
  const actual = await import('three')
  return { clayMaterial: vi.fn(() => new actual.MeshToonMaterial()) }
})

vi.mock('../fx/wobble', () => ({
  wobble: <T>(geometry: T): T => geometry,
}))

describe('rain placement', () => {
  it('keeps every recycled droplet over the island at rim casts', () => {
    const rng = new RNG(17)

    for (let i = 0; i < 500; i++) {
      const offset = rainOffset(ISLAND_RADIUS, 0, rng)
      expect(Math.hypot(ISLAND_RADIUS + offset.x, offset.z)).toBeLessThanOrEqual(ISLAND_RADIUS)
    }
  })

  it('restores fish once after the first crater-fill impact', () => {
    const fillCratersNear = vi.fn()
    const restoreFishNear = vi.fn()
    const world = {
      campfire: { lit: false, x: 99, z: 99 },
      douseNear: vi.fn(),
      fillCratersNear,
      restoreFishNear,
      growFruitNear: vi.fn(),
      bloomNear: vi.fn(),
      grumpNear: vi.fn(),
      sadNear: vi.fn(),
    }
    const ctx = {
      x: 0,
      z: 0,
      kind: 'ground',
      power: 'rain',
      world,
      island: { sampleHeight: () => 0, group: new THREE.Group() },
      scene: new THREE.Scene(),
      fx: {},
      bus: new EventBus(),
      rng: new RNG(1),
      lowFx: true,
    } as unknown as CastCtx

    const timeline = new Rain().cast(ctx)
    timeline.update(1.2)
    timeline.update(1)

    expect(restoreFishNear).toHaveBeenCalledTimes(1)
    expect(fillCratersNear.mock.invocationCallOrder[0]).toBeLessThan(
      restoreFishNear.mock.invocationCallOrder[0],
    )
  })
})

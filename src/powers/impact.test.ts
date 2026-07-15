import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EventBus, type GameEvent } from '../core/events'
import { RNG } from '../core/rng'
import { Lightning } from './lightning'
import type { CastCtx } from './power'

vi.mock('../fx/clayMaterial', async () => {
  const actual = await import('three')
  return { clayMaterial: vi.fn(() => new actual.MeshToonMaterial()) }
})

vi.mock('../fx/wobble', () => ({
  wobble: <T>(geometry: T): T => geometry,
}))

describe('delayed power targeting', () => {
  it('emits and applies Lightning against the target present at impact time', () => {
    const bus = new EventBus()
    const events: GameEvent[] = []
    bus.on(event => events.push(event))
    const pondAt = vi.fn(() => null)
    const ctx = {
      x: 2,
      z: 3,
      kind: 'pond',
      power: 'lightning',
      world: {
        resolveTarget: vi.fn(() => 'crater'),
        villagers: [],
        pondAt,
      },
      island: { sampleHeight: () => 0, group: new THREE.Group() },
      scene: new THREE.Scene(),
      fx: {
        particles: { burst: vi.fn() },
        shake: { add: vi.fn() },
        flash: vi.fn(),
      },
      bus,
      rng: new RNG(1),
      lowFx: false,
    } as unknown as CastCtx

    new Lightning().cast(ctx).update(0.9)

    expect(events).toContainEqual({
      type: 'power:impact', power: 'lightning', target: 'crater', x: 2, z: 3,
    })
    expect(pondAt).not.toHaveBeenCalled()
  })
})

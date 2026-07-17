import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CelebrationFireworks, FIREWORK_LAUNCHES } from './fireworks'

vi.mock('../fx/clayMaterial', () => ({
  clayMaterial: (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color }),
}))

describe('CelebrationFireworks', () => {
  it('uses three regular waves and one finale inside the 4–14 second window', () => {
    expect(FIREWORK_LAUNCHES.map(cue => cue.wave)).toEqual([
      1, 1, 1, 2, 2, 2, 3, 3, 3, 4,
    ])
    expect(FIREWORK_LAUNCHES[0]?.at).toBe(4)
    expect(FIREWORK_LAUNCHES.at(-1)).toMatchObject({ at: 12, finale: true })
  })

  it('is stage-local, bounded by quality, resettable, and disposable', () => {
    const stage = new THREE.Group()
    stage.position.y = 0.3
    const subject = new CelebrationFireworks(stage, {
      lowFx: true,
      reducedMotion: () => false,
    })
    subject.begin({ x: 2, y: 0, z: -1 })
    for (let elapsed = 0; elapsed < 13; elapsed += 0.1) subject.update(0.1)
    stage.updateMatrixWorld(true)
    expect(subject.group.parent).toBe(stage)
    expect(subject.group.position.toArray()).toEqual([2, 0, -1])
    expect(subject.poolCapacity).toBe(120)
    expect(subject.launchedCount).toBe(10)
    subject.reset()
    expect(subject.activeParticleCount).toBe(0)
    expect(subject.group.visible).toBe(false)
    subject.dispose()
    expect(subject.group.parent).toBeNull()
  })
})

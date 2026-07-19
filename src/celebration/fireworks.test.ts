import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CelebrationFireworks, FIREWORK_LAUNCHES } from './fireworks'

vi.mock('../fx/clayMaterial', () => ({
  clayMaterial: (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color }),
}))

function runShow(subject: CelebrationFireworks): string[] {
  const cues: string[] = []
  for (let elapsed = 0; elapsed < 13.9; elapsed += 0.05) {
    cues.push(...subject.update(0.05))
  }
  return cues
}

describe('CelebrationFireworks', () => {
  it('escalates from a three-shell fan into a six-shell finale', () => {
    expect(FIREWORK_LAUNCHES).toHaveLength(18)
    expect(FIREWORK_LAUNCHES.slice(0, 3).map(cue => cue.wave)).toEqual([1, 1, 1])
    expect(FIREWORK_LAUNCHES.filter(cue => cue.finale)).toHaveLength(6)
    expect(new Set(FIREWORK_LAUNCHES.map(cue => cue.pattern))).toEqual(
      new Set(['peony', 'ring', 'willow', 'finale']),
    )
    expect(Math.max(...FIREWORK_LAUNCHES.map(cue => cue.height))).toBeGreaterThan(11)
    expect(FIREWORK_LAUNCHES[0]?.at).toBe(4)
    expect(FIREWORK_LAUNCHES.at(-1)?.at).toBeLessThan(12)
  })

  it('is stage-local, bounded by quality, resettable, and disposable', () => {
    const stage = new THREE.Group()
    stage.position.y = 0.3
    const subject = new CelebrationFireworks(stage, {
      lowFx: true,
      reducedMotion: () => false,
    })
    subject.begin({ x: 2, y: 0, z: -1 })
    const cues = runShow(subject)
    stage.updateMatrixWorld(true)
    expect(subject.group.parent).toBe(stage)
    expect(subject.group.position.toArray()).toEqual([2, 0, -1])
    expect(subject.poolCapacity).toBe(200)
    expect(subject.launchedCount).toBe(18)
    expect(cues).toContain('crackle')
    expect(cues).toContain('finale')
    subject.reset()
    expect(subject.activeParticleCount).toBe(0)
    expect(subject.group.visible).toBe(false)
    subject.dispose()
    expect(subject.group.parent).toBeNull()
  })

  it('keeps the full show but removes echo crackles under reduced motion', () => {
    const subject = new CelebrationFireworks(new THREE.Group(), {
      lowFx: false,
      reducedMotion: () => true,
    })
    subject.begin({ x: 0, y: 0, z: 0 })
    const cues = runShow(subject)
    expect(subject.poolCapacity).toBe(560)
    expect(subject.launchedCount).toBe(18)
    expect(cues).not.toContain('crackle')
    expect(subject.activeParticleCount).toBeLessThanOrEqual(subject.poolCapacity)
  })

  it('replays with the same launch count and cue sequence', () => {
    const subject = new CelebrationFireworks(new THREE.Group(), {
      lowFx: false,
      reducedMotion: () => false,
    })
    subject.begin({ x: 0, y: 0, z: 0 })
    const first = runShow(subject)
    expect(subject.launchedCount).toBe(18)
    subject.begin({ x: 0, y: 0, z: 0 })
    const second = runShow(subject)
    expect(subject.launchedCount).toBe(18)
    expect(second).toEqual(first)
  })

  it('reports each burst color and finale flag for the island light', () => {
    const bursts: [string, boolean][] = []
    const subject = new CelebrationFireworks(new THREE.Group(), {
      lowFx: false,
      reducedMotion: () => false,
      onBurst: (color, finale) => bursts.push([color, finale]),
    })
    subject.begin({ x: 0, y: 0, z: 0 })
    runShow(subject)
    expect(bursts).toHaveLength(FIREWORK_LAUNCHES.length)
    expect(bursts.filter(([, finale]) => finale)).toHaveLength(6)
    expect(bursts[0]![0]).toBe(FIREWORK_LAUNCHES[0]!.color)
    subject.dispose()
  })
})

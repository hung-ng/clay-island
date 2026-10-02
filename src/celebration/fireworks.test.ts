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

function advanceUntilCue(subject: CelebrationFireworks, cue: string): void {
  for (let frame = 0; frame < 1400; frame++) {
    if (subject.update(0.01).includes(cue)) return
  }
  throw new Error(`The show did not emit ${cue}`)
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
    expect(stage.getObjectByName('celebration-burst-light')).toBeUndefined()
    expect(subject.launchedCount).toBe(18)
    expect(cues).toContain('crackle')
    expect(cues).toContain('finale')
    subject.reset()
    expect(subject.activeParticleCount).toBe(0)
    expect(subject.group.visible).toBe(false)
    subject.dispose()
    expect(subject.group.parent).toBeNull()
    expect(stage.children).toHaveLength(0)
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

  it('lights the island at burst time and decays ordinary shells linearly', () => {
    const stage = new THREE.Group()
    const subject = new CelebrationFireworks(stage, {
      lowFx: false,
      reducedMotion: () => false,
    })
    const light = stage.getObjectByName('celebration-burst-light') as THREE.PointLight
    subject.begin({ x: 2, y: 1, z: -1 })
    expect(light.position.toArray()).toEqual([2, 11, -1])
    expect(light.distance).toBe(34)
    expect(light.visible).toBe(false)

    advanceUntilCue(subject, 'pop')
    expect(light.visible).toBe(true)
    expect(light.intensity).toBe(5)
    expect(light.color.getHexString()).toBe(new THREE.Color(FIREWORK_LAUNCHES[0]!.color).getHexString())
    subject.update(0.1)
    expect(light.intensity).toBeCloseTo(4)
    subject.update(0.1)
    expect(light.intensity).toBeCloseTo(3)
    subject.update(-1)
    expect(light.intensity).toBeCloseTo(3)
    runShow(subject)
    expect(light.intensity).toBe(0)
    expect(light.visible).toBe(false)
    subject.dispose()
  })

  it('uses stronger finale lighting and clamps overlapping shells to the newest color', () => {
    const stage = new THREE.Group()
    const subject = new CelebrationFireworks(stage, {
      lowFx: false,
      reducedMotion: () => false,
    })
    const light = stage.getObjectByName('celebration-burst-light') as THREE.PointLight
    subject.begin({ x: 0, y: 0, z: 0 })
    advanceUntilCue(subject, 'finale')
    expect(light.intensity).toBe(8)
    advanceUntilCue(subject, 'finale')
    expect(light.intensity).toBe(12)
    expect(light.color.getHexString()).toBe(new THREE.Color(FIREWORK_LAUNCHES.at(-1)!.color).getHexString())
    subject.dispose()
  })

  it('owns light reset, replay positioning, and disposal through the show lifecycle', () => {
    const stage = new THREE.Group()
    const subject = new CelebrationFireworks(stage, {
      lowFx: false,
      reducedMotion: () => false,
    })
    const light = stage.getObjectByName('celebration-burst-light') as THREE.PointLight
    const disposeLight = vi.spyOn(light, 'dispose')
    subject.begin({ x: 0, y: 0, z: 0 })
    advanceUntilCue(subject, 'pop')
    subject.reset()
    expect(light.intensity).toBe(0)
    expect(light.visible).toBe(false)

    subject.begin({ x: -2, y: 2, z: 3 })
    expect(light.position.toArray()).toEqual([-2, 12, 3])
    advanceUntilCue(subject, 'pop')
    expect(stage.children.filter(child => child instanceof THREE.PointLight)).toHaveLength(1)
    expect(light.visible).toBe(true)
    subject.dispose()
    subject.dispose()
    expect(light.intensity).toBe(0)
    expect(light.visible).toBe(false)
    expect(light.parent).toBeNull()
    expect(disposeLight).toHaveBeenCalledOnce()
    expect(stage.children).toHaveLength(0)
  })
})

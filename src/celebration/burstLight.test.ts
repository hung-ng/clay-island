import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PALETTE } from '../ui/tokens'
import { BURST_LIGHT, CelebrationBurstLight, decayedBurstIntensity } from './burstLight'

describe('decayedBurstIntensity', () => {
  it('dies off linearly over about half a second', () => {
    expect(decayedBurstIntensity(BURST_LIGHT.peak, BURST_LIGHT.decaySeconds)).toBe(0)
    expect(decayedBurstIntensity(BURST_LIGHT.peak, BURST_LIGHT.decaySeconds / 2))
      .toBeCloseTo(BURST_LIGHT.peak / 2)
    expect(decayedBurstIntensity(0, 1)).toBe(0)
  })
})

describe('CelebrationBurstLight', () => {
  it('pulses to the newest shell color with clamped stacking', () => {
    const stage = new THREE.Group()
    const subject = new CelebrationBurstLight(stage)
    subject.begin({ x: 2, y: 1, z: -1 })
    expect(subject.light.position.toArray()).toEqual([2, 1 + BURST_LIGHT.height, -1])
    expect(subject.light.visible).toBe(false)

    subject.onBurst(PALETTE.flame, false)
    expect(subject.light.visible).toBe(true)
    expect(subject.light.intensity).toBe(BURST_LIGHT.peak)

    subject.onBurst(PALETTE.leafA, true)
    subject.onBurst(PALETTE.water, true)
    expect(subject.light.intensity).toBe(BURST_LIGHT.maxIntensity)
    expect(subject.light.color.getHexString()).toBe(new THREE.Color(PALETTE.water).getHexString())

    subject.update(5)
    expect(subject.light.intensity).toBe(0)
    expect(subject.light.visible).toBe(false)
  })

  it('resets and disposes without leaving scene children', () => {
    const stage = new THREE.Group()
    const subject = new CelebrationBurstLight(stage)
    subject.onBurst(PALETTE.cloud, false)
    subject.reset()
    expect(subject.light.intensity).toBe(0)
    expect(subject.light.visible).toBe(false)
    subject.dispose()
    expect(subject.light.parent).toBeNull()
    expect(stage.children).toHaveLength(0)
  })
})

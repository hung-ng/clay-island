import { describe, expect, it } from 'vitest'
import { tiltOpacityAtDistance, VisualQualityController } from './quality'

describe('adaptive quality', () => {
  it('removes tilt shift close and caps it at the home view', () => {
    expect(tiltOpacityAtDistance(15)).toBe(0)
    expect(tiltOpacityAtDistance(22)).toBe(0)
    expect(tiltOpacityAtDistance(Math.hypot(14, 34))).toBeCloseTo(0.32)
    expect(tiltOpacityAtDistance(55)).toBe(0.32)
  })

  it('writes adaptive tilt and restrained grain without recreating effects', () => {
    const tilt = { blendMode: { opacity: { value: 1 } } }
    const grain = { blendMode: { opacity: { value: 1 } }, seed: 0 }
    const subject = new VisualQualityController(tilt, grain, false)
    subject.update(1 / 12, 20, false)
    expect(tilt.blendMode.opacity.value).toBe(0)
    expect(grain.blendMode.opacity.value).toBe(0.08)
    subject.update(1 / 12, 40, true)
    expect(grain.blendMode.opacity.value).toBe(0.04)
  })
})

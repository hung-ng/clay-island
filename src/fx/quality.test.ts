import { describe, expect, it } from 'vitest'
import { tiltOpacityAtDistance, VisualQualityController } from './quality'

describe('adaptive quality', () => {
  it('removes tilt shift close and caps it at the home view', () => {
    expect(tiltOpacityAtDistance(15)).toBe(0)
    expect(tiltOpacityAtDistance(22)).toBe(0)
    expect(tiltOpacityAtDistance(Math.hypot(14, 34))).toBeCloseTo(0.45)
    expect(tiltOpacityAtDistance(55)).toBe(0.45)
  })

  it('writes adaptive tilt without recreating the effect', () => {
    const tilt = { blendMode: { opacity: { value: 1 } } }
    const subject = new VisualQualityController(tilt, false)
    subject.update(20)
    expect(tilt.blendMode.opacity.value).toBe(0)
    subject.update(55)
    expect(tilt.blendMode.opacity.value).toBe(0.45)
  })

  it('leaves reduced quality untouched', () => {
    const tilt = { blendMode: { opacity: { value: 1 } } }
    new VisualQualityController(tilt, true).update(20)
    expect(tilt.blendMode.opacity.value).toBe(1)
  })
})

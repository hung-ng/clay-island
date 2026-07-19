import { describe, expect, it } from 'vitest'
import { PALETTE } from '../ui/tokens'
import {
  DAY_PERIOD,
  DayClock,
  GOLDEN_T,
  kindAt,
  sampleAt,
} from './dayClock'

describe('kindAt', () => {
  it('maps the timeline segments', () => {
    expect(kindAt(0)).toBe('dawn')
    expect(kindAt(24.9)).toBe('dawn')
    expect(kindAt(25)).toBe('day')
    expect(kindAt(224.9)).toBe('day')
    expect(kindAt(225)).toBe('dusk')
    expect(kindAt(249.9)).toBe('dusk')
    expect(kindAt(250)).toBe('night')
    expect(kindAt(359.9)).toBe('night')
  })
})

describe('sampleAt', () => {
  it('reproduces the exact current golden-hour look at GOLDEN_T', () => {
    const p = sampleAt(GOLDEN_T)
    expect(p.keyColor).toBe(PALETTE.keyLight)
    expect(p.keyIntensity).toBeCloseTo(3.2)
    expect([p.keyX, p.keyY, p.keyZ]).toEqual([18, 24, 10])
    expect(p.fillSky).toBe(PALETTE.fillSky)
    expect(p.fillGround).toBe(PALETTE.fillGround)
    expect(p.fillIntensity).toBeCloseTo(1.1)
    expect(p.skyHigh).toBe(PALETTE.skyHigh)
    expect(p.skyLow).toBe(PALETTE.skyLow)
    expect(p.cloudTint).toBe(PALETTE.cloud)
    expect(p.starOpacity).toBe(0)
    expect(p.fireflyLevel).toBe(0)
  })

  it('is continuous across keyframe boundaries', () => {
    for (const boundary of [12, 25, 200, 225, 238, 250]) {
      const before = sampleAt(boundary - 1e-4)
      const after = sampleAt(boundary + 1e-4)
      expect(after.keyIntensity).toBeCloseTo(before.keyIntensity, 2)
      expect(after.keyY).toBeCloseTo(before.keyY, 1)
      expect(after.starOpacity).toBeCloseTo(before.starOpacity, 2)
    }
  })

  it('wraps: just before DAY_PERIOD matches just after 0', () => {
    const before = sampleAt(DAY_PERIOD - 1e-4)
    const after = sampleAt(0)
    expect(after.keyIntensity).toBeCloseTo(before.keyIntensity, 2)
  })

  it('shows stars only at night and dusk edges, never at midday', () => {
    expect(sampleAt(112).starOpacity).toBe(0)
    expect(sampleAt(300).starOpacity).toBeGreaterThan(0.8)
    expect(sampleAt(300).fireflyLevel).toBeGreaterThan(0.8)
  })
})

describe('DayClock', () => {
  const noReduced = () => false
  const reduced = () => true

  it('starts at GOLDEN_T and free-runs with wrap', () => {
    const clock = new DayClock(noReduced)
    expect(clock.time).toBe(GOLDEN_T)
    clock.tick(DAY_PERIOD + 5)
    expect(clock.time).toBeCloseTo(GOLDEN_T + 5)
    expect(clock.mode).toBe('auto')
  })

  it('glides forward to the day anchor and holds', () => {
    const clock = new DayClock(noReduced, 300)
    clock.setMode('day')
    for (let i = 0; i < 30 * 10; i++) clock.tick(1 / 30)
    expect(clock.time).toBeCloseTo(112, 1)
    expect(clock.kind).toBe('day')
    clock.tick(60)
    expect(clock.time).toBeCloseTo(112, 1)
  })

  it('snaps instead of gliding under reduced motion', () => {
    const clock = new DayClock(reduced, 100)
    clock.setMode('night')
    clock.tick(1 / 30)
    expect(clock.time).toBeCloseTo(305, 1)
  })

  it('auto resumes free-running from the held phase', () => {
    const clock = new DayClock(reduced, 100)
    clock.setMode('night')
    clock.tick(1 / 30)
    clock.setMode('auto')
    clock.tick(2)
    expect(clock.time).toBeCloseTo(307, 0)
  })

  it('night hold works in auto mode and releases back to the captured phase', () => {
    const clock = new DayClock(reduced, 100)
    clock.requestHold('night')
    clock.tick(1 / 30)
    expect(clock.kind).toBe('night')
    clock.releaseHold()
    clock.tick(1 / 30)
    expect(clock.time).toBeCloseTo(100, 0)
    clock.tick(5)
    expect(clock.time).toBeCloseTo(105, 0)
  })

  it('a user-selected mode wins over a hold request', () => {
    const clock = new DayClock(reduced, 100)
    clock.setMode('day')
    clock.tick(1 / 30)
    clock.requestHold('night')
    clock.tick(1 / 30)
    expect(clock.kind).toBe('day')
  })
})

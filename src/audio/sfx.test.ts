import { describe, expect, it } from 'vitest'
import { celebrationSoundProfile, prologueSoundProfile, shutterSoundProfile } from './sfx'

describe('prologue sound profiles', () => {
  it('gives every visual cue a bounded distinct sound profile', () => {
    expect(prologueSoundProfile('growth')).toMatchObject({ kind: 'tone', seconds: 0.15 })
    expect(prologueSoundProfile('step')).toEqual({ kind: 'step' })
    expect(prologueSoundProfile('hammer')).toMatchObject({ kind: 'knock', pitch: 150 })
    expect(prologueSoundProfile('place')).toMatchObject({ kind: 'knock', pitch: 95 })
    expect(prologueSoundProfile('ignite')).toMatchObject({ kind: 'tone', seconds: 0.4 })
  })
})

it('keeps every celebration cue bounded and distinct', () => {
  expect(celebrationSoundProfile('launch')).toMatchObject({ kind: 'tone', seconds: 0.46 })
  expect(celebrationSoundProfile('pop')).toMatchObject({ kind: 'knock', from: 118, seconds: 0.22 })
  expect(celebrationSoundProfile('crackle')).toMatchObject({
    kind: 'tone', from: 980, seconds: 0.11,
  })
  expect(celebrationSoundProfile('finale')).toMatchObject({ kind: 'knock', from: 88, seconds: 0.36 })
  expect(celebrationSoundProfile('cheer')).toMatchObject({ kind: 'tone', to: 620 })
})

it('keeps the shutter click short and quiet', () => {
  const profile = shutterSoundProfile()
  expect(profile.knock.seconds).toBeLessThanOrEqual(0.08)
  expect(profile.tick.seconds).toBeLessThanOrEqual(0.05)
  expect(profile.knock.volume).toBeLessThanOrEqual(0.06)
  expect(profile.tick.volume).toBeLessThanOrEqual(0.03)
  expect(profile.tick.from).toBeGreaterThan(profile.knock.pitch)
})

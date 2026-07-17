import { describe, expect, it } from 'vitest'
import { celebrationSoundProfile, prologueSoundProfile } from './sfx'

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
  expect(celebrationSoundProfile('launch')).toMatchObject({ kind: 'tone', seconds: 0.42 })
  expect(celebrationSoundProfile('pop')).toMatchObject({ kind: 'knock', from: 120 })
  expect(celebrationSoundProfile('finale')).toMatchObject({ kind: 'knock', from: 92 })
  expect(celebrationSoundProfile('cheer')).toMatchObject({ kind: 'tone', to: 520 })
})

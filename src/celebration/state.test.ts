import { describe, expect, it } from 'vitest'
import {
  CELEBRATION_SECONDS,
  CelebrationClock,
  canStartCelebration,
  shouldRequestAutomaticCelebration,
  type CelebrationReadiness,
} from './state'

const READY: CelebrationReadiness = {
  gameplay: true,
  toastsIdle: true,
  modalsClosed: true,
  powerEffectsIdle: true,
  worldSafe: true,
}

describe('CelebrationClock', () => {
  it('queues without advancing until every readiness gate passes', () => {
    const subject = new CelebrationClock()
    expect(subject.request()).toBe(true)
    expect(subject.request()).toBe(false)
    expect(subject.phase).toBe('queued')
    expect(subject.update(40, { ...READY, toastsIdle: false })).toEqual([])
    expect(subject.phase).toBe('queued')
  })

  it('runs the approved 4 + 8 + 2 second sequence', () => {
    const subject = new CelebrationClock()
    subject.request()
    expect(subject.update(0, READY)).toEqual(['started'])
    expect(subject.phase).toBe('gathering')
    expect(subject.update(CELEBRATION_SECONDS.gathering, READY)).toEqual(['fireworks'])
    expect(subject.phase).toBe('fireworks')
    expect(subject.update(CELEBRATION_SECONDS.fireworks, READY)).toEqual(['finale'])
    expect(subject.phase).toBe('finale')
    expect(subject.update(CELEBRATION_SECONDS.finale, READY)).toEqual(['completed'])
    expect(subject.phase).toBe('idle')
  })

  it('emits every crossed boundary in order when a frame overshoots', () => {
    const subject = new CelebrationClock()
    subject.request()
    expect(subject.update(14, READY)).toEqual([
      'started', 'fireworks', 'finale', 'completed',
    ])
    expect(subject.phase).toBe('idle')
  })

  it('cancels queued and active work idempotently', () => {
    const subject = new CelebrationClock()
    expect(subject.cancel()).toBe(false)
    subject.request()
    expect(subject.cancel()).toBe(true)
    expect(subject.cancel()).toBe(false)
    subject.request()
    subject.update(0, READY)
    expect(subject.cancel()).toBe(true)
    expect(subject.phase).toBe('idle')
  })
})

it('requires every readiness gate', () => {
  expect(canStartCelebration(READY)).toBe(true)
  for (const key of Object.keys(READY) as Array<keyof CelebrationReadiness>) {
    expect(canStartCelebration({ ...READY, [key]: false })).toBe(false)
  }
})

it('requests automatic playback only for the live 14 to 15 transition', () => {
  expect(shouldRequestAutomaticCelebration(14, 15, 15)).toBe(true)
  expect(shouldRequestAutomaticCelebration(15, 15, 15)).toBe(false)
  expect(shouldRequestAutomaticCelebration(13, 15, 15)).toBe(false)
  expect(shouldRequestAutomaticCelebration(14, 14, 15)).toBe(false)
})

import { describe, expect, it } from 'vitest'
import {
  canArmPower, canSkipPrologue, initialAppFlow, simulatesGameplay, transitionAppFlow,
} from './appFlow'

describe('app flow', () => {
  it('makes the first normal prologue mandatory', () => {
    const title = initialAppFlow(false)
    const prologue = transitionAppFlow(title, { type: 'begin' })
    expect(prologue).toMatchObject({ phase: 'prologue', mode: 'first', generation: 1 })
    expect(canSkipPrologue(prologue)).toBe(false)
    expect(transitionAppFlow(prologue, { type: 'finishPrologue' }).phase).toBe('gameplay')
  })

  it('authorizes returning and replay prologues, but not first view, for transport skip', () => {
    const prologue = transitionAppFlow(initialAppFlow(true), { type: 'begin' })
    expect(canSkipPrologue(prologue)).toBe(true)
    const first = transitionAppFlow(initialAppFlow(false), { type: 'begin' })
    expect(canSkipPrologue(first)).toBe(false)
  })

  it('covers both sides of replay and returns to gameplay', () => {
    const normal = transitionAppFlow(
      transitionAppFlow(initialAppFlow(true), { type: 'begin' }),
      { type: 'finishPrologue' },
    )
    const coverIn = transitionAppFlow(normal, { type: 'requestReplay' })
    expect(coverIn).toMatchObject({ phase: 'replay-transition', destination: 'prologue' })
    const replay = transitionAppFlow(coverIn, { type: 'coverReady' })
    expect(replay).toMatchObject({ phase: 'prologue', mode: 'replay' })
    expect(canSkipPrologue(replay)).toBe(true)
    const coverOut = transitionAppFlow(replay, { type: 'finishPrologue' })
    expect(coverOut).toMatchObject({ phase: 'replay-transition', destination: 'gameplay' })
    expect(transitionAppFlow(coverOut, { type: 'coverReady' }).phase).toBe('gameplay')
  })

  it('ignores stale or illegal events without advancing generation', () => {
    const state = initialAppFlow(false)
    expect(transitionAppFlow(state, { type: 'requestReplay' })).toBe(state)
    expect(transitionAppFlow(state, { type: 'finishPrologue' })).toBe(state)
  })

  it('simulates gameplay only in the gameplay phase', () => {
    const title = initialAppFlow(true)
    const prologue = transitionAppFlow(title, { type: 'begin' })
    const gameplay = transitionAppFlow(prologue, { type: 'finishPrologue' })

    expect(simulatesGameplay(title)).toBe(false)
    expect(simulatesGameplay(prologue)).toBe(false)
    expect(simulatesGameplay(gameplay)).toBe(true)
  })

  it('arms powers only during gameplay with no modal owner', () => {
    const title = initialAppFlow(true)
    const prologue = transitionAppFlow(title, { type: 'begin' })
    const gameplay = transitionAppFlow(prologue, { type: 'finishPrologue' })

    expect(canArmPower(title, false)).toBe(false)
    expect(canArmPower(prologue, false)).toBe(false)
    expect(canArmPower(gameplay, true)).toBe(false)
    expect(canArmPower(gameplay, false)).toBe(true)
  })
})

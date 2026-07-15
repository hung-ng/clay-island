import { describe, expect, it } from 'vitest'
import { setModalBackgroundInert, type InertElement } from './modal'

describe('modal background isolation', () => {
  it('inerts every background sibling and restores its previous state', () => {
    const active = { inert: false }
    const alreadyInert = { inert: true }
    const state = new Map<InertElement, boolean>()

    setModalBackgroundInert([active, alreadyInert], state, true)

    expect(active.inert).toBe(true)
    expect(alreadyInert.inert).toBe(true)

    setModalBackgroundInert([active, alreadyInert], state, false)

    expect(active.inert).toBe(false)
    expect(alreadyInert.inert).toBe(true)
    expect(state.size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { createModalBackground } from './modal'

function element(inert = false): HTMLElement {
  return { inert } as HTMLElement
}

describe('modal background isolation', () => {
  it('isolates the modal and restores each sibling to its previous state', () => {
    const modal = element()
    const active = element()
    const alreadyInert = element(true)
    const nonInertElement = {} as Element
    const setBackgroundInert = createModalBackground({
      children: [modal, active, alreadyInert, nonInertElement],
    }, modal)

    setBackgroundInert(true)

    expect(modal.inert).toBe(false)
    expect(active.inert).toBe(true)
    expect(alreadyInert.inert).toBe(true)
    expect(nonInertElement).not.toHaveProperty('inert')

    setBackgroundInert(false)

    expect(active.inert).toBe(false)
    expect(alreadyInert.inert).toBe(true)
  })

  it('keeps the original state across repeated activation and captures new siblings', () => {
    const modal = element()
    const active = element()
    const added = element()
    const host = { children: [modal, active] }
    const setBackgroundInert = createModalBackground(host, modal)

    setBackgroundInert(true)
    host.children = [modal, added]
    setBackgroundInert(true)
    expect(added.inert).toBe(true)
    setBackgroundInert(false)
    expect(active.inert).toBe(false)
    expect(added.inert).toBe(false)
  })

  it('captures fresh state on reopening and tolerates repeated close', () => {
    const modal = element()
    const background = element()
    const setBackgroundInert = createModalBackground({ children: [modal, background] }, modal)

    setBackgroundInert(true)
    setBackgroundInert(true)
    setBackgroundInert(false)
    expect(background.inert).toBe(false)

    background.inert = true
    setBackgroundInert(true)
    setBackgroundInert(false)
    setBackgroundInert(false)
    expect(background.inert).toBe(true)
  })
})

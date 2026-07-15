import { describe, expect, it } from 'vitest'
import { applyReducedMotion } from './motion'

describe('effective reduced-motion DOM state', () => {
  it('writes the explicit effective value for CSS consumers', () => {
    const root = { dataset: {} } as unknown as HTMLElement
    applyReducedMotion(root, true)
    expect(root.dataset.reducedMotion).toBe('true')
    applyReducedMotion(root, false)
    expect(root.dataset.reducedMotion).toBe('false')
  })
})

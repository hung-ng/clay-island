import { describe, expect, it } from 'vitest'
import { compareFramebuffers } from './audit'

describe('handoff framebuffer audit', () => {
  it('passes identical frames and ignores the ember mask', () => {
    const before = new Uint8Array(4 * 4 * 4)
    const after = before.slice()
    after[(1 * 4 + 1) * 4] = 255

    expect(compareFramebuffers(before, after, 4, 4, { x: 1, y: 1, radius: 1 })).toMatchObject({
      changedRatio: 0,
      pass: true,
    })
  })

  it('fails when more than 0.1 percent of unmasked pixels change by over 2', () => {
    const before = new Uint8Array(1000 * 4)
    const after = before.slice()
    after[0] = 3
    after[4] = 3

    expect(compareFramebuffers(before, after, 1000, 1, null).pass).toBe(false)
  })

  it('rejects mismatched buffers instead of comparing partial frames', () => {
    expect(() => compareFramebuffers(new Uint8Array(4), new Uint8Array(8), 1, 1, null))
      .toThrow(/framebuffer dimensions/i)
  })
})

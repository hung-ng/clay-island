import { describe, expect, it } from 'vitest'
import { floatingIsletY } from './islandShell'

describe('floating islet motion', () => {
  it('holds the authored height when reduced motion is enabled', () => {
    expect(floatingIsletY(-2.4, 1.7, 1000, true)).toBe(-2.4)
  })

  it('keeps the ambient bob when motion is enabled', () => {
    expect(floatingIsletY(-2.4, 1.7, 1000, false)).not.toBe(-2.4)
  })
})

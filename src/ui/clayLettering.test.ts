import { describe, expect, it } from 'vitest'
import { fitTitle, GLYPHS, layoutTitle } from './clayLettering'

const WORDS = ['CLAY', 'ISLAND'] as const

describe('clay lettering', () => {
  it('has a glyph for every letter of the title, inside its own box', () => {
    for (const char of WORDS.join('')) {
      const glyph = GLYPHS[char]
      expect(glyph, char).toBeDefined()
      for (const stroke of glyph!.strokes) {
        for (const [x, y] of stroke.points) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(glyph!.width)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('centres a single line on the origin', () => {
    const layout = layoutTitle(WORDS, true)
    const left = layout.glyphs[0]!.x
    const last = layout.glyphs.at(-1)!
    expect(left).toBeCloseTo(-layout.width / 2)
    expect(last.x + last.glyph.width).toBeCloseTo(layout.width / 2)
    expect(layout.glyphs.every(g => g.y === -0.5)).toBe(true)
    expect(layout.glyphs).toHaveLength(10)
  })

  it('stacks the words when the view is too narrow for one line', () => {
    const wide = fitTitle(WORDS, 13.4, 7.6, 1)
    expect(new Set(wide.layout.glyphs.map(g => g.y)).size).toBe(1)
    expect(wide.scale).toBe(1)

    const phone = fitTitle(WORDS, 3.5, 7.6, 1)
    expect(new Set(phone.layout.glyphs.map(g => g.y)).size).toBe(2)
    expect(phone.layout.width * phone.scale).toBeLessThanOrEqual(3.5 * 0.82 + 1e-9)
  })
})

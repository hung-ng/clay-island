import { describe, expect, it } from 'vitest'
import { powerGlyphMarkup } from './tray'

describe('power glyph markup', () => {
  it('builds the Nudge hand from explicit decorative clay shapes', () => {
    const markup = powerGlyphMarkup('nudge')

    expect(markup).toContain('data-glyph="nudge"')
    expect(markup).toContain('aria-hidden="true"')
    for (const part of [
      'nudge-wrist',
      'nudge-palm',
      'nudge-folded-fingers',
      'nudge-thumb',
      'nudge-index',
    ]) {
      expect(markup).toContain(`class="${part}"`)
    }
    expect(markup).not.toContain('nudge-dimple')
  })

  it('keeps other power glyphs as simple decorative spans', () => {
    expect(powerGlyphMarkup('meteor')).toBe(
      '<span class="power-glyph" data-glyph="meteor" aria-hidden="true"></span>',
    )
  })
})

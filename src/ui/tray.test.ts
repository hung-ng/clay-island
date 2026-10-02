import { describe, expect, it } from 'vitest'
import { POWER_IDS, powerGlyphMarkup } from './tray'

it('places Wind fourth and Nudge fifth so their shortcuts follow their slots', () => {
  expect(POWER_IDS).toEqual(['meteor', 'lightning', 'rain', 'wind', 'nudge'])
})

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

  it('gives Wind the same simple decorative span as the destructive powers', () => {
    expect(powerGlyphMarkup('wind')).toBe(
      '<span class="power-glyph" data-glyph="wind" aria-hidden="true"></span>',
    )
  })
})

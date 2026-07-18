import { describe, expect, it } from 'vitest'
import { EMOTE_GLYPHS } from './emotes'

describe('emote glyphs', () => {
  it('uses a compact semantic vocabulary with z reserved for sleep', () => {
    expect(EMOTE_GLYPHS).toEqual({
      alarm: '!',
      question: '?',
      water: '≋',
      sleep: 'z',
      fish: '><>',
      sad: '…',
      cower: '!',
      content: '~',
      happy: '♥',
      music: '♪',
    })

    expect(Object.entries(EMOTE_GLYPHS).filter(([, glyph]) => glyph === 'z'))
      .toEqual([['sleep', 'z']])
  })
})

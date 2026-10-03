/**
 * The title, spelled in rolled clay coils. Pure layout lives here so it can be
 * tested; titleLetters.ts turns it into meshes.
 *
 * Each glyph sits in a box one unit tall. A stroke is either a polyline (bent
 * coil: one capsule per segment, so joints and ends round off by themselves)
 * or a smooth curve (one tube along a spline, capped with balls).
 */
export type Point = readonly [number, number]
export type Stroke = { points: readonly Point[]; smooth?: boolean }
export type Glyph = { width: number; strokes: readonly Stroke[] }

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps: number): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = (from + (to - from) * (i / steps)) * Math.PI / 180
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry])
  }
  return points
}

export const GLYPHS: Readonly<Record<string, Glyph>> = {
  C: { width: 0.8, strokes: [{ smooth: true, points: arc(0.44, 0.5, 0.39, 0.49, 48, 312, 10) }] },
  L: { width: 0.62, strokes: [{ points: [[0.08, 1], [0.08, 0], [0.58, 0]] }] },
  A: {
    width: 0.82,
    strokes: [
      { points: [[0.03, 0], [0.41, 1], [0.79, 0]] },
      { points: [[0.18, 0.36], [0.64, 0.36]] },
    ],
  },
  Y: {
    width: 0.8,
    strokes: [
      { points: [[0.03, 1], [0.4, 0.47]] },
      { points: [[0.77, 1], [0.4, 0.47], [0.4, 0]] },
    ],
  },
  I: { width: 0.2, strokes: [{ points: [[0.1, 1], [0.1, 0]] }] },
  S: {
    width: 0.72,
    strokes: [{
      smooth: true,
      points: [
        [0.67, 0.84], [0.5, 0.99], [0.26, 0.99], [0.08, 0.85], [0.1, 0.63], [0.36, 0.52],
        [0.62, 0.42], [0.68, 0.2], [0.51, 0.02], [0.25, 0.01], [0.04, 0.15],
      ],
    }],
  },
  N: { width: 0.78, strokes: [{ points: [[0.06, 0], [0.06, 1], [0.72, 0], [0.72, 1]] }] },
  D: {
    width: 0.76,
    strokes: [
      { points: [[0.06, 0], [0.06, 1]] },
      { smooth: true, points: [[0.06, 1], [0.36, 0.98], [0.63, 0.8], [0.72, 0.5], [0.63, 0.2], [0.36, 0.02], [0.06, 0]] },
    ],
  },
}

export const LETTER_GAP = 0.17
export const LINE_GAP = 0.42

export type PlacedGlyph = { char: string; glyph: Glyph; x: number; y: number }
export type Layout = { glyphs: PlacedGlyph[]; width: number; height: number }

function lineWidth(word: string): number {
  let width = 0
  for (const char of word) width += GLYPHS[char]!.width
  return width + LETTER_GAP * Math.max(0, word.length - 1)
}

/**
 * Lays the words out centred on the origin, one per line, or all on one line
 * separated by a word gap. Glyph x/y are each box's lower-left corner.
 */
export function layoutTitle(words: readonly string[], singleLine: boolean): Layout {
  const lines = singleLine ? [words] : words.map(word => [word])
  const wordGap = 0.95
  const widths = lines.map(line => line.reduce((sum, word) => sum + lineWidth(word), 0)
    + wordGap * Math.max(0, line.length - 1))
  const height = lines.length + LINE_GAP * (lines.length - 1)
  const glyphs: PlacedGlyph[] = []
  lines.forEach((line, row) => {
    let x = -widths[row]! / 2
    const y = height / 2 - 1 - row * (1 + LINE_GAP)
    line.forEach((word, index) => {
      if (index > 0) x += wordGap
      for (const char of word) {
        const glyph = GLYPHS[char]!
        glyphs.push({ char, glyph, x, y })
        x += glyph.width + LETTER_GAP
      }
      x -= LETTER_GAP
    })
  })
  return { glyphs, width: Math.max(...widths), height }
}

/**
 * Picks the line arrangement and scale for a view `viewWidth` x `viewHeight`
 * units across at the lettering's depth. One line when it fits comfortably,
 * stacked otherwise; never wider than `maxWidthShare` of the view or taller
 * than `maxHeightShare`, and never bigger than `capHeight` per line.
 */
export function fitTitle(
  words: readonly string[],
  viewWidth: number,
  viewHeight: number,
  capHeight: number,
  maxWidthShare = 0.82,
  maxHeightShare = 0.34,
): { layout: Layout; scale: number } {
  const single = layoutTitle(words, true)
  const singleScale = Math.min(capHeight, (viewWidth * maxWidthShare) / single.width)
  if (singleScale >= capHeight * 0.8) return { layout: single, scale: singleScale }
  const stacked = layoutTitle(words, false)
  const scale = Math.min(
    capHeight,
    (viewWidth * maxWidthShare) / stacked.width,
    (viewHeight * maxHeightShare) / stacked.height,
  )
  return { layout: stacked, scale }
}

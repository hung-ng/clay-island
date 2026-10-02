import { describe, expect, it } from 'vitest'
import { PALETTE } from './tokens'
import {
  composePostcard,
  createPhotoCapture,
  exportPhoto,
  photoFilename,
  postcardCaption,
  postcardLayout,
  type CapturedPhoto,
  type CaptureRenderer,
  type Postcard2dContext,
  type PhotoCanvas,
} from './photo'

describe('postcard text', () => {
  it('derives the caption from day count and phase kind', () => {
    expect(postcardCaption(12, 'dusk')).toBe('Clay Island — Day 12, dusk')
    expect(postcardCaption(1, 'night')).toBe('Clay Island — Day 1, night')
  })

  it('derives the filename from day count and phase kind', () => {
    expect(photoFilename(12, 'dusk')).toBe('clay-island-day-12-dusk.png')
    expect(photoFilename(3, 'dawn')).toBe('clay-island-day-3-dawn.png')
  })
})

describe('postcardLayout', () => {
  it('frames a 2560x1440 capture with a clay border and caption band', () => {
    const layout = postcardLayout(2560, 1440)
    expect(layout.border).toBe(77)
    expect(layout.captionBand).toBe(192)
    expect(layout.outerWidth).toBe(2560 + 77 * 2)
    expect(layout.outerHeight).toBe(1440 + 77 + 192)
    expect(layout.imageX).toBe(77)
    expect(layout.imageY).toBe(77)
    expect(layout.captionX).toBe(Math.round((2560 + 77 * 2) / 2))
    expect(layout.captionY).toBe(1440 + 77 + 96)
    expect(layout.fontPx).toBe(77)
  })

  it('preserves portrait aspect captures', () => {
    const layout = postcardLayout(2560, 5120)
    expect(layout.outerWidth).toBe(2560 + layout.border * 2)
    expect(layout.outerHeight).toBe(5120 + layout.border + layout.captionBand)
  })
})

type Rect = { x: number; y: number; w: number; h: number; fill: string }
type Draw = { x: number; y: number; w: number; h: number }
type Text = { text: string; x: number; y: number; fill: string }

class StubContext implements Postcard2dContext {
  fillStyle: string | CanvasGradient | CanvasPattern = ''
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  rects: Rect[] = []
  draws: Draw[] = []
  texts: Text[] = []
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, fill: String(this.fillStyle) })
  }
  drawImage(_source: unknown, x: number, y: number, w: number, h: number): void {
    this.draws.push({ x, y, w, h })
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, fill: String(this.fillStyle) })
  }
}

describe('composePostcard', () => {
  it('paints paper, pressed seam, capture, and a two-pass pressed caption', () => {
    const layout = postcardLayout(2560, 1440)
    const context = new StubContext()
    composePostcard(context, { width: 2560, height: 1440 }, layout, 'Clay Island — Day 12, dusk')

    expect(context.rects[0]).toEqual({
      x: 0, y: 0, w: layout.outerWidth, h: layout.outerHeight, fill: PALETTE.paper,
    })
    expect(context.rects[1]).toEqual({
      x: layout.imageX - 3, y: layout.imageY - 3, w: 2560 + 6, h: 1440 + 6,
      fill: PALETTE.inkSoft,
    })
    expect(context.draws).toEqual([{ x: layout.imageX, y: layout.imageY, w: 2560, h: 1440 }])
    expect(context.texts).toHaveLength(2)
    expect(context.texts[0]).toMatchObject({
      text: 'Clay Island — Day 12, dusk', x: layout.captionX, fill: PALETTE.cloud,
    })
    expect(context.texts[0]!.y).toBeGreaterThan(layout.captionY)
    expect(context.texts[1]).toEqual({
      text: 'Clay Island — Day 12, dusk', x: layout.captionX, y: layout.captionY,
      fill: PALETTE.ink,
    })
    expect(context.textAlign).toBe('center')
    expect(context.textBaseline).toBe('middle')
    expect(context.font).toContain(`${layout.fontPx}px`)
  })
})

function stubRenderer(width: number, height: number) {
  const sizes: { width: number; height: number }[] = []
  const ratios: number[] = []
  const renderer: CaptureRenderer = {
    canvas: { width, height },
    size: () => ({ width, height }),
    pixelRatio: () => 1.5,
    setPixelRatio: value => { ratios.push(value) },
    setSize: (w, h) => { sizes.push({ width: w, height: h }) },
  }
  return { renderer, sizes, ratios }
}

type StubCanvas = PhotoCanvas & { context: StubContext }

function stubCanvas(width: number, height: number, blob: Blob | null): StubCanvas {
  const context = new StubContext()
  return {
    width,
    height,
    context,
    getContext: () => context,
    toBlob: callback => callback(blob),
  }
}

function captureHarness(overrides: {
  renderFrame?(): void
  openPreview?(photo: CapturedPhoto): void
}) {
  const { renderer, sizes, ratios } = stubRenderer(1280, 720)
  const composerSizes: { width: number; height: number }[] = []
  const messages: string[] = []
  const previews: CapturedPhoto[] = []
  const canvases: StubCanvas[] = []
  let rendered = 0
  let captured = 0
  const capture = createPhotoCapture({
    renderer,
    composer: { setSize: (w, h) => { composerSizes.push({ width: w, height: h }) } },
    renderFrame: overrides.renderFrame ?? (() => { rendered++ }),
    day: () => 3,
    kind: () => 'dusk',
    createCanvas: (width, height) => {
      const canvas = stubCanvas(width, height, {} as Blob)
      canvases.push(canvas)
      return canvas
    },
    openPreview: overrides.openPreview ?? (photo => { previews.push(photo) }),
    announce: message => { messages.push(message) },
    onCaptured: () => { captured++ },
  })
  return {
    capture,
    sizes,
    ratios,
    composerSizes,
    previews,
    canvases,
    messages,
    renderedCount: () => rendered,
    capturedCount: () => captured,
  }
}

describe('createPhotoCapture', () => {
  it('copies one capped frame, restores rendering, and opens a default-caption draft', () => {
    const harness = captureHarness({})
    harness.capture.capture()
    expect(harness.renderedCount()).toBe(1)
    expect(harness.ratios).toEqual([1, 1.5])
    expect(harness.sizes).toEqual([
      { width: 2560, height: 1440 },
      { width: 1280, height: 720 },
    ])
    expect(harness.composerSizes).toEqual([
      { width: 2560, height: 1440 },
      { width: 1280, height: 720 },
    ])
    expect(harness.previews).toHaveLength(1)
    expect(harness.previews[0]).toMatchObject({
      defaultCaption: 'Clay Island — Day 3, dusk',
      filename: 'clay-island-day-3-dusk.png',
    })
    expect(harness.previews[0]!.source).toMatchObject({ width: 2560, height: 1440 })
    expect(harness.canvases[0]!.context.draws).toEqual([
      { x: 0, y: 0, w: 2560, h: 1440 },
    ])
    expect(harness.messages).toEqual([])
    expect(harness.capturedCount()).toBe(1)
  })

  it('restores sizes and announces failure when the render throws', () => {
    const harness = captureHarness({ renderFrame: () => { throw new Error('context lost') } })
    harness.capture.capture()
    expect(harness.sizes).toEqual([
      { width: 2560, height: 1440 },
      { width: 1280, height: 720 },
    ])
    expect(harness.ratios).toEqual([1, 1.5])
    expect(harness.previews).toEqual([])
    expect(harness.messages).toEqual(['Photo failed'])
    expect(harness.capturedCount()).toBe(0)
  })

  it('releases the cached frame and announces failure when preview opening throws', () => {
    const harness = captureHarness({ openPreview: () => { throw new Error('modal failed') } })
    harness.capture.capture()
    expect(harness.canvases[0]).toMatchObject({ width: 1, height: 1 })
    expect(harness.messages).toEqual(['Photo failed'])
  })
})

function photoDraft(blob: Blob | null): {
  photo: CapturedPhoto
  output: StubCanvas
  released: () => number
} {
  const source = stubCanvas(2560, 1440, {} as Blob)
  const output = stubCanvas(2714, 1709, blob)
  let releaseCount = 0
  return {
    photo: {
      source,
      layout: postcardLayout(source.width, source.height),
      defaultCaption: 'Clay Island — Day 3, dusk',
      filename: 'clay-island-day-3-dusk.png',
      release: () => { releaseCount++ },
    },
    output,
    released: () => releaseCount,
  }
}

describe('exportPhoto', () => {
  it('composites the edited caption and downloads only when explicitly exported', async () => {
    const { photo, output, released } = photoDraft({} as Blob)
    const downloads: string[] = []
    const messages: string[] = []

    const saved = await exportPhoto(photo, 'Wish you were here!', {
      createCanvas: () => output,
      download: (_, filename) => { downloads.push(filename) },
      announce: message => { messages.push(message) },
    })

    expect(saved).toBe(true)
    expect(output.context.texts.map(text => text.text)).toEqual([
      'Wish you were here!',
      'Wish you were here!',
    ])
    expect(downloads).toEqual(['clay-island-day-3-dusk.png'])
    expect(messages).toEqual(['Photo saved'])
    expect(released()).toBe(0)
  })

  it('keeps the draft available when encoding fails', async () => {
    const { photo, output, released } = photoDraft(null)
    const messages: string[] = []

    const saved = await exportPhoto(photo, photo.defaultCaption, {
      createCanvas: () => output,
      download: () => { throw new Error('must not download') },
      announce: message => { messages.push(message) },
    })

    expect(saved).toBe(false)
    expect(messages).toEqual(['Photo failed'])
    expect(released()).toBe(0)
  })

  it('reports a blocked download without releasing the draft', async () => {
    const { photo, output, released } = photoDraft({} as Blob)
    const messages: string[] = []

    const saved = await exportPhoto(photo, 'A quieter island', {
      createCanvas: () => output,
      download: () => { throw new Error('blocked') },
      announce: message => { messages.push(message) },
    })

    expect(saved).toBe(false)
    expect(messages).toEqual(['Photo failed'])
    expect(released()).toBe(0)
  })
})

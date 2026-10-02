import type { DayKind } from '../core/dayClock'
import { createModalBackground } from './modal'
import { PALETTE } from './tokens'

/** Capture is capped here; aspect follows the live canvas. */
export const CAPTURE_MAX_WIDTH = 2560

export type PostcardLayout = {
  outerWidth: number
  outerHeight: number
  border: number
  captionBand: number
  imageX: number
  imageY: number
  captionX: number
  captionY: number
  fontPx: number
}

export type PostcardImageSource = { width: number; height: number }

export type Postcard2dContext = {
  fillStyle: string | CanvasGradient | CanvasPattern
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  fillRect(x: number, y: number, width: number, height: number): void
  drawImage(
    source: PostcardImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void
  fillText(text: string, x: number, y: number, maxWidth?: number): void
}

export function postcardCaption(day: number, kind: DayKind): string {
  return `Clay Island — Day ${day}, ${kind}`
}

export function photoFilename(day: number, kind: DayKind): string {
  return `clay-island-day-${day}-${kind}.png`
}

export function postcardLayout(width: number, height: number): PostcardLayout {
  const border = Math.round(width * 0.03)
  const captionBand = Math.round(width * 0.075)
  return {
    outerWidth: width + border * 2,
    outerHeight: height + border + captionBand,
    border,
    captionBand,
    imageX: border,
    imageY: border,
    captionX: Math.round((width + border * 2) / 2),
    captionY: Math.round(height + border + captionBand / 2),
    fontPx: Math.round(captionBand * 0.4),
  }
}

export function composePostcard(
  context: Postcard2dContext,
  source: PostcardImageSource,
  layout: PostcardLayout,
  caption: string,
): void {
  const imageWidth = layout.outerWidth - layout.border * 2
  const imageHeight = layout.outerHeight - layout.border - layout.captionBand
  context.fillStyle = PALETTE.paper
  context.fillRect(0, 0, layout.outerWidth, layout.outerHeight)
  // A pressed seam around the capture so the border reads as clay, not flat paper.
  context.fillStyle = PALETTE.inkSoft
  context.fillRect(layout.imageX - 3, layout.imageY - 3, imageWidth + 6, imageHeight + 6)
  context.drawImage(source, layout.imageX, layout.imageY, imageWidth, imageHeight)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `600 ${layout.fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`
  // Pressed caption: clay-white highlight one step below, ink on top.
  const press = Math.max(1, Math.round(layout.fontPx / 14))
  const captionMaxWidth = imageWidth * 0.9
  context.fillStyle = PALETTE.cloud
  context.fillText(caption, layout.captionX, layout.captionY + press, captionMaxWidth)
  context.fillStyle = PALETTE.ink
  context.fillText(caption, layout.captionX, layout.captionY, captionMaxWidth)
}

export type CaptureRenderer = {
  canvas: PostcardImageSource
  size(): { width: number; height: number }
  pixelRatio(): number
  setPixelRatio(value: number): void
  setSize(width: number, height: number): void
}

export type CaptureComposer = { setSize(width: number, height: number): void }

export type PostcardCanvas = {
  getContext(kind: '2d'): Postcard2dContext | null
  toBlob(callback: (blob: Blob | null) => void, type?: string): void
}

export type PhotoCanvas = PostcardCanvas & PostcardImageSource

export type CapturedPhoto = {
  source: PhotoCanvas
  layout: PostcardLayout
  defaultCaption: string
  filename: string
  release(): void
}

export type PhotoCaptureOptions = {
  renderer: CaptureRenderer
  composer: CaptureComposer | null
  renderFrame(): void
  day(): number
  kind(): DayKind
  createCanvas(width: number, height: number): PhotoCanvas
  openPreview(photo: CapturedPhoto): void
  announce(message: string): void
  onCaptured(): void
}

export function createPhotoCapture(options: PhotoCaptureOptions): { capture(): void } {
  function capture(): void {
    const previous = options.renderer.size()
    const previousRatio = options.renderer.pixelRatio()
    const width = CAPTURE_MAX_WIDTH
    const height = Math.max(1, Math.round((width * previous.height) / previous.width))
    const day = options.day()
    const kind = options.kind()
    let source: PhotoCanvas
    try {
      options.renderer.setPixelRatio(1)
      options.renderer.setSize(width, height)
      options.composer?.setSize(width, height)
      // Render and read back in the same task so preserveDrawingBuffer stays off.
      options.renderFrame()
      source = options.createCanvas(width, height)
      const context = source.getContext('2d')
      if (!context) throw new Error('no 2d context')
      context.drawImage(options.renderer.canvas, 0, 0, width, height)
    } catch {
      options.announce('Photo failed')
      return
    } finally {
      options.renderer.setPixelRatio(previousRatio)
      options.renderer.setSize(previous.width, previous.height)
      options.composer?.setSize(previous.width, previous.height)
    }
    let released = false
    const photo: CapturedPhoto = {
      source,
      layout: postcardLayout(width, height),
      defaultCaption: postcardCaption(day, kind),
      filename: photoFilename(day, kind),
      release: () => {
        if (released) return
        released = true
        source.width = 1
        source.height = 1
      },
    }
    try {
      options.onCaptured()
      options.openPreview(photo)
    } catch {
      photo.release()
      options.announce('Photo failed')
    }
  }
  return { capture }
}

export type PhotoExportOptions = {
  createCanvas(width: number, height: number): PhotoCanvas
  download(blob: Blob, filename: string): void
  announce(message: string): void
}

export function exportPhoto(
  photo: CapturedPhoto,
  caption: string,
  options: PhotoExportOptions,
): Promise<boolean> {
  return new Promise(resolve => {
    let output: PhotoCanvas | null = null
    const finish = (saved: boolean): void => {
      if (output) {
        output.width = 1
        output.height = 1
      }
      options.announce(saved ? 'Photo saved' : 'Photo failed')
      resolve(saved)
    }

    try {
      output = options.createCanvas(photo.layout.outerWidth, photo.layout.outerHeight)
      const context = output.getContext('2d')
      if (!context) throw new Error('no 2d context')
      composePostcard(context, photo.source, photo.layout, caption)
      output.toBlob(blob => {
        if (!blob) {
          finish(false)
          return
        }
        try {
          options.download(blob, photo.filename)
          finish(true)
        } catch {
          finish(false)
        }
      }, 'image/png')
    } catch {
      finish(false)
    }
  })
}

/** Browser-only download boundary; the controller receives it injected. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Screen-reader-only status region for "Photo saved" / "Photo failed". */
export function createPhotoAnnouncer(host: HTMLElement): (message: string) => void {
  const region = document.createElement('div')
  region.className = 'photo-announce'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  region.setAttribute('aria-atomic', 'true')
  host.appendChild(region)
  return message => { region.textContent = message }
}

export type PhotoPreviewUI = {
  open(photo: CapturedPhoto): void
  close(): void
  isOpen(): boolean
  dispose(): void
}

export type PhotoPreviewOptions = PhotoExportOptions & {
  reducedMotion(): boolean
  onOpenChange?(open: boolean): void
}

/** Browser-only editable postcard preview. Capture/export stay injected and Node-testable. */
export function createPhotoPreview(
  host: HTMLElement,
  options: PhotoPreviewOptions,
): PhotoPreviewUI {
  const layer = document.createElement('div')
  layer.id = 'photo-preview-layer'
  layer.hidden = true

  const backdrop = document.createElement('div')
  backdrop.className = 'photo-preview-backdrop'
  backdrop.setAttribute('aria-hidden', 'true')

  const dialog = document.createElement('section')
  dialog.id = 'photo-preview-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'photo-preview-heading')
  dialog.tabIndex = -1

  const heading = document.createElement('h2')
  heading.id = 'photo-preview-heading'
  heading.textContent = 'Your postcard'

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'photo-preview-close'
  closeButton.setAttribute('aria-label', 'Close photo preview')
  closeButton.textContent = 'Close'

  const stage = document.createElement('div')
  stage.className = 'photo-preview-stage'
  const postcard = document.createElement('div')
  postcard.className = 'photo-preview-postcard'
  const shot = document.createElement('div')
  shot.className = 'photo-preview-shot'
  const captionPreview = document.createElement('p')
  captionPreview.className = 'photo-preview-caption'
  postcard.append(shot, captionPreview)
  stage.appendChild(postcard)

  const editor = document.createElement('form')
  editor.className = 'photo-preview-editor'
  const captionLabel = document.createElement('label')
  captionLabel.htmlFor = 'photo-caption-input'
  captionLabel.textContent = 'Caption'
  const captionInput = document.createElement('input')
  captionInput.id = 'photo-caption-input'
  captionInput.type = 'text'
  captionInput.maxLength = 80
  captionInput.autocomplete = 'off'
  captionInput.spellcheck = true
  const status = document.createElement('p')
  status.className = 'photo-preview-status'
  status.setAttribute('aria-live', 'polite')
  const actions = document.createElement('div')
  actions.className = 'photo-preview-actions'
  const saveButton = document.createElement('button')
  saveButton.type = 'submit'
  saveButton.className = 'photo-preview-save'
  saveButton.textContent = 'Save photo'
  actions.appendChild(saveButton)
  editor.append(captionLabel, captionInput, status, actions)

  dialog.append(heading, closeButton, stage, editor)
  layer.append(backdrop, dialog)
  host.appendChild(layer)

  let current: CapturedPhoto | null = null
  let currentCanvas: HTMLCanvasElement | null = null
  let pendingRelease: CapturedPhoto | null = null
  let openRaf = 0
  let closeTimer = 0
  let saving = false
  let disposed = false
  let restoreFocus: HTMLElement | null = null
  const setBackgroundInert = createModalBackground(host, layer)

  const finishPendingClose = (): void => {
    window.clearTimeout(closeTimer)
    closeTimer = 0
    currentCanvas?.remove()
    currentCanvas = null
    pendingRelease?.release()
    pendingRelease = null
    layer.hidden = true
  }

  const setSaving = (value: boolean): void => {
    saving = value
    dialog.setAttribute('aria-busy', String(value))
    closeButton.disabled = value
    captionInput.disabled = value
    saveButton.disabled = value
    saveButton.textContent = value ? 'Saving…' : 'Save photo'
  }

  const syncCaption = (): void => {
    captionPreview.textContent = captionInput.value || '\u00a0'
  }

  const positionPreview = (photo: CapturedPhoto): void => {
    const { layout, source } = photo
    const percent = (value: number, total: number): string => `${(value / total) * 100}%`
    postcard.style.aspectRatio = `${layout.outerWidth} / ${layout.outerHeight}`
    postcard.style.setProperty('--photo-aspect', String(layout.outerWidth / layout.outerHeight))
    shot.style.left = percent(layout.imageX, layout.outerWidth)
    shot.style.top = percent(layout.imageY, layout.outerHeight)
    shot.style.width = percent(source.width, layout.outerWidth)
    shot.style.height = percent(source.height, layout.outerHeight)
    captionPreview.style.left = percent(layout.border, layout.outerWidth)
    captionPreview.style.top = percent(source.height + layout.border, layout.outerHeight)
    captionPreview.style.width = percent(source.width, layout.outerWidth)
    captionPreview.style.height = percent(layout.captionBand, layout.outerHeight)
  }

  const close = (): void => {
    if (!current || saving) return
    cancelAnimationFrame(openRaf)
    openRaf = 0
    layer.classList.remove('open')
    setBackgroundInert(false)
    options.onOpenChange?.(false)
    pendingRelease = current
    current = null
    status.textContent = ''
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true })
    else document.getElementById('photo-btn')?.focus({ preventScroll: true })
    restoreFocus = null
    if (options.reducedMotion()) finishPendingClose()
    else closeTimer = window.setTimeout(finishPendingClose, 240)
  }

  const open = (photo: CapturedPhoto): void => {
    if (disposed) {
      photo.release()
      return
    }
    if (current) close()
    if (pendingRelease) finishPendingClose()
    const activeElement = document.activeElement
    restoreFocus = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : document.getElementById('photo-btn')
    current = photo
    currentCanvas = photo.source as unknown as HTMLCanvasElement
    currentCanvas.classList.add('photo-preview-canvas')
    shot.replaceChildren(currentCanvas)
    positionPreview(photo)
    captionInput.value = photo.defaultCaption
    syncCaption()
    status.textContent = ''
    setSaving(false)
    layer.hidden = false
    setBackgroundInert(true)
    options.onOpenChange?.(true)
    openRaf = requestAnimationFrame(() => {
      openRaf = 0
      if (!current || disposed) return
      layer.classList.add('open')
      captionInput.focus({ preventScroll: true })
      captionInput.select()
    })
  }

  const save = async (): Promise<void> => {
    const photo = current
    if (!photo || saving) return
    setSaving(true)
    status.textContent = ''
    const saved = await exportPhoto(photo, captionInput.value, options)
    if (disposed || current !== photo) return
    if (saved) {
      setSaving(false)
      close()
    }
    else {
      setSaving(false)
      status.textContent = 'Photo could not be saved. Try again.'
      saveButton.focus({ preventScroll: true })
    }
  }

  captionInput.addEventListener('input', syncCaption)
  closeButton.addEventListener('click', close)
  backdrop.addEventListener('click', close)
  editor.addEventListener('submit', event => {
    event.preventDefault()
    void save()
  })
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [closeButton, captionInput, saveButton]
      .filter(element => !element.disabled)
    const currentIndex = focusable.indexOf(document.activeElement as typeof focusable[number])
    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault()
      focusable.at(-1)?.focus()
    } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
      event.preventDefault()
      focusable[0]?.focus()
    }
  })

  return {
    open,
    close,
    isOpen: () => current !== null,
    dispose: () => {
      if (disposed) return
      disposed = true
      setSaving(false)
      if (current) {
        pendingRelease = current
        current = null
      }
      setBackgroundInert(false)
      options.onOpenChange?.(false)
      finishPendingClose()
      layer.remove()
    },
  }
}

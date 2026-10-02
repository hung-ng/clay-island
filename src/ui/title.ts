import { createModalBackground } from './modal'

export type TitleUI = {
  showBegin(): void
  showPrologue(canSkip: boolean): void
  showCover(onCovered: () => void): void
  hide(): void
  dispose(): void
}

export function createTitleUI(
  ui: HTMLElement,
  handlers: { reducedMotion(): boolean; onBegin(): void; onSkip(): void },
): TitleUI {
  const layer = document.createElement('div')
  layer.id = 'title-layer'
  layer.dataset.mode = 'hidden'
  layer.setAttribute('aria-hidden', 'true')

  const plaque = document.createElement('section')
  plaque.id = 'title-plaque'
  plaque.setAttribute('aria-labelledby', 'title-heading')

  const heading = document.createElement('h1')
  heading.id = 'title-heading'
  heading.textContent = 'Clay Island'

  const begin = document.createElement('button')
  begin.id = 'begin-btn'
  begin.type = 'button'
  begin.textContent = 'Begin'
  begin.disabled = true
  begin.tabIndex = -1

  const skip = document.createElement('button')
  skip.id = 'intro-skip'
  skip.type = 'button'
  skip.textContent = 'Skip intro'
  skip.hidden = true
  skip.tabIndex = -1

  plaque.append(heading, begin)
  layer.append(plaque, skip)
  ui.appendChild(layer)

  let coverTimer = 0
  let plaqueTimer = 0
  let disposed = false
  const setBackgroundInert = createModalBackground(ui, layer)

  const clearCoverTimer = (): void => {
    window.clearTimeout(coverTimer)
    coverTimer = 0
  }

  const clearPlaqueTimer = (): void => {
    window.clearTimeout(plaqueTimer)
    plaqueTimer = 0
  }

  const setMode = (mode: 'begin' | 'prologue' | 'cover' | 'hidden'): void => {
    clearCoverTimer()
    clearPlaqueTimer()
    layer.dataset.mode = mode
    layer.setAttribute('aria-hidden', String(mode === 'hidden'))
    setBackgroundInert(mode !== 'hidden')
  }

  const onBegin = (): void => { handlers.onBegin() }
  const onSkip = (): void => { handlers.onSkip() }
  begin.addEventListener('click', onBegin)
  skip.addEventListener('click', onSkip)

  const api: TitleUI = {
    showBegin() {
      if (disposed) return
      setMode('begin')
      plaque.hidden = false
      plaque.removeAttribute('aria-hidden')
      begin.hidden = false
      begin.disabled = false
      begin.tabIndex = 0
      skip.hidden = true
      skip.tabIndex = -1
      begin.focus({ preventScroll: true })
    },

    showPrologue(canSkip) {
      if (disposed) return
      setMode('prologue')
      plaque.hidden = false
      plaque.setAttribute('aria-hidden', 'true')
      begin.disabled = true
      begin.tabIndex = -1
      skip.hidden = !canSkip
      skip.tabIndex = canSkip ? 0 : -1
      layer.setAttribute('aria-hidden', String(!canSkip))
      const hidePlaque = (): void => {
        plaqueTimer = 0
        if (!disposed && layer.dataset.mode === 'prologue') plaque.hidden = true
      }
      if (handlers.reducedMotion()) hidePlaque()
      else plaqueTimer = window.setTimeout(hidePlaque, 240)
    },

    showCover(onCovered) {
      if (disposed) return
      setMode('cover')
      plaque.hidden = false
      plaque.removeAttribute('aria-hidden')
      begin.hidden = true
      begin.disabled = true
      begin.tabIndex = -1
      skip.hidden = true
      skip.tabIndex = -1
      coverTimer = window.setTimeout(() => {
        coverTimer = 0
        if (!disposed && layer.dataset.mode === 'cover') onCovered()
      }, handlers.reducedMotion() ? 0 : 320)
    },

    hide() {
      if (disposed) return
      setMode('hidden')
      begin.hidden = true
      begin.disabled = true
      begin.tabIndex = -1
      skip.hidden = true
      skip.tabIndex = -1
    },

    dispose() {
      if (disposed) return
      disposed = true
      clearCoverTimer()
      clearPlaqueTimer()
      setBackgroundInert(false)
      begin.removeEventListener('click', onBegin)
      skip.removeEventListener('click', onSkip)
      layer.remove()
    },
  }

  return api
}

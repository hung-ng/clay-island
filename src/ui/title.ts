import { createModalBackground } from './modal'

export type TitleUI = {
  showPrologue(canSkip: boolean): void
  showCover(onCovered: () => void): void
  hide(): void
  dispose(): void
}

/** Hand-placed, not random: the wordmark should look the same every visit. */
const TITLE_TILTS = [-6, 4, -3, 7, -5, 3, -7, 5, -2, 6]
const TITLE_LIFTS = [0, -3, 2, -1, 3, -2, 1, -4, 2, 0]

export function createTitleUI(
  ui: HTMLElement,
  handlers: { reducedMotion(): boolean; onSkip(): void },
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
  heading.setAttribute('aria-label', 'Clay Island')
  // Each letter is its own pressed lump of clay: own colour, own small tilt.
  let letterIndex = 0
  for (const word of ['Clay', 'Island']) {
    const group = document.createElement('span')
    group.className = 'title-word'
    group.setAttribute('aria-hidden', 'true')
    for (const char of word) {
      const letter = document.createElement('span')
      letter.className = 'title-letter'
      letter.textContent = char
      letter.style.setProperty('--i', String(letterIndex))
      letter.style.setProperty('--tilt', `${TITLE_TILTS[letterIndex % TITLE_TILTS.length]}deg`)
      letter.style.setProperty('--lift', `${TITLE_LIFTS[letterIndex % TITLE_LIFTS.length]}px`)
      letter.dataset.clay = String(letterIndex % 4)
      group.append(letter)
      letterIndex++
    }
    heading.append(group)
  }

  const skip = document.createElement('button')
  skip.id = 'intro-skip'
  skip.type = 'button'
  skip.textContent = 'Skip intro'
  skip.hidden = true
  skip.tabIndex = -1

  plaque.append(heading)
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

  const setMode = (mode: 'prologue' | 'cover' | 'hidden'): void => {
    clearCoverTimer()
    clearPlaqueTimer()
    layer.dataset.mode = mode
    layer.setAttribute('aria-hidden', String(mode === 'hidden'))
    setBackgroundInert(mode !== 'hidden')
  }

  const onSkip = (): void => { handlers.onSkip() }
  skip.addEventListener('click', onSkip)

  const api: TitleUI = {
    showPrologue(canSkip) {
      if (disposed) return
      setMode('prologue')
      plaque.hidden = false
      plaque.setAttribute('aria-hidden', 'true')
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
      skip.hidden = true
      skip.tabIndex = -1
    },

    dispose() {
      if (disposed) return
      disposed = true
      clearCoverTimer()
      clearPlaqueTimer()
      setBackgroundInert(false)
      skip.removeEventListener('click', onSkip)
      layer.remove()
    },
  }

  return api
}

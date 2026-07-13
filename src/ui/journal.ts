import { prefersReducedMotion } from '../core/motion'
import { MOMENTS, type Journal, type Moment, type MomentId } from '../discovery/moments'

type JournalUIOptions = {
  lowFx: boolean
}

export type JournalUI = {
  toast(moment: Moment): void
  setUnlocked(unlocked: ReadonlySet<MomentId>): void
  rect(): DOMRect
  readonly isOpen: boolean
  onOpenChange(handler: (open: boolean) => void): () => void
  close(): void
}

export function createJournalUI(
  ui: HTMLElement,
  journal: Journal,
  options: JournalUIOptions,
): JournalUI {
  const trigger = document.querySelector<HTMLButtonElement>('#journal-btn')
  if (!trigger) throw new Error('journal button must exist before journal UI')
  trigger.setAttribute('aria-expanded', 'false')

  const layer = document.createElement('div')
  layer.id = 'journal-layer'
  layer.hidden = true
  layer.classList.toggle('lowfx', options.lowFx || prefersReducedMotion())

  const backdrop = document.createElement('div')
  backdrop.className = 'journal-backdrop'
  backdrop.setAttribute('aria-hidden', 'true')

  const dialog = document.createElement('section')
  dialog.id = 'journal-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'journal-heading')
  dialog.tabIndex = -1

  const heading = document.createElement('h2')
  heading.id = 'journal-heading'
  heading.textContent = 'Little Moments'

  const count = document.createElement('p')
  count.className = 'journal-progress'
  count.setAttribute('aria-live', 'polite')

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'journal-close'
  closeButton.textContent = 'Close book'

  const viewport = document.createElement('div')
  viewport.id = 'journal-book-viewport'

  const grid = document.createElement('div')
  grid.className = 'moment-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-label', 'Discovered moments')

  const hint = document.createElement('p')
  hint.className = 'journal-hint'
  hint.setAttribute('aria-live', 'polite')
  hint.textContent = 'Focus an unpressed tile for a hint.'

  const tiles = MOMENTS.map((moment, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'moment-tile'
    button.dataset.moment = moment.id
    button.dataset.index = String(index)
    button.setAttribute('role', 'gridcell')
    grid.appendChild(button)

    const showHint = (): void => {
      hint.textContent = journal.has(moment.id) ? moment.title : moment.hint
    }
    button.addEventListener('focus', showHint)
    button.addEventListener('pointerenter', showHint)
    return button
  })

  viewport.append(grid)
  dialog.append(heading, count, closeButton, viewport, hint)
  layer.append(backdrop, dialog)
  ui.appendChild(layer)

  let open = false
  let closeTimer = 0
  const openHandlers = new Set<(value: boolean) => void>()
  const trayButtons = [...document.querySelectorAll<HTMLButtonElement>('#tray button')]
    .filter(button => button !== trigger)
  const trayTabIndexes = new Map<HTMLButtonElement, string | null>()

  const setBackgroundInert = (value: boolean): void => {
    for (const button of trayButtons) {
      if (value) {
        trayTabIndexes.set(button, button.getAttribute('tabindex'))
        button.setAttribute('tabindex', '-1')
        button.setAttribute('aria-hidden', 'true')
      } else {
        const previous = trayTabIndexes.get(button)
        if (previous === null || previous === undefined) button.removeAttribute('tabindex')
        else button.setAttribute('tabindex', previous)
        button.removeAttribute('aria-hidden')
      }
    }
    if (!value) trayTabIndexes.clear()
  }

  const notify = (): void => {
    for (const handler of openHandlers) handler(open)
  }

  const setOpen = (value: boolean): void => {
    if (open === value) return
    open = value
    window.clearTimeout(closeTimer)
    trigger.setAttribute('aria-expanded', String(open))
    setBackgroundInert(open)

    if (open) {
      layer.hidden = false
      requestAnimationFrame(() => layer.classList.add('open'))
      closeButton.focus({ preventScroll: true })
    } else {
      layer.classList.remove('open')
      trigger.focus({ preventScroll: true })
      if (prefersReducedMotion()) layer.hidden = true
      else closeTimer = window.setTimeout(() => { layer.hidden = true }, 340)
    }
    notify()
  }

  trigger.addEventListener('click', () => setOpen(true))
  closeButton.addEventListener('click', () => setOpen(false))
  backdrop.addEventListener('click', () => setOpen(false))

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }

    const active = document.activeElement as HTMLElement | null
    const tileIndex = active?.classList.contains('moment-tile')
      ? Number(active.dataset.index)
      : -1
    if (tileIndex >= 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      const row = Math.floor(tileIndex / 3)
      const column = tileIndex % 3
      let next = tileIndex
      if (event.key === 'ArrowLeft') next = row * 3 + (column + 2) % 3
      if (event.key === 'ArrowRight') next = row * 3 + (column + 1) % 3
      if (event.key === 'ArrowUp') next = ((row + 3) % 4) * 3 + column
      if (event.key === 'ArrowDown') next = ((row + 1) % 4) * 3 + column
      tiles[next].focus()
      return
    }

    if (event.key !== 'Tab') return
    const focusable = [closeButton, ...tiles]
    const current = focusable.indexOf(document.activeElement as HTMLButtonElement)
    if (event.shiftKey && current <= 0) {
      event.preventDefault()
      focusable.at(-1)?.focus()
    } else if (!event.shiftKey && current === focusable.length - 1) {
      event.preventDefault()
      focusable[0].focus()
    }
  })

  let toastTimer = 0
  const toastHost = document.createElement('div')
  toastHost.className = 'moment-toast'
  toastHost.setAttribute('role', 'status')
  toastHost.setAttribute('aria-live', 'polite')
  toastHost.hidden = true
  ui.appendChild(toastHost)

  const api: JournalUI = {
    toast(moment) {
      window.clearTimeout(toastTimer)
      toastHost.replaceChildren()
      const title = document.createElement('strong')
      title.textContent = moment.title
      const copy = document.createElement('span')
      copy.textContent = moment.hint
      toastHost.append(title, copy)
      toastHost.hidden = false
      requestAnimationFrame(() => toastHost.classList.add('show'))
      toastTimer = window.setTimeout(() => {
        toastHost.classList.remove('show')
        window.setTimeout(() => { toastHost.hidden = true }, prefersReducedMotion() ? 0 : 320)
      }, 3000)
    },
    setUnlocked(unlocked) {
      tiles.forEach((button, index) => {
        const moment = MOMENTS[index]
        const isUnlocked = unlocked.has(moment.id)
        button.classList.toggle('unlocked', isUnlocked)
        button.setAttribute(
          'aria-label',
          isUnlocked ? moment.title : `Locked moment: ${moment.hint}`,
        )
        button.style.setProperty('--moment-color', moment.color)
        button.textContent = isUnlocked ? moment.title : ''
      })
      count.textContent = `${unlocked.size} of ${MOMENTS.length} moments pressed`
    },
    rect() {
      return (open ? viewport : trigger).getBoundingClientRect()
    },
    get isOpen() { return open },
    onOpenChange(handler) {
      openHandlers.add(handler)
      return () => { openHandlers.delete(handler) }
    },
    close() { setOpen(false) },
  }

  api.setUnlocked(journal.unlocked)
  return api
}

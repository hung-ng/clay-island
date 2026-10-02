import { MOMENTS, type Journal, type Moment, type MomentId } from '../discovery/moments'
import { createModalBackground } from './modal'

export type CelebrationRewardStatus = 'ready' | 'queued' | 'active'

export type CelebrationRewardView = {
  hidden: boolean
  disabled: boolean
  label: string
}

export function celebrationRewardView(
  unlockedCount: number,
  status: CelebrationRewardStatus,
): CelebrationRewardView {
  if (unlockedCount < MOMENTS.length) {
    return { hidden: true, disabled: true, label: 'Celebrate Again' }
  }
  if (status === 'queued') {
    return { hidden: false, disabled: true, label: 'Celebration waiting…' }
  }
  if (status === 'active') {
    return { hidden: false, disabled: true, label: 'Celebrating…' }
  }
  return { hidden: false, disabled: false, label: 'Celebrate Again' }
}

export type JournalUIOptions = {
  lowFx: boolean
  reducedMotion(): boolean
  onOpenChange?(open: boolean): void
  onCelebrate?(): void
}

export type JournalUI = {
  toast(moment: Moment): void
  setUnlocked(unlocked: ReadonlySet<MomentId>): void
  setCelebrationStatus(status: CelebrationRewardStatus): void
  close(): void
  isOpen(): boolean
  isToastIdle(): boolean
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
  layer.classList.toggle('lowfx', options.lowFx)

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
  heading.textContent = 'Journal'

  const count = document.createElement('p')
  count.className = 'journal-progress'
  count.setAttribute('aria-live', 'polite')

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'journal-close'
  closeButton.textContent = 'Close'
  closeButton.setAttribute('aria-label', 'Close journal')

  const slab = document.createElement('div')
  slab.className = 'journal-slab'

  const grid = document.createElement('div')
  grid.className = 'moment-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-label', 'Journal moments')

  const hint = document.createElement('p')
  hint.className = 'journal-hint'
  hint.setAttribute('aria-live', 'polite')

  const celebrateButton = document.createElement('button')
  celebrateButton.type = 'button'
  celebrateButton.className = 'journal-celebrate'
  celebrateButton.hidden = true
  celebrateButton.setAttribute('aria-live', 'polite')

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
    const clearHint = (): void => {
      hint.textContent = ''
    }
    button.addEventListener('focus', showHint)
    button.addEventListener('blur', clearHint)
    button.addEventListener('pointerenter', showHint)
    button.addEventListener('pointerleave', clearHint)
    return button
  })

  slab.append(heading, count, closeButton, grid, celebrateButton, hint)
  dialog.append(slab)
  layer.append(backdrop, dialog)
  ui.appendChild(layer)

  let open = false
  let closeTimer = 0
  let unlockedCount = journal.count()
  let celebrationStatus: CelebrationRewardStatus = 'ready'
  const setBackgroundInert = createModalBackground(ui, layer)

  const syncCelebrationReward = (): void => {
    const view = celebrationRewardView(unlockedCount, celebrationStatus)
    celebrateButton.hidden = view.hidden
    celebrateButton.disabled = view.disabled
    celebrateButton.textContent = view.label
    slab.classList.toggle('journal-complete', !view.hidden)
  }

  const setOpen = (value: boolean): void => {
    if (open === value) return
    open = value
    window.clearTimeout(closeTimer)
    trigger.setAttribute('aria-expanded', String(open))
    setBackgroundInert(open)

    if (open) {
      hint.textContent = ''
      layer.hidden = false
      requestAnimationFrame(() => layer.classList.add('open'))
    } else {
      layer.classList.remove('open')
      trigger.focus({ preventScroll: true })
      if (options.reducedMotion()) layer.hidden = true
      else closeTimer = window.setTimeout(() => { layer.hidden = true }, 340)
    }
    options.onOpenChange?.(open)
    if (open) closeButton.focus({ preventScroll: true })
  }

  trigger.addEventListener('click', () => {
    if (trigger.inert || trigger.closest('[inert]')) return
    setOpen(true)
  })
  closeButton.addEventListener('click', () => setOpen(false))
  backdrop.addEventListener('click', () => setOpen(false))
  celebrateButton.addEventListener('click', () => {
    if (celebrateButton.disabled) return
    setOpen(false)
    options.onCelebrate?.()
  })

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
      const rows = Math.ceil(tiles.length / 3)
      let next = tileIndex
      if (event.key === 'ArrowLeft') next = row * 3 + (column + 2) % 3
      if (event.key === 'ArrowRight') next = row * 3 + (column + 1) % 3
      if (event.key === 'ArrowUp') next = ((row + rows - 1) % rows) * 3 + column
      if (event.key === 'ArrowDown') next = ((row + 1) % rows) * 3 + column
      tiles[next]?.focus()
      return
    }

    if (event.key !== 'Tab') return
    const focusable = [
      closeButton,
      ...tiles,
      ...(celebrateButton.hidden || celebrateButton.disabled ? [] : [celebrateButton]),
    ]
    const current = focusable.indexOf(document.activeElement as HTMLButtonElement)
    if (event.shiftKey && current <= 0) {
      event.preventDefault()
      focusable.at(-1)?.focus()
    } else if (!event.shiftKey && current === focusable.length - 1) {
      event.preventDefault()
      focusable[0]?.focus()
    }
  })

  let toastShowing = false
  const toastQueue: Moment[] = []
  const toastHost = document.createElement('div')
  toastHost.className = 'moment-toast'
  toastHost.setAttribute('role', 'status')
  toastHost.setAttribute('aria-live', 'polite')
  toastHost.hidden = true
  ui.appendChild(toastHost)

  const showNextToast = (): void => {
    const moment = toastQueue.shift()
    if (!moment) {
      toastShowing = false
      toastHost.hidden = true
      return
    }

    toastShowing = true
    toastHost.replaceChildren()
    const title = document.createElement('strong')
    title.textContent = moment.title
    const copy = document.createElement('span')
    copy.textContent = moment.hint
    toastHost.append(title, copy)
    toastHost.hidden = false
    requestAnimationFrame(() => toastHost.classList.add('show'))
    window.setTimeout(() => {
      toastHost.classList.remove('show')
      window.setTimeout(() => {
        toastHost.hidden = true
        showNextToast()
      }, options.reducedMotion() ? 0 : 320)
    }, 3000)
  }

  const api: JournalUI = {
    toast(moment) {
      toastQueue.push(moment)
      if (!toastShowing) showNextToast()
    },
    setUnlocked(unlocked) {
      unlockedCount = unlocked.size
      tiles.forEach((button, index) => {
        const moment = MOMENTS[index]
        if (!moment) return
        const isUnlocked = unlocked.has(moment.id)
        const wasUnlocked = button.classList.contains('unlocked')
        button.classList.toggle('unlocked', isUnlocked)
        button.setAttribute(
          'aria-label',
          isUnlocked ? moment.title : `Locked moment: ${moment.hint}`,
        )
        button.style.setProperty('--moment-color', moment.color)
        button.textContent = isUnlocked ? moment.title : ''
        if (isUnlocked && !wasUnlocked && !options.reducedMotion()) {
          button.classList.remove('pop')
          // Force a reflow so re-adding the class restarts the animation.
          void button.offsetWidth
          button.classList.add('pop')
        }
      })
      count.textContent = `${unlocked.size} of ${MOMENTS.length} moments`
      syncCelebrationReward()
    },
    setCelebrationStatus(status) {
      celebrationStatus = status
      syncCelebrationReward()
    },
    close() { setOpen(false) },
    isOpen() { return open },
    isToastIdle() { return !toastShowing && toastQueue.length === 0 },
  }

  api.setUnlocked(journal.unlocked)
  return api
}

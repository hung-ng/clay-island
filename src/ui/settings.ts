import type { VisualQuality } from '../core/preferences'
import { setModalBackgroundInert } from './modal'

export type SettingsUI = {
  close(): void
  setVisible(visible: boolean): void
  setMuted(muted: boolean): void
  setAutoRotate(on: boolean): void
  setReducedMotion(on: boolean): void
  dispose(): void
}

export type SettingsUIOptions = {
  muted: boolean
  quality: VisualQuality
  forcedLowFx: boolean
  autoRotate: boolean
  reducedMotion: boolean
  reducedMotionActive(): boolean
  onOpenChange(open: boolean): void
  onSoundChange(muted: boolean): void
  onQualityChange(quality: VisualQuality, reportFailure: () => void): void
  onAutoRotateChange(on: boolean): void
  onReducedMotionChange(on: boolean): void
  onResetCamera(): void
  onReplayIntro(): void
}

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function createSettingsUI(ui: HTMLElement, options: SettingsUIOptions): SettingsUI {
  const trigger = document.createElement('button')
  trigger.id = 'settings-btn'
  trigger.type = 'button'
  trigger.setAttribute('aria-label', 'Settings')
  trigger.setAttribute('aria-haspopup', 'dialog')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.innerHTML = '<span aria-hidden="true">Settings</span>'

  const layer = document.createElement('div')
  layer.id = 'settings-layer'
  layer.hidden = true

  const backdrop = document.createElement('div')
  backdrop.className = 'settings-backdrop'
  backdrop.setAttribute('aria-hidden', 'true')

  const dialog = document.createElement('section')
  dialog.id = 'settings-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'settings-heading')
  dialog.tabIndex = -1

  const heading = document.createElement('h2')
  heading.id = 'settings-heading'
  heading.textContent = 'Settings'

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'settings-close'
  closeButton.setAttribute('aria-label', 'Close settings')
  closeButton.textContent = 'Close'

  const body = document.createElement('div')
  body.className = 'settings-body'

  const soundButton = document.createElement('button')
  soundButton.type = 'button'
  soundButton.className = 'settings-toggle'

  const qualityGroup = document.createElement('fieldset')
  qualityGroup.className = 'settings-quality'
  const qualityLegend = document.createElement('legend')
  qualityLegend.textContent = 'Quality'
  const enhancedLabel = document.createElement('label')
  const enhancedRadio = document.createElement('input')
  enhancedRadio.type = 'radio'
  enhancedRadio.name = 'visual-quality'
  enhancedRadio.value = 'enhanced'
  enhancedLabel.append(enhancedRadio, document.createTextNode('Enhanced'))
  const reducedLabel = document.createElement('label')
  const reducedRadio = document.createElement('input')
  reducedRadio.type = 'radio'
  reducedRadio.name = 'visual-quality'
  reducedRadio.value = 'reduced'
  reducedLabel.append(
    reducedRadio,
    document.createTextNode(options.forcedLowFx ? 'Reduced (forced by link)' : 'Reduced'),
  )
  qualityGroup.append(qualityLegend, enhancedLabel, reducedLabel)
  qualityGroup.disabled = options.forcedLowFx

  const autoRotateButton = document.createElement('button')
  autoRotateButton.type = 'button'
  autoRotateButton.className = 'settings-toggle'

  const reducedMotionButton = document.createElement('button')
  reducedMotionButton.type = 'button'
  reducedMotionButton.className = 'settings-toggle'

  const resetButton = document.createElement('button')
  resetButton.type = 'button'
  resetButton.className = 'settings-action'
  resetButton.textContent = 'Reset camera'

  const replayButton = document.createElement('button')
  replayButton.type = 'button'
  replayButton.className = 'settings-action settings-replay'
  replayButton.textContent = 'Replay intro'

  const status = document.createElement('p')
  status.className = 'settings-status'
  status.setAttribute('aria-live', 'polite')

  body.append(
    soundButton,
    qualityGroup,
    autoRotateButton,
    reducedMotionButton,
    resetButton,
    replayButton,
    status,
  )

  const confirmation = document.createElement('div')
  confirmation.className = 'settings-confirmation'
  confirmation.hidden = true
  const confirmationCopy = document.createElement('p')
  confirmationCopy.textContent = 'Changing quality will remold the current island. Discovered Moments are kept.'
  const confirmationActions = document.createElement('div')
  confirmationActions.className = 'settings-confirmation-actions'
  const keepButton = document.createElement('button')
  keepButton.type = 'button'
  keepButton.textContent = 'Keep current'
  const reloadButton = document.createElement('button')
  reloadButton.type = 'button'
  reloadButton.textContent = 'Remold and reload'
  confirmationActions.append(keepButton, reloadButton)
  confirmation.append(confirmationCopy, confirmationActions)

  dialog.append(heading, closeButton, body, confirmation)
  layer.append(backdrop, dialog)
  ui.append(trigger, layer)

  let open = false
  let visible = true
  let muted = options.muted
  let autoRotate = options.autoRotate
  let reducedMotion = options.reducedMotion
  let quality = options.quality
  let pendingQuality: VisualQuality | null = null
  let openRaf = 0
  let closeTimer = 0
  let disposed = false
  const backgroundInertState = new Map<HTMLElement, boolean>()

  const syncSound = (): void => {
    const on = !muted
    soundButton.setAttribute('aria-pressed', String(on))
    soundButton.textContent = on ? 'Sound on' : 'Sound off'
  }

  const syncAutoRotate = (): void => {
    autoRotateButton.setAttribute('aria-pressed', String(autoRotate))
    autoRotateButton.textContent = autoRotate ? 'Auto-rotate on' : 'Auto-rotate off'
  }

  const syncReducedMotion = (): void => {
    reducedMotionButton.setAttribute('aria-pressed', String(reducedMotion))
    reducedMotionButton.textContent = reducedMotion ? 'Reduced motion on' : 'Reduced motion off'
  }

  const syncQuality = (): void => {
    enhancedRadio.checked = quality === 'enhanced'
    reducedRadio.checked = quality === 'reduced'
  }

  const setBackgroundInert = (value: boolean): void => {
    const background = [...ui.children].filter((child): child is HTMLElement => (
      child instanceof HTMLElement && child !== layer
    ))
    setModalBackgroundInert(background, backgroundInertState, value)
  }

  const showSettingsBody = (focus = true): void => {
    pendingQuality = null
    confirmation.hidden = true
    body.hidden = false
    syncQuality()
    if (focus) (quality === 'enhanced' ? enhancedRadio : reducedRadio).focus()
  }

  const setOpen = (value: boolean): void => {
    if (disposed || open === value || (value && !visible)) return
    open = value
    cancelAnimationFrame(openRaf)
    openRaf = 0
    window.clearTimeout(closeTimer)
    trigger.setAttribute('aria-expanded', String(open))

    if (open) {
      status.textContent = ''
      showSettingsBody(false)
      layer.hidden = false
      setBackgroundInert(true)
      options.onOpenChange(true)
      openRaf = requestAnimationFrame(() => {
        openRaf = 0
        if (open && !disposed) layer.classList.add('open')
      })
      closeButton.focus({ preventScroll: true })
      return
    }

    layer.classList.remove('open')
    setBackgroundInert(false)
    options.onOpenChange(false)
    if (visible) trigger.focus({ preventScroll: true })
    if (options.reducedMotionActive()) layer.hidden = true
    else closeTimer = window.setTimeout(() => { layer.hidden = true }, 240)
  }

  const beginQualityConfirmation = (next: VisualQuality): void => {
    if (options.forcedLowFx || next === quality) {
      syncQuality()
      return
    }
    pendingQuality = next
    body.hidden = true
    confirmation.hidden = false
    keepButton.focus({ preventScroll: true })
  }

  const reportQualityFailure = (): void => {
    showSettingsBody(false)
    status.textContent = 'This browser could not save that quality setting.'
    ;(quality === 'enhanced' ? enhancedRadio : reducedRadio).focus({ preventScroll: true })
  }

  const handleTrigger = (): void => {
    if (trigger.inert || trigger.closest('[inert]')) return
    setOpen(!open)
  }
  const handleClose = (): void => setOpen(false)
  const handleBackdrop = (): void => setOpen(false)
  const handleSound = (): void => options.onSoundChange(!muted)
  const handleAutoRotate = (): void => options.onAutoRotateChange(!autoRotate)
  const handleReducedMotion = (): void => options.onReducedMotionChange(!reducedMotion)
  const handleReset = (): void => options.onResetCamera()
  const handleReplay = (): void => options.onReplayIntro()
  const handleEnhanced = (): void => beginQualityConfirmation('enhanced')
  const handleReduced = (): void => beginQualityConfirmation('reduced')
  const handleKeep = (): void => showSettingsBody()
  const handleReload = (): void => {
    if (!pendingQuality) return
    const next = pendingQuality
    options.onQualityChange(next, reportQualityFailure)
  }
  const handleDialogKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!confirmation.hidden) showSettingsBody()
      else setOpen(false)
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter(element => !element.matches(':disabled') && !element.closest<HTMLElement>('[hidden]'))
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    if (event.shiftKey && current <= 0) {
      event.preventDefault()
      focusable.at(-1)?.focus()
    } else if (!event.shiftKey && current === focusable.length - 1) {
      event.preventDefault()
      focusable[0]?.focus()
    }
  }

  trigger.addEventListener('click', handleTrigger)
  closeButton.addEventListener('click', handleClose)
  backdrop.addEventListener('click', handleBackdrop)
  soundButton.addEventListener('click', handleSound)
  autoRotateButton.addEventListener('click', handleAutoRotate)
  reducedMotionButton.addEventListener('click', handleReducedMotion)
  resetButton.addEventListener('click', handleReset)
  replayButton.addEventListener('click', handleReplay)
  enhancedRadio.addEventListener('change', handleEnhanced)
  reducedRadio.addEventListener('change', handleReduced)
  keepButton.addEventListener('click', handleKeep)
  reloadButton.addEventListener('click', handleReload)
  dialog.addEventListener('keydown', handleDialogKeydown)

  syncSound()
  syncAutoRotate()
  syncReducedMotion()
  syncQuality()

  return {
    close() { setOpen(false) },
    setVisible(nextVisible) {
      if (disposed || visible === nextVisible) return
      if (!nextVisible) setOpen(false)
      visible = nextVisible
      trigger.hidden = !visible
      trigger.tabIndex = visible ? 0 : -1
    },
    setMuted(nextMuted) {
      muted = nextMuted
      syncSound()
    },
    setAutoRotate(on) {
      autoRotate = on
      syncAutoRotate()
    },
    setReducedMotion(on) {
      reducedMotion = on
      syncReducedMotion()
    },
    dispose() {
      if (disposed) return
      setOpen(false)
      disposed = true
      cancelAnimationFrame(openRaf)
      window.clearTimeout(closeTimer)
      setBackgroundInert(false)
      trigger.removeEventListener('click', handleTrigger)
      closeButton.removeEventListener('click', handleClose)
      backdrop.removeEventListener('click', handleBackdrop)
      soundButton.removeEventListener('click', handleSound)
      autoRotateButton.removeEventListener('click', handleAutoRotate)
      reducedMotionButton.removeEventListener('click', handleReducedMotion)
      resetButton.removeEventListener('click', handleReset)
      replayButton.removeEventListener('click', handleReplay)
      enhancedRadio.removeEventListener('change', handleEnhanced)
      reducedRadio.removeEventListener('change', handleReduced)
      keepButton.removeEventListener('click', handleKeep)
      reloadButton.removeEventListener('click', handleReload)
      dialog.removeEventListener('keydown', handleDialogKeydown)
      trigger.remove()
      layer.remove()
    },
  }
}

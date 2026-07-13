import type { PowerId } from '../core/events'

type TrayOptions = {
  onArm(id: PowerId): void
  onCancel(): void
  cooldowns: () => Record<PowerId, number>
}

type PowerControl = {
  button: HTMLButtonElement
  cooldownFill: HTMLSpanElement
  cooldown: number
  displayedCooldown: number
  enabled: boolean
}

const POWER_IDS: readonly PowerId[] = ['meteor', 'lightning', 'rain']
const COOLDOWN_STEPS = 12
const POWER_LABELS: Record<PowerId, string> = {
  meteor: 'Meteor',
  lightning: 'Lightning',
  rain: 'Rain',
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function createTray(ui: HTMLElement, opts: TrayOptions): {
  setCooldown(id: PowerId, t01: number): void
  setEnabled(id: PowerId, on: boolean): void
  setJournalCount(n: number): void
  setMuted(muted: boolean): void
  onMute(handler: () => void): void
} {
  const tray = document.createElement('div')
  tray.id = 'tray'
  tray.setAttribute('role', 'toolbar')
  tray.setAttribute('aria-label', 'Powers')

  const controls = new Map<PowerId, PowerControl>()
  const initialCooldowns = opts.cooldowns()

  for (const id of POWER_IDS) {
    const shell = document.createElement('span')
    shell.className = 'power-shell'
    shell.dataset.powerShell = id

    const cooldownFill = document.createElement('span')
    cooldownFill.className = 'power-cooldown'
    cooldownFill.setAttribute('aria-hidden', 'true')

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'power'
    button.dataset.power = id
    button.setAttribute('aria-keyshortcuts', String(POWER_IDS.indexOf(id) + 1))
    button.innerHTML = `
      <span class="power-glyph" data-glyph="${id}" aria-hidden="true"></span>
      <span class="power-label">${POWER_LABELS[id]}</span>
    `
    shell.append(cooldownFill, button)
    tray.appendChild(shell)

    const control = {
      button,
      cooldownFill,
      cooldown: clamp01(initialCooldowns[id]),
      displayedCooldown: -1,
      enabled: true,
    }
    controls.set(id, control)

    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || button.disabled) return
      button.focus({ preventScroll: true })
      event.preventDefault()
      opts.onArm(id)
    })
    button.addEventListener('click', (event) => {
      // Pointer input arms on pointerdown so dragging can begin immediately.
      // Keyboard and assistive-technology clicks have detail 0.
      if (event.detail !== 0 || button.disabled) return
      opts.onArm(id)
    })
  }

  const spacer = document.createElement('span')
  spacer.className = 'spacer'
  spacer.setAttribute('aria-hidden', 'true')
  tray.appendChild(spacer)

  const journal = document.createElement('button')
  journal.type = 'button'
  journal.id = 'journal-btn'
  journal.setAttribute('aria-haspopup', 'dialog')
  journal.innerHTML = 'Journal <b>0/12</b>'
  tray.appendChild(journal)

  const mute = document.createElement('button')
  mute.type = 'button'
  mute.id = 'mute-btn'
  mute.setAttribute('aria-pressed', 'false')
  mute.textContent = 'Sound on'
  tray.appendChild(mute)

  let muteHandler: (() => void) | null = null
  mute.addEventListener('click', () => muteHandler?.())

  function sync(control: PowerControl): void {
    const unavailable = !control.enabled || control.cooldown > 0
    const displayedCooldown = control.cooldown <= 0
      ? 0
      : Math.ceil(control.cooldown * COOLDOWN_STEPS) / COOLDOWN_STEPS
    if (displayedCooldown !== control.displayedCooldown) {
      control.displayedCooldown = displayedCooldown
      control.cooldownFill.style.height = `${(displayedCooldown * 100).toFixed(1)}%`
    }
    if (control.button.disabled !== unavailable) control.button.disabled = unavailable
  }

  for (const control of controls.values()) sync(control)
  ui.appendChild(tray)

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      opts.onCancel()
      return
    }
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    const index = Number(event.key) - 1
    const id = POWER_IDS[index]
    if (!id) return
    const control = controls.get(id)!
    if (control.button.disabled) return
    event.preventDefault()
    control.button.focus({ preventScroll: true })
    opts.onArm(id)
  })

  return {
    setCooldown(id, t01) {
      const control = controls.get(id)
      if (!control) return
      control.cooldown = clamp01(t01)
      sync(control)
    },
    setEnabled(id, on) {
      const control = controls.get(id)
      if (!control) return
      control.enabled = on
      sync(control)
    },
    setJournalCount(n) {
      const counter = journal.querySelector('b')
      if (!counter) return
      counter.textContent = `${Math.max(0, Math.min(12, n))}/12`
      counter.classList.remove('pop')
      void counter.offsetWidth
      counter.classList.add('pop')
    },
    setMuted(muted) {
      mute.setAttribute('aria-pressed', String(muted))
      mute.textContent = muted ? 'Sound off' : 'Sound on'
    },
    onMute(handler) { muteHandler = handler },
  }
}

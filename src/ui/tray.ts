import type { PowerId } from '../core/events'

type TrayOptions = {
  onArm(id: PowerId): void
  onCancel(): void
  cooldowns: () => Record<PowerId, number>
}

type PowerControl = {
  button: HTMLButtonElement
  cooldown: number
  enabled: boolean
}

const POWER_IDS: readonly PowerId[] = ['meteor', 'lightning', 'rain']
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
} {
  const tray = document.createElement('div')
  tray.id = 'tray'
  tray.setAttribute('role', 'toolbar')
  tray.setAttribute('aria-label', 'Powers')

  const controls = new Map<PowerId, PowerControl>()
  const initialCooldowns = opts.cooldowns()

  for (const id of POWER_IDS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'power'
    button.dataset.power = id
    button.setAttribute('aria-keyshortcuts', String(POWER_IDS.indexOf(id) + 1))
    button.innerHTML = `
      <span class="power-glyph" data-glyph="${id}" aria-hidden="true"></span>
      <span class="power-label">${POWER_LABELS[id]}</span>
    `
    tray.appendChild(button)

    const control = {
      button,
      cooldown: clamp01(initialCooldowns[id]),
      enabled: true,
    }
    controls.set(id, control)

    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || button.getAttribute('aria-disabled') === 'true') return
      button.focus({ preventScroll: true })
      event.preventDefault()
      opts.onArm(id)
    })
    button.addEventListener('click', (event) => {
      // Pointer input arms on pointerdown so dragging can begin immediately.
      // Keyboard and assistive-technology clicks have detail 0.
      if (event.detail !== 0 || button.getAttribute('aria-disabled') === 'true') return
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

  function sync(control: PowerControl): void {
    const unavailable = !control.enabled || control.cooldown > 0
    control.button.style.setProperty('--cooldown', control.cooldown.toFixed(3))
    control.button.setAttribute('aria-disabled', String(unavailable))
    control.button.classList.toggle('cooling', control.cooldown > 0)
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
    if (control.button.getAttribute('aria-disabled') === 'true') return
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
  }
}

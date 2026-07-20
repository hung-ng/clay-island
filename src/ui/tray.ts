import type { PowerId } from '../core/events'
import { MOMENTS } from '../discovery/moments'

type TrayOptions = {
  onArm(id: PowerId): void
  onPhoto(): void
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

export const POWER_IDS: readonly PowerId[] = ['meteor', 'lightning', 'rain', 'wind', 'nudge']
export const TRAY_AUXILIARY_CONTROLS = ['photo', 'journal'] as const
const COOLDOWN_STEPS = 12
const POWER_LABELS: Record<PowerId, string> = {
  meteor: 'Meteor',
  lightning: 'Lightning',
  rain: 'Rain',
  nudge: 'Nudge',
  wind: 'Wind',
}

export function powerGlyphMarkup(id: PowerId): string {
  if (id !== 'nudge') {
    return `<span class="power-glyph" data-glyph="${id}" aria-hidden="true"></span>`
  }

  return `
    <span class="power-glyph" data-glyph="nudge" aria-hidden="true">
      <span class="nudge-hand">
        <span class="nudge-wrist"></span>
        <span class="nudge-palm"></span>
        <span class="nudge-folded-fingers"></span>
        <span class="nudge-thumb"></span>
        <span class="nudge-index"></span>
      </span>
    </span>
  `
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function createTray(ui: HTMLElement, opts: TrayOptions): {
  setCooldown(id: PowerId, t01: number): void
  setEnabled(id: PowerId, on: boolean): void
  setPhotoEnabled(on: boolean): void
  setJournalCount(n: number): void
} {
  const tray = document.createElement('div')
  tray.id = 'tray'
  tray.setAttribute('role', 'toolbar')
  tray.setAttribute('aria-label', 'Island controls')

  const powers = document.createElement('div')
  powers.className = 'tray-powers'
  powers.setAttribute('role', 'group')
  powers.setAttribute('aria-label', 'Powers')

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
      ${powerGlyphMarkup(id)}
      <span class="power-label">${POWER_LABELS[id]}</span>
    `
    shell.append(cooldownFill, button)
    powers.appendChild(shell)

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

  tray.appendChild(powers)

  const tools = document.createElement('div')
  tools.className = 'tray-tools'
  tools.setAttribute('role', 'group')
  tools.setAttribute('aria-label', 'Island tools')

  const spacer = document.createElement('span')
  spacer.className = 'spacer'
  spacer.setAttribute('aria-hidden', 'true')
  tools.appendChild(spacer)

  const photo = document.createElement('button')
  photo.type = 'button'
  photo.id = 'photo-btn'
  photo.setAttribute('aria-label', 'Take photo')
  photo.setAttribute('aria-keyshortcuts', 'P')
  photo.title = 'Take photo (P)'
  photo.disabled = true
  photo.innerHTML = `
    <span class="photo-glyph" aria-hidden="true"></span>
    <span class="photo-label">Photo</span>
  `
  photo.addEventListener('click', () => {
    if (!photo.disabled) opts.onPhoto()
  })
  tools.appendChild(photo)

  const journal = document.createElement('button')
  journal.type = 'button'
  journal.id = 'journal-btn'
  journal.setAttribute('aria-haspopup', 'dialog')
  journal.innerHTML = `Journal <b>0/${MOMENTS.length}</b>`
  tools.appendChild(journal)
  tray.appendChild(tools)

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
    if (event.key === 'p' || event.key === 'P') {
      if (photo.disabled) return
      event.preventDefault()
      opts.onPhoto()
      return
    }
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
    setPhotoEnabled(on) {
      photo.disabled = !on
    },
    setJournalCount(n) {
      const counter = journal.querySelector('b')
      if (!counter) return
      const total = MOMENTS.length
      counter.textContent = `${Math.max(0, Math.min(total, n))}/${total}`
      counter.classList.remove('pop')
      void counter.offsetWidth
      counter.classList.add('pop')
    },
  }
}

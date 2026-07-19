import type { TimeOfDayMode } from './dayClock'

export type VisualQuality = 'enhanced' | 'reduced'
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

export type PreferencesSnapshot = {
  quality: VisualQuality
  lowFx: boolean
  forcedLowFx: boolean
  autoRotate: boolean
  reducedMotion: boolean
  introSeen: boolean
  timeOfDay: TimeOfDayMode
}

const QUALITY_KEY = 'clayisland.visualQuality'
const ROTATE_KEY = 'clayisland.autoRotate'
const MOTION_KEY = 'clayisland.reducedMotion'
const INTRO_KEY = 'clayisland.introSeen'
const TIME_OF_DAY_KEY = 'clayisland.timeOfDay'

function read(storage: PreferenceStorage | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null } catch { return null }
}

function storedBoolean(value: string | null, fallback: boolean): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export class Preferences {
  private qualityValue: VisualQuality
  private autoRotateValue: boolean
  private reducedMotionValue: boolean
  private introSeenValue: boolean
  private timeOfDayValue: TimeOfDayMode
  private readonly forced: boolean

  constructor(
    private readonly storage: PreferenceStorage | null,
    search: string,
    systemReducedMotion = false,
  ) {
    this.forced = new URLSearchParams(search).get('lowfx') === '1'
    const quality = read(storage, QUALITY_KEY)
    this.qualityValue = quality === 'reduced' ? 'reduced' : 'enhanced'
    this.autoRotateValue = storedBoolean(read(storage, ROTATE_KEY), true)
    this.reducedMotionValue = storedBoolean(read(storage, MOTION_KEY), systemReducedMotion)
    this.introSeenValue = read(storage, INTRO_KEY) === 'true'
    const timeOfDay = read(storage, TIME_OF_DAY_KEY)
    this.timeOfDayValue = timeOfDay === 'day' || timeOfDay === 'night' ? timeOfDay : 'auto'
  }

  get snapshot(): PreferencesSnapshot {
    const quality = this.forced ? 'reduced' : this.qualityValue
    return {
      quality,
      lowFx: quality === 'reduced',
      forcedLowFx: this.forced,
      autoRotate: this.autoRotateValue,
      reducedMotion: this.reducedMotionValue,
      introSeen: this.introSeenValue,
      timeOfDay: this.timeOfDayValue,
    }
  }

  setQuality(quality: VisualQuality): boolean {
    if (this.forced) return false
    try {
      this.storage?.setItem(QUALITY_KEY, quality)
      if (!this.storage) return false
      this.qualityValue = quality
      return true
    } catch { return false }
  }

  setAutoRotate(on: boolean): void {
    this.autoRotateValue = on
    try { this.storage?.setItem(ROTATE_KEY, String(on)) } catch { /* session-only */ }
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotionValue = on
    try { this.storage?.setItem(MOTION_KEY, String(on)) } catch { /* session-only */ }
  }

  setTimeOfDay(mode: TimeOfDayMode): void {
    this.timeOfDayValue = mode
    try { this.storage?.setItem(TIME_OF_DAY_KEY, mode) } catch { /* session-only */ }
  }

  markIntroSeen(): void {
    this.introSeenValue = true
    try { this.storage?.setItem(INTRO_KEY, 'true') } catch { /* session-only */ }
  }
}

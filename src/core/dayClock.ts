import { PALETTE } from '../ui/tokens'

export type DayKind = 'dawn' | 'day' | 'dusk' | 'night'
export type TimeOfDayMode = 'auto' | 'day' | 'night'
export type GlideDirection = 'forward' | 'backward'

export type DayParams = {
  kind: DayKind
  t: number
  keyColor: string
  keyIntensity: number
  keyX: number
  keyY: number
  keyZ: number
  fillSky: string
  fillGround: string
  fillIntensity: number
  skyHigh: string
  skyLow: string
  cloudTint: string
  starOpacity: number
  fireflyLevel: number
}

type DayLook = Omit<DayParams, 'kind' | 't'>

/** One full day+night in seconds of simulation time. */
export const DAY_PERIOD = 360
/** The pre-cycle golden-hour look lives here; gameplay starts at this phase. */
export const GOLDEN_T = 225
const DAY_START = 25
const DUSK_START = 225
const NIGHT_START = 250
/** Where the Day / Night overrides park the clock. */
export const DAY_ANCHOR = 112
export const NIGHT_ANCHOR = 305
/** Override transitions take this long at full motion. */
const GLIDE_SECONDS = 3

const GOLDEN: DayLook = {
  keyColor: PALETTE.keyLight, keyIntensity: 3.2, keyX: 18, keyY: 24, keyZ: 10,
  fillSky: PALETTE.fillSky, fillGround: PALETTE.fillGround, fillIntensity: 1.1,
  skyHigh: PALETTE.skyHigh, skyLow: PALETTE.skyLow, cloudTint: PALETTE.cloud,
  starOpacity: 0, fireflyLevel: 0,
}

const DAY: DayLook = {
  ...GOLDEN,
  keyColor: PALETTE.dayKeyLight, keyIntensity: 3.4, keyX: 4, keyY: 32, keyZ: 10,
  skyHigh: PALETTE.daySkyHigh, skyLow: PALETTE.daySkyLow,
}

const DAWN: DayLook = {
  ...GOLDEN,
  keyColor: PALETTE.dawnKeyLight, keyIntensity: 2.4, keyX: -26, keyY: 9, keyZ: 10,
  skyHigh: PALETTE.dawnSkyHigh, skyLow: PALETTE.dawnSkyLow,
  fireflyLevel: 0.2,
}

const DUSK: DayLook = {
  ...GOLDEN,
  keyColor: PALETTE.duskKeyLight, keyIntensity: 2.2, keyX: 26, keyY: 10, keyZ: 10,
  skyHigh: PALETTE.duskSkyHigh, skyLow: PALETTE.duskSkyLow,
  starOpacity: 0.25, fireflyLevel: 0.5,
}

const NIGHT: DayLook = {
  keyColor: PALETTE.nightKeyLight, keyIntensity: 0.55, keyX: -18, keyY: 26, keyZ: -8,
  fillSky: PALETTE.nightFillSky, fillGround: PALETTE.nightFillGround, fillIntensity: 0.5,
  skyHigh: PALETTE.nightSkyHigh, skyLow: PALETTE.nightSkyLow, cloudTint: PALETTE.nightCloud,
  starOpacity: 1, fireflyLevel: 1,
}

/**
 * The whole cycle is these keyframes; sample() smoothsteps between neighbours.
 * The last segment (NIGHT_START..DAY_PERIOD) wraps to the t=0 keyframe.
 */
const KEYFRAMES: { t: number; look: DayLook }[] = [
  { t: 0, look: NIGHT },
  { t: 12, look: DAWN },
  { t: DAY_START, look: DAY },
  { t: 200, look: DAY },
  { t: DUSK_START, look: GOLDEN },
  { t: 238, look: DUSK },
  { t: NIGHT_START, look: NIGHT },
]

export function kindAt(t: number): DayKind {
  const wrapped = wrap(t)
  if (wrapped < DAY_START) return 'dawn'
  if (wrapped < DUSK_START) return 'day'
  if (wrapped < NIGHT_START) return 'dusk'
  return 'night'
}

function wrap(t: number): number {
  return ((t % DAY_PERIOD) + DAY_PERIOD) % DAY_PERIOD
}

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u)
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

function lerpHex(a: string, b: string, u: number): string {
  const parse = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  const channel = (from: number, to: number): string =>
    Math.round(lerp(from, to, u)).toString(16).padStart(2, '0')
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`
}

export function sampleAt(t: number): DayParams {
  const wrapped = wrap(t)
  let from = KEYFRAMES[KEYFRAMES.length - 1]!
  let to = { t: DAY_PERIOD, look: KEYFRAMES[0]!.look }
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (wrapped >= KEYFRAMES[i]!.t && wrapped < KEYFRAMES[i + 1]!.t) {
      from = KEYFRAMES[i]!
      to = KEYFRAMES[i + 1]!
      break
    }
  }
  const span = to.t - from.t
  const u = span > 0 ? smoothstep((wrapped - from.t) / span) : 0
  const a = from.look
  const b = to.look
  return {
    kind: kindAt(wrapped),
    t: wrapped,
    keyColor: lerpHex(a.keyColor, b.keyColor, u),
    keyIntensity: lerp(a.keyIntensity, b.keyIntensity, u),
    keyX: lerp(a.keyX, b.keyX, u),
    keyY: lerp(a.keyY, b.keyY, u),
    keyZ: lerp(a.keyZ, b.keyZ, u),
    fillSky: lerpHex(a.fillSky, b.fillSky, u),
    fillGround: lerpHex(a.fillGround, b.fillGround, u),
    fillIntensity: lerp(a.fillIntensity, b.fillIntensity, u),
    skyHigh: lerpHex(a.skyHigh, b.skyHigh, u),
    skyLow: lerpHex(a.skyLow, b.skyLow, u),
    cloudTint: lerpHex(a.cloudTint, b.cloudTint, u),
    starOpacity: lerp(a.starOpacity, b.starOpacity, u),
    fireflyLevel: lerp(a.fireflyLevel, b.fireflyLevel, u),
  }
}

export class DayClock {
  private t: number
  private dayValue: number
  private modeValue: TimeOfDayMode = 'auto'
  private holdKind: 'night' | null = null
  private holdResumeT: number | null = null
  private glideTarget: number | null = null
  private glideSpeed = 0
  private glideDirection: 1 | -1 = 1
  /** After a glide lands (or a hold), the clock parks until circumstances change. */
  private parked = false
  private parkAfterGlide = true
  /** Fired with the new count each time the free-running clock wraps a full day. */
  onDayWrap: ((day: number) => void) | null = null

  constructor(
    private readonly reducedMotion: () => boolean,
    startT = GOLDEN_T,
    startDay = 1,
  ) {
    this.t = wrap(startT)
    const wholeDay = Math.floor(startDay)
    this.dayValue = Number.isFinite(wholeDay) ? Math.max(1, wholeDay) : 1
  }

  get time(): number { return this.t }
  get day(): number { return this.dayValue }
  get mode(): TimeOfDayMode { return this.modeValue }
  get kind(): DayKind { return kindAt(this.t) }

  sample(): DayParams { return sampleAt(this.t) }

  setMode(mode: TimeOfDayMode, direction: GlideDirection = 'forward'): void {
    if (mode === this.modeValue) return
    this.modeValue = mode
    if (mode === 'auto') {
      this.parked = false
      this.glideTarget = null
      if (this.holdKind) this.beginGlide(NIGHT_ANCHOR)
    } else {
      this.beginGlide(mode === 'day' ? DAY_ANCHOR : NIGHT_ANCHOR, true, GLIDE_SECONDS, direction)
    }
  }

  requestHold(kind: 'night', glideSeconds = GLIDE_SECONDS): void {
    if (this.holdKind) return
    this.holdKind = kind
    this.holdResumeT = this.t
    if (this.modeValue === 'auto') this.beginGlide(NIGHT_ANCHOR, true, glideSeconds)
  }

  releaseHold(): void {
    if (!this.holdKind) return
    this.holdKind = null
    const resume = this.holdResumeT
    this.holdResumeT = null
    if (this.modeValue !== 'auto') return
    this.parked = false
    if (resume !== null) this.beginGlide(resume, false)
  }

  tick(dt: number): void {
    if (this.glideTarget !== null) {
      if (this.reducedMotion()) {
        this.t = this.glideTarget
        this.finishGlide()
        return
      }
      const remaining = this.glideDirection === 1
        ? wrap(this.glideTarget - this.t)
        : wrap(this.t - this.glideTarget)
      const step = this.glideSpeed * dt
      if (step >= remaining) {
        this.t = this.glideTarget
        this.finishGlide()
      } else {
        this.t = wrap(this.t + step * this.glideDirection)
      }
      return
    }
    if (this.parked) return
    const advanced = this.t + dt
    if (advanced >= DAY_PERIOD) {
      this.dayValue += Math.floor(advanced / DAY_PERIOD)
      this.onDayWrap?.(this.dayValue)
    }
    this.t = wrap(advanced)
  }

  private beginGlide(
    target: number,
    parkAfter = true,
    seconds = GLIDE_SECONDS,
    direction: GlideDirection = 'forward',
  ): void {
    this.glideTarget = wrap(target)
    this.glideDirection = direction === 'forward' ? 1 : -1
    const distance = this.glideDirection === 1
      ? wrap(this.glideTarget - this.t)
      : wrap(this.t - this.glideTarget)
    this.glideSpeed = distance > 0 ? distance / seconds : 0
    this.parkAfterGlide = parkAfter
  }

  private finishGlide(): void {
    this.glideTarget = null
    this.parked = this.parkAfterGlide
      && (this.modeValue !== 'auto' || this.holdKind !== null)
  }
}

export const CELEBRATION_SECONDS = {
  gathering: 4,
  fireworks: 8,
  finale: 2,
  total: 14,
} as const

export type CelebrationPhase = 'idle' | 'queued' | 'gathering' | 'fireworks' | 'finale'
export type ActiveCelebrationPhase = Exclude<CelebrationPhase, 'idle' | 'queued'>
export type CelebrationSignal = 'started' | 'fireworks' | 'finale' | 'completed'

export type CelebrationReadiness = {
  gameplay: boolean
  toastsIdle: boolean
  modalsClosed: boolean
  powerEffectsIdle: boolean
  worldSafe: boolean
}

export function canStartCelebration(readiness: CelebrationReadiness): boolean {
  return readiness.gameplay
    && readiness.toastsIdle
    && readiness.modalsClosed
    && readiness.powerEffectsIdle
    && readiness.worldSafe
}

export function shouldRequestAutomaticCelebration(
  before: number,
  after: number,
  total: number,
): boolean {
  return before === total - 1 && after === total
}

function durationFor(phase: ActiveCelebrationPhase): number {
  return CELEBRATION_SECONDS[phase]
}

function nextPhase(phase: ActiveCelebrationPhase): CelebrationPhase {
  if (phase === 'gathering') return 'fireworks'
  if (phase === 'fireworks') return 'finale'
  return 'idle'
}

function signalFor(phase: CelebrationPhase): CelebrationSignal {
  if (phase === 'fireworks') return 'fireworks'
  if (phase === 'finale') return 'finale'
  return 'completed'
}

export class CelebrationClock {
  phase: CelebrationPhase = 'idle'
  private elapsed = 0

  get busy(): boolean { return this.phase !== 'idle' }
  get active(): boolean { return this.phase !== 'idle' && this.phase !== 'queued' }
  get phaseElapsed(): number { return this.elapsed }

  request(): boolean {
    if (this.busy) return false
    this.phase = 'queued'
    this.elapsed = 0
    return true
  }

  cancel(): boolean {
    if (!this.busy) return false
    this.phase = 'idle'
    this.elapsed = 0
    return true
  }

  update(dt: number, readiness: CelebrationReadiness): CelebrationSignal[] {
    const signals: CelebrationSignal[] = []
    let remaining = Math.max(0, dt)

    if (this.phase === 'queued') {
      if (!canStartCelebration(readiness)) return signals
      this.phase = 'gathering'
      this.elapsed = 0
      signals.push('started')
    }

    while (this.active && remaining > 0) {
      const active = this.phase as ActiveCelebrationPhase
      const untilBoundary = durationFor(active) - this.elapsed
      if (remaining < untilBoundary) {
        this.elapsed += remaining
        remaining = 0
        continue
      }

      remaining -= untilBoundary
      this.phase = nextPhase(active)
      this.elapsed = 0
      signals.push(signalFor(this.phase))
    }

    return signals
  }
}

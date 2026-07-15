import { QuantizedClock } from '../core/loop'
import { TIMING } from '../ui/tokens'

type OpacityEffect = { blendMode: { opacity: { value: number } } }
type GrainEffect = OpacityEffect & { seed: number }

const HOME_DISTANCE = Math.hypot(14, 34)
const HOME_TILT_OPACITY = 0.45

export function tiltOpacityAtDistance(distance: number): number {
  if (distance <= 22) return 0
  return Math.min(
    HOME_TILT_OPACITY,
    HOME_TILT_OPACITY * (distance - 22) / (HOME_DISTANCE - 22),
  )
}

export class VisualQualityController {
  private readonly clock = new QuantizedClock(TIMING.fps)

  constructor(
    private readonly tilt: OpacityEffect | null,
    private readonly grain: GrainEffect | null,
    private readonly lowFx: boolean,
  ) {}

  update(dt: number, distance: number, reducedMotion: boolean): void {
    if (this.lowFx) return
    this.clock.advance(dt)
    if (this.tilt) this.tilt.blendMode.opacity.value = tiltOpacityAtDistance(distance)
    if (!this.grain) return
    this.grain.blendMode.opacity.value = reducedMotion ? 0.06 : 0.12
    if (!reducedMotion && this.clock.ticked) this.grain.seed = this.clock.quantizedTime
  }
}

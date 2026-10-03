type OpacityEffect = { blendMode: { opacity: { value: number } } }

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
  constructor(
    private readonly tilt: OpacityEffect | null,
    private readonly lowFx: boolean,
  ) {}

  update(distance: number): void {
    if (this.lowFx || !this.tilt) return
    this.tilt.blendMode.opacity.value = tiltOpacityAtDistance(distance)
  }
}

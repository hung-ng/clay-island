export type Vec3 = { x: number; y: number; z: number }
export type CameraPose = { position: Vec3; target: Vec3 }

export const CAMERA_HOME: CameraPose = {
  position: { x: 0, y: 14, z: 34 },
  target: { x: 0, y: 0, z: 0 },
}

export const CAMERA_LIMITS = {
  minDistance: 15,
  maxDistance: 55,
  targetRadius: 7.5,
  minPolarAngle: 0.6,
  nearMaxPolarAngle: 1.20,
  farMaxPolarAngle: 1.35,
  polarRelaxDistance: 25,
  resetSeconds: 0.7,
  idleSeconds: 8,
  recenterSeconds: 1.2,
} as const

export function clampCameraTarget(target: Vec3, maxHeight = 0): Vec3 {
  const radius = Math.hypot(target.x, target.z)
  const scale = radius > CAMERA_LIMITS.targetRadius
    ? CAMERA_LIMITS.targetRadius / radius
    : 1
  const y = Math.min(Math.max(target.y, 0), maxHeight)
  return { x: target.x * scale, y, z: target.z * scale }
}

export type CelebrationAct = 1 | 2 | 3

/** Bursts sit centre-frame: the celebration target floats this far above ground. */
export const CELEBRATION_TARGET_LIFT = 3.5

/**
 * Three-act celebration choreography over the 14-second timeline:
 * close protected view while villagers gather, a pull-back that settles before
 * the first launch, and the widest pose for the finale. `at` is seconds since
 * gathering began.
 */
export const CELEBRATION_ACTS: readonly {
  act: CelebrationAct
  at: number
  distance: number
  height: number
  seconds: number
}[] = [
  { act: 1, at: 0, distance: 24, height: 9, seconds: 1.6 },
  { act: 2, at: 3.2, distance: 40, height: 15, seconds: 0.8 },
  { act: 3, at: 11, distance: CAMERA_LIMITS.maxDistance, height: 20, seconds: 0.8 },
] as const

/** The Act 1 gesture lock always releases at the Act 2 boundary. */
export const CELEBRATION_INTRO_LOCK_SECONDS = CELEBRATION_ACTS[1]!.at
  - CELEBRATION_ACTS[0]!.at

/** An act's launcher-relative pose that preserves the player's current azimuth. */
export function celebrationActPose(
  act: CelebrationAct,
  current: CameraPose,
  centre: { x: number; z: number },
): CameraPose {
  const spec = CELEBRATION_ACTS[act - 1]!
  const target = clampCameraTarget(
    { x: centre.x, y: CELEBRATION_TARGET_LIFT, z: centre.z },
    CELEBRATION_TARGET_LIFT,
  )
  const dx = current.position.x - current.target.x
  const dz = current.position.z - current.target.z
  const length = Math.hypot(dx, dz)
  const direction = length > 1e-6
    ? { x: dx / length, z: dz / length }
    : { x: 0, z: 1 }
  const rise = spec.height - target.y
  const horizontalDistance = Math.sqrt(Math.max(0, spec.distance ** 2 - rise ** 2))
  return {
    position: {
      x: target.x + direction.x * horizontalDistance,
      y: spec.height,
      z: target.z + direction.z * horizontalDistance,
    },
    target,
  }
}

export function maxPolarAngleAt(distance: number): number {
  const span = CAMERA_LIMITS.polarRelaxDistance - CAMERA_LIMITS.minDistance
  const t = Math.max(0, Math.min(1, (distance - CAMERA_LIMITS.minDistance) / span))
  return CAMERA_LIMITS.nearMaxPolarAngle
    + (CAMERA_LIMITS.farMaxPolarAngle - CAMERA_LIMITS.nearMaxPolarAngle) * t
}

export function smooth01(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

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

export const CELEBRATION_CAMERA = {
  distance: CAMERA_LIMITS.maxDistance,
  height: 20,
  seconds: 0.8,
  suggestAt: 3,
} as const

export function clampCameraTarget(target: Vec3): Vec3 {
  const radius = Math.hypot(target.x, target.z)
  const scale = radius > CAMERA_LIMITS.targetRadius
    ? CAMERA_LIMITS.targetRadius / radius
    : 1
  return { x: target.x * scale, y: 0, z: target.z * scale }
}

/** A launcher-relative view that preserves the player's current azimuth. */
export function celebrationCameraPose(
  current: CameraPose,
  centre: { x: number; z: number },
): CameraPose {
  const target = clampCameraTarget({ x: centre.x, y: 0, z: centre.z })
  const dx = current.position.x - current.target.x
  const dz = current.position.z - current.target.z
  const length = Math.hypot(dx, dz)
  const direction = length > 1e-6
    ? { x: dx / length, z: dz / length }
    : { x: 0, z: 1 }
  const horizontalDistance = Math.sqrt(Math.max(
    0,
    CELEBRATION_CAMERA.distance ** 2 - CELEBRATION_CAMERA.height ** 2,
  ))
  return {
    position: {
      x: target.x + direction.x * horizontalDistance,
      y: CELEBRATION_CAMERA.height,
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

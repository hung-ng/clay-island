export type CelebrationPoint = { x: number; z: number }
export type CelebrationSite = {
  centre: CelebrationPoint
  slots: Array<CelebrationPoint | null>
}

const RADII = [2.2, 2.8, 3.4, 4] as const
const ANGLE_OFFSETS = [0, 1, -1, 2, -2, 3, -3, 4, -4] as const
const ANGLE_STEP = Math.PI / 18
const MIN_SLOT_DISTANCE = 0.72
const SITE_RADII = [0, 2.4, 3.8, 5.2, 6.6, 8, 9.4, 10.8] as const
const SITE_ANGLE_COUNT = 24

export function findCelebrationSlots(
  center: CelebrationPoint,
  count: number,
  canStand: (point: CelebrationPoint) => boolean,
): Array<CelebrationPoint | null> {
  const slots: Array<CelebrationPoint | null> = []
  if (count <= 0) return slots

  for (let index = 0; index < count; index++) {
    const baseAngle = -Math.PI / 2 + index / count * Math.PI * 2
    let accepted: CelebrationPoint | null = null

    for (const radius of RADII) {
      for (const offset of ANGLE_OFFSETS) {
        const angle = baseAngle + offset * ANGLE_STEP
        const candidate = {
          x: center.x + Math.cos(angle) * radius,
          z: center.z + Math.sin(angle) * radius,
        }
        const separated = slots.every(slot => (
          !slot || Math.hypot(slot.x - candidate.x, slot.z - candidate.z) >= MIN_SLOT_DISTANCE
        ))
        if (separated && canStand(candidate)) {
          accepted = candidate
          break
        }
      }
      if (accepted) break
    }

    slots.push(accepted)
  }

  return slots
}

/** Select one stable launch centre by maximizing the usable viewing ring. */
export function findCelebrationSite(
  anchors: readonly CelebrationPoint[],
  count: number,
  canLaunch: (point: CelebrationPoint) => boolean,
  canStand: (point: CelebrationPoint) => boolean,
): CelebrationSite | null {
  let best: CelebrationSite | null = null
  let bestScore = -1

  for (const anchor of anchors) {
    for (const radius of SITE_RADII) {
      const samples = radius === 0 ? 1 : SITE_ANGLE_COUNT
      for (let index = 0; index < samples; index++) {
        const angle = -Math.PI / 2 + index / samples * Math.PI * 2
        const centre = {
          x: anchor.x + Math.cos(angle) * radius,
          z: anchor.z + Math.sin(angle) * radius,
        }
        if (!canLaunch(centre)) continue

        const slots = findCelebrationSlots(centre, count, canStand)
        const score = slots.filter(Boolean).length
        if (score <= bestScore) continue
        best = { centre, slots }
        bestScore = score
        if (score === count) return best
      }
    }
  }

  return best
}

export type Crater = { x: number; z: number; radius: number; depth: number }

/** Downward displacement at (x,z) from all craters. Always >= 0. */
export function craterOffset(x: number, z: number, craters: Crater[]): number {
  let d = 0
  for (const c of craters) {
    const t = Math.hypot(x - c.x, z - c.z) / c.radius
    if (t >= 1) continue
    // Smooth bowl: 1 at centre, 0 at rim, with a slight raised lip just inside.
    const bowl = Math.cos(t * Math.PI * 0.5) ** 2
    d += c.depth * bowl
  }
  return d
}

/** True if the point is inside any crater's rim — used by resolveTarget + pond fill. */
export function craterAt(x: number, z: number, craters: Crater[]): Crater | null {
  for (const c of craters) if (Math.hypot(x - c.x, z - c.z) < c.radius) return c
  return null
}

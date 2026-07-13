function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Add one radial paint stamp to an accumulated 0..1 decal amount. */
export function accumulateScorch(current: number, distance: number, radius: number): number {
  if (radius <= 0 || distance >= radius) return clamp01(current)
  return clamp01(current + 1 - distance / radius)
}

/** Blend one color channel from its preserved base toward a decal color. */
export function blendChannel(base: number, decal: number, amount: number): number {
  const t = clamp01(amount)
  return base + (decal - base) * t
}

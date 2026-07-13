// NOTE: hash2 takes INTEGER lattice coords only. Math.imul coerces via ToInt32,
// so hash2(1.5, y) === hash2(1.9, y). Only valueNoise2 may call it, and it always
// passes Math.floor'd values. Do not call hash2 directly from anywhere else.
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Returns [-1, 1). */
export function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi), b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}

/** Sum of octaves; bounded by the amp series (~[-1, 1) as octaves → ∞, tighter for few). */
export function fbm2(x: number, y: number, octaves = 3): number {
  let sum = 0, amp = 0.5, f = 1
  for (let i = 0; i < octaves; i++) { sum += valueNoise2(x * f, y * f) * amp; amp *= 0.5; f *= 2 }
  return sum
}

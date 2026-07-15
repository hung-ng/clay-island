export class RNG {
  private s: number
  constructor(seed = 1) { this.s = seed >>> 0 }
  next(): number {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(min: number, max: number): number { return min + (max - min) * this.next() }
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)) }
  pick<T>(a: readonly T[]): T {
    if (a.length === 0) throw new RangeError('RNG.pick requires at least one item')
    return a[Math.floor(this.next() * a.length)]!
  }
  chance(p: number): boolean { return this.next() < p }
}

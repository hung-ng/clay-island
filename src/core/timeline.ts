// Fires each callback exactly once, on the first update at or past its time.
// A fired-flag (rather than a prev < t <= now window) is what makes `at(0, …)`
// work and makes `done` mean "everything actually ran", not "the clock passed them".
export class Timeline {
  private events: { t: number; fn: () => void; fired: boolean }[] = []
  private t = 0
  at(t: number, fn: () => void): this { this.events.push({ t, fn, fired: false }); return this }
  update(dt: number): void {
    this.t += dt
    for (const e of this.events) {
      if (!e.fired && this.t >= e.t) { e.fired = true; e.fn() }
    }
  }
  get done(): boolean { return this.events.length > 0 && this.events.every(e => e.fired) }
}

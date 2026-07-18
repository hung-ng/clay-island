export class GameLoop {
  /** Longest stretch of sim time drained in one visible frame or hidden tick. */
  static readonly MAX_CATCH_UP = 30

  private acc = 0; private last = 0; private raf = 0; private running = false
  private background = false
  constructor(
    private onSim: (dt: number) => void,
    private onRender: (dt: number) => void,
    private simDt = 1 / 30,
    private now: () => number = () => performance.now(),
  ) {}

  start(): void {
    if (this.running) return
    this.running = true; this.last = this.now(); this.acc = 0
    this.scheduleFrame()
  }

  /** Hidden tabs swap the rAF drive for external ticks; sim time keeps flowing. */
  setBackground(active: boolean): void {
    if (!this.running || this.background === active) return
    // A fully-frozen tab may never have ticked: bank the elapsed time before
    // switching drives so the catch-up happens on return.
    if (!active) this.backgroundTick()
    this.background = active
    cancelAnimationFrame(this.raf)
    this.last = this.now()
    if (!active) this.scheduleFrame()
  }

  /** One hidden-tab tick: advance sim by real elapsed time, render nothing. */
  backgroundTick(): void {
    if (!this.running || !this.background) return
    const now = this.now()
    this.acc += (now - this.last) / 1000
    this.last = now
    this.drainSim()
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.raf) }

  private scheduleFrame(): void {
    const frame = (now: number) => {
      if (!this.running || this.background) return
      const dt = Math.min((now - this.last) / 1000, 0.1)
      this.last = now; this.acc += dt
      this.drainSim()
      if (!this.running) return
      this.onRender(dt)
      if (this.running && !this.background) this.raf = requestAnimationFrame(frame)
    }
    this.raf = requestAnimationFrame(frame)
  }

  private drainSim(): void {
    // The clamp intentionally drops older backlog after long throttling.
    this.acc = Math.min(this.acc, GameLoop.MAX_CATCH_UP)
    const epsilon = this.simDt * 1e-9
    while (this.running && this.acc + epsilon >= this.simDt) {
      this.onSim(this.simDt)
      this.acc = Math.max(0, this.acc - this.simDt)
    }
  }
}

export class QuantizedClock {
  private time = 0
  private frame = -1        // -1 so the first advance() lands on frame 0 and ticks
  ticked = false
  constructor(private fps = 12) {}
  advance(dt: number): void {
    this.time += dt
    const f = Math.floor(this.time * this.fps)
    this.ticked = f !== this.frame
    this.frame = f
  }
  get quantizedTime(): number { return Math.max(this.frame, 0) / this.fps }
}

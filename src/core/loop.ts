export class GameLoop {
  private acc = 0; private last = 0; private raf = 0; private running = false
  constructor(
    private onSim: (dt: number) => void,
    private onRender: (dt: number) => void,
    private simDt = 1 / 30,
  ) {}
  start(): void {
    this.running = true; this.last = performance.now()
    const frame = (now: number) => {
      if (!this.running) return
      const dt = Math.min((now - this.last) / 1000, 0.1)
      this.last = now; this.acc += dt
      while (this.acc >= this.simDt) { this.onSim(this.simDt); this.acc -= this.simDt }
      this.onRender(dt)
      this.raf = requestAnimationFrame(frame)
    }
    this.raf = requestAnimationFrame(frame)
  }
  stop(): void { this.running = false; cancelAnimationFrame(this.raf) }
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

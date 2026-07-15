import { afterEach, describe, it, expect, vi } from 'vitest'
import { RNG } from './rng'
import { valueNoise2 } from './noise'
import { EventBus, type GameEvent } from './events'
import { GameLoop, QuantizedClock } from './loop'
import { Timeline } from './timeline'

afterEach(() => vi.unstubAllGlobals())

describe('RNG', () => {
  it('is deterministic per seed', () => {
    const a = new RNG(42), b = new RNG(42)
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()])
  })
  it('range stays in bounds', () => {
    const r = new RNG(1)
    for (let i = 0; i < 100; i++) { const v = r.range(2, 5); expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThan(5) }
  })
  it('rejects an empty choice instead of returning undefined', () => {
    expect(() => new RNG(1).pick([])).toThrow(RangeError)
  })
})

describe('noise', () => {
  it('is deterministic and bounded', () => {
    expect(valueNoise2(1.5, 2.5)).toBe(valueNoise2(1.5, 2.5))
    for (let i = 0; i < 100; i++) {
      const v = valueNoise2(i * 0.37, i * 0.91)
      expect(Math.abs(v)).toBeLessThanOrEqual(1)
    }
  })
})

describe('EventBus', () => {
  it('emits to handlers and unsubscribes', () => {
    const bus = new EventBus(); const seen: GameEvent[] = []
    const off = bus.on(e => seen.push(e))
    bus.emit({ type: 'pond:created', x: 0, z: 0 })
    off()
    bus.emit({ type: 'pond:created', x: 0, z: 0 })
    expect(seen).toHaveLength(1)
  })
  it('survives a handler unsubscribing during emit', () => {
    const bus = new EventBus(); let n = 0
    const off = bus.on(() => { n++; off() })   // the [...handlers] copy is why this is safe
    bus.emit({ type: 'pond:emptied' })
    bus.emit({ type: 'pond:emptied' })
    expect(n).toBe(1)
  })
})

describe('QuantizedClock', () => {
  it('ticks on the very first advance', () => {
    const c = new QuantizedClock(12)
    c.advance(1 / 60)
    expect(c.ticked).toBe(true)   // frame 0 is a real frame — something must pop on it
  })
  it('ticks at the quantized rate only', () => {
    const c = new QuantizedClock(12)
    c.advance(1 / 60)             // frame 0
    c.advance(1 / 60); expect(c.ticked).toBe(false)
    c.advance(4 / 60); expect(c.ticked).toBe(true)
    expect(c.quantizedTime).toBeCloseTo(1 / 12)
  })
})

describe('GameLoop lifecycle', () => {
  it('does not schedule duplicate frames when start is called twice', () => {
    vi.stubGlobal('performance', { now: () => 0 })
    const request = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const loop = new GameLoop(() => {}, () => {})

    loop.start()
    loop.start()

    expect(request).toHaveBeenCalledOnce()
  })

  it('does not schedule another frame when stopped during rendering', () => {
    vi.stubGlobal('performance', { now: () => 0 })
    let frame: FrameRequestCallback | null = null
    const request = vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let loop: GameLoop
    loop = new GameLoop(() => {}, () => loop.stop())
    loop.start()

    const scheduled = frame as FrameRequestCallback | null
    expect(scheduled).not.toBeNull()
    scheduled!(1 / 60)

    expect(request).toHaveBeenCalledOnce()
  })

  it('does not render or reschedule when stopped during simulation', () => {
    vi.stubGlobal('performance', { now: () => 0 })
    let frame: FrameRequestCallback | null = null
    const request = vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const render = vi.fn()
    let loop: GameLoop
    loop = new GameLoop(() => loop.stop(), render)
    loop.start()

    const scheduled = frame as FrameRequestCallback | null
    expect(scheduled).not.toBeNull()
    scheduled!(100)

    expect(render).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledOnce()
  })
})

describe('Timeline', () => {
  it('fires callbacks in windows, reports done', () => {
    const hits: number[] = []
    const t = new Timeline().at(0.1, () => hits.push(1)).at(0.3, () => hits.push(2))
    expect(t.done).toBe(false)                                   // not done before it runs
    t.update(0.2); expect(hits).toEqual([1]); expect(t.done).toBe(false)
    t.update(0.2); expect(hits).toEqual([1, 2]); expect(t.done).toBe(true)
  })
  it('fires a t=0 callback on the first update', () => {
    const hits: number[] = []
    const t = new Timeline().at(0, () => hits.push(0))
    t.update(1 / 60)
    expect(hits).toEqual([0])
  })
  it('fires each callback exactly once', () => {
    let n = 0
    const t = new Timeline().at(0.1, () => n++)
    t.update(1); t.update(1)
    expect(n).toBe(1)
  })
  it('fires scheduled callbacks chronologically even when registered out of order', () => {
    const hits: string[] = []
    const timeline = new Timeline()
      .at(1, () => hits.push('late'))
      .at(0.5, () => hits.push('early'))

    timeline.update(1)

    expect(hits).toEqual(['early', 'late'])
  })
  it('an empty timeline is never done', () => {
    expect(new Timeline().done).toBe(false)   // guards against `[].every() === true`
  })
})

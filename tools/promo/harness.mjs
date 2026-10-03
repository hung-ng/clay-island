// Full virtual-time harness: rAF, performance.now, setTimeout and every CSS/Web
// Animation advance only when we step, so slow software WebGL still yields
// frame-perfect footage.
// Playwright isn't a project dependency; point PLAYWRIGHT at any install
// (e.g. a global one) if `playwright` doesn't resolve from here.
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')

export async function open({ url = 'http://127.0.0.1:5174/', width = 1920, height = 1080, storage = {} } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('pageerror', e => console.log('pageerror:', e.message))
  page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()) })
  await page.addInitScript((storage) => {
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v)
    let now = 0
    const frames = new Map(); let frameId = 0
    const timers = new Map(); let timerId = 0
    const seen = new WeakSet()
    window.requestAnimationFrame = cb => { frames.set(++frameId, cb); return frameId }
    window.cancelAnimationFrame = id => { frames.delete(id) }
    window.setTimeout = (fn, ms = 0, ...args) => { timers.set(++timerId, { at: now + Number(ms || 0), fn, args }); return timerId }
    window.clearTimeout = id => { timers.delete(id) }
    performance.now = () => now
    const advanceAnimations = (ms) => {
      for (const animation of document.getAnimations()) {
        if (!seen.has(animation)) {
          seen.add(animation)
          animation.pause()
          animation.currentTime = 0
          continue
        }
        if (animation.playState === 'finished') continue
        const end = animation.effect?.getComputedTiming().endTime ?? 0
        const next = (animation.currentTime ?? 0) + ms
        if (next >= end) animation.finish()
        else animation.currentTime = next
      }
    }
    window.__vt = {
      step(ms) {
        now += ms
        const due = [...timers].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)
        for (const [id, t] of due) {
          timers.delete(id)
          if (typeof t.fn === 'function') t.fn(...t.args)
        }
        const callbacks = [...frames.values()]
        frames.clear()
        for (const cb of callbacks) cb(now)
        advanceAnimations(ms)
      },
      get now() { return now },
    }
  }, storage)
  await page.goto(url)
  await page.waitForFunction(() => window.__vt)
  const vt = {
    page, browser,
    /** Advance `seconds` of virtual time in frames of 1/fps, calling `each(i)` after every frame. */
    async run(seconds, fps = 10, each = null) {
      const n = Math.round(seconds * fps)
      for (let i = 0; i < n; i++) {
        await page.evaluate(ms => window.__vt.step(ms), 1000 / fps)
        if (each) await each(i)
      }
    },
    async shot(path, timeout = 180000) { await page.screenshot({ path, timeout }) },
    async close() { await browser.close() },
  }
  await vt.run(0.1)
  return vt
}

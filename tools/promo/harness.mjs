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

    // Audio: the game's AudioContext becomes an offline one whose clock we
    // advance in step with the video, so every sound lands on its frame.
    const SAMPLE_RATE = 44100
    const MAX_AUDIO_SECONDS = 300
    const Offline = window.OfflineAudioContext
    let audio = null
    let audioRendering = null
    let audioT = 0
    class CaptureAudioContext extends Offline {
      constructor() {
        super(2, SAMPLE_RATE * MAX_AUDIO_SECONDS, SAMPLE_RATE)
        audio = this
      }
      // The game resumes on unlock; rendering is ours to drive.
      resume() { return Promise.resolve() }
    }
    window.AudioContext = CaptureAudioContext
    window.webkitAudioContext = CaptureAudioContext
    window.__audio = {
      get ready() { return audio !== null },
      get time() { return audioT },
      async advance(seconds) {
        if (!audio) return false
        const target = audioT + seconds
        const reached = Offline.prototype.suspend.call(audio, target)
        if (!audioRendering) audioRendering = Offline.prototype.startRendering.call(audio)
        else await Offline.prototype.resume.call(audio)
        await reached
        audioT = target
        return true
      },
      async finish() {
        if (!audio) return null
        await Offline.prototype.resume.call(audio)
        const buffer = await audioRendering
        window.__audioBuffer = buffer
        return { sampleRate: buffer.sampleRate, length: buffer.length }
      },
      /** Interleaved 16-bit PCM for [from, to) samples, base64. */
      chunk(from, to) {
        const buffer = window.__audioBuffer
        const left = buffer.getChannelData(0), right = buffer.getChannelData(1)
        const pcm = new Int16Array((to - from) * 2)
        for (let i = from, j = 0; i < to; i++, j += 2) {
          pcm[j] = Math.max(-1, Math.min(1, left[i])) * 32767
          pcm[j + 1] = Math.max(-1, Math.min(1, right[i])) * 32767
        }
        const bytes = new Uint8Array(pcm.buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(binary)
      },
    }
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
  // Audio timeline: what each recorded video frame should sound like.
  const track = { leadingSilence: 0, keep: [] }
  const vt = {
    page, browser, track,
    /**
     * Step one frame. `ms` is game time; `audioSeconds` is how far the audio
     * clock moves (video time when recorded, so slow motion keeps sounds at
     * their real pitch and length). Recorded frames add to the audio track.
     */
    async frame(ms, audioSeconds, record) {
      const from = await page.evaluate(() => window.__audio.time)
      await page.evaluate(ms => window.__vt.step(ms), ms)
      const had = await page.evaluate(s => window.__audio.advance(s), audioSeconds)
      if (!record) return
      if (!had) { track.leadingSilence += audioSeconds; return }
      const last = track.keep.at(-1)
      if (last && Math.abs(last[1] - from) < 1e-6) last[1] = from + audioSeconds
      else track.keep.push([from, from + audioSeconds])
    },
    /** Finish the offline render and write the recorded audio as a WAV. */
    async writeAudio(path) {
      const { writeFileSync } = await import('node:fs')
      const info = await page.evaluate(() => window.__audio.finish())
      const rate = info?.sampleRate ?? 44100
      const parts = [Buffer.alloc(Math.round(track.leadingSilence * rate) * 4)]
      const FADE = Math.round(rate * 0.006)
      for (const [from, to] of track.keep) {
        const a = Math.round(from * rate), b = Math.min(Math.round(to * rate), info.length)
        const pieces = []
        for (let i = a; i < b; i += rate * 5) {
          pieces.push(Buffer.from(await page.evaluate(([x, y]) => window.__audio.chunk(x, y), [i, Math.min(b, i + rate * 5)]), 'base64'))
        }
        const part = Buffer.concat(pieces)
        // A few ms of fade at every splice so cuts don't click.
        const frames = part.length / 4
        for (let k = 0; k < Math.min(FADE, frames); k++) {
          for (const offset of [k * 4, (frames - 1 - k) * 4]) {
            const g = k / FADE
            part.writeInt16LE(Math.round(part.readInt16LE(offset) * g), offset)
            part.writeInt16LE(Math.round(part.readInt16LE(offset + 2) * g), offset + 2)
          }
        }
        parts.push(part)
      }
      const data = Buffer.concat(parts)
      const header = Buffer.alloc(44)
      header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
      header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22)
      header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34)
      header.write('data', 36); header.writeUInt32LE(data.length, 40)
      writeFileSync(path, Buffer.concat([header, data]))
      return { seconds: data.length / 4 / rate, splices: track.keep.length }
    },
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

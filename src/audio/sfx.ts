import type { EventBus, GameEvent } from '../core/events'
import { RNG } from '../core/rng'
import type { CelebrationSoundCue } from '../celebration/fireworks'

type SfxStorage = Pick<Storage, 'getItem' | 'setItem'>
type Voice = { sources: AudioScheduledSourceNode[]; nodes: AudioNode[]; sustained: boolean; stop(): void }

export type PrologueSoundCue = 'growth' | 'step' | 'hammer' | 'chop' | 'place' | 'ignite'
export type CelebrationSoundProfile = {
  kind: 'tone' | 'knock'
  from: number
  to: number
  seconds: number
  volume: number
}
export type PrologueSoundProfile =
  | { kind: 'step' }
  | { kind: 'knock'; pitch: number; seconds: number; volume: number }
  | { kind: 'tone'; from: number; to: number; seconds: number; volume: number }
export type ShutterSoundProfile = {
  knock: { pitch: number; seconds: number; volume: number }
  tick: { from: number; to: number; seconds: number; volume: number }
}

export function prologueSoundProfile(cue: PrologueSoundCue): PrologueSoundProfile {
  if (cue === 'step') return { kind: 'step' }
  if (cue === 'hammer') return { kind: 'knock', pitch: 150, seconds: 0.10, volume: 0.028 }
  // Deeper and longer than a hammer: an axe biting wood, not a peg going in.
  if (cue === 'chop') return { kind: 'knock', pitch: 82, seconds: 0.18, volume: 0.036 }
  if (cue === 'place') return { kind: 'knock', pitch: 95, seconds: 0.14, volume: 0.032 }
  if (cue === 'growth') {
    return { kind: 'tone', from: 150, to: 230, seconds: 0.15, volume: 0.012 }
  }
  return { kind: 'tone', from: 180, to: 520, seconds: 0.4, volume: 0.026 }
}

export function celebrationSoundProfile(cue: CelebrationSoundCue): CelebrationSoundProfile {
  if (cue === 'launch') {
    return { kind: 'tone', from: 210, to: 1040, seconds: 0.46, volume: 0.021 }
  }
  if (cue === 'pop') {
    return { kind: 'knock', from: 118, to: 72, seconds: 0.22, volume: 0.044 }
  }
  if (cue === 'crackle') {
    return { kind: 'tone', from: 980, to: 620, seconds: 0.11, volume: 0.012 }
  }
  if (cue === 'finale') {
    return { kind: 'knock', from: 88, to: 46, seconds: 0.36, volume: 0.058 }
  }
  return { kind: 'tone', from: 310, to: 620, seconds: 0.34, volume: 0.026 }
}

export function shutterSoundProfile(): ShutterSoundProfile {
  return {
    knock: { pitch: 430, seconds: 0.05, volume: 0.045 },
    tick: { from: 2400, to: 1500, seconds: 0.03, volume: 0.016 },
  }
}

const MUTE_KEY = 'clayisland.muted'
const MAX_VOICES = 6

/**
 * The voice to cut when the cap is reached: the oldest short one. Sustained
 * beds (the rain, a gust) go only when nothing else can, so a burst of
 * footsteps can't silence the rain while it is still falling.
 */
export function voiceToEvict<T extends { sustained: boolean }>(voices: readonly T[]): T | undefined {
  return voices.find(voice => !voice.sustained) ?? voices[0]
}

export class Sfx {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private ambientGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private ambientNodes: AudioNode[] = []
  private ambientSources: AudioScheduledSourceNode[] = []
  private voices: Voice[] = []
  private detachBus: (() => void) | null = null
  private readonly rng = new RNG(907)
  private mutedValue = false
  private birdTimer = 1.5
  private cricketTimer = 0.8
  private crackleTimer = 0

  constructor(private readonly options: { storage?: SfxStorage | null } = {}) {
    try { this.mutedValue = options.storage?.getItem(MUTE_KEY) === 'true' } catch { /* optional */ }
  }

  get muted(): boolean { return this.mutedValue }

  attach(bus: EventBus): () => void {
    this.detachBus?.()
    this.detachBus = bus.on(event => this.onEvent(event))
    return () => {
      this.detachBus?.()
      this.detachBus = null
    }
  }

  unlock(): void {
    if (this.context) {
      void this.context.resume()
      return
    }
    try {
      const context = new AudioContext()
      const master = context.createGain()
      master.gain.value = this.mutedValue ? 0 : 0.72
      master.connect(context.destination)
      this.context = context
      this.master = master
      this.noiseBuffer = this.createNoiseBuffer(context)
      this.startAmbient()
      void context.resume()
    } catch {
      this.context = null
      this.master = null
    }
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime)
      this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.025)
    }
    try { this.options.storage?.setItem(MUTE_KEY, String(muted)) } catch { /* optional */ }
  }

  step(): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime
    const noise = context.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.playbackRate.value = this.rng.range(0.85, 1.15)
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(this.rng.range(360, 520), now)
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.09)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.028, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)
    noise.connect(filter).connect(gain).connect(audio.master)
    noise.start(now)
    noise.stop(now + 0.105)
    this.trackVoice([noise], [filter, gain])
  }

  prologue(cue: PrologueSoundCue): void {
    const profile = prologueSoundProfile(cue)
    if (profile.kind === 'step') {
      this.step()
      return
    }
    if (profile.kind === 'knock') {
      this.knock(profile.pitch, profile.seconds, profile.volume)
      return
    }
    this.oscillator('sine', profile.from, profile.to, profile.seconds, profile.volume)
  }

  celebration(cue: CelebrationSoundCue): void {
    const profile = celebrationSoundProfile(cue)
    if (cue === 'pop' || cue === 'finale') this.burstAir(cue === 'finale' ? 1.6 : 1)
    if (cue === 'crackle' || cue === 'finale') this.crackle(cue === 'finale' ? 14 : 8, 0.5)
    if (profile.kind === 'knock') {
      this.knock(profile.from, profile.seconds, profile.volume)
      return
    }
    this.oscillator('sine', profile.from, profile.to, profile.seconds, profile.volume)
  }

  /** A Moment pressed into the journal: a soft two-note clay marimba. */
  reward(): void {
    this.oscillator('sine', 116, 82, 0.18, 0.022)
    this.chime(659, 0, 0.016)
    this.chime(988, 0.11, 0.014)
  }

  /**
   * Ambient life, called once per rendered frame. Birds sing by day, crickets
   * by night, and any open fire crackles; everything rides the ambient bus so
   * impacts duck it.
   */
  update(dt: number, nightLevel: number, burning: number): void {
    if (!this.context || !this.ambientGain || dt <= 0) return
    const day = 1 - nightLevel
    this.birdTimer -= dt
    if (this.birdTimer <= 0) {
      this.birdTimer = this.rng.range(1.4, 4.2)
      if (day > 0.35 && this.rng.chance(day)) this.birdsong()
    }
    this.cricketTimer -= dt
    if (this.cricketTimer <= 0) {
      this.cricketTimer = this.rng.range(0.35, 0.9)
      if (nightLevel > 0.4 && this.rng.chance(nightLevel)) this.cricket()
    }
    if (burning > 0) {
      this.crackleTimer -= dt
      if (this.crackleTimer <= 0) {
        this.crackleTimer = this.rng.range(0.05, 0.22) / Math.min(3, burning)
        this.fireTick()
      }
    }
  }

  shutter(): void {
    const profile = shutterSoundProfile()
    this.knock(profile.knock.pitch, profile.knock.seconds, profile.knock.volume)
    this.oscillator(
      'sine',
      profile.tick.from,
      profile.tick.to,
      profile.tick.seconds,
      profile.tick.volume,
    )
  }

  dispose(): void {
    this.detachBus?.()
    this.detachBus = null
    for (const voice of [...this.voices]) voice.stop()
    for (const source of this.ambientSources) {
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    }
    for (const node of this.ambientNodes) node.disconnect()
    this.ambientSources = []
    this.ambientNodes = []
    this.master?.disconnect()
    void this.context?.close()
    this.context = null
    this.master = null
  }

  private ready(): { context: AudioContext; master: GainNode } | null {
    return this.context && this.master ? { context: this.context, master: this.master } : null
  }

  private onEvent(event: GameEvent): void {
    if (event.type === 'power:anticipate') {
      if (event.power === 'meteor') this.oscillator('sine', 220, 980, 1.2, 0.042)
      if (event.power === 'lightning') this.oscillator('sawtooth', 58, 34, 0.9, 0.018)
      if (event.power === 'rain') this.rain(7.2)
      if (event.power === 'wind') this.whoosh(3.4)
      return
    }
    if (event.type === 'power:impact') {
      this.duckAmbient()
      if (event.power === 'meteor') {
        this.thud()
        this.rumble(0, 1.8, 0.11, 150)
      }
      if (event.power === 'lightning') {
        this.crack()
        this.rumble(0.12, 2.4, 0.085, 230)
      }
      return
    }
    if (event.type === 'fire:doused') {
      this.hiss()
      return
    }
    if (
      event.type === 'flower:bloomed'
      || event.type === 'fruit:grown'
      || event.type === 'campfire:flared'
    ) this.oscillator('sine', 380, 680, 0.1, 0.025)
  }

  private oscillator(
    type: OscillatorType,
    from: number,
    to: number,
    seconds: number,
    volume: number,
  ): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime
    const source = context.createOscillator()
    const gain = context.createGain()
    source.type = type
    source.frequency.setValueAtTime(from, now)
    source.frequency.exponentialRampToValueAtTime(to, now + seconds)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.02, seconds * 0.2))
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(gain).connect(audio.master)
    source.start(now)
    source.stop(now + seconds)
    this.trackVoice([source], [gain])
  }

  private knock(pitch: number, seconds: number, volume: number): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime

    const tone = context.createOscillator()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(pitch * 1.08, now)
    tone.frequency.exponentialRampToValueAtTime(pitch, now + seconds)
    const toneGain = context.createGain()
    toneGain.gain.setValueAtTime(volume, now)
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)

    const noise = context.createBufferSource()
    noise.buffer = this.noiseBuffer
    const noiseFilter = context.createBiquadFilter()
    noiseFilter.type = 'bandpass'
    noiseFilter.frequency.value = pitch * 3.2
    noiseFilter.Q.value = 0.9
    const noiseGain = context.createGain()
    noiseGain.gain.setValueAtTime(volume * 0.42, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds * 0.65)

    tone.connect(toneGain).connect(audio.master)
    noise.connect(noiseFilter).connect(noiseGain).connect(audio.master)
    tone.start(now)
    tone.stop(now + seconds)
    noise.start(now)
    noise.stop(now + seconds)
    this.trackVoice([tone, noise], [toneGain, noiseFilter, noiseGain])
  }

  private thud(): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime
    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(68, now)
    oscillator.frequency.exponentialRampToValueAtTime(42, now + 0.42)
    const oscillatorGain = context.createGain()
    oscillatorGain.gain.setValueAtTime(0.12, now)
    oscillatorGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)

    const noise = context.createBufferSource()
    noise.buffer = this.noiseBuffer
    const noiseFilter = context.createBiquadFilter()
    noiseFilter.type = 'lowpass'
    noiseFilter.frequency.value = 240
    const noiseGain = context.createGain()
    noiseGain.gain.setValueAtTime(0.065, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
    oscillator.connect(oscillatorGain).connect(audio.master)
    noise.connect(noiseFilter).connect(noiseGain).connect(audio.master)
    oscillator.start(now)
    oscillator.stop(now + 0.46)
    noise.start(now)
    noise.stop(now + 0.12)
    this.trackVoice([oscillator, noise], [oscillatorGain, noiseFilter, noiseGain])
  }

  private crack(): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(3200, now)
    filter.Q.value = 0.7
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.13, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    source.connect(filter).connect(gain).connect(audio.master)
    source.start(now)
    source.stop(now + 0.17)
    this.trackVoice([source], [filter, gain])
  }

  private hiss(): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(800, now)
    filter.frequency.exponentialRampToValueAtTime(3900, now + 0.25)
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.8)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.08)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82)
    source.connect(filter).connect(gain).connect(audio.master)
    source.start(now)
    source.stop(now + 0.83)
    this.trackVoice([source], [filter, gain])
  }

  private rain(seconds: number): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1800
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.018, now + 0.45)
    gain.gain.setValueAtTime(0.018, now + seconds - 0.7)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(filter).connect(gain).connect(audio.master)
    source.start(now)
    source.stop(now + seconds)
    this.trackVoice([source], [filter, gain], true)
  }

  private whoosh(seconds: number): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.6
    filter.frequency.setValueAtTime(240, now)
    filter.frequency.exponentialRampToValueAtTime(900, now + 1.1)
    filter.frequency.exponentialRampToValueAtTime(320, now + seconds)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.9)
    gain.gain.setValueAtTime(0.05, now + seconds - 1)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(filter).connect(gain).connect(audio.master)
    source.start(now)
    source.stop(now + seconds)
    this.trackVoice([source], [filter, gain], true)
  }

  /** Low noise swell: thunder after the crack, the ground settling after a meteor. */
  private rumble(delay: number, seconds: number, volume: number, cutoff: number): void {
    const audio = this.ready()
    if (!audio || !this.noiseBuffer) return
    const { context } = audio
    const start = context.currentTime + delay
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    source.loop = true
    source.playbackRate.value = 0.6
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(cutoff * 1.8, start)
    filter.frequency.exponentialRampToValueAtTime(cutoff * 0.5, start + seconds)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.14)
    gain.gain.exponentialRampToValueAtTime(volume * 0.35, start + seconds * 0.4)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds)
    source.connect(filter).connect(gain).connect(audio.master)
    source.start(start)
    source.stop(start + seconds + 0.05)
    this.trackVoice([source], [filter, gain])
  }

  /** The bright airy part of a firework pop. */
  private burstAir(scale: number): void {
    const audio = this.ready()
    if (!audio || !this.noiseBuffer) return
    const { context } = audio
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(2200, now)
    filter.frequency.exponentialRampToValueAtTime(700, now + 0.3)
    filter.Q.value = 0.6
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.05 * scale, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    source.connect(filter).connect(gain).connect(audio.master)
    source.start(now)
    source.stop(now + 0.34)
    this.trackVoice([source], [filter, gain])
  }

  /** A scatter of tiny ticks spread over `seconds`, scheduled on the audio clock. */
  private crackle(count: number, seconds: number): void {
    for (let i = 0; i < count; i++) {
      this.tick(this.rng.range(0, seconds), this.rng.range(2600, 5200), this.rng.range(0.012, 0.026))
    }
  }

  private fireTick(): void {
    this.tick(0, this.rng.range(900, 2400), this.rng.range(0.006, 0.016))
  }

  /** One unvoiced noise click. Untracked: too short to need voice stealing. */
  private tick(delay: number, frequency: number, volume: number): void {
    const audio = this.ready()
    if (!audio || !this.noiseBuffer) return
    const { context } = audio
    const start = context.currentTime + delay
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    source.playbackRate.value = this.rng.range(0.8, 1.3)
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = frequency
    filter.Q.value = 1.4
    const gain = context.createGain()
    gain.gain.setValueAtTime(volume, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.035)
    source.connect(filter).connect(gain).connect(this.ambientGain ?? audio.master)
    source.start(start, this.rng.range(0, 1.5))
    source.stop(start + 0.04)
    this.releaseWhenEnded(source, [filter, gain])
  }

  /** Sine with a quick strike and ring-out, like a struck wooden bar. */
  private chime(frequency: number, delay: number, volume: number): void {
    const audio = this.ready()
    if (!audio) return
    const { context } = audio
    const start = context.currentTime + delay
    const tone = context.createOscillator()
    tone.type = 'sine'
    tone.frequency.value = frequency
    const overtone = context.createOscillator()
    overtone.type = 'sine'
    overtone.frequency.value = frequency * 3.98
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9)
    const overtoneGain = context.createGain()
    overtoneGain.gain.setValueAtTime(volume * 0.25, start)
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12)
    tone.connect(gain).connect(audio.master)
    overtone.connect(overtoneGain).connect(audio.master)
    tone.start(start)
    overtone.start(start)
    tone.stop(start + 0.92)
    overtone.stop(start + 0.14)
    this.releaseWhenEnded(tone, [gain])
    this.releaseWhenEnded(overtone, [overtoneGain])
  }

  /** Two to four quick rising whistles, quiet and far away. */
  private birdsong(): void {
    const audio = this.ready()
    if (!audio || !this.ambientGain) return
    const { context } = audio
    const base = this.rng.range(2500, 3900)
    const notes = this.rng.int(2, 4)
    let at = context.currentTime
    for (let i = 0; i < notes; i++) {
      const length = this.rng.range(0.05, 0.11)
      const from = base * this.rng.range(0.92, 1.08)
      const tone = context.createOscillator()
      tone.type = 'sine'
      tone.frequency.setValueAtTime(from, at)
      tone.frequency.exponentialRampToValueAtTime(from * this.rng.range(1.15, 1.45), at + length)
      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      // The ambient bus sits at ~0.024, so this lands near 0.015 at the master.
      gain.gain.exponentialRampToValueAtTime(0.6, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
      tone.connect(gain).connect(this.ambientGain)
      tone.start(at)
      tone.stop(at + length + 0.01)
      this.releaseWhenEnded(tone, [gain])
      at += length + this.rng.range(0.03, 0.09)
    }
  }

  /** A three-pulse cricket chirp. */
  private cricket(): void {
    const audio = this.ready()
    if (!audio || !this.ambientGain) return
    const { context } = audio
    const frequency = this.rng.chance(0.5) ? 4300 : 4750
    let at = context.currentTime
    for (let i = 0; i < 3; i++) {
      const tone = context.createOscillator()
      tone.type = 'sine'
      tone.frequency.value = frequency
      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.45, at + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.022)
      tone.connect(gain).connect(this.ambientGain)
      tone.start(at)
      tone.stop(at + 0.025)
      this.releaseWhenEnded(tone, [gain])
      at += 0.034
    }
  }

  private releaseWhenEnded(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    source.addEventListener('ended', () => {
      source.disconnect()
      for (const node of nodes) node.disconnect()
    }, { once: true })
  }

  private duckAmbient(): void {
    if (!this.context || !this.ambientGain) return
    const now = this.context.currentTime
    const gain = this.ambientGain.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(Math.max(gain.value, 0.0001), now)
    gain.exponentialRampToValueAtTime(0.012, now + 0.025)
    gain.exponentialRampToValueAtTime(0.024, now + 0.4)
  }

  private startAmbient(): void {
    const audio = this.ready()
    if (!audio || !this.noiseBuffer) return
    const { context } = audio
    const ambientGain = context.createGain()
    ambientGain.gain.value = 0.024
    ambientGain.connect(audio.master)
    this.ambientGain = ambientGain

    const wind = context.createBufferSource()
    wind.buffer = this.noiseBuffer
    wind.loop = true
    const windFilter = context.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.frequency.value = 360
    const windGain = context.createGain()
    windGain.gain.value = 0.34
    wind.connect(windFilter).connect(windGain).connect(ambientGain)

    const low = context.createOscillator()
    const high = context.createOscillator()
    low.type = high.type = 'sine'
    low.frequency.value = 54
    high.frequency.value = 54.7
    const toneGain = context.createGain()
    toneGain.gain.value = 0.08
    low.connect(toneGain)
    high.connect(toneGain)
    toneGain.connect(ambientGain)
    wind.start()
    low.start()
    high.start()
    this.ambientSources = [wind, low, high]
    this.ambientNodes = [windFilter, windGain, toneGain, ambientGain]
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = context.sampleRate * 2
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < length; index++) data[index] = this.rng.range(-1, 1)
    return buffer
  }

  private trackVoice(sources: AudioScheduledSourceNode[], nodes: AudioNode[], sustained = false): void {
    while (this.voices.length >= MAX_VOICES) {
      const victim = voiceToEvict(this.voices)
      if (!victim) break
      victim.stop()
    }
    let ended = 0
    let cleaned = false
    const voice: Voice = {
      sources,
      nodes,
      sustained,
      stop: () => {
        if (cleaned) return
        for (const source of sources) {
          try { source.stop() } catch { /* already stopped */ }
        }
        cleanup()
      },
    }
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      for (const source of sources) source.disconnect()
      for (const node of nodes) node.disconnect()
      const index = this.voices.indexOf(voice)
      if (index >= 0) this.voices.splice(index, 1)
    }
    for (const source of sources) {
      source.addEventListener('ended', () => {
        ended++
        if (ended === sources.length) cleanup()
      }, { once: true })
    }
    this.voices.push(voice)
  }
}

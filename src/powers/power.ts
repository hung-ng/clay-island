import type * as THREE from 'three'
import type { EventBus, PowerId, TargetKind } from '../core/events'
import type { RNG } from '../core/rng'
import type { Timeline } from '../core/timeline'
import type { ParticleBurst } from '../fx/particles'
import type { Shake } from '../fx/shake'
import type { Island } from '../world/island'
import type { World } from '../world/world'

export type PowerFx = {
  particles: ParticleBurst
  shake: Shake
  flash(color: string, seconds: number): void
}

export type PowerContext = {
  world: World
  island: Island
  scene: THREE.Scene
  fx: PowerFx
  bus: EventBus
  rng: RNG
  lowFx: boolean
  reducedMotion(): boolean
}

export type CastCtx = PowerContext & {
  x: number
  z: number
  kind: TargetKind
  power: PowerId
}

/** Resolve mutable world state at the instant a delayed power actually lands. */
export function impactContext(ctx: CastCtx): CastCtx {
  return { ...ctx, kind: ctx.world.resolveTarget(ctx.x, ctx.z) }
}

export interface Power {
  readonly id: PowerId
  readonly cooldown: number
  cast(ctx: CastCtx): Timeline
}

export class PowerManager {
  private readonly powers = new Map<PowerId, Power>()
  private readonly cooldowns = new Map<PowerId, number>()
  private timelines: Timeline[] = []

  constructor(powers: readonly Power[], private readonly context: PowerContext) {
    for (const power of powers) {
      this.powers.set(power.id, power)
      this.cooldowns.set(power.id, 0)
    }
  }

  get effectsActive(): boolean { return this.timelines.length > 0 }

  cast(id: PowerId, x: number, z: number): void {
    const power = this.powers.get(id)
    if (!power || !this.ready(id)) return
    const kind = this.context.world.resolveTarget(x, z)
    this.timelines.push(power.cast({ ...this.context, x, z, kind, power: id }))
    this.cooldowns.set(id, power.cooldown)
  }

  ready(id: PowerId): boolean {
    return this.powers.has(id) && (this.cooldowns.get(id) ?? 0) <= 0
  }

  cooldown01(id: PowerId): number {
    const power = this.powers.get(id)
    if (!power) return 0
    return Math.max(0, Math.min(1, (this.cooldowns.get(id) ?? 0) / power.cooldown))
  }

  update(dt: number): void {
    for (const [id, remaining] of this.cooldowns) {
      this.cooldowns.set(id, Math.max(0, remaining - dt))
    }
    for (const timeline of this.timelines) timeline.update(dt)
    this.timelines = this.timelines.filter(timeline => !timeline.done)
  }
}

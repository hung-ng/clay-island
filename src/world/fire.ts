import type { RNG } from '../core/rng'

export const FIRE_CONFIG = {
  spreadRadius: 3.0,
  spreadChancePerSec: 0.35,
  burnSeconds: 12,
  hutBurnSeconds: 16,
  douseRadius: 4,
} as const

export type FlammableKind = 'tree' | 'hut' | 'campfire'

export type Flammable = {
  id: string
  x: number
  z: number
  kind: FlammableKind
  burning: boolean
  burnt: boolean
  burnTime: number
}

export type FireEvent =
  | { type: 'ignited'; id: string; kind: FlammableKind }
  | { type: 'burnt'; id: string; kind: Exclude<FlammableKind, 'campfire'> }
  | { type: 'doused'; id: string; kind: FlammableKind }

function burnDuration(item: Flammable): number {
  return item.kind === 'hut' ? FIRE_CONFIG.hutBurnSeconds : FIRE_CONFIG.burnSeconds
}

function healthy(item: Flammable): boolean {
  return !item.burning && !item.burnt
}

export class FireSystem {
  update(dt: number, items: Flammable[], rng: RNG): FireEvent[] {
    if (dt <= 0) return []
    const events: FireEvent[] = []

    for (const item of items) {
      if (!item.burning || item.burnt || item.kind === 'campfire') continue
      item.burnTime += dt
      if (item.burnTime < burnDuration(item)) continue
      item.burning = false
      item.burnt = true
      events.push({ type: 'burnt', id: item.id, kind: item.kind })
    }

    // Snapshot sources so something ignited this frame cannot chain-spread until
    // the next simulation step.
    const sources = items.filter(item => item.burning && !item.burnt)
    for (const source of sources) {
      for (const target of items) {
        if (target === source || !healthy(target)) continue
        if (Math.hypot(target.x - source.x, target.z - source.z) > FIRE_CONFIG.spreadRadius) continue
        if (!rng.chance(FIRE_CONFIG.spreadChancePerSec * dt)) continue
        target.burning = true
        target.burnTime = 0
        events.push({ type: 'ignited', id: target.id, kind: target.kind })
      }
    }

    return events
  }

  douse(
    x: number,
    z: number,
    items: Flammable[],
    radius: number = FIRE_CONFIG.douseRadius,
  ): FireEvent[] {
    const events: FireEvent[] = []
    for (const item of items) {
      if (!item.burning || item.burnt) continue
      if (Math.hypot(item.x - x, item.z - z) > radius) continue
      item.burning = false
      item.burnTime = 0
      events.push({ type: 'doused', id: item.id, kind: item.kind })
    }
    return events
  }
}

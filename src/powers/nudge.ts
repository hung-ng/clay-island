import * as THREE from 'three'
import { RNG } from '../core/rng'
import { Timeline } from '../core/timeline'
import { PALETTE } from '../ui/tokens'
import type { SuggestionKind } from '../villagers/fsm'
import { MAX_HUTS } from '../world/world'
import { resolveInteraction } from './matrix'
import { applyInteractions } from './outcomes'
import { Power, type CastCtx } from './power'

type Ripple = {
  start(): void
  remove(): void
}

export type GroundNudgeCtx = {
  needsFire: boolean
  living: number
  capacity: number
  huts: number
  buildable: boolean
  /** A founded site nobody has finished yet. One at a time. */
  pendingSite: boolean
  treesNear: number
  pondNear: boolean
  rng: RNG
}

/**
 * Ground-nudge means one thing — *tend to this spot* — and both the village's
 * needs and the ground itself decide the outcome.
 *
 * This is a weighted roll, not a ladder. A ladder made `build` the deterministic
 * winner: capacity is 2 x built huts, so a starting village is already "full",
 * and every nudge founded a hut until the cap. Rolling keeps the growth valve
 * meaningful while letting the place speak — nudge a stand of trees and they
 * are likely to chop, nudge the shore and they are likely to fish.
 */
export function groundNudge(ctx: GroundNudgeCtx): SuggestionKind {
  // Unbuildable ground carries no meaning beyond "stand here".
  if (!ctx.buildable) return 'gather'
  // No fire is an emergency, not a preference. It skips the roll.
  if (ctx.needsFire) return 'makeFire'

  const options: { kind: SuggestionKind; weight: number }[] = [
    { kind: 'gather', weight: 2 },
  ]
  // The growth valve: a new home only when the old ones are full, the cap has
  // room, and no founded site is already standing empty.
  const pressed = ctx.living >= ctx.capacity
    && ctx.huts < MAX_HUTS
    && !ctx.pendingSite
  if (pressed) options.push({ kind: 'build', weight: 5 })
  if (ctx.treesNear > 0) {
    options.push({ kind: 'chop', weight: Math.min(3, ctx.treesNear) + 1 })
  }
  if (ctx.pondNear) options.push({ kind: 'fish', weight: 3 })

  const total = options.reduce((sum, option) => sum + option.weight, 0)
  let roll = ctx.rng.next() * total
  for (const option of options) {
    roll -= option.weight
    if (roll < 0) return option.kind
  }
  return 'gather'
}

function pokeRipple(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
): Ripple {
  const geometry = new THREE.RingGeometry(0.32, 0.48, 36)
  const material = new THREE.MeshBasicMaterial({
    color: PALETTE.paper,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.name = 'nudge-poke-ripple'
  ring.frustumCulled = false
  ring.position.set(x, y + 0.08, z)
  ring.rotation.x = -Math.PI / 2
  ring.scale.setScalar(0.2)
  ring.visible = false
  parent.add(ring)

  let startedAt = Number.POSITIVE_INFINITY
  let removed = false
  ring.onBeforeRender = () => {
    if (!Number.isFinite(startedAt) || removed) return
    const progress = Math.min(1, (performance.now() - startedAt) / 950)
    ring.scale.setScalar(THREE.MathUtils.lerp(0.2, 4.6, 1 - (1 - progress) ** 2))
    material.opacity = (1 - progress) * 0.78
  }

  return {
    start: () => {
      startedAt = performance.now()
      ring.visible = true
    },
    remove: () => {
      if (removed) return
      removed = true
      parent.remove(ring)
      geometry.dispose()
      material.dispose()
    },
  }
}

export class Nudge extends Power {
  readonly id = 'nudge' as const
  readonly cooldown = 2

  cast(ctx: CastCtx): Timeline {
    const y0 = ctx.island.sampleHeight(ctx.x, ctx.z)
    const ripple = pokeRipple(ctx.island.group, ctx.x, y0, ctx.z)

    return new Timeline()
      .at(0, () => {
        ctx.bus.emit({ type: 'power:anticipate', power: this.id, x: ctx.x, z: ctx.z })
        ripple.start()
      })
      .at(0.25, () => {
        applyInteractions(resolveInteraction(this.id, ctx.kind), ctx, y0)
        ctx.bus.emit({
          type: 'power:impact', power: this.id, target: ctx.kind, x: ctx.x, z: ctx.z,
        })
      })
      .at(1.2, () => ripple.remove())
  }
}

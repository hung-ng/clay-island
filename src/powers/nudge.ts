import * as THREE from 'three'
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

/**
 * Ground-nudge means one thing — tend to this spot — and the village's own
 * needs decide the outcome. No mode, no menu. First match wins.
 */
export function groundNudge(ctx: {
  needsFire: boolean
  living: number
  capacity: number
  huts: number
  buildable: boolean
}): SuggestionKind {
  if (!ctx.buildable) return 'gather'
  if (ctx.needsFire) return 'makeFire'
  if (ctx.living >= ctx.capacity && ctx.huts < MAX_HUTS) return 'build'
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

import { PALETTE } from '../ui/tokens'
import type { Interaction, InteractionKind } from './matrix'
import type { CastCtx } from './power'

export const OUTCOME_HANDLERS: Record<
  InteractionKind,
  (ctx: CastCtx, y0: number) => void
> = {
  ignite: (ctx) => {
    if (ctx.kind === 'tree' || ctx.kind === 'hut') {
      ctx.world.igniteTarget(ctx.kind, ctx.x, ctx.z)
    }
  },
  destroy: (ctx) => {
    if (ctx.kind === 'tree' || ctx.kind === 'hut') {
      ctx.world.destroyTarget(ctx.kind, ctx.x, ctx.z)
    }
  },
  kill: (ctx) => {
    ctx.world.killVillagerNear(
      ctx.x,
      ctx.z,
      3,
      ctx.power === 'meteor' ? 'meteor' : 'lightning',
    )
  },
  zap: (ctx) => { ctx.world.villagerAt(ctx.x, ctx.z, 1.2)?.zap() },
  scatter: (ctx) => { ctx.world.scatterCampfire() },
  emptyPond: (ctx) => { ctx.world.emptyPondAt(ctx.x, ctx.z) },
  steam: (ctx, y0) => {
    ctx.fx.particles.burst({
      x: ctx.x,
      y: y0 + ctx.island.group.position.y,
      z: ctx.z,
      n: 36,
      color: PALETTE.cloud,
      speed: 2.2,
      gravity: -0.35,
      size: 1.8,
      life: 1.5,
    })
  },
  floatFish: (ctx) => {
    const pond = ctx.world.pondAt(ctx.x, ctx.z)
    if (pond?.floatFish()) ctx.bus.emit({ type: 'fish:floated' })
  },
  flare: (ctx) => {
    ctx.world.campfire.flare(2, 3)
    ctx.bus.emit({ type: 'campfire:flared' })
  },
  growFruit: (ctx) => { ctx.world.growFruitNear(ctx.x, ctx.z, 4) },
  grumpy: (ctx) => { ctx.world.grumpNear(ctx.x, ctx.z, 4) },
}

export function applyInteractions(
  interactions: readonly Interaction[],
  ctx: CastCtx,
  y0: number,
): void {
  for (const interaction of interactions) OUTCOME_HANDLERS[interaction.kind](ctx, y0)
}

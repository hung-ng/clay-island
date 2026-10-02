import { PALETTE } from '../ui/tokens'
import type { SuggestionKind } from '../villagers/fsm'
import { isBuildable } from '../world/terrain'
import type { InteractionKind } from './matrix'
import { groundNudge } from './nudge'
import type { CastCtx } from './power'
import { gustDirection } from './wind'

/** How far a ground nudge "sees" when deciding what the place is for. */
const NUDGE_SENSE_RADIUS = 5

type ResolvedSuggestion = { kind: SuggestionKind; targetId?: string }

function suggestionFor(ctx: CastCtx): ResolvedSuggestion | null {
  switch (ctx.kind) {
    case 'tree': {
      const tree = ctx.world.actionableTreeAt(ctx.x, ctx.z)
      return tree ? { kind: tree.hasFruit ? 'harvest' : 'chop', targetId: tree.id } : null
    }
    case 'pond': {
      const pond = ctx.world.pondAt(ctx.x, ctx.z)
      return pond ? { kind: pond.hasFish ? 'fish' : 'drink' } : null
    }
    case 'hut': return { kind: 'build' }
    case 'campfire': return { kind: 'gather' }
    case 'ground': {
      const buildable = isBuildable(
        ctx.x,
        ctx.z,
        ctx.world.groundQuery(),
        (x, z) => ctx.island.sampleHeight(x, z),
      )
      const kind = groundNudge({
        needsFire: ctx.world.needsFire(),
        living: ctx.world.living(),
        capacity: ctx.world.capacity(),
        huts: ctx.world.huts.filter(hut => hut.state !== 'abandoned').length,
        buildable,
        pendingSite: ctx.world.pendingSite(),
        treesNear: ctx.world.treesNear(ctx.x, ctx.z, NUDGE_SENSE_RADIUS),
        fruitTreesNear: ctx.world.fruitTreesNear(ctx.x, ctx.z, NUDGE_SENSE_RADIUS),
        pondNear: ctx.world.pondNear(ctx.x, ctx.z, NUDGE_SENSE_RADIUS),
        stockedPondNear: ctx.world.stockedPondNear(
          ctx.x,
          ctx.z,
          NUDGE_SENSE_RADIUS,
        ),
        rng: ctx.rng,
      })
      // A ground nudge that resolves to `build` must create the site to build on.
      if (kind === 'build') ctx.world.foundHutAt(ctx.x, ctx.z, ctx.rng, ctx.lowFx)
      return { kind }
    }
    default: return null
  }
}

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
  scatter: (ctx, y0) => {
    if (ctx.kind === 'hut') {
      ctx.fx.particles.burst({
        x: ctx.x,
        y: y0 + 1.1,
        z: ctx.z,
        n: ctx.lowFx ? 6 : 14,
        color: PALETTE.dirt,
        speed: 1.6,
        gravity: 6,
        size: 0.5,
        life: 0.6,
      })
      return
    }
    ctx.world.scatterCampfire()
  },
  emptyPond: (ctx) => { ctx.world.emptyPondAt(ctx.x, ctx.z) },
  steam: (ctx, y0) => {
    ctx.fx.particles.burst({
      x: ctx.x,
      y: y0,
      z: ctx.z,
      n: 36,
      color: PALETTE.cloud,
      speed: 2.2,
      gravity: -0.35,
      size: 1.8,
      life: 1.5,
    })
  },
  stunFish: (ctx) => {
    const pond = ctx.world.pondAt(ctx.x, ctx.z)
    if (pond?.stunFish()) ctx.bus.emit({ type: 'fish:floated' })
  },
  flare: (ctx) => {
    ctx.world.campfire.flare(2, 3)
    ctx.bus.emit({ type: 'campfire:flared' })
  },
  growFruit: (ctx) => { ctx.world.growFruitNear(ctx.x, ctx.z, 4) },
  grumpy: (ctx) => { ctx.world.grumpNear(ctx.x, ctx.z, 4) },
  suggest: (ctx) => {
    const suggestion = suggestionFor(ctx)
    if (!suggestion) return
    if (suggestion.targetId) {
      ctx.world.suggest(ctx.x, ctx.z, suggestion.kind, suggestion.targetId)
    } else {
      ctx.world.suggest(ctx.x, ctx.z, suggestion.kind)
    }
  },
  startleVillager: (ctx) => {
    ctx.world.villagerAt(ctx.x, ctx.z, 1.2)?.emote('question')
  },
  tumble: (ctx) => {
    const direction = gustDirection(ctx.x, ctx.z)
    ctx.world.villagerAt(ctx.x, ctx.z, 1.2)?.tumble({
      x: ctx.x - direction.x * 2,
      z: ctx.z - direction.z * 2,
    })
  },
}

export function applyInteractions(
  interactions: readonly InteractionKind[],
  ctx: CastCtx,
  y0: number,
): void {
  for (const kind of interactions) OUTCOME_HANDLERS[kind](ctx, y0)
}

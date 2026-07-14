import type { GameEvent } from '../core/events'
import { PALETTE } from '../ui/tokens'

export type MomentId =
  | 'fishing-hole'
  | 'flash-fry'
  | 'first-bloom'
  | 'ghost-story'
  | 'drained'
  | 'new-pond'
  | 'gone-fishing'
  | 'wildfire'
  | 'firefighter'
  | 'homewrecker'
  | 'they-rebuild'
  | 'respects-paid'
  | 'village-grows'
  | 'close-call'
  | 'fed'

export type Moment = { id: MomentId; title: string; hint: string; color: string }

export const MOMENTS: readonly Moment[] = [
  {
    id: 'fishing-hole', title: 'Fishing Hole',
    hint: 'Electricity and water. What could go wrong.', color: PALETTE.water,
  },
  {
    id: 'flash-fry', title: 'Flash Fry',
    hint: 'The fire was already lit. It could be more lit.', color: PALETTE.flame,
  },
  {
    id: 'first-bloom', title: 'First Bloom',
    hint: 'Something grows where nothing happened.', color: PALETTE.bloom,
  },
  {
    id: 'ghost-story', title: 'Ghost Story',
    hint: 'They keep coming back. Sort of.', color: PALETTE.ghost,
  },
  {
    id: 'drained', title: 'Drained',
    hint: 'You made it. You can unmake it.', color: PALETTE.stone,
  },
  {
    id: 'new-pond', title: 'Watering Hole',
    hint: 'Make a hole. Then fill it.', color: PALETTE.water,
  },
  {
    id: 'gone-fishing', title: 'Gone Fishing',
    hint: 'Give them a pond and see what happens.', color: PALETTE.smockB,
  },
  {
    id: 'wildfire', title: 'Wildfire',
    hint: "You lit one. It didn't stop at one.", color: PALETTE.ember,
  },
  {
    id: 'firefighter', title: 'Firefighter',
    hint: 'Second thoughts.', color: PALETTE.skyHigh,
  },
  {
    id: 'homewrecker', title: 'Homewrecker',
    hint: "That was somebody's house.", color: PALETTE.hutClay,
  },
  {
    id: 'they-rebuild', title: 'They Rebuild',
    hint: 'You broke it. They fixed it.', color: PALETTE.smockC,
  },
  {
    id: 'respects-paid', title: 'Respects Paid',
    hint: 'Someone remembers.', color: PALETTE.stone,
  },
  {
    id: 'village-grows', title: 'The Village Grows',
    hint: 'Nudge open ground when there is nowhere left to sleep.',
    color: PALETTE.hutClay,
  },
  {
    id: 'close-call', title: 'Close Call',
    hint: 'They ran. It landed. They lived.', color: PALETTE.smockA,
  },
  {
    id: 'fed', title: 'Fed',
    hint: 'Rain, a tree, and someone hungry.', color: PALETTE.leafB,
  },
] as const

const STORAGE_KEY = 'tinygod.moments'
const MOMENT_IDS = new Set<string>(MOMENTS.map(moment => moment.id))
const CRATER_MATCH_RADIUS = 2.5

export interface JournalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type MomentState = {
  deaths: number
  craters: { x: number; z: number }[]
}

export class Journal {
  private readonly unlockedSet = new Set<MomentId>()
  private readonly state: MomentState = { deaths: 0, craters: [] }

  constructor(private readonly storage: JournalStorage | null = null) {
    this.load()
  }

  get unlocked(): ReadonlySet<MomentId> { return this.unlockedSet }
  has(id: MomentId): boolean { return this.unlockedSet.has(id) }
  count(): number { return this.unlockedSet.size }

  observe(event: GameEvent): Moment | null {
    const id = this.match(event)
    if (!id || this.unlockedSet.has(id)) return null
    this.unlockedSet.add(id)
    this.save()
    return MOMENTS.find(moment => moment.id === id) ?? null
  }

  reset(): void {
    this.unlockedSet.clear()
    this.state.deaths = 0
    this.state.craters.length = 0
    this.save()
  }

  private match(event: GameEvent): MomentId | null {
    switch (event.type) {
      case 'power:impact':
        return event.power === 'lightning' && event.target === 'pond' ? 'fishing-hole' : null
      case 'campfire:flared': return 'flash-fry'
      case 'flower:bloomed': return 'first-bloom'
      case 'villager:fished': return 'gone-fishing'
      case 'hut:rebuilt': return 'they-rebuild'
      case 'villager:mourned': return 'respects-paid'
      case 'village:grew': return 'village-grows'
      case 'villager:escaped': return 'close-call'
      case 'villager:ate': return 'fed'
      case 'burnt': return event.kind === 'hut' ? 'homewrecker' : null
      case 'villager:died':
        this.state.deaths++
        return this.state.deaths >= 3 ? 'ghost-story' : null
      // `bySpread` is the lesson: fire jumps from tree to tree on its own.
      // The old `burning >= 5` was a body count, and taught nothing.
      case 'fire:ignited': return event.bySpread ? 'wildfire' : null
      case 'fire:doused': return event.burning >= 3 ? 'firefighter' : null
      case 'pond:emptied': return 'drained'
      case 'crater:created':
        this.state.craters.push({ x: event.x, z: event.z })
        return null
      case 'pond:created':
        return this.state.craters.some(crater => (
          Math.hypot(crater.x - event.x, crater.z - event.z) <= CRATER_MATCH_RADIUS
        )) ? 'new-pond' : null
      default: return null
    }
  }

  private load(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      for (const id of parsed) {
        if (typeof id === 'string' && MOMENT_IDS.has(id)) this.unlockedSet.add(id as MomentId)
      }
    } catch {
      // Corrupt or inaccessible storage yields an empty journal, not a broken game.
    }
  }

  private save(): void {
    if (!this.storage) return
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.unlockedSet]))
    } catch {
      // The game stays playable in private browsing or when storage is full.
    }
  }
}

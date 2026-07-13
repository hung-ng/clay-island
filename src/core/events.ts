export type PowerId = 'meteor' | 'lightning' | 'rain'
export type TargetKind = 'ground' | 'tree' | 'hut' | 'villager' | 'pond' | 'crater' | 'campfire'

// Events carrying `x`/`z` do so because the discovery system (Task 17) needs to
// correlate them in SPACE, not just in time — e.g. "Watering Hole" = a pond created
// where a crater was created. `burning` counts ride along for the "Wildfire" (5+ at
// once) and "Firefighter" (doused while 3+ burning) Moments. Add the field when a
// Moment needs it; don't speculatively attach data to every event.
export type GameEvent =
  | { type: 'power:anticipate'; power: PowerId; x: number; z: number }
  | { type: 'power:impact'; power: PowerId; target: TargetKind; x: number; z: number }
  | { type: 'fire:ignited'; kind: 'tree' | 'hut' | 'campfire'; bySpread: boolean; burning: number }
  | { type: 'fire:doused'; byRain: boolean; burning: number }
  | { type: 'burnt'; kind: 'tree' | 'hut' }
  | { type: 'villager:died'; cause: 'meteor' | 'lightning' }
  | { type: 'villager:mourned' }
  | { type: 'villager:fished' }
  | { type: 'hut:rebuilt' }
  | { type: 'crater:created'; x: number; z: number }
  | { type: 'pond:created'; x: number; z: number }
  | { type: 'pond:emptied' }
  | { type: 'fish:floated' }
  | { type: 'flower:bloomed' }
  | { type: 'fruit:grown'; treeId: string }   // "Full Harvest" = 4+ DISTINCT trees
  | { type: 'campfire:flared' }

export class EventBus {
  private handlers = new Set<(e: GameEvent) => void>()
  on(h: (e: GameEvent) => void): () => void { this.handlers.add(h); return () => { this.handlers.delete(h) } }
  emit(e: GameEvent): void { for (const h of [...this.handlers]) h(e) }
}

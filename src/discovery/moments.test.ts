import { describe, it, expect } from 'vitest'
import type { GameEvent } from '../core/events'
import { Journal, MOMENTS, type JournalStorage } from './moments'

function memoryStorage(initial: Record<string, string> = {}): JournalStorage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
  }
}

const lightningPond: GameEvent = {
  type: 'power:impact', power: 'lightning', target: 'pond', x: 0, z: 0,
}

describe('MOMENTS', () => {
  it('has exactly 15 moments with unique ids', () => {
    expect(MOMENTS).toHaveLength(15)
    expect(new Set(MOMENTS.map(moment => moment.id)).size).toBe(15)
  })

  it('every moment has a title and a hint', () => {
    for (const moment of MOMENTS) {
      expect(moment.title.length).toBeGreaterThan(0)
      expect(moment.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('Journal.observe', () => {
  it('unlocks fishing-hole on lightning + pond', () => {
    const journal = new Journal(memoryStorage())
    expect(journal.observe(lightningPond)?.id).toBe('fishing-hole')
    expect(journal.has('fishing-hole')).toBe(true)
    expect(journal.count()).toBe(1)
  })

  it('does not unlock fishing-hole on lightning + tree', () => {
    const journal = new Journal(memoryStorage())
    const event: GameEvent = {
      type: 'power:impact', power: 'lightning', target: 'tree', x: 0, z: 0,
    }
    expect(journal.observe(event)).toBeNull()
    expect(journal.count()).toBe(0)
  })

  it('unlocking twice is a no-op and returns null the second time', () => {
    const journal = new Journal(memoryStorage())
    expect(journal.observe(lightningPond)).not.toBeNull()
    expect(journal.observe(lightningPond)).toBeNull()
    expect(journal.count()).toBe(1)
  })

  it('ghost-story needs three deaths, not two', () => {
    const journal = new Journal(memoryStorage())
    const died: GameEvent = { type: 'villager:died', cause: 'meteor' }
    expect(journal.observe(died)).toBeNull()
    expect(journal.observe(died)).toBeNull()
    expect(journal.observe(died)?.id).toBe('ghost-story')
  })

  it('no longer carries Full Harvest, which only ever duplicated Fed', () => {
    expect(MOMENTS.map(moment => moment.id)).not.toContain('full-harvest')
  })

  it('unlocks Wildfire when fire jumps, not when a body count is hit', () => {
    const journal = new Journal(memoryStorage())

    expect(journal.observe({
      type: 'fire:ignited', kind: 'tree', bySpread: false, burning: 9,
    })).toBeNull()
    expect(journal.observe({
      type: 'fire:ignited', kind: 'tree', bySpread: true, burning: 2,
    })?.id).toBe('wildfire')
  })

  it('unlocks Drained when a pond is emptied', () => {
    const journal = new Journal(memoryStorage())
    expect(journal.observe({ type: 'pond:emptied' })?.id).toBe('drained')
  })

  it('unlocks Fed when a villager eats', () => {
    const journal = new Journal(memoryStorage())
    expect(journal.observe({ type: 'villager:ate' })?.id).toBe('fed')
  })

  it('firefighter needs a douse while three or more were burning', () => {
    const journal = new Journal(memoryStorage())
    expect(journal.observe({ type: 'fire:doused', byRain: true, burning: 2 })).toBeNull()
    expect(journal.observe({ type: 'fire:doused', byRain: true, burning: 3 })?.id)
      .toBe('firefighter')
  })

  it('new-pond needs a pond created where a crater was, not anywhere', () => {
    const journal = new Journal(memoryStorage())
    journal.observe({ type: 'crater:created', x: 5, z: 5 })
    expect(journal.observe({ type: 'pond:created', x: -8, z: -8 })).toBeNull()
    expect(journal.observe({ type: 'pond:created', x: 5.4, z: 4.7 })?.id).toBe('new-pond')
  })

  it('unlocks the simple one-shot moments from their own event', () => {
    const cases: [GameEvent, string][] = [
      [{ type: 'flower:bloomed' }, 'first-bloom'],
      [{ type: 'villager:fished' }, 'gone-fishing'],
      [{ type: 'burnt', kind: 'hut' }, 'homewrecker'],
      [{ type: 'hut:rebuilt' }, 'they-rebuild'],
      [{ type: 'villager:mourned' }, 'respects-paid'],
      [{ type: 'campfire:flared' }, 'flash-fry'],
    ]
    for (const [event, id] of cases) {
      const journal = new Journal(memoryStorage())
      expect(journal.observe(event)?.id, `${event.type} should unlock ${id}`).toBe(id)
    }
  })

  it('burnt tree does not unlock homewrecker', () => {
    const journal = new Journal(memoryStorage())
    expect(journal.observe({ type: 'burnt', kind: 'tree' })).toBeNull()
  })

  it.each([
    [{ type: 'village:grew' }, 'village-grows'],
    [{ type: 'villager:escaped' }, 'close-call'],
    [{ type: 'villager:ate' }, 'fed'],
  ] as const)('unlocks %s as %s', (event, id) => {
    const journal = new Journal(memoryStorage())
    expect(journal.observe(event)?.id).toBe(id)
  })
})

describe('Journal persistence', () => {
  it('persists unlocks to storage and reloads them', () => {
    const storage = memoryStorage()
    const first = new Journal(storage)
    first.observe(lightningPond)
    const second = new Journal(storage)
    expect(second.has('fishing-hole')).toBe(true)
    expect(second.count()).toBe(1)
  })

  it('survives a corrupt stored value without throwing', () => {
    const journal = new Journal(memoryStorage({ 'clayisland.moments': '{{{not json' }))
    expect(journal.count()).toBe(0)
    expect(() => journal.observe(lightningPond)).not.toThrow()
  })

  it('survives a stored value of the wrong shape', () => {
    const journal = new Journal(memoryStorage({ 'clayisland.moments': '{"nope":true}' }))
    expect(journal.count()).toBe(0)
  })

  it('ignores unknown ids in storage', () => {
    const journal = new Journal(memoryStorage({
      'clayisland.moments': '["fishing-hole","full-harvest","not-a-moment"]',
    }))
    expect(journal.count()).toBe(1)
    expect(journal.has('fishing-hole')).toBe(true)
  })

  it('reset clears everything', () => {
    const storage = memoryStorage()
    const journal = new Journal(storage)
    journal.observe(lightningPond)
    journal.reset()
    expect(journal.count()).toBe(0)
    expect(new Journal(storage).count()).toBe(0)
  })
})

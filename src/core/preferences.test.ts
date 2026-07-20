import { describe, expect, it } from 'vitest'
import { Preferences, type PreferenceStorage } from './preferences'

class MemoryStorage implements PreferenceStorage {
  values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('Preferences', () => {
  it('uses safe defaults for absent and corrupt values', () => {
    const storage = new MemoryStorage()
    storage.values.set('clayisland.visualQuality', 'ultra')
    storage.values.set('clayisland.autoRotate', 'perhaps')
    storage.values.set('clayisland.introSeen', '1')
    expect(new Preferences(storage, '').snapshot).toEqual({
      quality: 'enhanced', lowFx: false, forcedLowFx: false,
      autoRotate: true, reducedMotion: false, introSeen: false,
      timeOfDay: 'auto', dayCount: 1,
    })
  })

  it('uses the OS motion preference only when no valid stored choice exists', () => {
    const storage = new MemoryStorage()
    expect(new Preferences(storage, '', true).snapshot.reducedMotion).toBe(true)
    expect(new Preferences(storage, '', false).snapshot.reducedMotion).toBe(false)

    storage.values.set('clayisland.reducedMotion', 'perhaps')
    expect(new Preferences(storage, '', true).snapshot.reducedMotion).toBe(true)
  })

  it('lets an explicit reduced-motion choice override the OS and survive reload', () => {
    const storage = new MemoryStorage()
    const preferences = new Preferences(storage, '', true)
    preferences.setReducedMotion(false)

    expect(preferences.snapshot.reducedMotion).toBe(false)
    expect(storage.values.get('clayisland.reducedMotion')).toBe('false')
    expect(new Preferences(storage, '', true).snapshot.reducedMotion).toBe(false)
  })

  it('keeps reduced motion session-local when storage writes fail', () => {
    const storage: PreferenceStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('blocked') },
    }
    const preferences = new Preferences(storage, '', false)
    preferences.setReducedMotion(true)
    expect(preferences.snapshot.reducedMotion).toBe(true)
  })

  it('lets the lowfx query force and lock reduced quality', () => {
    const storage = new MemoryStorage()
    storage.values.set('clayisland.visualQuality', 'enhanced')
    const preferences = new Preferences(storage, '?lowfx=1')
    expect(preferences.snapshot).toMatchObject({
      quality: 'reduced', lowFx: true, forcedLowFx: true,
    })
    expect(preferences.setQuality('enhanced')).toBe(false)
  })

  it('persists quality and updates session preferences', () => {
    const storage = new MemoryStorage()
    const preferences = new Preferences(storage, '')
    expect(preferences.setQuality('reduced')).toBe(true)
    preferences.setAutoRotate(false)
    preferences.markIntroSeen()
    expect(new Preferences(storage, '').snapshot).toMatchObject({
      quality: 'reduced', lowFx: true, autoRotate: false, introSeen: true,
    })
  })

  it('keeps session-only values but reports a failed durable quality write', () => {
    const storage: PreferenceStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('blocked') },
    }
    const preferences = new Preferences(storage, '')
    expect(preferences.setQuality('reduced')).toBe(false)
    preferences.setAutoRotate(false)
    preferences.markIntroSeen()
    expect(preferences.snapshot).toMatchObject({ autoRotate: false, introSeen: true })
  })
})

describe('timeOfDay preference', () => {
  it('defaults to auto when nothing is stored', () => {
    const preferences = new Preferences(null, '')
    expect(preferences.snapshot.timeOfDay).toBe('auto')
  })

  it('accepts only day and night as stored overrides', () => {
    const storage = new MemoryStorage()
    storage.values.set('clayisland.timeOfDay', 'night')
    expect(new Preferences(storage, '').snapshot.timeOfDay).toBe('night')

    storage.values.set('clayisland.timeOfDay', 'noon')
    expect(new Preferences(storage, '').snapshot.timeOfDay).toBe('auto')
  })

  it('persists the mode and stays session-local when storage is unavailable', () => {
    const storage = new MemoryStorage()
    const preferences = new Preferences(storage, '')
    preferences.setTimeOfDay('day')
    expect(storage.getItem('clayisland.timeOfDay')).toBe('day')

    const blocked = new Preferences(null, '')
    blocked.setTimeOfDay('night')
    expect(blocked.snapshot.timeOfDay).toBe('night')
  })
})

describe('day count', () => {
  it('defaults to 1 for absent or corrupt values', () => {
    expect(new Preferences(null, '').snapshot.dayCount).toBe(1)
    const storage = new MemoryStorage()
    storage.values.set('clayisland.dayCount', 'twelve')
    expect(new Preferences(storage, '').snapshot.dayCount).toBe(1)
    storage.values.set('clayisland.dayCount', '0')
    expect(new Preferences(storage, '').snapshot.dayCount).toBe(1)
  })

  it('persists the count and survives reload', () => {
    const storage = new MemoryStorage()
    new Preferences(storage, '').setDayCount(12)
    expect(storage.values.get('clayisland.dayCount')).toBe('12')
    expect(new Preferences(storage, '').snapshot.dayCount).toBe(12)
  })

  it('stays session-local when storage writes fail', () => {
    const blocked: PreferenceStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('blocked') },
    }
    const preferences = new Preferences(blocked, '')
    preferences.setDayCount(4)
    expect(preferences.snapshot.dayCount).toBe(4)
  })
})

import { describe, expect, it } from 'vitest'
import { createInitialWorldBlueprint, INITIAL_HANDOFF_FRAME } from './blueprint'

describe('initial world blueprint', () => {
  const blueprint = createInitialWorldBlueprint(7)

  it('contains the canonical starting population and props', () => {
    expect(blueprint.props.filter(item => item.kind === 'tree')).toHaveLength(12)
    const huts = blueprint.props.filter(item => item.kind === 'hut')
    expect(huts).toHaveLength(3)
    expect(huts.every(item => item.state === 'built')).toBe(true)
    expect(blueprint.props.filter(item => item.kind === 'campfire')).toHaveLength(1)
    expect(blueprint.villagers).toHaveLength(6)
    expect(blueprint.handoffFrame).toBe(INITIAL_HANDOFF_FRAME)
    expect(INITIAL_HANDOFF_FRAME).toBe(204)
  })

  it('is deeply deterministic and uses unique visual seeds', () => {
    expect(createInitialWorldBlueprint(7)).toEqual(createInitialWorldBlueprint(7))
    expect(createInitialWorldBlueprint(8)).not.toEqual(blueprint)
    const seeds = [
      ...blueprint.props.map(item => item.visualSeed),
      ...blueprint.villagers.map(item => item.visualSeed),
    ]
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('keeps props and villagers in their accepted discs and clear of one another', () => {
    for (const prop of blueprint.props) expect(Math.hypot(prop.x, prop.z)).toBeLessThan(12)
    for (const villager of blueprint.villagers) {
      expect(Math.hypot(villager.x, villager.z)).toBeLessThanOrEqual(12)
      for (const prop of blueprint.props) {
        expect(Math.hypot(villager.x - prop.x, villager.z - prop.z)).toBeGreaterThanOrEqual(1.6)
      }
    }
  })
})

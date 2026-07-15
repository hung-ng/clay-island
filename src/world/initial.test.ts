import { describe, expect, it, vi } from 'vitest'
import { createInitialWorldBlueprint } from './blueprint'
import { buildInitialWorld } from './initial'

vi.mock('../fx/clayMaterial', async () => {
  const THREE = await import('three')
  return { clayMaterial: vi.fn(() => new THREE.MeshToonMaterial()) }
})

vi.mock('../fx/emotes', async () => {
  const THREE = await import('three')
  return {
    EmoteSprite: class {
      sprite = new THREE.Sprite()
      show(): void {}
      update(): void {}
    },
  }
})

describe('buildInitialWorld', () => {
  it('constructs the blueprint ids, states, and transforms', () => {
    const blueprint = createInitialWorldBlueprint(7)
    const { island, world } = buildInitialWorld(blueprint, false)
    expect(world.trees.map(tree => tree.id)).toEqual(
      blueprint.props.filter(item => item.kind === 'tree').map(item => item.id),
    )
    expect(world.huts.map(hut => [hut.id, hut.state])).toEqual(
      blueprint.props.filter(item => item.kind === 'hut').map(item => [item.id, item.state]),
    )
    expect(world.huts).toHaveLength(3)
    expect(world.huts.every(hut => hut.state === 'built')).toBe(true)
    expect(world.campfire.state).toBe('lit')
    expect(world.villagers.map(person => person.id)).toEqual(blueprint.villagers.map(item => item.id))
    expect(island.group.getObjectByName('villager-0')).toBe(world.villagers[0].group)
  })
})

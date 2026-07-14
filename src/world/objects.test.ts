import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import { Campfire, Hut, Tree } from './objects'

vi.mock('../fx/clayMaterial', async () => {
  const actual = await import('three')
  return {
    clayMaterial: vi.fn((color: THREE.ColorRepresentation) =>
      new actual.MeshToonMaterial({ color })),
  }
})

const tree = (): Tree => new Tree('tree-0', 0, 0, 0, new RNG(1))

/** Drive the clock forward. `qt` must advance or quantized work is skipped. */
function run(subject: Tree, seconds: number, from = 0): number {
  const step = 1 / 12
  let qt = from
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    qt += step
    subject.update(step, qt)
  }
  return qt
}

describe('Tree lifecycle', () => {
  it('starts grown', () => {
    expect(tree().state).toBe('normal')
  })

  it('reveals the stump as soon as chopping starts the fall', () => {
    const subject = tree()
    subject.chop()

    expect(subject.state).toBe('toppling')
    expect(subject.group.getObjectByName('tree-stump')?.visible).toBe(true)
  })

  it('lies as a felled log beside the stump once it has gone over', () => {
    const subject = tree()
    subject.chop()
    const trunk = subject.group.getObjectByName('tree-trunk')!
    const stump = subject.group.getObjectByName('tree-stump')!

    subject.update(0.3, 0.3)
    expect(trunk.position.x).toBeGreaterThan(0)
    expect(trunk.position.x).toBeLessThan(0.9)

    subject.update(0.31, 0.61)

    expect(subject.state).toBe('felled')
    expect(trunk.visible).toBe(true)
    expect(stump.visible).toBe(true)
    expect(trunk.position.x - stump.position.x).toBeCloseTo(0.9)
  })

  it('lets the chopped log disappear first, then expires the temporary stump', () => {
    const subject = tree()
    subject.chop()
    const qt = run(subject, 33)

    expect(subject.state).toBe('stump')
    expect(subject.expired).toBe(false)
    expect(subject.group.getObjectByName('tree-trunk')?.visible).toBe(false)
    expect(subject.group.getObjectByName('tree-stump')?.visible).toBe(true)

    run(subject, 33, qt)
    expect(subject.expired).toBe(true)
    expect(subject.group.visible).toBe(false)
  })

  it('a stump is not living — it is neither fuel nor forest', () => {
    const subject = tree()
    subject.chop()
    run(subject, 33)

    expect(subject.state).toBe('stump')
    expect(subject.living).toBe(false)
    expect(subject.burnt).toBe(true)
  })

  it('obliterate expires immediately without leaving wooden remains', () => {
    const subject = tree()
    subject.obliterate()

    expect(subject.expired).toBe(true)
    expect(subject.state).toBe('normal')
    expect(subject.group.visible).toBe(false)
  })

  it('burns upright regardless of whether ignition is direct or spread', () => {
    const subject = tree()
    subject.ignite()

    expect(subject.state).toBe('burning')
    expect(subject.burning).toBe(true)
  })

  it('ignoring a re-ignite keeps FireSystem from resetting a burning tree', () => {
    const subject = tree()
    subject.ignite()
    subject.burnTime = 4
    subject.ignite()

    expect(subject.state).toBe('burning')
    expect(subject.burnTime).toBe(4)
  })

  it('starts the visual burn after FireSystem pre-marks the fuel as burning', () => {
    const subject = tree()
    subject.burning = true

    subject.ignite()

    expect(subject.state).toBe('burning')
    expect(subject.group.getObjectByName('burning-fx')?.visible).toBe(true)
  })

  it('never ignites a chopped tree that has already started falling', () => {
    const subject = tree()
    subject.chop()
    subject.ignite()

    expect(subject.state).toBe('toppling')
    expect(subject.burning).toBe(false)
  })

  it('a completed burn topples into a charred log without a stump', () => {
    const subject = tree()
    subject.ignite()
    subject.setBurnt()

    expect(subject.state).toBe('toppling')
    expect(subject.burning).toBe(false)
    expect(subject.group.getObjectByName('tree-stump')?.visible).toBe(false)

    run(subject, 1)
    expect(subject.state).toBe('felled')
    expect(subject.group.getObjectByName('tree-stump')?.visible).toBe(false)
    expect(subject.group.getObjectByName('tree-trunk')?.position.x).toBeCloseTo(0.9)
  })

  it('keeps a partially grown sapling at its current scale while fire topples it', () => {
    const sapling = new Tree('tree-4', 0, 0, 0, new RNG(1), false, 'sapling')
    const qt = run(sapling, 10)
    const trunk = sapling.group.getObjectByName('tree-trunk')!
    const crown = sapling.group.getObjectByName('tree-crown')!
    const scale = trunk.scale.x
    const standingTrunkY = trunk.position.y
    const standingCrownY = crown.position.y

    sapling.ignite()
    sapling.setBurnt()
    sapling.update(0.3, qt + 0.3)

    expect(trunk.scale.x).toBeCloseTo(scale)
    expect(crown.scale.x).toBeCloseTo(scale)
    expect(trunk.position.y).toBeLessThan(standingTrunkY)
    expect(crown.position.y).toBeLessThan(standingCrownY)

    sapling.update(0.31, qt + 0.61)
    expect(sapling.state).toBe('felled')
    expect(trunk.position.y).toBeCloseTo(0.18 * scale)
    expect(crown.position.y).toBeCloseTo(0.42 * scale)
  })

  it('expires a fire-felled log after its hold and fade, without a stump phase', () => {
    const subject = tree()
    subject.ignite()
    subject.setBurnt()

    run(subject, 33)
    expect(subject.expired).toBe(true)
    expect(subject.state).toBe('felled')
  })

  it('a sapling grows into a full tree', () => {
    const sapling = new Tree('tree-1', 0, 0, 0, new RNG(1), false, 'sapling')
    expect(sapling.state).toBe('sapling')
    expect(sapling.living).toBe(true)

    run(sapling, 45)
    expect(sapling.state).toBe('normal')
  })

  it('a sapling is visibly SMALLER than a grown tree — growth is not a shrunk crown', () => {
    const sapling = new Tree('tree-2', 0, 0, 0, new RNG(1), false, 'sapling')
    const grown = tree()

    const sizeOf = (subject: Tree): number => {
      const box = new THREE.Box3().setFromObject(subject.group)
      return box.max.y - box.min.y
    }
    expect(sizeOf(sapling)).toBeLessThan(sizeOf(grown))
  })

  it('extinguishing a burning tree returns it to normal, unscorched', () => {
    const subject = tree()
    subject.ignite()
    run(subject, 2)
    subject.extinguish()
    expect(subject.state).toBe('normal')
    expect(subject.burning).toBe(false)
  })

  it('extinguishing a sapling restores its interrupted growth', () => {
    const sapling = new Tree('tree-3', 0, 0, 0, new RNG(1), false, 'sapling')
    const qt = run(sapling, 10)
    sapling.ignite()
    run(sapling, 5, qt)
    sapling.extinguish()

    expect(sapling.state).toBe('sapling')
    const afterRain = run(sapling, 29, qt + 5)
    expect(sapling.state).toBe('sapling')
    run(sapling, 2, afterRain)
    expect(sapling.state).toBe('normal')
  })
})

function colorOf(hut: Hut, name: string): number {
  let found = 0
  hut.group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child.name !== name) return
    found = (child.material as THREE.MeshToonMaterial).color.getHex()
  })
  return found
}

describe('Hut charring', () => {
  const built = (): Hut => new Hut('hut-0', 0, 0, 'built', 0, new RNG(1))

  it('chars the door and the roof knob too, not just the body', () => {
    const hut = built()
    const knobBefore = colorOf(hut, 'hut-roof-knob')

    hut.ignite()
    for (let i = 0; i < 40; i++) hut.update(1 / 12, i / 12)

    expect(colorOf(hut, 'hut-roof-knob')).not.toBe(knobBefore)
    expect(colorOf(hut, 'hut-door')).not.toBe(0)
  })

  it('a REBUILT hut is clay-coloured again, not charcoal forever', () => {
    const hut = built()
    const clean = colorOf(hut, 'hut-base')

    hut.ignite()
    for (let i = 0; i < 40; i++) hut.update(1 / 12, i / 12)
    hut.setRuin()

    hut.buildTick()
    hut.buildTick()
    hut.buildTick()
    expect(hut.state).toBe('built')
    expect(colorOf(hut, 'hut-base')).toBe(clean)
  })

  it('extinguishing a burning hut also clears the scorch', () => {
    const hut = built()
    const clean = colorOf(hut, 'hut-base')

    hut.ignite()
    for (let i = 0; i < 20; i++) hut.update(1 / 12, i / 12)
    hut.extinguish()

    expect(colorOf(hut, 'hut-base')).toBe(clean)
  })
})

describe('Campfire construction', () => {
  const campfire = (state: 'site' | 'building' | 'lit' | 'doused' | 'scattered' = 'lit') =>
    new Campfire(0, 0, 0, new RNG(1), false, state)

  it('shows only its stone ring while it is a site', () => {
    const subject = campfire('site')

    expect(subject.state).toBe('site')
    expect(subject.group.getObjectByName('campfire-stones')?.visible).toBe(true)
    expect(subject.group.getObjectByName('campfire-log')?.visible).toBe(false)
    expect(subject.group.getObjectByName('campfire-flame')?.visible).toBe(false)
  })

  it('grows its logs continuously while building, then lights', () => {
    const subject = campfire('site')

    subject.buildTick(0.4)
    expect(subject.state).toBe('building')
    expect(subject.progress).toBeCloseTo(0.4)
    expect(subject.group.getObjectByName('campfire-log')?.visible).toBe(true)
    expect(subject.group.getObjectByName('campfire-flame')?.visible).toBe(false)

    subject.buildTick(0.6)
    expect(subject.state).toBe('lit')
    expect(subject.lit).toBe(true)
    expect(subject.group.getObjectByName('campfire-flame')?.visible).toBe(true)
  })

  it('keeps an intact doused fire in place without entering construction', () => {
    const subject = campfire()
    subject.douse()

    expect(subject.state).toBe('doused')
    expect(subject.group.getObjectByName('campfire-stones')?.visible).toBe(true)
    expect(subject.group.getObjectByName('campfire-log')?.visible).toBe(true)
    expect(subject.group.getObjectByName('campfire-flame')?.visible).toBe(false)
  })

  it('keeps scattered remains visible until the world claims a replacement', () => {
    const subject = campfire()
    subject.scatter()

    expect(subject.state).toBe('scattered')
    expect(subject.scattered).toBe(true)
    expect(subject.group.getObjectByName('campfire-stones')?.visible).toBe(true)
    expect(subject.group.getObjectByName('campfire-log')?.visible).toBe(true)
  })
})

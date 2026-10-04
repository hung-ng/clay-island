import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import { Campfire, flameAnchors, Hut, Tree } from './objects'

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
    const trunk = subject.group.getObjectByName('tree-trunk') as THREE.Mesh<THREE.CylinderGeometry>
    const stump = subject.group.getObjectByName('tree-stump')!

    subject.update(0.3, 0.3)
    expect(trunk.position.x).toBeGreaterThan(0)
    expect(trunk.position.x).toBeLessThan(0.9)

    subject.update(0.31, 0.61)

    expect(subject.state).toBe('felled')
    expect(trunk.visible).toBe(true)
    expect(stump.visible).toBe(true)
    expect(trunk.position.x - stump.position.x).toBeCloseTo(0.9)

    const halfHeight = trunk.geometry.parameters.height / 2
    const largeEnd = trunk.localToWorld(new THREE.Vector3(0, -halfHeight, 0))
    const smallEnd = trunk.localToWorld(new THREE.Vector3(0, halfHeight, 0))
    const stumpCenter = stump.getWorldPosition(new THREE.Vector3())
    expect(largeEnd.distanceTo(stumpCenter)).toBeLessThan(smallEnd.distanceTo(stumpCenter))
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

  it('lets authored presentation seek tree growth without advancing gameplay time', () => {
    const sapling = new Tree('tree-1', 0, 0, 0, new RNG(1), false, 'sapling')
    const trunk = sapling.group.getObjectByName('tree-trunk')!
    const crown = sapling.group.getObjectByName('tree-crown')!

    sapling.setGrowthProgress(0)
    expect(trunk.scale.x).toBeCloseTo(0.25)
    expect(crown.scale.x).toBeCloseTo(0.25)
    expect(sapling.state).toBe('sapling')

    sapling.setGrowthProgress(0.5)
    expect(trunk.scale.x).toBeCloseTo(0.625)
    expect(crown.scale.x).toBeCloseTo(0.625)
    expect(trunk.position.y).toBeCloseTo(0.55 * 0.625)
    expect(crown.position.y).toBeCloseTo(1.45 * 0.625)
    expect(sapling.state).toBe('sapling')

    sapling.setGrowthProgress(1)
    expect(trunk.scale.x).toBe(1)
    expect(crown.scale.x).toBe(1)
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

  it('shudders when struck, then settles', () => {
    const subject = tree()
    const crown = subject.group.getObjectByName('tree-crown')!

    subject.shudder()
    subject.update(1 / 60, 1 / 60)
    expect(crown.rotation.z).not.toBe(0)

    run(subject, 1, 1 / 60)
    expect(crown.rotation.z).toBe(0)
  })

  it('drops one fruit per call to a landing point near the trunk', () => {
    const subject = tree()
    subject.growFruit()
    expect(subject.fruitCount).toBe(4)

    const landing = subject.dropFruit()
    expect(landing).not.toBeNull()
    expect(Math.hypot(landing!.x, landing!.z)).toBeLessThanOrEqual(2.6)
    expect(subject.fruitCount).toBe(3)

    subject.dropFruit()
    subject.dropFruit()
    subject.dropFruit()
    expect(subject.fruitCount).toBe(0)
    expect(subject.hasFruit).toBe(false)
    expect(subject.dropFruit()).toBeNull()
  })

  it('sways its crown along the gust and settles back upright', () => {
    const subject = tree()
    const crown = subject.group.getObjectByName('tree-crown')!
    subject.sway(0, 1, 2.5)
    run(subject, 1.2)
    expect(Math.abs(crown.rotation.x)).toBeGreaterThan(0.01)
    run(subject, 2, 1.2)
    expect(crown.rotation.x).toBe(0)
    expect(crown.rotation.z).toBe(0)
  })

  it('ignores sway once felled', () => {
    const subject = tree()
    subject.chop()
    const qt = run(subject, 1)
    expect(subject.state).toBe('felled')
    subject.sway(1, 0, 2.5)
    const crown = subject.group.getObjectByName('tree-crown')!
    const before = crown.rotation.z
    run(subject, 0.5, qt)
    expect(crown.rotation.x).toBe(0)
    expect(crown.rotation.z).toBe(before)
  })
})

describe('Tree fruit', () => {
  it('hangs every fruit on the crown surface instead of inside a blob', () => {
    const subject = new Tree('tree-1', 0, 0, 0, new RNG(5))
    subject.growFruit()

    const crown = subject.group.getObjectByName('tree-crown') as THREE.Group
    const fruit = crown.getObjectByName('tree-fruit') as THREE.InstancedMesh
    const blobs = crown.children.filter(child => (
      child instanceof THREE.Mesh && child !== fruit
    )) as THREE.Mesh[]
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()

    for (let i = 0; i < fruit.count; i++) {
      fruit.getMatrixAt(i, matrix)
      position.setFromMatrixPosition(matrix)
      const buried = blobs.some((blob) => {
        const geometry = blob.geometry as THREE.SphereGeometry
        const radius = geometry.parameters.radius
          * Math.max(blob.scale.x, blob.scale.y, blob.scale.z)
        return position.distanceTo(blob.position) < radius * 0.92
      })
      expect(buried).toBe(false)
    }
  })

  it('scatters the fruit around the crown rather than clumping them', () => {
    const subject = new Tree('tree-1', 0, 0, 0, new RNG(5))
    subject.growFruit()

    const crown = subject.group.getObjectByName('tree-crown') as THREE.Group
    const fruit = crown.getObjectByName('tree-fruit') as THREE.InstancedMesh
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const angles: number[] = []
    for (let i = 0; i < fruit.count; i++) {
      fruit.getMatrixAt(i, matrix)
      position.setFromMatrixPosition(matrix)
      angles.push(Math.atan2(position.z, position.x))
    }

    for (let i = 0; i < angles.length; i++) {
      for (let j = i + 1; j < angles.length; j++) {
        const delta = Math.abs(angles[i] - angles[j])
        const separation = Math.min(delta, Math.PI * 2 - delta)
        expect(separation).toBeGreaterThan(0.5)
      }
    }
  })

  it('takes only the nearest fruit, and leaves the rest hanging', () => {
    const subject = new Tree('tree-1', 0, 0, 0, new RNG(5))
    subject.growFruit()
    expect(subject.fruitCount).toBe(4)

    expect(subject.pickFruit(0, 0)).toBe(true)

    expect(subject.fruitCount).toBe(3)
    expect(subject.hasFruit).toBe(true)
  })

  it('empties the tree only after the fourth pick', () => {
    const subject = new Tree('tree-1', 0, 0, 0, new RNG(5))
    subject.growFruit()

    for (let i = 0; i < 4; i++) expect(subject.pickFruit(0, 0)).toBe(true)

    expect(subject.fruitCount).toBe(0)
    expect(subject.hasFruit).toBe(false)
    expect(subject.pickFruit(0, 0)).toBe(false)
  })

  it('takes the fruit nearest the picker', () => {
    const subject = new Tree('tree-1', 0, 0, 0, new RNG(5))
    subject.growFruit()

    const crown = subject.group.getObjectByName('tree-crown') as THREE.Group
    const fruit = crown.getObjectByName('tree-fruit') as THREE.InstancedMesh
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    fruit.getMatrixAt(0, matrix)
    position.setFromMatrixPosition(matrix)

    subject.group.updateMatrixWorld(true)
    const worldPosition = crown.localToWorld(position.clone())
    subject.pickFruit(worldPosition.x, worldPosition.z)

    fruit.getMatrixAt(0, matrix)
    expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeLessThan(0.01)
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

describe('burning-object flare', () => {
  it.each([
    ['tree', () => new Tree('tree-flare', 0, 0, 0, new RNG(1))],
    ['hut', () => new Hut('hut-flare', 0, 0, 'built', 0, new RNG(1))],
  ] as const)('briefly surges the visible %s flames', (_kind, create) => {
    const subject = create()
    subject.ignite()
    subject.update(1 / 12, 1)
    const flame = subject.group.getObjectByName('fire-flame')!
    const baseline = flame.scale.y

    subject.flare(1, 2)
    subject.update(1 / 12, 1 + 1 / 12)

    expect(flame.scale.y).toBeGreaterThan(baseline * 1.5)
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

describe('fire placement', () => {
  /** How far out a point sits, in dome radii: 1 is on the surface. */
  const reach = (point: THREE.Vector3, shell: { y: number; radius: number; squash: number }): number => Math.hypot(
    point.x / shell.radius,
    (point.y - shell.y) / (shell.radius * shell.squash),
    point.z / shell.radius,
  )

  it('sets every flame just outside the dome and above its middle, crest first', () => {
    const shell = { y: 1.6, radius: 0.95, squash: 0.85 }
    const anchors = flameAnchors(shell, 5, 0.3, new RNG(4))
    for (const anchor of anchors) {
      expect(reach(anchor, shell)).toBeGreaterThan(1)
      expect(anchor.y).toBeGreaterThan(shell.y)
    }
    expect(anchors[0]!.y).toBe(Math.max(...anchors.map(anchor => anchor.y)))
  })

  it('shows a burning hut\'s flames on the roof, not inside the dome', () => {
    const hut = new Hut('hut-fire', 0, 0, 'built', 0, new RNG(1))
    hut.ignite()
    const dome = { y: 0.82, radius: 1.1, squash: 0.75 }
    const flames: THREE.Object3D[] = []
    hut.group.traverse(child => { if (child.name === 'fire-flame') flames.push(child) })
    expect(flames.length).toBeGreaterThan(1)
    for (const flame of flames) expect(reach(flame.position, dome)).toBeGreaterThan(1)
  })
})

describe('hut dome', () => {
  it('keeps the doorway on the dome while the hut is going up', () => {
    const hut = new Hut('hut-door', 0, 0, 'site', 0, new RNG(1))
    hut.buildTick()
    const base = hut.group.getObjectByName('hut-base')!
    const door = hut.group.getObjectByName('hut-door')!
    // Both grow about the dome's centre, so the doorway never floats off the wall.
    expect(door.position.y).toBe(base.position.y)
    expect(door.scale.x).toBeCloseTo(base.scale.x)
    expect(door.getObjectByName('hut-door-frame')).toBeDefined()
  })
})

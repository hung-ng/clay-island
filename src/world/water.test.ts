import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { RNG } from '../core/rng'
import type { Crater } from './craters'
import { Pond } from './objects'
import { groupBasins } from './terrain'

vi.mock('../fx/clayMaterial', async () => {
  const actual = await import('three')
  return { clayMaterial: vi.fn(() => new actual.MeshToonMaterial()) }
})

const FLAT = (): number => 0

/** The real island's crater bowl: a cosine dish, deepest at the centre. */
function dish(craters: Crater[]) {
  return (x: number, z: number): number => {
    let depth = 0
    for (const crater of craters) {
      const t = Math.hypot(x - crater.x, z - crater.z) / crater.radius
      if (t < 1) {
        depth = Math.max(depth, crater.depth * Math.cos(t * Math.PI * 0.5) ** 2)
      }
    }
    return -depth
  }
}

/** Every vertex of the pond's water mesh, in world space. */
function surfacePoints(pond: Pond): { x: number; z: number }[] {
  const water = pond.group.getObjectByName('pond-water') as THREE.Mesh
  const position = water.geometry.getAttribute('position')
  const points: { x: number; z: number }[] = []
  for (let i = 0; i < position.count; i++) {
    points.push({
      x: pond.group.position.x + position.getX(i),
      z: pond.group.position.z + position.getZ(i),
    })
  }
  return points
}

function pondFish(pond: Pond): THREE.Mesh[] {
  const school = pond.group.getObjectByName('pond-fish') as THREE.Group
  return school.children as THREE.Mesh[]
}

describe('pond water surface', () => {
  it('reaches the bank instead of stranding a puddle in a dry bowl', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    const reach = Math.max(...surfacePoints(pond).map(p => Math.hypot(p.x, p.z)))

    // The freeboard holds the water ~0.61 of the way out to the rim, leaving a
    // bank of earth above it. The surface must actually reach that waterline: the
    // bug this guards is whole-cell clipping, which stopped it at 2.24 of 3 and
    // left the water reading as a flat disc floating in the middle of a hole.
    expect(reach).toBeGreaterThan(3 * 0.58)
    expect(reach).toBeLessThan(3 * 0.63)
  })

  it('never spills past the crater onto the surrounding grass', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    for (const point of surfacePoints(pond)) {
      expect(Math.hypot(point.x, point.z)).toBeLessThanOrEqual(3)
    }
  })

  it('does not call the dry inner bank water', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    expect(pond.contains(0, 0)).toBe(true)
    expect(pond.contains(2.9, 0)).toBe(false)
  })

  it('puts a fisher beside the visible waterline, inside the crater rim', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    const shore = pond.shoreNear(4, 0)

    expect(pond.contains(shore.x, shore.z)).toBe(false)
    expect(Math.hypot(shore.x, shore.z)).toBeLessThan(3)
  })

  it('follows the shoreline smoothly rather than in half-metre steps', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    // Sample the outer edge by angle. On a round crater the shoreline is a
    // circle, so a staircased boundary shows up as a big spread between the
    // nearest and furthest edge vertex in each angular slice.
    const bins = new Array(24).fill(0)
    for (const point of surfacePoints(pond)) {
      const angle = Math.atan2(point.z, point.x) + Math.PI
      const bin = Math.min(23, Math.floor((angle / (Math.PI * 2)) * 24))
      bins[bin] = Math.max(bins[bin], Math.hypot(point.x, point.z))
    }

    const spread = Math.max(...bins) - Math.min(...bins)
    // Quad clipping left a 0.5m staircase. Interpolating onto the waterline
    // holds the edge to well under a tenth of a metre of wobble.
    expect(spread).toBeLessThan(0.1)
  })

  it('makes ONE continuous sheet across two overlapping craters', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 3, z: 0, radius: 3, depth: 1.5 },
    ]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    const points = surfacePoints(pond)
    // Water over both bowls...
    expect(points.some(p => Math.hypot(p.x - 0, p.z) < 1)).toBe(true)
    expect(points.some(p => Math.hypot(p.x - 3, p.z) < 1)).toBe(true)
    // ...and across the saddle between them, where the two bowls merge. If the
    // sheet broke here you would see two discs, not one lake.
    expect(points.some(p => Math.abs(p.x - 1.5) < 0.4 && Math.abs(p.z) < 0.4)).toBe(true)
  })

  it('has real thickness: a bed below the surface, not one flat plane', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    const bed = pond.group.getObjectByName('pond-bed') as THREE.Mesh
    expect(bed).toBeDefined()

    const position = bed.geometry.getAttribute('position')
    let deepest = 0
    for (let i = 0; i < position.count; i++) {
      deepest = Math.min(deepest, position.getY(i))
    }

    // The bowl is 1.5 deep and the water stands 0.5 below the rim, so the body is
    // ~1.0 thick in the middle. A single flat plane would measure 0.
    expect(deepest).toBeLessThan(-0.9)
    expect(deepest).toBeGreaterThan(-1.05)
  })

  it('tapers to nothing at the bank, so the body closes at the shore', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    const bed = pond.group.getObjectByName('pond-bed') as THREE.Mesh
    const position = bed.geometry.getAttribute('position')

    // Every bed vertex out at the shoreline must have risen to meet the lid,
    // or the water body would end in a visible open wall of water.
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      if (radius < 2.7) continue
      expect(position.getY(i)).toBeGreaterThan(-0.35)
    }
  })

  it('deepens toward the middle of the bowl', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    const bed = pond.group.getObjectByName('pond-bed') as THREE.Mesh
    const position = bed.geometry.getAttribute('position')

    // Bucket bed height by distance from the centre: it must rise monotonically
    // outward, which is what makes the water read as a bowl rather than a box.
    const inner: number[] = []
    const outer: number[] = []
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i))
      if (radius < 1) inner.push(position.getY(i))
      else if (radius > 1.5 && radius < 1.9) outer.push(position.getY(i))
    }

    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length
    expect(mean(inner)).toBeLessThan(mean(outer))
  })

  it('sits at exactly one height across the whole merged lake', () => {
    const craters: Crater[] = [
      { x: 0, z: 0, radius: 3, depth: 1.5 },
      { x: 4, z: 0, radius: 3, depth: 1.5 },
    ]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))

    const water = pond.group.getObjectByName('pond-water') as THREE.Mesh
    const position = water.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBe(0)
    }
    expect(pond.group.position.y).toBeCloseTo(basin.waterLevel)
  })

  it('faces the lid upward and does not render its flat underside', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const pond = new Pond(basin, dish(craters), new RNG(1))
    const water = pond.group.getObjectByName('pond-water') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshToonMaterial
    >

    expect(water.material.side).toBe(THREE.FrontSide)
    const normals = water.geometry.getAttribute('normal')
    for (let i = 0; i < normals.count; i++) {
      expect(normals.getY(i)).toBeGreaterThan(0.99)
    }
  })
})

describe('pond fish population', () => {
  const makePond = (initialFish = 3): {
    pond: Pond
    groundY: (x: number, z: number) => number
  } => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const groundY = dish(craters)
    return {
      pond: new Pond(basin, groundY, new RNG(7), false, initialFish),
      groundY,
    }
  }

  it('starts with three visible fish swimming below the surface and above the bed', () => {
    const { pond, groundY } = makePond()

    pond.update(1 / 12, 1 / 12)

    expect(pond.fishCount).toBe(3)
    for (const fish of pondFish(pond)) {
      const worldX = pond.x + fish.position.x
      const worldZ = pond.z + fish.position.z
      const bedY = groundY(worldX, worldZ) - pond.basin.waterLevel
      expect(fish.visible).toBe(true)
      expect(fish.position.y).toBeLessThan(-0.05)
      expect(fish.position.y).toBeGreaterThan(bedY + 0.08)
      expect(pond.contains(worldX, worldZ)).toBe(true)
    }
  })

  it('removes exactly one fish per catch and never underflows', () => {
    const { pond } = makePond()

    expect(pond.catchFish()).toBe(true)
    expect(pond.fishCount).toBe(2)
    expect(pondFish(pond).filter(fish => fish.visible)).toHaveLength(2)

    expect(pond.catchFish()).toBe(true)
    expect(pond.catchFish()).toBe(true)
    expect(pond.catchFish()).toBe(false)
    expect(pond.fishCount).toBe(0)
    expect(pond.hasFish).toBe(false)
  })

  it('clears the stun when the last remaining fish is caught', () => {
    const { pond } = makePond()
    pond.stunFish()

    while (pond.catchFish()) {
      expect(pond.fishCount).toBeGreaterThanOrEqual(0)
    }

    expect(pond.fishStunned).toBe(false)
  })

  it('restores a partial or empty pond to three without allocating another school', () => {
    const { pond } = makePond()
    const school = pond.group.getObjectByName('pond-fish')
    pond.catchFish()
    pond.catchFish()

    expect(pond.restoreFish()).toBe(true)
    expect(pond.fishCount).toBe(3)
    expect(pond.group.getObjectByName('pond-fish')).toBe(school)
    expect(pond.restoreFish()).toBe(false)
  })

  it('returns restored fish underwater even when Rain lands on the same animation frame', () => {
    const { pond } = makePond()
    pond.stunFish()
    pond.update(0, 1 / 12)
    pond.catchFish()

    pond.restoreFish()
    pond.update(0, 1 / 12)

    expect(pondFish(pond).every(fish => fish.position.y < -0.05)).toBe(true)
  })

  it('stuns remaining fish at the surface for two seconds without consuming them', () => {
    const { pond } = makePond()
    pond.catchFish()
    const before = pond.fishCount

    expect(pond.stunFish()).toBe(true)
    pond.update(1 / 12, 1 / 12)
    expect(pond.fishStunned).toBe(true)
    expect(pondFish(pond).filter(fish => fish.visible).every(
      fish => fish.position.y >= 0,
    )).toBe(true)

    pond.update(2.01, 2.1)
    expect(pond.fishStunned).toBe(false)
    expect(pond.fishCount).toBe(before)
    expect(pondFish(pond).filter(fish => fish.visible).every(
      fish => fish.position.y < -0.05,
    )).toBe(true)
  })

  it('applies and ends stun immediately even when quantized time has not advanced', () => {
    const { pond } = makePond()
    const qt = 1 / 12
    pond.update(0, qt)

    pond.stunFish()
    pond.update(0, qt)
    expect(pondFish(pond).every(fish => fish.position.y >= 0)).toBe(true)

    pond.update(2.01, qt)
    expect(pond.fishStunned).toBe(false)
    expect(pondFish(pond).every(fish => fish.position.y < -0.05)).toBe(true)
  })

  it('refreshes rather than stacks repeated Lightning stuns', () => {
    const { pond } = makePond()
    pond.stunFish()
    pond.update(1.5, 1 / 12)

    pond.stunFish()
    pond.update(0.6, 2 / 12)
    expect(pond.fishStunned).toBe(true)

    pond.update(1.41, 3 / 12)
    expect(pond.fishStunned).toBe(false)
  })

  it('keeps every swim route in submerged space across the animation cycle', () => {
    const craters: Crater[] = [{ x: 0, z: 0, radius: 3, depth: 1.5 }]
    const [basin] = groupBasins(craters, FLAT)
    const bowl = dish(craters)
    // A dry shoulder cuts into the nominal crater-centred route. A fixed route
    // radius crosses it; a water-aware route must shrink into the wet half.
    const groundY = (x: number, z: number): number => (
      x > 0.12 ? Math.max(bowl(x, z), basin.waterLevel + 0.1) : bowl(x, z)
    )
    const pond = new Pond(basin, groundY, new RNG(7))

    for (let frame = 0; frame < 240; frame++) {
      pond.update(1 / 12, frame / 12)
      for (const fish of pondFish(pond)) {
        const worldX = pond.x + fish.position.x
        const worldZ = pond.z + fish.position.z
        const bedY = groundY(worldX, worldZ) - basin.waterLevel
        expect(pond.contains(worldX, worldZ)).toBe(true)
        expect(fish.position.y).toBeGreaterThan(bedY + 0.08)
      }
    }
  })

  it('faces each fish along the tangent of its swim route', () => {
    const { pond } = makePond()
    pond.update(0, 10 / 12)
    const before = pondFish(pond).map(fish => fish.position.clone())

    pond.update(1 / 12, 11 / 12)

    for (let i = 0; i < pondFish(pond).length; i++) {
      const fish = pondFish(pond)[i]
      const movement = fish.position.clone().sub(before[i]).setY(0).normalize()
      const forward = new THREE.Vector3(
        Math.cos(fish.rotation.y),
        0,
        -Math.sin(fish.rotation.y),
      )
      expect(forward.dot(movement)).toBeGreaterThan(0.98)
    }
  })

  it('does not stun an empty pond', () => {
    const { pond } = makePond(0)
    expect(pond.stunFish()).toBe(false)
    expect(pond.fishStunned).toBe(false)
  })
})

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { fbm2 } from '../core/noise'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'
import type { Crater } from './craters'

/**
 * Small decorative clutter on the meadow: grass tufts, a scatter of wild
 * flowers, pebbles. It never blocks or targets anything; it only has to get
 * out of the way when a meteor digs a crater, so a pond never grows grass.
 */
export type GroundCoverOptions = {
  radius: number
  sampleHeight(x: number, z: number): number
  rng: RNG
  lowFx: boolean
}

type Item = { x: number; z: number; lift: number; scale: number; tilt: number; yaw: number }

/** Scorch from an impact reaches a little past the crater rim. */
const CRATER_CLEARANCE = 1.25
const CENTRE_CLEARANCE = 2.6

function tuftGeometry(rng: RNG): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = []
  const count = 4
  for (let i = 0; i < count; i++) {
    const height = rng.range(0.2, 0.32)
    const blade = new THREE.ConeGeometry(0.04, height, 4)
    blade.translate(0, height / 2, 0)
    blade.rotateZ(rng.range(0.15, 0.45))
    blade.rotateY((i / count) * Math.PI * 2 + rng.range(-0.3, 0.3))
    blades.push(blade)
  }
  const merged = mergeGeometries(blades)!
  for (const blade of blades) blade.dispose()
  return merged
}

export class GroundCover {
  readonly group = new THREE.Group()
  private readonly layers: Array<{ mesh: THREE.InstancedMesh; items: Item[] }> = []
  private readonly dummy = new THREE.Object3D()

  constructor(private readonly options: GroundCoverOptions) {
    this.group.name = 'ground-cover'
    const { rng, lowFx } = options

    // Tufts gather in patches; open lawn between them keeps the meadow calm.
    const tufts = this.scatter(lowFx ? 150 : 420, 0.36, (x, z) => fbm2(x * 0.32 + 9, z * 0.32 - 4) > -0.02, () => ({
      lift: -0.02, scale: rng.range(0.75, 1.35), tilt: rng.range(-0.12, 0.12), yaw: rng.range(0, Math.PI * 2),
    }))
    this.addLayer(tuftGeometry(rng), clayMaterial(PALETTE.unmodulated), tufts, () => (
      new THREE.Color(PALETTE.grassDeep).lerp(new THREE.Color(PALETTE.leafA), rng.range(0, 0.7))
    ))

    // Flowers grow in little single-colour clumps rather than evenly salted
    // across the grass. Pink stays reserved for the rain's First Bloom.
    const flowerColors = [PALETTE.cloud, PALETTE.smockC, PALETTE.cloud, PALETTE.wildflower]
    const flowers: Item[] = []
    const flowerTints: THREE.Color[] = []
    const clumps = this.scatter(lowFx ? 10 : 26, 1.4, null, () => ({ lift: 0, scale: 1, tilt: 0, yaw: 0 }))
    for (const [clumpIndex, clump] of clumps.entries()) {
      const size = rng.int(3, 6)
      const tint = new THREE.Color(flowerColors[clumpIndex % flowerColors.length]!)
      for (let i = 0; i < size; i++) {
        flowerTints.push(tint)
        const angle = rng.range(0, Math.PI * 2)
        const distance = rng.range(0.1, 0.6)
        flowers.push({
          x: clump.x + Math.cos(angle) * distance,
          z: clump.z + Math.sin(angle) * distance,
          lift: rng.range(0.07, 0.14),
          scale: rng.range(0.7, 1.2),
          tilt: 0,
          yaw: rng.range(0, Math.PI * 2),
        })
      }
    }
    const flowerGeometry = wobble(new THREE.IcosahedronGeometry(0.075, 1), rng, 0.015)
    flowerGeometry.scale(1, 0.7, 1)
    this.addLayer(flowerGeometry, clayMaterial(PALETTE.unmodulated), flowers, index => flowerTints[index]!)

    const pebbles = this.scatter(lowFx ? 30 : 70, 0.6, null, () => ({
      lift: 0.01, scale: rng.range(0.7, 1.6), tilt: rng.range(-0.4, 0.4), yaw: rng.range(0, Math.PI * 2),
    }))
    const pebbleGeometry = wobble(new THREE.IcosahedronGeometry(0.09, 1), rng, 0.025)
    pebbleGeometry.scale(1, 0.6, 1)
    this.addLayer(pebbleGeometry, clayMaterial(PALETTE.unmodulated), pebbles, () => (
      new THREE.Color(PALETTE.stone).lerp(new THREE.Color(PALETTE.cloud), rng.range(0, 0.35))
    ))
  }

  /** Re-seat everything on the current ground and hide what a crater swallowed. */
  reground(craters: readonly Crater[]): void {
    for (const layer of this.layers) {
      for (const [index, item] of layer.items.entries()) {
        const buried = craters.some(crater => (
          Math.hypot(item.x - crater.x, item.z - crater.z) < crater.radius * CRATER_CLEARANCE
        ))
        this.write(layer.mesh, index, item, buried ? 0 : item.scale)
      }
      layer.mesh.instanceMatrix.needsUpdate = true
    }
  }

  private scatter(
    count: number,
    spacing: number,
    accept: ((x: number, z: number) => boolean) | null,
    make: () => Omit<Item, 'x' | 'z'>,
  ): Item[] {
    const { rng, radius } = this.options
    const items: Item[] = []
    for (let tries = 0; tries < count * 30 && items.length < count; tries++) {
      const angle = rng.range(0, Math.PI * 2)
      const distance = Math.sqrt(rng.next()) * (radius - 0.6)
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      if (distance < CENTRE_CLEARANCE) continue
      if (accept && !accept(x, z)) continue
      if (items.some(item => Math.hypot(item.x - x, item.z - z) < spacing)) continue
      items.push({ x, z, ...make() })
    }
    return items
  }

  private addLayer(
    geometry: THREE.BufferGeometry,
    material: THREE.MeshToonMaterial,
    items: Item[],
    color: (index: number) => THREE.Color,
  ): void {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length))
    mesh.count = items.length
    mesh.receiveShadow = !this.options.lowFx
    for (const [index, item] of items.entries()) {
      this.write(mesh, index, item, item.scale)
      mesh.setColorAt(index, color(index))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
    this.layers.push({ mesh, items })
  }

  private write(mesh: THREE.InstancedMesh, index: number, item: Item, scale: number): void {
    this.dummy.position.set(item.x, this.options.sampleHeight(item.x, item.z) + item.lift, item.z)
    this.dummy.rotation.set(item.tilt, item.yaw, item.tilt * 0.5)
    this.dummy.scale.setScalar(scale)
    this.dummy.updateMatrix()
    mesh.setMatrixAt(index, this.dummy.matrix)
  }
}

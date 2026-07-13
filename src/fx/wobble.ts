import * as THREE from 'three'
import { RNG } from '../core/rng'
import { fbm2 } from '../core/noise'

export function wobble(geo: THREE.BufferGeometry, rng: RNG, amount = 0.06): THREE.BufferGeometry {
  geo.computeVertexNormals()
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute
  const ox = rng.range(0, 100), oy = rng.range(0, 100), oz = rng.range(0, 100)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    // Two decorrelated 2D samples ≈ 3D noise. Do NOT fold axes together
    // (e.g. fbm2(x, y + z)): that makes every vertex on a y+z diagonal displace
    // identically and ridges the sphere along a visible seam.
    const n = (fbm2(x * 1.7 + ox, z * 1.7 + oz, 2)
             + fbm2(y * 1.7 + oy, x * 1.3 + oz, 2)) * 0.5 * amount
    pos.setXYZ(i, x + nrm.getX(i) * n, y + nrm.getY(i) * n, z + nrm.getZ(i) * n)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

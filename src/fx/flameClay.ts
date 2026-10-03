import type * as THREE from 'three'
import { PALETTE } from '../ui/tokens'
import { clayMaterial } from './clayMaterial'

const FLAME_CLAY_SHARE = 0.25

/**
 * Fire, modelled in clay. Flames are light sources: their clay is dimmed to a
 * quarter and their colour carried by the glow, so neither the sun nor a point
 * light a hand's width away can drive them red. `core` is the hot yellow lump;
 * the rest are orange tongues. The glow is what the bloom pass keys on.
 */
export function flameClay(core: boolean): THREE.MeshToonMaterial {
  const material = core
    ? clayMaterial(PALETTE.ember, { glow: 1.6, glowColor: PALETTE.emberGlow })
    : clayMaterial(PALETTE.flame, { glow: 1.3, glowColor: PALETTE.flameGlow })
  material.color.multiplyScalar(FLAME_CLAY_SHARE)
  return material
}

import { describe, expect, it } from 'vitest'
import {
  CAMERA_HOME,
  CAMERA_LIMITS,
  clampCameraTarget,
  maxPolarAngleAt,
  smooth01,
} from './policy'

describe('camera policy', () => {
  it('clamps focus to the horizontal 7.5 metre disc and y=0', () => {
    expect(clampCameraTarget({ x: 12, y: 4, z: 0 })).toEqual({ x: 7.5, y: 0, z: 0 })
    expect(clampCameraTarget({ x: 3, y: -2, z: 4 })).toEqual({ x: 3, y: 0, z: 4 })
  })

  it('tightens the low viewing angle only near the island', () => {
    expect(maxPolarAngleAt(15)).toBeCloseTo(1.20)
    expect(maxPolarAngleAt(25)).toBeCloseTo(1.35)
    expect(maxPolarAngleAt(55)).toBeCloseTo(1.35)
  })

  it('keeps exact home and distance acceptance values', () => {
    expect(CAMERA_HOME).toEqual({
      position: { x: 0, y: 14, z: 34 },
      target: { x: 0, y: 0, z: 0 },
    })
    expect(CAMERA_LIMITS).toMatchObject({
      minDistance: 15,
      maxDistance: 55,
      targetRadius: 7.5,
    })
  })

  it('smooths only inside the normalized interpolation interval', () => {
    expect(smooth01(-1)).toBe(0)
    expect(smooth01(0.5)).toBe(0.5)
    expect(smooth01(2)).toBe(1)
  })
})

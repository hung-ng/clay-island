import { describe, expect, it } from 'vitest'
import {
  CAMERA_HOME,
  CAMERA_LIMITS,
  CELEBRATION_CAMERA,
  celebrationCameraPose,
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

  it('frames the launcher while preserving horizontal viewing direction', () => {
    const pose = celebrationCameraPose(
      { position: { x: 10, y: 8, z: 0 }, target: { x: 0, y: 0, z: 0 } },
      { x: 3, z: 4 },
    )

    expect(pose.target).toEqual({ x: 3, y: 0, z: 4 })
    expect(pose.position).toMatchObject({ y: 20, z: 4 })
    expect(pose.position.x).toBeCloseTo(54.2347538298)
    expect(Math.hypot(
      pose.position.x - pose.target.x,
      pose.position.y - pose.target.y,
      pose.position.z - pose.target.z,
    )).toBeCloseTo(CAMERA_LIMITS.maxDistance)
    expect(CELEBRATION_CAMERA).toMatchObject({ seconds: 0.8, suggestAt: 3 })
  })

  it('keeps a distant launcher target inside the camera focus disc', () => {
    const pose = celebrationCameraPose(CAMERA_HOME, { x: 12, z: 0 })
    expect(pose.target).toEqual({ x: 7.5, y: 0, z: 0 })
    expect(Math.hypot(
      pose.position.x - pose.target.x,
      pose.position.y - pose.target.y,
      pose.position.z - pose.target.z,
    )).toBeCloseTo(CAMERA_LIMITS.maxDistance)
  })
})

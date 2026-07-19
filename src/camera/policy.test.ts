import { describe, expect, it } from 'vitest'
import {
  CAMERA_HOME,
  CAMERA_LIMITS,
  CELEBRATION_ACTS,
  CELEBRATION_INTRO_LOCK_SECONDS,
  CELEBRATION_TARGET_LIFT,
  celebrationActPose,
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

  it('stages three acts closer to farther, settling before the first launch', () => {
    expect(CELEBRATION_ACTS.map(spec => spec.act)).toEqual([1, 2, 3])
    const starts = CELEBRATION_ACTS.map(spec => spec.at)
    expect(starts).toEqual([0, 3.2, 11])
    expect(CELEBRATION_INTRO_LOCK_SECONDS)
      .toBe(CELEBRATION_ACTS[1]!.at - CELEBRATION_ACTS[0]!.at)
    expect(CELEBRATION_ACTS[1]!.at + CELEBRATION_ACTS[1]!.seconds).toBe(4)
    const distances = CELEBRATION_ACTS.map(spec => spec.distance)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
    expect(distances[0]!).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance)
    expect(CELEBRATION_ACTS[2]!.distance).toBe(CAMERA_LIMITS.maxDistance)
  })

  it('frames each act at its distance with a lifted sky target, keeping azimuth', () => {
    const current = {
      position: { x: 10, y: 8, z: 0 },
      target: { x: 0, y: 0, z: 0 },
    }
    for (const act of [1, 2, 3] as const) {
      const spec = CELEBRATION_ACTS[act - 1]!
      const pose = celebrationActPose(act, current, { x: 3, z: 4 })
      expect(pose.target).toEqual({ x: 3, y: CELEBRATION_TARGET_LIFT, z: 4 })
      expect(pose.position.y).toBe(spec.height)
      expect(Math.hypot(
        pose.position.x - pose.target.x,
        pose.position.y - pose.target.y,
        pose.position.z - pose.target.z,
      )).toBeCloseTo(spec.distance)
      expect(pose.position.z).toBeCloseTo(pose.target.z)
      expect(pose.position.x).toBeGreaterThan(pose.target.x)
    }
  })

  it('clamps the lifted target to the focus disc and the lift ceiling', () => {
    const pose = celebrationActPose(3, CAMERA_HOME, { x: 12, z: 0 })
    expect(pose.target.x).toBeCloseTo(7.5)
    expect(pose.target.y).toBe(CELEBRATION_TARGET_LIFT)
    expect(clampCameraTarget({ x: 0, y: 9, z: 0 }, CELEBRATION_TARGET_LIFT).y)
      .toBe(CELEBRATION_TARGET_LIFT)
    expect(clampCameraTarget({ x: 0, y: 2, z: 0 }, CELEBRATION_TARGET_LIFT).y).toBe(2)
    expect(clampCameraTarget({ x: 0, y: 2, z: 0 }).y).toBe(0)
    expect(clampCameraTarget({ x: 0, y: -3, z: 0 }, CELEBRATION_TARGET_LIFT).y).toBe(0)
  })
})

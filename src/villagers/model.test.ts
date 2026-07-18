import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MODEL_SCALE, VillagerModel } from './model'

vi.mock('../fx/clayMaterial', async () => {
  const THREE = await import('three')
  return { clayMaterial: vi.fn((color: string) => new THREE.MeshToonMaterial({ color })) }
})

function namedTransforms(root: THREE.Object3D): Record<string, number[]> {
  const result: Record<string, number[]> = {}
  root.traverse(object => {
    if (!object.name) return
    result[object.name] = [
      ...object.position.toArray(),
      object.rotation.x,
      object.rotation.y,
      object.rotation.z,
      ...object.scale.toArray(),
    ]
  })
  return result
}

describe('VillagerModel', () => {
  it('builds identical named meshes and transforms from one visual seed', () => {
    expect(namedTransforms(new VillagerModel('v', 41, false).group)).toEqual(
      namedTransforms(new VillagerModel('v', 41, false).group),
    )
  })

  it('returns every authored pose to the exact idle pose', () => {
    const subject = new VillagerModel('v', 41, false)
    const idle = namedTransforms(subject.group)

    for (const pose of ['wake', 'carry', 'hammer', 'place', 'kneel'] as const) {
      subject.setProloguePose(pose, 3)
      subject.resetPose()
      expect(namedTransforms(subject.group)).toEqual(idle)
    }
  })

  it('restores the model transform after a prone pose', () => {
    const subject = new VillagerModel('villager-1', 7, false)
    subject.group.rotation.z = -Math.PI / 2
    subject.group.position.y = 0.27

    subject.resetPose()

    expect(subject.group.rotation.toArray()).toEqual([0, 0, 0, 'XYZ'])
    expect(subject.group.position.toArray()).toEqual([0, 0, 0])
  })

  it('authors a curled ground pose without rotating the complete rig', () => {
    const subject = new VillagerModel('villager-1', 7, false)

    subject.setNapPose(1.04)

    const bodyAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(subject.body.quaternion)
    expect(subject.group.rotation.toArray()).toEqual([0, 0, 0, 'XYZ'])
    expect(subject.group.scale.toArray()).toEqual([MODEL_SCALE, MODEL_SCALE, MODEL_SCALE])
    expect(Math.abs(bodyAxis.y)).toBeLessThan(0.01)
    expect(subject.body.position.y).toBeCloseTo(0.22)
    expect(subject.body.scale.x).toBeCloseTo(1.04)
    expect(subject.body.scale.y).toBeLessThan(0.9)
    expect(subject.head.position.x).toBeGreaterThan(subject.body.position.x + 0.2)
    expect(subject.head.position.z).toBeGreaterThan(subject.body.position.z + 0.2)
    expect(subject.head.position.y).toBeCloseTo(0.22)
    expect(subject.arms[1].position.y).toBeLessThan(subject.head.position.y)
    expect(subject.arms[0].position.y).toBeGreaterThan(subject.body.position.y)
    expect(subject.legs[0].position.z).toBeGreaterThan(subject.body.position.z + 0.15)
    expect(subject.legs[1].position.z).toBeGreaterThan(subject.legs[0].position.z)
  })

  it('restores every articulated part after sleeping', () => {
    const subject = new VillagerModel('villager-1', 7, false)
    const idle = namedTransforms(subject.group)

    subject.setNapPose(1.04)
    subject.resetPose()

    expect(namedTransforms(subject.group)).toEqual(idle)
  })
})

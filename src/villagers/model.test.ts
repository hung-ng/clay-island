import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { VillagerModel } from './model'

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
})

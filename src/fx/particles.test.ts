import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ParticleBurst } from './particles'

vi.mock('./clayMaterial', () => ({
  clayMaterial: (color: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color }),
}))

describe('ParticleBurst stage coordinates', () => {
  it('inherits the shared stage transform while keeping burst coordinates stage-local', () => {
    const stageRoot = new THREE.Group()
    stageRoot.position.y = 0.3
    const particles = new ParticleBurst(stageRoot, 1)

    particles.burst({
      x: 2,
      y: 1,
      z: -3,
      n: 1,
      color: 0xffffff,
      speed: 1,
      gravity: 1,
      life: 1,
    })
    stageRoot.updateMatrixWorld(true)

    const instance = new THREE.Matrix4()
    particles.mesh.getMatrixAt(0, instance)
    const local = new THREE.Vector3().setFromMatrixPosition(instance)
    const world = local.clone().applyMatrix4(particles.mesh.matrixWorld)

    expect(particles.mesh.parent).toBe(stageRoot)
    expect(world.y - local.y).toBeCloseTo(0.3)
  })
})

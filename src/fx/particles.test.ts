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

  it('supports spherical emission while preserving the default fountain', () => {
    const parent = new THREE.Group()
    const sphere = new ParticleBurst(parent, 32, 91)
    sphere.burst({
      x: 0, y: 5, z: 0, n: 32, color: 0xffffff,
      speed: 2, gravity: 0.5, life: 1, shape: 'sphere',
    })
    const matrix = new THREE.Matrix4()
    const before: number[] = []
    for (let index = 0; index < 32; index++) {
      sphere.mesh.getMatrixAt(index, matrix)
      before.push(new THREE.Vector3().setFromMatrixPosition(matrix).y)
    }
    sphere.update(0.1)
    const after: number[] = []
    for (let index = 0; index < 32; index++) {
      sphere.mesh.getMatrixAt(index, matrix)
      after.push(new THREE.Vector3().setFromMatrixPosition(matrix).y)
    }
    const verticalDeltas = after.map((value, index) => value - before[index]!)
    expect(verticalDeltas.some(value => value < 0)).toBe(true)
    expect(verticalDeltas.some(value => value > 0)).toBe(true)
    expect(sphere.activeCount).toBe(32)
  })

  it('clears deterministically and disposes owned resources', () => {
    const parent = new THREE.Group()
    const particles = new ParticleBurst(parent, 2, 12)
    const geometryDispose = vi.spyOn(particles.mesh.geometry, 'dispose')
    const material = particles.mesh.material as THREE.Material
    const materialDispose = vi.spyOn(material, 'dispose')
    particles.burst({
      x: 0, y: 0, z: 0, n: 2, color: 0xffffff,
      speed: 1, gravity: 1, life: 1,
    })
    particles.clear()
    expect(particles.activeCount).toBe(0)
    particles.dispose()
    expect(particles.mesh.parent).toBeNull()
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })
})

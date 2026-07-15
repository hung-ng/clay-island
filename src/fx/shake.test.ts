import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Shake } from './shake'

describe('Shake', () => {
  it('can clear its prior offset before orbit controls consume camera state', () => {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(2, 3, 4)
    const origin = camera.position.clone()
    const shake = new Shake(() => false)

    shake.add(0.8, 0.5)
    shake.update(0.1, camera)
    expect(camera.position.equals(origin)).toBe(false)

    shake.beginFrame(camera)

    expect(camera.position.x).toBeCloseTo(origin.x)
    expect(camera.position.y).toBeCloseTo(origin.y)
    expect(camera.position.z).toBeCloseTo(origin.z)
  })

  it('removes its previous offset when the trauma expires', () => {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(2, 3, 4)
    const origin = camera.position.clone()
    const shake = new Shake(() => false)

    shake.add(0.8, 0.5)
    shake.update(0.1, camera)
    expect(camera.position.equals(origin)).toBe(false)

    shake.update(0.5, camera)
    expect(camera.position.x).toBeCloseTo(origin.x)
    expect(camera.position.y).toBeCloseTo(origin.y)
    expect(camera.position.z).toBeCloseTo(origin.z)
  })

  it('removes any active offset and stops shaking when live reduced motion turns on', () => {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(2, 3, 4)
    const origin = camera.position.clone()
    let reduced = false
    const shake = new Shake(() => reduced)

    shake.add(0.8, 0.5)
    shake.update(0.1, camera)
    reduced = true
    shake.update(0.1, camera)

    expect(camera.position.x).toBeCloseTo(origin.x)
    expect(camera.position.y).toBeCloseTo(origin.y)
    expect(camera.position.z).toBeCloseTo(origin.z)
  })
})

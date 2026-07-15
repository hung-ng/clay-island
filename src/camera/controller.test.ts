import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CAMERA_HOME } from './policy'
import { CameraController, type CameraControlsPort } from './controller'

function fakeControls(): CameraControlsPort & { emit(type: 'start' | 'end'): void } {
  const listeners = { start: new Set<() => void>(), end: new Set<() => void>() }
  return {
    target: new THREE.Vector3(),
    cursor: new THREE.Vector3(),
    enabled: true,
    autoRotate: false,
    autoRotateSpeed: 0,
    enableDamping: false,
    enablePan: false,
    screenSpacePanning: true,
    zoomToCursor: false,
    minDistance: 0,
    maxDistance: Infinity,
    minTargetRadius: 0,
    maxTargetRadius: Infinity,
    touches: {},
    minPolarAngle: 0,
    maxPolarAngle: Math.PI,
    update: vi.fn(),
    dispose: vi.fn(),
    addEventListener: (type, listener) => listeners[type].add(listener),
    removeEventListener: (type, listener) => listeners[type].delete(listener),
    emit: type => { for (const listener of listeners[type]) listener() },
  }
}

describe('CameraController', () => {
  it('configures the constrained diorama controls', () => {
    const controls = fakeControls()
    const subject = new CameraController({
      camera: new THREE.PerspectiveCamera(),
      dom: new EventTarget() as HTMLElement,
      autoRotate: true,
      reducedMotion: () => false,
      controls,
    })

    expect(controls).toMatchObject({
      enablePan: true,
      enableDamping: true,
      zoomToCursor: true,
      minDistance: 15,
      maxDistance: 55,
      minPolarAngle: 0.6,
      maxPolarAngle: 1.35,
      maxTargetRadius: 7.5,
      autoRotateSpeed: 0.35,
    })
    expect(controls.cursor.toArray()).toEqual([0, 0, 0])
    expect(controls.touches).toEqual({ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN })
    subject.dispose()
  })

  it('composes lock reasons without unlocking another owner', () => {
    const controls = fakeControls()
    const subject = new CameraController({
      camera: new THREE.PerspectiveCamera(),
      dom: new EventTarget() as HTMLElement,
      autoRotate: true,
      reducedMotion: () => false,
      controls,
    })
    subject.lock('journal')
    subject.lock('settings')
    subject.unlock('journal')
    expect(controls.enabled).toBe(false)
    subject.unlock('settings')
    expect(controls.enabled).toBe(true)
  })

  it('reaches exact home after a reset and lets user input cancel the tween', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = fakeControls()
    const subject = new CameraController({
      camera,
      dom: new EventTarget() as HTMLElement,
      autoRotate: false,
      reducedMotion: () => false,
      controls,
    })
    camera.position.set(4, 9, 20)
    controls.target.set(3, 0, 4)
    subject.reset()
    subject.update(0.7)
    expect(camera.position.toArray()).toEqual([0, 14, 34])
    expect(controls.target.toArray()).toEqual([0, 0, 0])

    camera.position.set(4, 9, 20)
    subject.reset()
    controls.emit('start')
    subject.update(0.7)
    expect(camera.position.toArray()).toEqual([4, 9, 20])
  })

  it('applies the exact reset pose after controls damping has updated', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = fakeControls()
    controls.update = vi.fn(() => camera.position.addScalar(1))
    const subject = new CameraController({
      camera,
      dom: new EventTarget() as HTMLElement,
      autoRotate: false,
      reducedMotion: () => false,
      controls,
    })
    camera.position.set(4, 9, 20)
    subject.reset()
    subject.update(0.7)
    expect(camera.position.toArray()).toEqual([0, 14, 34])
    expect(controls.target.toArray()).toEqual([0, 0, 0])
  })

  it('reduced motion applies reset immediately and never auto-rotates', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = fakeControls()
    const subject = new CameraController({
      camera,
      dom: new EventTarget() as HTMLElement,
      autoRotate: true,
      reducedMotion: () => true,
      controls,
    })
    camera.position.set(1, 2, 3)
    subject.reset()
    expect(camera.position.toArray()).toEqual([0, 14, 34])
    subject.update(20)
    expect(controls.autoRotate).toBe(false)
  })

  it('finishes an in-flight reset if reduced motion becomes active', () => {
    let reduced = false
    const camera = new THREE.PerspectiveCamera()
    const controls = fakeControls()
    const subject = new CameraController({
      camera,
      dom: new EventTarget() as HTMLElement,
      autoRotate: true,
      reducedMotion: () => reduced,
      controls,
    })
    camera.position.set(1, 2, 3)
    subject.reset()
    subject.update(0.2)
    reduced = true
    subject.update(0.01)
    expect(camera.position.toArray()).toEqual([0, 14, 34])
    expect(controls.autoRotate).toBe(false)
  })

  it('recentres before auto-rotating after an idle user interaction', () => {
    const camera = new THREE.PerspectiveCamera()
    camera.position.copy(new THREE.Vector3(
      CAMERA_HOME.position.x,
      CAMERA_HOME.position.y,
      CAMERA_HOME.position.z,
    ))
    const controls = fakeControls()
    controls.target.set(4, 0, 3)
    const subject = new CameraController({
      camera,
      dom: new EventTarget() as HTMLElement,
      autoRotate: true,
      reducedMotion: () => false,
      controls,
    })

    controls.emit('start')
    controls.emit('end')
    subject.update(8)
    expect(controls.autoRotate).toBe(false)
    expect(controls.target.toArray()).toEqual([4, 0, 3])
    subject.update(1.2)
    expect(controls.target.toArray()).toEqual([0, 0, 0])
    expect(controls.autoRotate).toBe(true)
  })

  it('can disable automatic recentering while idle', () => {
    const camera = new THREE.PerspectiveCamera()
    const controls = fakeControls()
    controls.target.set(4, 0, 3)
    const subject = new CameraController({
      camera,
      dom: new EventTarget() as HTMLElement,
      autoRotate: true,
      reducedMotion: () => false,
      controls,
    })

    controls.emit('start')
    controls.emit('end')
    subject.setAutoRotate(false)
    subject.update(20)
    expect(controls.target.toArray()).toEqual([4, 0, 3])
    expect(controls.autoRotate).toBe(false)
  })

  it('suppresses only the context menu paired with a canvas right-button press', () => {
    const dom = new EventTarget()
    const subject = new CameraController({
      camera: new THREE.PerspectiveCamera(),
      dom: dom as HTMLElement,
      autoRotate: false,
      reducedMotion: () => false,
      controls: fakeControls(),
    })
    const unpaired = new Event('contextmenu', { cancelable: true })
    dom.dispatchEvent(unpaired)
    expect(unpaired.defaultPrevented).toBe(false)

    const rightDown = new Event('pointerdown')
    Object.defineProperty(rightDown, 'button', { value: 2 })
    dom.dispatchEvent(rightDown)
    const paired = new Event('contextmenu', { cancelable: true })
    dom.dispatchEvent(paired)
    expect(paired.defaultPrevented).toBe(true)

    const following = new Event('contextmenu', { cancelable: true })
    dom.dispatchEvent(following)
    expect(following.defaultPrevented).toBe(false)
    subject.dispose()
  })
})

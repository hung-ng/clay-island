import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  CAMERA_HOME,
  CAMERA_LIMITS,
  clampCameraTarget,
  maxPolarAngleAt,
  smooth01,
  type CameraPose,
} from './policy'

export type CameraLockReason = 'prologue' | 'targeting' | 'journal' | 'settings'

export type CameraControlsPort = {
  target: THREE.Vector3
  cursor: THREE.Vector3
  enabled: boolean
  autoRotate: boolean
  autoRotateSpeed: number
  enableDamping: boolean
  enablePan: boolean
  screenSpacePanning: boolean
  zoomToCursor: boolean
  minDistance: number
  maxDistance: number
  minTargetRadius: number
  maxTargetRadius: number
  minPolarAngle: number
  maxPolarAngle: number
  touches: { ONE?: THREE.TOUCH | null; TWO?: THREE.TOUCH | null }
  update(dt?: number): void
  dispose(): void
  addEventListener(type: 'start' | 'end', listener: () => void): void
  removeEventListener(type: 'start' | 'end', listener: () => void): void
}

export type CameraControllerOptions = {
  camera: THREE.PerspectiveCamera
  dom: HTMLElement
  autoRotate: boolean
  reducedMotion: () => boolean
  controls?: CameraControlsPort
}

type CameraTween = {
  kind: 'reset' | 'recenter'
  start: CameraPose
  end: CameraPose
  elapsed: number
  seconds: number
}

function vectorFrom(value: CameraPose['position']): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z)
}

function copyPose(pose: CameraPose): CameraPose {
  return {
    position: { ...pose.position },
    target: { ...pose.target },
  }
}

export class CameraController {
  readonly controls: CameraControlsPort
  private readonly camera: THREE.PerspectiveCamera
  private readonly dom: HTMLElement
  private readonly reducedMotion: () => boolean
  private readonly locks = new Set<CameraLockReason>()
  private autoRotateEnabled: boolean
  private interacting = false
  private idleElapsed = 0
  private tween: CameraTween | null = null
  private suppressNextContextMenu = false

  constructor(options: CameraControllerOptions) {
    this.camera = options.camera
    this.dom = options.dom
    this.reducedMotion = options.reducedMotion
    this.autoRotateEnabled = options.autoRotate
    this.controls = options.controls ?? new OrbitControls(options.camera, options.dom)

    this.controls.enablePan = true
    this.controls.enableDamping = true
    this.controls.zoomToCursor = true
    this.controls.minDistance = CAMERA_LIMITS.minDistance
    this.controls.maxDistance = CAMERA_LIMITS.maxDistance
    this.controls.minPolarAngle = CAMERA_LIMITS.minPolarAngle
    this.controls.maxPolarAngle = CAMERA_LIMITS.farMaxPolarAngle
    this.controls.cursor.set(0, 0, 0)
    this.controls.maxTargetRadius = CAMERA_LIMITS.targetRadius
    this.controls.touches.ONE = THREE.TOUCH.ROTATE
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
    this.controls.autoRotateSpeed = 0.35
    this.controls.autoRotate = options.autoRotate && !this.reducedMotion()

    this.controls.addEventListener('start', this.handleControlsStart)
    this.controls.addEventListener('end', this.handleControlsEnd)
    this.dom.addEventListener('pointerdown', this.handlePointerDown)
    this.dom.addEventListener('contextmenu', this.handleContextMenu)
  }

  lock(reason: CameraLockReason): void {
    this.locks.add(reason)
    this.controls.enabled = false
    this.controls.autoRotate = false
    this.interacting = false
    this.idleElapsed = 0
    this.tween = null
  }

  unlock(reason: CameraLockReason): void {
    if (!this.locks.delete(reason)) return
    if (this.locks.size > 0) return
    this.controls.enabled = true
    this.controls.autoRotate = false
    this.idleElapsed = 0
  }

  setAutoRotate(on: boolean): void {
    this.autoRotateEnabled = on
    if (!on) {
      this.controls.autoRotate = false
      if (this.tween?.kind === 'recenter') this.tween = null
      return
    }
    this.idleElapsed = 0
  }

  setPose(pose: CameraPose): void {
    this.tween = null
    this.applyPose(pose)
  }

  pose(): CameraPose {
    return {
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      target: {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z,
      },
    }
  }

  reset(): void {
    if (this.reducedMotion()) {
      this.controls.autoRotate = false
      this.flushControlsMotion()
      this.setPose(CAMERA_HOME)
      return
    }
    this.controls.autoRotate = false
    this.tween = {
      kind: 'reset',
      start: this.pose(),
      end: copyPose(CAMERA_HOME),
      elapsed: 0,
      seconds: CAMERA_LIMITS.resetSeconds,
    }
  }

  update(dt: number): void {
    const reduced = this.reducedMotion()
    if (reduced || this.locks.size > 0 || !this.autoRotateEnabled) {
      this.controls.autoRotate = false
    }

    if (reduced && this.tween) {
      if (this.tween.kind === 'reset') {
        this.flushControlsMotion()
        this.applyPose(this.tween.end)
      }
      this.tween = null
    }

    const tweenAtFrameStart = this.tween
    if (this.locks.size === 0) this.controls.update(dt)
    if (tweenAtFrameStart) this.advanceTween(tweenAtFrameStart, dt)

    if (!tweenAtFrameStart && !this.interacting && this.locks.size === 0) {
      this.advanceIdle(dt, reduced)
    }

    this.enforcePolicy()
  }

  distance(): number {
    return this.camera.position.distanceTo(this.controls.target)
  }

  dispose(): void {
    this.controls.removeEventListener('start', this.handleControlsStart)
    this.controls.removeEventListener('end', this.handleControlsEnd)
    this.dom.removeEventListener('pointerdown', this.handlePointerDown)
    this.dom.removeEventListener('contextmenu', this.handleContextMenu)
    this.controls.dispose()
  }

  private advanceIdle(dt: number, reduced: boolean): void {
    if (reduced || !this.autoRotateEnabled) return
    if (this.controls.autoRotate) return
    this.idleElapsed += dt
    if (this.idleElapsed < CAMERA_LIMITS.idleSeconds) return

    const targetOffset = Math.hypot(this.controls.target.x, this.controls.target.z)
    if (targetOffset <= 1e-6) {
      this.controls.autoRotate = true
      return
    }

    const start = this.pose()
    this.tween = {
      kind: 'recenter',
      start,
      end: {
        position: {
          x: start.position.x - start.target.x,
          y: start.position.y - start.target.y,
          z: start.position.z - start.target.z,
        },
        target: { x: 0, y: 0, z: 0 },
      },
      elapsed: 0,
      seconds: CAMERA_LIMITS.recenterSeconds,
    }
  }

  private advanceTween(tween: CameraTween, dt: number): void {
    tween.elapsed = Math.min(tween.seconds, tween.elapsed + Math.max(0, dt))
    const progress = smooth01(tween.elapsed / tween.seconds)
    const startPosition = vectorFrom(tween.start.position)
    const endPosition = vectorFrom(tween.end.position)
    const startTarget = vectorFrom(tween.start.target)
    const endTarget = vectorFrom(tween.end.target)
    const position = startPosition.lerp(endPosition, progress)
    const target = startTarget.lerp(endTarget, progress)
    this.applyPose({ position, target })

    if (tween.elapsed < tween.seconds) return
    this.flushControlsMotion()
    this.applyPose(tween.end)
    this.tween = null
    this.idleElapsed = 0
    if (tween.kind === 'recenter'
      && this.autoRotateEnabled
      && !this.reducedMotion()
      && this.locks.size === 0) {
      this.controls.autoRotate = true
    }
  }

  private applyPose(pose: CameraPose): void {
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z)
    const target = clampCameraTarget(pose.target)
    this.controls.target.set(target.x, target.y, target.z)
    this.camera.lookAt(this.controls.target)
  }

  private flushControlsMotion(): void {
    const damping = this.controls.enableDamping
    this.controls.enableDamping = false
    this.controls.update(0)
    this.controls.enableDamping = damping
  }

  private enforcePolicy(): void {
    const target = clampCameraTarget(this.controls.target)
    if (this.controls.target.x !== target.x
      || this.controls.target.y !== target.y
      || this.controls.target.z !== target.z) {
      this.controls.target.set(target.x, target.y, target.z)
      this.camera.lookAt(this.controls.target)
    }
    this.controls.maxPolarAngle = maxPolarAngleAt(this.distance())
  }

  private readonly handleControlsStart = (): void => {
    this.interacting = true
    this.tween = null
    this.controls.autoRotate = false
    this.idleElapsed = 0
  }

  private readonly handleControlsEnd = (): void => {
    this.interacting = false
    this.idleElapsed = 0
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.suppressNextContextMenu = event.button === 2
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (!this.suppressNextContextMenu) return
    this.suppressNextContextMenu = false
    event.preventDefault()
  }
}

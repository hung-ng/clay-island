import * as THREE from 'three'
import type { PowerId, TargetKind } from '../core/events'
import { clayMaterial } from '../fx/clayMaterial'
import { PALETTE } from '../ui/tokens'
import { ISLAND_RADIUS, type Island } from '../world/island'
import type { World } from '../world/world'

type PointerArm = {
  id: PowerId
  pointerId: number
  clientX: number
  clientY: number
  button: HTMLButtonElement
}

const TARGET_LABELS: Record<TargetKind, string> = {
  ground: 'over open ground',
  tree: 'over a tree',
  hut: 'over a hut',
  villager: 'over a villager',
  pond: 'over a pond',
  crater: 'over a crater',
  campfire: 'over the campfire',
}

function powerButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null
  const button = target.closest<HTMLButtonElement>('button[data-power]')
  return !button || button.disabled ? null : button
}

export function pointInsideClientRect(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>,
): boolean {
  return clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom
}

export function pointerDragMode(
  clientX: number,
  clientY: number,
  originRect: Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'> | null,
): 'cancel' | 'target' {
  return originRect && pointInsideClientRect(clientX, clientY, originRect)
    ? 'cancel'
    : 'target'
}

export function cameraRelativeOffset(
  key: string,
  forwardX: number,
  forwardZ: number,
  step = 2,
): [number, number] | null {
  const length = Math.hypot(forwardX, forwardZ)
  if (length <= Number.EPSILON) return null
  const fx = forwardX / length
  const fz = forwardZ / length
  const rx = -fz
  const rz = fx
  const clean = (value: number): number => Math.abs(value) < 1e-12 ? 0 : value

  switch (key) {
    case 'ArrowUp': return [clean(fx * step), clean(fz * step)]
    case 'ArrowDown': return [clean(-fx * step), clean(-fz * step)]
    case 'ArrowRight': return [clean(rx * step), clean(rz * step)]
    case 'ArrowLeft': return [clean(-rx * step), clean(-rz * step)]
    default: return null
  }
}

export class DragTargeting {
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly cameraForward = new THREE.Vector3()
  private readonly islandWorldRotation = new THREE.Quaternion()
  private readonly reticle: THREE.Mesh<THREE.RingGeometry, THREE.MeshToonMaterial>
  private readonly liveRegion: HTMLDivElement
  private activePower: PowerId | null = null
  private activePointerId: number | null = null
  private pendingPointer: PointerArm | null = null
  private keyboardMode = false
  private validTarget = false
  private targetKind: TargetKind = 'ground'
  private targetX = 0
  private targetZ = 0
  private focusOrigin: HTMLButtonElement | null = null
  private pointerOrigin: HTMLButtonElement | null = null
  private cancelPreview = false
  private previousCursor = ''

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly island: Island,
    private readonly world: World,
    private readonly onFire: (id: PowerId, x: number, z: number, kind: TargetKind) => void,
    private readonly onActiveChange?: (active: boolean) => void,
  ) {
    const geometry = new THREE.RingGeometry(0.7, 0.94, 32)
    const material = clayMaterial(PALETTE.paper, { flat: true })
    material.side = THREE.DoubleSide
    material.depthWrite = false
    this.reticle = new THREE.Mesh(geometry, material)
    this.reticle.name = 'power-target-reticle'
    this.reticle.rotation.x = -Math.PI / 2
    this.reticle.renderOrder = 3
    this.reticle.visible = false
    this.island.group.add(this.reticle)

    this.liveRegion = document.createElement('div')
    this.liveRegion.className = 'target-readout'
    this.liveRegion.setAttribute('role', 'status')
    this.liveRegion.setAttribute('aria-live', 'polite')
    this.liveRegion.setAttribute('aria-atomic', 'true')
    const overlay = document.getElementById('ui') ?? document.body
    overlay.appendChild(this.liveRegion)

    document.addEventListener('pointerdown', this.capturePointerArm, true)
    addEventListener('pointermove', this.movePointer)
    addEventListener('pointerup', this.releasePointer)
    addEventListener('pointercancel', this.cancelPointer)
    document.addEventListener('keydown', this.handleKey)
  }

  arm(id: PowerId): void {
    const pointerArm = this.pendingPointer?.id === id ? this.pendingPointer : null
    if (this.activePower) this.cancel(false)
    if (pointerArm) this.pendingPointer = pointerArm
    this.activePower = id
    this.focusOrigin = pointerArm?.button ?? (document.activeElement instanceof HTMLButtonElement
      ? document.activeElement
      : document.querySelector<HTMLButtonElement>(`button[data-power="${id}"]`))
    this.pointerOrigin = pointerArm?.button ?? null
    this.previousCursor = this.dom.style.cursor
    this.dom.style.cursor = 'crosshair'
    this.liveRegion.classList.add('active')
    this.onActiveChange?.(true)

    if (pointerArm) {
      this.keyboardMode = false
      this.activePointerId = pointerArm.pointerId
      this.updateFromPointer(pointerArm.clientX, pointerArm.clientY)
      return
    }

    this.keyboardMode = true
    this.activePointerId = null
    this.setTarget(0, 0)
  }

  cancel(returnFocus = false): void {
    if (!this.activePower) return
    this.setCancelPreview(false)
    this.activePower = null
    this.activePointerId = null
    this.pendingPointer = null
    this.keyboardMode = false
    this.validTarget = false
    this.reticle.visible = false
    this.pointerOrigin = null
    this.dom.style.cursor = this.previousCursor
    this.liveRegion.classList.remove('active')
    this.liveRegion.textContent = ''
    if (returnFocus) this.focusOrigin?.focus({ preventScroll: true })
    this.focusOrigin = null
    this.onActiveChange?.(false)
  }

  update(): void {
    if (!this.activePower || this.cancelPreview || !this.validTarget) return
    this.reticle.position.y = this.island.sampleHeight(this.targetX, this.targetZ) + 0.08
    this.setTargetKind(this.world.resolveTarget(this.targetX, this.targetZ))
  }

  private readonly capturePointerArm = (event: PointerEvent): void => {
    const button = powerButton(event.target)
    const id = button?.dataset.power as PowerId | undefined
    if (!button || !id || event.button !== 0) {
      this.pendingPointer = null
      return
    }
    this.pendingPointer = {
      id,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      button,
    }
  }

  private readonly movePointer = (event: PointerEvent): void => {
    if (!this.activePower || this.keyboardMode || event.pointerId !== this.activePointerId) return
    this.updateFromPointer(event.clientX, event.clientY)
  }

  private readonly releasePointer = (event: PointerEvent): void => {
    if (!this.activePower || this.keyboardMode || event.pointerId !== this.activePointerId) return
    this.updateFromPointer(event.clientX, event.clientY)
    if (this.cancelPreview) {
      this.cancel(false)
      return
    }
    if (this.validTarget) this.fire()
    else this.cancel(false)
  }

  private readonly cancelPointer = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) this.cancel(false)
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (!this.activePower) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel(true)
      return
    }
    if (!this.keyboardMode) return
    if (event.key === 'Enter') {
      event.preventDefault()
      this.fire()
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      return
    }

    this.camera.getWorldDirection(this.cameraForward)
    this.island.group.getWorldQuaternion(this.islandWorldRotation)
    this.cameraForward.applyQuaternion(this.islandWorldRotation.invert())
    const offset = cameraRelativeOffset(
      event.key,
      this.cameraForward.x,
      this.cameraForward.z,
    )
    if (!offset) return
    event.preventDefault()
    const x = this.targetX + offset[0]
    const z = this.targetZ + offset[1]
    if (Math.hypot(x, z) <= ISLAND_RADIUS - 0.5) this.setTarget(x, z)
  }

  private updateFromPointer(clientX: number, clientY: number): void {
    const cancelSurface = this.pointerOrigin?.closest<HTMLElement>('.power-shell')
      ?? this.pointerOrigin
    const mode = pointerDragMode(
      clientX,
      clientY,
      cancelSurface?.getBoundingClientRect() ?? null,
    )
    this.setCancelPreview(mode === 'cancel')
    if (this.cancelPreview) return

    const rect = this.dom.getBoundingClientRect()
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.camera.updateMatrixWorld()
    this.island.topMesh.updateWorldMatrix(true, false)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.island.topMesh, false)[0]
    if (!hit) {
      this.validTarget = false
      this.reticle.visible = false
      this.liveRegion.textContent = 'Move over the island'
      return
    }
    const local = this.island.group.worldToLocal(hit.point.clone())
    this.setTarget(local.x, local.z)
  }

  private setCancelPreview(active: boolean): void {
    if (this.cancelPreview === active) return
    this.cancelPreview = active
    this.pointerOrigin?.toggleAttribute('data-cancel-target', active)
    this.liveRegion.classList.toggle('cancel-preview', active)

    if (active) {
      this.validTarget = false
      this.reticle.visible = false
      this.liveRegion.textContent = 'Release to cancel'
      return
    }

    // Force the next raycast to restore its visible target label even when the
    // pointer returns to the same target kind it was over before cancellation.
    this.liveRegion.textContent = ''
  }

  private setTarget(x: number, z: number): void {
    this.targetX = x
    this.targetZ = z
    this.validTarget = true
    this.reticle.position.set(x, this.island.sampleHeight(x, z) + 0.08, z)
    this.reticle.visible = true
    this.setTargetKind(this.world.resolveTarget(x, z))
  }

  private setTargetKind(kind: TargetKind): void {
    if (kind === this.targetKind && this.liveRegion.textContent) return
    this.targetKind = kind
    this.liveRegion.textContent = TARGET_LABELS[kind]
  }

  private fire(): void {
    if (!this.activePower || !this.validTarget) return
    const { activePower, targetX, targetZ, targetKind } = this
    this.cancel(false)
    this.onFire(activePower, targetX, targetZ, targetKind)
  }
}

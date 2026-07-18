import * as THREE from 'three'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE } from '../ui/tokens'

export type VillagerProloguePose = 'idle' | 'wake' | 'carry' | 'hammer' | 'place' | 'kneel'

export const MODEL_SCALE = 0.75

type PartTransform = {
  part: THREE.Object3D
  position: THREE.Vector3
  rotation: THREE.Euler
  scale: THREE.Vector3
}

const MODEL_UP = new THREE.Vector3(0, 1, 0)
const NAP_DIRECTION = new THREE.Vector3()
const SMOCK_COLORS = [PALETTE.smockA, PALETTE.smockB, PALETTE.smockC] as const

function smockColor(id: string, rng: RNG): string {
  // Preserve the visual RNG stream so changing color assignment does not
  // reshape the seeded clay geometry that follows this draw.
  const seededFallback = rng.pick(SMOCK_COLORS)
  const serial = /^villager-(\d+)$/.exec(id)?.[1]
  if (serial === undefined) return seededFallback
  return SMOCK_COLORS[Number(serial) % SMOCK_COLORS.length]!
}

function orientOnGround(part: THREE.Object3D, angle: number): void {
  NAP_DIRECTION.set(Math.cos(angle), 0, Math.sin(angle))
  part.quaternion.setFromUnitVectors(MODEL_UP, NAP_DIRECTION)
}

export class VillagerModel {
  readonly group = new THREE.Group()
  readonly body: THREE.Mesh
  readonly head: THREE.Mesh
  readonly arms: [THREE.Mesh, THREE.Mesh]
  readonly legs: [THREE.Mesh, THREE.Mesh]
  readonly axe: THREE.Group
  readonly materials: THREE.MeshToonMaterial[] = []
  readonly cleanColors: THREE.Color[] = []
  private readonly idlePartTransforms: PartTransform[] = []

  constructor(id: string, visualSeed: number, lowFx: boolean) {
    const rng = new RNG(visualSeed)
    this.group.name = `${id}-model`

    const smock = smockColor(id, rng)
    this.body = new THREE.Mesh(
      wobble(new THREE.CapsuleGeometry(0.22, 0.34, 5, 10), rng, 0.035),
      clayMaterial(smock),
    )
    this.body.name = 'villager-body'
    this.body.position.y = 0.44
    this.addPart(this.body, lowFx)

    this.head = new THREE.Mesh(
      wobble(new THREE.SphereGeometry(0.22, 12, 9), rng, 0.035),
      clayMaterial(PALETTE.skin),
    )
    this.head.name = 'villager-head'
    this.head.position.y = 0.94
    this.head.scale.set(1, 0.96, 0.94)
    this.addPart(this.head, lowFx)

    const arms: THREE.Mesh[] = []
    const legs: THREE.Mesh[] = []
    for (const side of [-1, 1] as const) {
      const arm = new THREE.Mesh(
        wobble(new THREE.CapsuleGeometry(0.065, 0.2, 4, 8), rng, 0.018),
        clayMaterial(PALETTE.skin),
      )
      arm.name = side < 0 ? 'villager-arm-left' : 'villager-arm-right'
      arm.position.set(side * 0.28, 0.51, 0)
      arm.rotation.z = side * -0.28
      arm.userData.baseRotation = arm.rotation.z
      arms.push(arm)
      this.addPart(arm, lowFx)

      const leg = new THREE.Mesh(
        wobble(new THREE.CapsuleGeometry(0.075, 0.13, 4, 8), rng, 0.018),
        clayMaterial(PALETTE.skin),
      )
      leg.name = side < 0 ? 'villager-leg-left' : 'villager-leg-right'
      leg.position.set(side * 0.11, 0.12, 0)
      legs.push(leg)
      this.addPart(leg, lowFx)
    }
    this.arms = [arms[0]!, arms[1]!]
    this.legs = [legs[0]!, legs[1]!]
    this.group.scale.setScalar(MODEL_SCALE)

    this.axe = new THREE.Group()
    this.axe.name = 'villager-axe'
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.62, 5),
      clayMaterial(PALETTE.bark),
    )
    handle.name = 'villager-axe-handle'
    const axeHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.12, 0.07),
      clayMaterial(PALETTE.stone),
    )
    axeHead.name = 'villager-axe-head'
    axeHead.position.y = 0.3
    handle.castShadow = !lowFx
    axeHead.castShadow = !lowFx
    this.axe.add(handle, axeHead)
    this.axe.position.set(-0.27, 0.62, 0.05)
    this.axe.rotation.z = -0.7
    this.axe.visible = false
    this.group.add(this.axe)

    for (const part of [this.body, this.head, ...this.arms, ...this.legs]) {
      this.idlePartTransforms.push({
        part,
        position: part.position.clone(),
        rotation: part.rotation.clone(),
        scale: part.scale.clone(),
      })
    }
  }

  resetPose(): void {
    this.group.position.set(0, 0, 0)
    this.group.rotation.set(0, 0, 0)
    this.group.scale.setScalar(MODEL_SCALE)
    for (const transform of this.idlePartTransforms) {
      transform.part.position.copy(transform.position)
      transform.part.rotation.copy(transform.rotation)
      transform.part.scale.copy(transform.scale)
    }
    this.axe.rotation.z = -0.7
    this.axe.visible = false
  }

  setNapPose(breathe: number): void {
    this.resetPose()

    // The root stays upright. Each piece is arranged on the ground so the
    // silhouette reads as a curled body instead of a rotated standing rig.
    this.body.position.set(0, 0.22, 0)
    orientOnGround(this.body, 0.08)
    this.body.scale.x = breathe
    this.body.scale.y = 0.82

    this.head.position.set(0.31, 0.22, 0.27)

    // Right arm becomes a pillow; left arm drapes visibly over the torso.
    this.arms[1].position.set(0.3, 0.1, 0.2)
    orientOnGround(this.arms[1], 1.28)
    this.arms[0].position.set(0.05, 0.39, 0.08)
    orientOnGround(this.arms[0], 1.18)

    // Both short legs pull toward the face side at different angles, closing
    // the silhouette into a compact C instead of extending the standing body.
    this.legs[0].position.set(-0.23, 0.1, 0.2)
    orientOnGround(this.legs[0], 0.32)
    this.legs[1].position.set(-0.34, 0.1, 0.3)
    orientOnGround(this.legs[1], 0.82)
  }

  setProloguePose(pose: VillagerProloguePose, frame: number): void {
    this.resetPose()
    if (pose === 'wake') {
      this.group.scale.y = MODEL_SCALE * (0.72 + Math.min(1, frame / 4) * 0.28)
    }
    if (pose === 'carry') {
      this.arms[0].rotation.z = -1.35
      this.arms[1].rotation.z = 1.35
    }
    if (pose === 'hammer') {
      const raised = frame % 2 === 0
      this.axe.visible = true
      this.arms[0].rotation.z = raised ? -1.9 : -0.8
      this.arms[1].rotation.z = raised ? 1.9 : 0.8
      this.axe.rotation.z = raised ? -1.2 : -0.35
    }
    if (pose === 'place') {
      this.arms[0].rotation.z = -1.7
      this.arms[1].rotation.z = 1.7
    }
    if (pose === 'kneel') {
      this.group.scale.set(MODEL_SCALE, MODEL_SCALE * 0.72, MODEL_SCALE)
      this.head.rotation.x = 0.28
      this.arms[0].rotation.z = -1.1
      this.arms[1].rotation.z = 1.1
    }
  }

  restoreColors(): void {
    this.materials.forEach((material, index) => material.color.copy(this.cleanColors[index]!))
  }

  dispose(): void {
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    })
  }

  private addPart(mesh: THREE.Mesh, lowFx: boolean): void {
    mesh.castShadow = !lowFx
    if (mesh.material instanceof THREE.MeshToonMaterial) {
      this.materials.push(mesh.material)
      this.cleanColors.push(mesh.material.color.clone())
    }
    this.group.add(mesh)
  }
}

import * as THREE from 'three'
import { clayMaterial } from '../fx/clayMaterial'
import { PALETTE } from '../ui/tokens'
import { VillagerModel } from '../villagers/model'
import type { InitialVillagerSpec } from '../world/blueprint'
import type { ActorState } from './choreography'

function actorNumber(id: string): number {
  const match = id.match(/(\d+)$/)
  return match ? Number(match[1]) : 0
}

function carriedProp(spec: InitialVillagerSpec, lowFx: boolean): THREE.Object3D {
  const wood = actorNumber(spec.id) < 4
  const mesh = wood
    ? new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.07, 0.52, 6),
        clayMaterial(PALETTE.bark),
      )
    : new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.14, 0),
        clayMaterial(PALETTE.stone),
      )
  mesh.name = `${spec.id}-carried-${wood ? 'wood' : 'stone'}`
  mesh.position.set(0, -0.22, 0.08)
  mesh.rotation.z = wood ? Math.PI / 2 : 0
  mesh.castShadow = !lowFx
  mesh.visible = false
  return mesh
}

export class PrologueActor {
  readonly group = new THREE.Group()
  readonly model: VillagerModel
  private readonly carried: THREE.Object3D
  private readonly shadow: THREE.Mesh | null
  private disposed = false

  constructor(readonly spec: InitialVillagerSpec, lowFx: boolean) {
    this.group.name = spec.id
    this.model = new VillagerModel(spec.id, spec.visualSeed, lowFx)
    this.carried = carriedProp(spec, lowFx)
    this.model.arms[0].add(this.carried)
    this.group.add(this.model.group)
    this.shadow = lowFx ? this.createBlobShadow() : null
  }

  apply(state: ActorState): void {
    this.group.position.set(state.position.x, state.position.y, state.position.z)
    this.group.rotation.set(0, state.facing, 0)
    this.model.setProloguePose(state.pose, state.frame)
    this.carried.visible = state.carry !== null
  }

  settle(y: number): void {
    this.group.position.set(this.spec.x, y, this.spec.z)
    this.group.rotation.set(0, this.spec.facing, 0)
    this.model.resetPose()
    this.carried.visible = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.model.dispose()
    this.shadow?.geometry.dispose()
    if (this.shadow) {
      const materials = Array.isArray(this.shadow.material)
        ? this.shadow.material
        : [this.shadow.material]
      for (const material of materials) material.dispose()
    }
  }

  private createBlobShadow(): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      color: PALETTE.scorch,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 18), material)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.018
    shadow.renderOrder = 1
    this.group.add(shadow)
    return shadow
  }
}

import * as THREE from 'three'
import { PALETTE } from '../ui/tokens'

const SCORCH = new THREE.Color(PALETTE.scorch)

/** One scorch value driving every material an object owns. */
export class Charring {
  private readonly materials: THREE.MeshToonMaterial[] = []
  private readonly baseColors: THREE.Color[] = []
  private value = 0

  constructor(materials: readonly THREE.MeshToonMaterial[]) {
    this.add(...materials)
  }

  /** Register more materials. Their current colour is taken as their base. */
  add(...materials: THREE.MeshToonMaterial[]): void {
    for (const material of materials) {
      this.materials.push(material)
      this.baseColors.push(material.color.clone())
    }
    this.apply()
  }

  set(amount: number): void {
    this.value = THREE.MathUtils.clamp(amount, 0, 1)
    this.apply()
  }

  get amount(): number {
    return this.value
  }

  private apply(): void {
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i]!.color.copy(this.baseColors[i]!).lerp(SCORCH, this.value)
    }
  }
}

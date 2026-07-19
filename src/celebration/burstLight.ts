import * as THREE from 'three'
import { PALETTE } from '../ui/tokens'

export const BURST_LIGHT = {
  /** Metres above the resolved celebration centre. */
  height: 10,
  distance: 34,
  /** Intensity added per shell burst; finale shells hit harder. */
  peak: 5,
  finalePeak: 8,
  /** Overlapping bursts combine but never exceed this. */
  maxIntensity: 12,
  decaySeconds: 0.5,
} as const

/** Sharp attack happens in onBurst; this is the ~0.5 s linear die-off. */
export function decayedBurstIntensity(current: number, dt: number): number {
  return Math.max(0, current - (BURST_LIGHT.peak / BURST_LIGHT.decaySeconds) * dt)
}

/**
 * One pooled point light above the celebration site that flashes the island in
 * each shell's color. Reused across all launches and replays; skipped entirely
 * on reduced quality (the composition root simply never constructs it).
 */
export class CelebrationBurstLight {
  readonly light: THREE.PointLight

  constructor(parent: THREE.Object3D) {
    this.light = new THREE.PointLight(PALETTE.cloud, 0, BURST_LIGHT.distance)
    this.light.name = 'celebration-burst-light'
    this.light.visible = false
    parent.add(this.light)
  }

  begin(centre: { x: number; y: number; z: number }): void {
    this.light.position.set(centre.x, centre.y + BURST_LIGHT.height, centre.z)
  }

  onBurst(color: string, finale: boolean): void {
    const added = finale ? BURST_LIGHT.finalePeak : BURST_LIGHT.peak
    this.light.color.set(color)
    this.light.intensity = Math.min(BURST_LIGHT.maxIntensity, this.light.intensity + added)
    this.light.visible = true
  }

  update(dt: number): void {
    if (!this.light.visible) return
    this.light.intensity = decayedBurstIntensity(this.light.intensity, Math.max(0, dt))
    if (this.light.intensity <= 0.01) {
      this.light.intensity = 0
      this.light.visible = false
    }
  }

  reset(): void {
    this.light.intensity = 0
    this.light.visible = false
  }

  dispose(): void {
    this.reset()
    this.light.removeFromParent()
    this.light.dispose()
  }
}

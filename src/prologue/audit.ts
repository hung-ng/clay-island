import * as THREE from 'three'

export type EmberMask = { x: number; y: number; radius: number }
export type FrameDiff = {
  changed: number
  compared: number
  changedRatio: number
  pass: boolean
}
export type Framebuffer = {
  pixels: Uint8Array
  width: number
  height: number
}

export function compareFramebuffers(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
  height: number,
  mask: EmberMask | null,
): FrameDiff {
  const expectedLength = width * height * 4
  if (width < 0 || height < 0 || before.length !== expectedLength || after.length !== expectedLength) {
    throw new Error('Framebuffer dimensions do not match pixel buffers')
  }

  let changed = 0
  let compared = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask && Math.hypot(x - mask.x, y - mask.y) <= mask.radius) continue
      compared++
      const offset = (y * width + x) * 4
      if ([0, 1, 2].some(channel => (
        Math.abs(before[offset + channel]! - after[offset + channel]!) > 2
      ))) changed++
    }
  }
  const changedRatio = compared === 0 ? 0 : changed / compared
  return { changed, compared, changedRatio, pass: changedRatio <= 0.001 }
}

export function readFramebuffer(renderer: THREE.WebGLRenderer): Framebuffer {
  const gl = renderer.getContext()
  const width = gl.drawingBufferWidth
  const height = gl.drawingBufferHeight
  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return { pixels, width, height }
}

const projectedPosition = new THREE.Vector3()

export function projectEmberMask(
  object: THREE.Object3D,
  camera: THREE.Camera,
  width: number,
  height: number,
  radius = 64,
): EmberMask {
  object.getWorldPosition(projectedPosition)
  projectedPosition.project(camera)
  return {
    x: (projectedPosition.x * 0.5 + 0.5) * width,
    y: (projectedPosition.y * 0.5 + 0.5) * height,
    radius,
  }
}

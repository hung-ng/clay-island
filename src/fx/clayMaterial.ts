import * as THREE from 'three'
import { PALETTE } from '../ui/tokens'

let ramp: THREE.Texture | null = null
function toonRamp(): THREE.Texture {
  if (ramp) return ramp
  const c = document.createElement('canvas'); c.width = 128; c.height = 1
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 128, 0)
  // 3 bands with soft transitions — the "lit plasticine" ramp
  grad.addColorStop(0.0, PALETTE.toonShadow); grad.addColorStop(0.28, PALETTE.toonShadow)
  grad.addColorStop(0.38, PALETTE.toonMid); grad.addColorStop(0.62, PALETTE.toonMid)
  grad.addColorStop(0.72, PALETTE.unmodulated); grad.addColorStop(1.0, PALETTE.unmodulated)
  g.fillStyle = grad; g.fillRect(0, 0, 128, 1)
  ramp = new THREE.CanvasTexture(c)
  ramp.colorSpace = THREE.NoColorSpace
  // LinearFilter (not Nearest) is deliberate: we want the SOFT band transitions
  // baked into the gradient above, not hard cel edges. ClampToEdge is required —
  // without it the ramp wraps and the terminator gets a bright fringe.
  ramp.minFilter = ramp.magFilter = THREE.LinearFilter
  ramp.wrapS = ramp.wrapT = THREE.ClampToEdgeWrapping
  ramp.generateMipmaps = false
  return ramp
}

export function clayMaterial(color: THREE.ColorRepresentation, opts: { flat?: boolean } = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() })
  if (!opts.flat) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vClayPos;')
        // World-ish position, so InstancedMesh instances each get their own clay
        // grain and hue instead of all sharing the local-space one.
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vClayPos = (instanceMatrix * vec4(position, 1.0)).xyz;
#else
  vClayPos = position;
#endif`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vClayPos;
float clayHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
        // MeshToonMaterial has NO <normal_fragment_maps> chunk — patching it is a
        // silent no-op. <normal_fragment_begin> is the one that defines `normal`.
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
// fingerprint-scale dents: perturb the normal with high-frequency hash noise
vec3 dent = vec3(
  clayHash(floor(vClayPos * 40.0)),
  clayHash(floor(vClayPos * 40.0 + 13.0)),
  clayHash(floor(vClayPos * 40.0 + 47.0))) - 0.5;
normal = normalize(normal + dent * 0.18);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
// hand-mixed clay: subtle low-frequency color unevenness
float tint = clayHash(floor(vClayPos * 3.0)) * 0.08 - 0.04;
diffuseColor.rgb *= 1.0 + tint;`)
    }
    // Without this, three caches the compiled program by material *type* and the
    // flat and non-flat variants collide — whichever compiles first wins for both.
    mat.customProgramCacheKey = () => 'clay'
  } else {
    mat.customProgramCacheKey = () => 'clay-flat'
  }
  return mat
}

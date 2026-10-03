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

export type ClayOptions = {
  /** Skip the thumbprint/tint/rim shader patch (clouds, water). */
  flat?: boolean
  /**
   * Self-lit strength. Flame, embers and other light sources set this well past
   * 1 so the HDR bloom pass picks them out; lit clay never gets that bright.
   */
  glow?: number
  /**
   * What colour the glow is, if not the clay's own. Flames glow yellower than
   * they look: an orange pushed into HDR tone-maps toward pink.
   */
  glowColor?: THREE.ColorRepresentation
  /**
   * Edge brightening, 0 to switch off. Ground seen at a grazing angle would read
   * as all rim, so the island top turns it off.
   */
  rim?: number
}

const DEFAULT_RIM = 0.45

export function clayMaterial(color: THREE.ColorRepresentation, opts: ClayOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() })
  if (opts.glow) {
    mat.emissive.set(opts.glowColor ?? color)
    mat.emissiveIntensity = opts.glow
  }
  if (!opts.flat) {
    const rim = { value: opts.rim ?? DEFAULT_RIM }
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.clayRimStrength = rim
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
uniform float clayRimStrength;
// Smooth three-channel value noise. Sampling a raw hash per floor() cell (as
// this used to) gives hard-edged cells that read as voxel speckle up close and
// as a faint checkerboard across the ground. One vec3 hash per lattice corner
// feeds all three dent axes at once, keeping it cheap enough for laptop GPUs.
vec3 clayHash3(vec3 p) {
  return fract(sin(vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}
vec3 clayNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(clayHash3(i), clayHash3(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(clayHash3(i + vec3(0.0, 1.0, 0.0)), clayHash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(clayHash3(i + vec3(0.0, 0.0, 1.0)), clayHash3(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(clayHash3(i + vec3(0.0, 1.0, 1.0)), clayHash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}`)
        // MeshToonMaterial has NO <normal_fragment_maps> chunk — patching it is a
        // silent no-op. <normal_fragment_begin> is the one that defines `normal`.
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
// thumb-pressed undulation plus finer fingerprint texture
normal = normalize(normal + (clayNoise3(vClayPos * 7.0) - 0.5) * 0.32 + (clayNoise3(vClayPos * 23.0) - 0.5) * 0.16);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
// hand-mixed clay: subtle low-frequency color unevenness
diffuseColor.rgb *= 1.0 + (clayNoise3(vClayPos * 2.3).x - 0.5) * 0.14;`)
        // Per-vertex and per-instance colour tints the glow too, so one pooled
        // material can carry many differently-coloured lights (firework sparks).
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
totalEmissiveRadiance *= vColor.rgb;
#endif`)
        // Light scatters a little way into real clay, so silhouettes glow softly
        // instead of ending on a hard cel edge. Multiplicative, so it follows the
        // light: bright at noon, barely there at night.
        .replace('#include <opaque_fragment>', `float clayRim = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
outgoingLight *= 1.0 + clayRim * clayRim * clayRim * clayRimStrength;
#include <opaque_fragment>`)
    }
    // Without this, three caches the compiled program by material *type* and the
    // flat and non-flat variants collide — whichever compiles first wins for both.
    mat.customProgramCacheKey = () => 'clay'
  } else {
    mat.customProgramCacheKey = () => 'clay-flat'
  }
  return mat
}

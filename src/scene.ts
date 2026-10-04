import * as THREE from 'three'
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  TiltShiftEffect,
  VignetteEffect,
} from 'postprocessing'
import type { DayParams } from './core/dayClock'
import { RNG } from './core/rng'
import { clayMaterial } from './fx/clayMaterial'
import { VisualQualityController } from './fx/quality'
import { wobble } from './fx/wobble'
import { PALETTE } from './ui/tokens'

const heldNoiseFragment = `
uniform float seed;

float heldRand(vec2 p) {
  vec2 wrapped = mod(p + vec2(seed * 17.0, seed * 31.0), 289.0);
  return fract(sin(dot(wrapped, vec2(12.9898, 78.233))) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float noise = heldRand(uv * 2048.0);
  float filmGrain = 0.5 + (noise - 0.5) * 0.15;
  outputColor = vec4(vec3(filmGrain), inputColor.a);
}
`

class HeldNoiseEffect extends Effect {
  private readonly seedUniform: THREE.Uniform<number>

  constructor() {
    const seedUniform = new THREE.Uniform(0)
    super('HeldNoiseEffect', heldNoiseFragment, {
      blendFunction: BlendFunction.SOFT_LIGHT,
      uniforms: new Map([['seed', seedUniform]]),
    })
    this.seedUniform = seedUniform
  }

  set seed(value: number) {
    this.seedUniform.value = value
  }
}

/**
 * Caps scene radiance before any other effect runs. A light sitting inside a
 * flame can push pixels into the hundreds; the half-precision effect shaders
 * then overflow to Inf/NaN and the grain blend paints them cyan.
 */
class HdrClampEffect extends Effect {
  constructor(ceiling: number) {
    super('HdrClampEffect', `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(min(inputColor.rgb, vec3(${ceiling.toFixed(1)})), inputColor.a);
}
`)
  }
}

function createSky(): { texture: THREE.CanvasTexture; redraw(high: string, low: string): void } {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const redraw = (high: string, low: string): void => {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, high)
    gradient.addColorStop(1, low)
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    texture.needsUpdate = true
  }
  redraw(PALETTE.skyHigh, PALETTE.skyLow)
  return { texture, redraw }
}

type SceneOptions = {
  lowFx: boolean
  reducedMotion(): boolean
}

export function createScene(options: SceneOptions) {
  const { lowFx } = options
  const splash = document.getElementById('splash')!

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch {
    splash.textContent = 'This toy needs WebGL, and this browser does not have it.'
    throw new Error('no webgl')
  }

  renderer.setPixelRatio(lowFx ? 1 : Math.min(devicePixelRatio, 1.5))
  renderer.setSize(innerWidth, innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  // VSM must be selected before any material compiles.
  renderer.shadowMap.type = THREE.VSMShadowMap
  renderer.shadowMap.enabled = !lowFx
  document.getElementById('app')!.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const sky = createSky()
  scene.background = sky.texture

  const stageRoot = new THREE.Group()
  stageRoot.name = 'island-stage'
  scene.add(stageRoot)

  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 200)
  camera.position.set(0, 14, 34)
  camera.lookAt(0, 0, 0)

  const cloudGroup = new THREE.Group()
  const cloudMaterial = clayMaterial(PALETTE.cloud, { flat: true })
  const cloudRng = new RNG(31)
  const clouds: THREE.Group[] = []
  const addCloud = (angle: number, radius: number, y: number, scale: number, castShadow: boolean): void => {
    const cloud = new THREE.Group()
    const pieces = cloudRng.int(3, 5)
    for (let j = 0; j < pieces; j++) {
      const puffRadius = cloudRng.range(0.8, 1.5)
      const geometry = wobble(new THREE.SphereGeometry(puffRadius, 16, 12), cloudRng, 0.1)
      const puff = new THREE.Mesh(geometry, cloudMaterial)
      puff.position.set(
        (j - (pieces - 1) * 0.5) * cloudRng.range(1, 1.5),
        cloudRng.range(-0.35, 0.45),
        cloudRng.range(-0.7, 0.7),
      )
      puff.scale.y = cloudRng.range(0.65, 0.9)
      puff.castShadow = castShadow
      cloud.add(puff)
    }
    cloud.scale.setScalar(scale)
    cloud.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
    cloud.rotation.y = -angle
    cloud.userData.baseY = cloud.position.y
    cloud.userData.phase = cloudRng.range(0, Math.PI * 2)
    clouds.push(cloud)
    cloudGroup.add(cloud)
  }
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + cloudRng.range(-0.3, 0.3)
    addCloud(angle, cloudRng.range(24, 32), cloudRng.range(5, 8), 1, true)
  }
  // A lower deck drifting beneath the island: the camera looks down, so these
  // are what sell "floating" in a wide shot.
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.4 + cloudRng.range(-0.25, 0.25)
    addCloud(angle, cloudRng.range(20, 30), cloudRng.range(-16, -9), cloudRng.range(1.5, 2.3), false)
  }
  scene.add(cloudGroup)

  const key = new THREE.DirectionalLight(PALETTE.keyLight, 3.2)
  key.position.set(18, 24, 10)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.radius = 5
  key.shadow.blurSamples = 16
  key.shadow.camera.left = -18
  key.shadow.camera.right = 18
  key.shadow.camera.top = 18
  key.shadow.camera.bottom = -18
  key.shadow.bias = 0
  const fill = new THREE.HemisphereLight(PALETTE.fillSky, PALETTE.fillGround, 1.1)
  scene.add(key, fill)

  // Half-float buffers keep fire, lightning and fireworks above 1.0 so bloom
  // can pick them out without haloing the daylit clay before ACES tone mapping.
  const composer = new EffectComposer(renderer, lowFx ? {} : {
    frameBufferType: THREE.HalfFloatType,
    multisampling: Math.min(4, renderer.capabilities.maxSamples),
  })
  composer.addPass(new RenderPass(scene, camera))

  let tilt: TiltShiftEffect | null = null
  let grain: HeldNoiseEffect | null = null
  if (!lowFx) {
    composer.addPass(new EffectPass(camera, new HdrClampEffect(4)))
    const bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.05,
      luminanceSmoothing: 0.35,
      intensity: 1.15,
      radius: 0.7,
    })
    tilt = new TiltShiftEffect({ focusArea: 0.5, feather: 0.32 })
    tilt.blendMode.opacity.value = 0.32
    const vignette = new VignetteEffect({ darkness: 0.5, offset: 0.32 })
    grain = new HeldNoiseEffect()
    grain.blendMode.opacity.value = 0.08
    const grade = new HueSaturationEffect({ saturation: 0.14 })
    composer.addPass(new EffectPass(camera, bloom, tilt, vignette, grain, grade))
  }
  const quality = new VisualQualityController(tilt, grain, lowFx)

  let elapsed = 0

  /**
   * `driftScale` speeds cloud travel without touching the island's own bob. The
   * prologue time-lapse runs it high so daylight has visible motion instead of
   * reading as a held blue plate; gameplay leaves it at 1.
   */
  function updateSky(dt: number, driftScale = 1): void {
    elapsed += dt
    const reduced = options.reducedMotion()

    if (!reduced) cloudGroup.rotation.y += dt * 0.01 * driftScale
    for (const cloud of clouds) {
      const bob = reduced ? 0 : Math.sin(elapsed * 0.22 + cloud.userData.phase) * 0.25
      cloud.position.y = cloud.userData.baseY + bob
    }
    stageRoot.position.y = reduced ? 0 : Math.sin(elapsed * 0.15) * 0.3
  }

  let skyRedrawCooldown = 0
  let lastSkyHigh: string = PALETTE.skyHigh
  let lastSkyLow: string = PALETTE.skyLow

  function applyDay(params: DayParams, dt: number): void {
    key.color.set(params.keyColor)
    key.intensity = params.keyIntensity
    // Reduced quality bypasses shadows; a moving sun buys nothing there.
    if (!lowFx) key.position.set(params.keyX, params.keyY, params.keyZ)
    fill.color.set(params.fillSky)
    fill.groundColor.set(params.fillGround)
    fill.intensity = params.fillIntensity
    cloudMaterial.color.set(params.cloudTint)

    skyRedrawCooldown -= dt
    if (skyRedrawCooldown <= 0
      && (params.skyHigh !== lastSkyHigh || params.skyLow !== lastSkyLow)) {
      skyRedrawCooldown = 0.25
      lastSkyHigh = params.skyHigh
      lastSkyLow = params.skyLow
      sky.redraw(params.skyHigh, params.skyLow)
    }
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    composer.setSize(innerWidth, innerHeight)
  })

  return { scene, stageRoot, camera, renderer, updateSky, applyDay, quality, composer, lowFx }
}

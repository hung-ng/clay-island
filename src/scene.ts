import * as THREE from 'three'
import {
  BlendFunction,
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
  for (let i = 0; i < 6; i++) {
    const cloud = new THREE.Group()
    const pieces = cloudRng.int(3, 5)
    for (let j = 0; j < pieces; j++) {
      const radius = cloudRng.range(0.8, 1.5)
      const geometry = wobble(new THREE.SphereGeometry(radius, 16, 12), cloudRng, 0.1)
      const puff = new THREE.Mesh(geometry, cloudMaterial)
      puff.position.set(
        (j - (pieces - 1) * 0.5) * cloudRng.range(1, 1.5),
        cloudRng.range(-0.35, 0.45),
        cloudRng.range(-0.7, 0.7),
      )
      puff.scale.y = cloudRng.range(0.65, 0.9)
      puff.castShadow = true
      cloud.add(puff)
    }
    const angle = (i / 6) * Math.PI * 2 + cloudRng.range(-0.3, 0.3)
    const radius = cloudRng.range(24, 32)
    cloud.position.set(Math.cos(angle) * radius, cloudRng.range(5, 8), Math.sin(angle) * radius)
    cloud.userData.baseY = cloud.position.y
    cloud.userData.phase = cloudRng.range(0, Math.PI * 2)
    clouds.push(cloud)
    cloudGroup.add(cloud)
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

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  let tilt: TiltShiftEffect | null = null
  let grain: HeldNoiseEffect | null = null
  if (!lowFx) {
    tilt = new TiltShiftEffect({ focusArea: 0.45, feather: 0.35 })
    tilt.blendMode.opacity.value = 0.45
    const vignette = new VignetteEffect({ darkness: 0.55, offset: 0.3 })
    grain = new HeldNoiseEffect()
    grain.blendMode.opacity.value = 0.12
    const grade = new HueSaturationEffect({ saturation: 0.12 })
    composer.addPass(new EffectPass(camera, tilt, vignette, grain, grade))
  }
  const quality = new VisualQualityController(tilt, grain, lowFx)

  let elapsed = 0

  function updateSky(dt: number): void {
    elapsed += dt
    const reduced = options.reducedMotion()

    if (!reduced) cloudGroup.rotation.y += dt * 0.01
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

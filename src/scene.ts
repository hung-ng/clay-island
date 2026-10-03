import * as THREE from 'three'
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  TiltShiftEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'
import type { DayParams } from './core/dayClock'
import { RNG } from './core/rng'
import { clayMaterial } from './fx/clayMaterial'
import { VisualQualityController } from './fx/quality'
import { wobble } from './fx/wobble'
import { PALETTE } from './ui/tokens'

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

/**
 * Bloom only catches what glows. Lit clay tops out a little over 1.0 at noon;
 * emissive flame, embers, bolts and bursts are pushed well past it.
 */
const BLOOM = {
  threshold: 1.0,
  smoothing: 0.3,
  intensity: 0.85,
  radius: 0.7,
} as const

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

  // Full device resolution up to 2x: screen captures of a retina window are
  // upscaled (and visibly soft) at anything less.
  renderer.setPixelRatio(lowFx ? 1 : Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  // Three only tone-maps draws to the screen, so this reaches the reduced path;
  // enhanced quality renders to the composer's buffers and maps in its own pass.
  // Neutral keeps the palette's hues and only rolls off highlights; ACES washed
  // the clay out to pastel.
  renderer.toneMapping = THREE.NeutralToneMapping
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

  // Enhanced quality renders into a multisampled half-float buffer: the
  // multisampling is the only anti-aliasing the post stack gets (edges were
  // visibly stepped without it), and the float range lets glowing things
  // (flame, bolts, fireworks) exceed 1.0 so bloom can pick them out from merely
  // bright clay.
  const composer = lowFx
    ? new EffectComposer(renderer)
    : new EffectComposer(renderer, { multisampling: 4, frameBufferType: THREE.HalfFloatType })
  composer.addPass(new RenderPass(scene, camera))

  let tilt: TiltShiftEffect | null = null
  if (!lowFx) {
    const bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: BLOOM.threshold,
      luminanceSmoothing: BLOOM.smoothing,
      intensity: BLOOM.intensity,
      radius: BLOOM.radius,
    })
    tilt = new TiltShiftEffect({ focusArea: 0.5, feather: 0.3 })
    tilt.blendMode.opacity.value = 0.45
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })
    const vignette = new VignetteEffect({ darkness: 0.32, offset: 0.38 })
    const grade = new HueSaturationEffect({ saturation: 0.12 })
    // Tilt shift samples the raw input, so it must precede bloom or it would
    // blur the glow away inside its feathered bands.
    composer.addPass(new EffectPass(camera, tilt, bloom, toneMapping, vignette, grade))
  }
  const quality = new VisualQualityController(tilt, lowFx)

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

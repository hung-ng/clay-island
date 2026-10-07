import * as THREE from 'three'
import type { PowerId } from './core/events'
import { Sfx } from './audio/sfx'
import { CameraController } from './camera/controller'
import {
  CELEBRATION_ACTS,
  CELEBRATION_INTRO_LOCK_SECONDS,
  CELEBRATION_TARGET_LIFT,
  celebrationActPose,
  type CameraPose,
} from './camera/policy'
import { CelebrationDirector } from './celebration/director'
import { CelebrationFireworks } from './celebration/fireworks'
import {
  CELEBRATION_NIGHT_GLIDE_SECONDS,
  shouldRequestAutomaticCelebration,
} from './celebration/state'
import {
  canArmPower,
  canSkipPrologue,
  initialAppFlow,
  simulatesGameplay,
  transitionAppFlow,
} from './core/appFlow'
import { createBackgroundTicker } from './core/backgroundTicker'
import { DayClock, GOLDEN_T, sampleAt } from './core/dayClock'
import { GameLoop, QuantizedClock } from './core/loop'
import { Preferences } from './core/preferences'
import { RNG } from './core/rng'
import { Journal, MOMENTS } from './discovery/moments'
import { NightSky } from './fx/nightSky'
import { ParticleBurst } from './fx/particles'
import { flash, Shake } from './fx/shake'
import { DragTargeting } from './powers/drag'
import { Lightning } from './powers/lightning'
import { Meteor } from './powers/meteor'
import { Nudge } from './powers/nudge'
import { PowerManager } from './powers/power'
import { Rain } from './powers/rain'
import { Wind } from './powers/wind'
import {
  compareFramebuffers,
  projectEmberMask,
  readFramebuffer,
  type EmberMask,
  type Framebuffer,
} from './prologue/audit'
import { PROLOGUE_CLOUD_DRIFT } from './prologue/choreography'
import { PrologueDirector } from './prologue/prologue'
import { createScene } from './scene'
import { createJournalUI, type JournalUI } from './ui/journal'
import {
  createPhotoAnnouncer,
  createPhotoCapture,
  createPhotoPreview,
  downloadBlob,
  type PhotoCanvas,
  type PhotoPreviewUI,
} from './ui/photo'
import { createSettingsUI, type SettingsUI } from './ui/settings'
import { createTitleUI } from './ui/title'
import { PALETTE, TIMING } from './ui/tokens'
import { createTray } from './ui/tray'
import { createInitialWorldBlueprint } from './world/blueprint'
import { buildInitialWorld } from './world/initial'

const ui = document.getElementById('ui')!
const splash = document.getElementById('splash')!
let storage: Storage | null = null
try { storage = localStorage } catch { /* Persistence is optional. */ }

const systemReducedMotion = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches
const preferences = new Preferences(storage, location.search, systemReducedMotion)
const reducedMotion = (): boolean => preferences.snapshot.reducedMotion
document.documentElement.dataset.reducedMotion = String(reducedMotion())
const startup = preferences.snapshot
const blueprint = createInitialWorldBlueprint(7)
const sceneBundle = createScene({ lowFx: startup.lowFx, reducedMotion })
const {
  scene,
  stageRoot,
  camera,
  renderer,
  updateSky,
  applyDay,
  quality,
  composer,
  lowFx,
} = sceneBundle
const cameraController = new CameraController({
  camera,
  dom: renderer.domElement,
  autoRotate: startup.autoRotate,
  reducedMotion,
})
cameraController.lock('prologue')
const dayClock = new DayClock(reducedMotion, GOLDEN_T, startup.dayCount)
dayClock.onDayWrap = day => preferences.setDayCount(day)
dayClock.setMode(
  startup.timeOfDay,
  startup.timeOfDay === 'day' ? 'backward' : 'forward',
)
const canonicalDay = sampleAt(GOLDEN_T)
const nightSky = new NightSky(scene, stageRoot, lowFx)
let lastDayKind = dayClock.kind

const gameplay = buildInitialWorld(blueprint, startup.lowFx)
const { island, world } = gameplay
stageRoot.add(island.group)
island.group.visible = false

let flow = initialAppFlow(startup.introSeen)
let director: PrologueDirector | null = null
let pendingNormalHandoff = false
let renderedFinalPrologue = false
let normalHandoffSwapped = false

type ReplayRestore = {
  camera: CameraPose
  stagePosition: THREE.Vector3
  stageRotation: THREE.Euler
}

let replayRestore: ReplayRestore | null = null

const handoffAuditEnabled = new URLSearchParams(location.search).get('handoffAudit') === '1'
let auditBefore: Framebuffer | null = null
let auditMask: EmberMask | null = null

const rng = new RNG(7)
const fireRng = new RNG(13)
const powerIds: readonly PowerId[] = ['meteor', 'lightning', 'rain', 'nudge', 'wind']
const particles = new ParticleBurst(stageRoot)
world.setChipFx((x, z) => particles.burst({
  x,
  y: island.sampleHeight(x, z) + 0.8,
  z,
  n: 8,
  color: PALETTE.bark,
  speed: 2.4,
  gravity: 9,
  life: 0.5,
  size: 0.6,
}))
const shake = new Shake(reducedMotion)
const powers = new PowerManager([new Meteor(), new Lightning(), new Rain(), new Nudge(), new Wind()], {
  world,
  island,
  scene,
  fx: {
    particles,
    shake,
    flash: (color, seconds) => flash(color, seconds, reducedMotion()),
  },
  bus: world.bus,
  rng,
  lowFx,
  reducedMotion,
})
const targeting = new DragTargeting(renderer.domElement, camera, island, world, (power, x, z) => {
  powers.cast(power, x, z)
}, (active) => {
  if (active) cameraController.lock('targeting')
  else cameraController.unlock('targeting')
})
let settingsOpen = false
let journalUI: JournalUI | null = null
let celebration: CelebrationDirector | null = null
let takePhoto: (() => void) | null = null
let photoPreview: PhotoPreviewUI | null = null
const modalOpen = (): boolean => settingsOpen
  || Boolean(journalUI?.isOpen())
  || Boolean(photoPreview?.isOpen())
const tray = createTray(ui, {
  onPhoto: () => takePhoto?.(),
  onArm: power => {
    const celebrationActive = celebration?.active ?? false
    if (!celebrationActive && canArmPower(flow, modalOpen())) {
      targeting.arm(power)
    }
  },
  onCancel: () => targeting.cancel(true),
  cooldowns: () => ({
    meteor: powers.cooldown01('meteor'),
    lightning: powers.cooldown01('lightning'),
    rain: powers.cooldown01('rain'),
    nudge: powers.cooldown01('nudge'),
    wind: powers.cooldown01('wind'),
  }),
})
const trayElement = document.getElementById('tray')!
trayElement.classList.add('gameplay-hidden')
trayElement.inert = true

const sfx = new Sfx({ storage })
sfx.attach(world.bus)
world.setStepFoley(() => sfx.step())

const photoAnnounce = createPhotoAnnouncer(ui)
const createPhotoCanvas = (width: number, height: number): PhotoCanvas => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas as unknown as PhotoCanvas
}
photoPreview = createPhotoPreview(ui, {
  reducedMotion,
  createCanvas: createPhotoCanvas,
  download: downloadBlob,
  announce: photoAnnounce,
  onOpenChange: (open) => {
    if (open) {
      targeting.cancel(true)
      cameraController.lock('photo')
    } else cameraController.unlock('photo')
  },
})
const photoCapture = createPhotoCapture({
  renderer: {
    canvas: renderer.domElement,
    size: () => {
      const size = renderer.getSize(new THREE.Vector2())
      return { width: size.x, height: size.y }
    },
    pixelRatio: () => renderer.getPixelRatio(),
    setPixelRatio: value => renderer.setPixelRatio(value),
    setSize: (width, height) => renderer.setSize(width, height, false),
  },
  // Reduced quality renders without the composer; resizing it would only
  // allocate capture-sized buffers that nothing reads.
  composer: lowFx ? null : { setSize: (width, height) => composer.setSize(width, height) },
  renderFrame: renderScene,
  day: () => dayClock.day,
  kind: () => dayClock.kind,
  createCanvas: createPhotoCanvas,
  openPreview: photo => photoPreview?.open(photo),
  announce: photoAnnounce,
  onCaptured: () => {
    sfx.unlock()
    sfx.shutter()
    if (!reducedMotion()) flash(PALETTE.cloud, 0.24, false)
  },
})
takePhoto = () => {
  if (canArmPower(flow, modalOpen())) photoCapture.capture()
}

const journal = new Journal(storage)
let settingsUI: SettingsUI | null = null
journalUI = createJournalUI(ui, journal, {
  lowFx,
  reducedMotion,
  onOpenChange: (open) => {
    if (open) settingsUI?.close()
    if (open) cameraController.lock('journal')
    else cameraController.unlock('journal')
  },
  onCelebrate: () => { celebration?.request() },
})
settingsUI = createSettingsUI(ui, {
  muted: sfx.muted,
  quality: startup.quality,
  forcedLowFx: startup.forcedLowFx,
  autoRotate: startup.autoRotate,
  reducedMotion: reducedMotion(),
  timeOfDay: startup.timeOfDay,
  reducedMotionActive: reducedMotion,
  onOpenChange(open) {
    settingsOpen = open
    if (open) {
      targeting.cancel(true)
      journalUI?.close()
      cameraController.lock('settings')
    } else cameraController.unlock('settings')
  },
  onSoundChange(muted) {
    sfx.unlock()
    sfx.setMuted(muted)
    settingsUI?.setMuted(sfx.muted)
  },
  onQualityChange(nextQuality, reportFailure) {
    if (preferences.setQuality(nextQuality)) location.reload()
    else reportFailure()
  },
  onAutoRotateChange(on) {
    preferences.setAutoRotate(on)
    cameraController.setAutoRotate(on)
    settingsUI?.setAutoRotate(on)
  },
  onReducedMotionChange(on) {
    preferences.setReducedMotion(on)
    document.documentElement.dataset.reducedMotion = String(reducedMotion())
    settingsUI?.setReducedMotion(reducedMotion())
  },
  onTimeOfDayChange(mode) {
    preferences.setTimeOfDay(mode)
    dayClock.setMode(mode)
    settingsUI?.setTimeOfDay(mode)
  },
  onResetCamera() {
    settingsUI?.close()
    cameraController.reset()
  },
  onReplayIntro() { beginSettingsReplay() },
})
settingsUI.setVisible(false)
const celebrationFireworks = new CelebrationFireworks(stageRoot, {
  lowFx,
  reducedMotion,
})
let celebrationCameraRevision = 0
let celebrationDragAtStart = false
celebration = new CelebrationDirector({
  world,
  fireworks: celebrationFireworks,
  isGameplay: () => flow.phase === 'gameplay',
  toastsIdle: () => journalUI?.isToastIdle() ?? true,
  modalsClosed: () => !settingsOpen && !(journalUI?.isOpen() ?? false),
  powerEffectsIdle: () => !powers.effectsActive,
  reducedMotion,
  onStatusChange: status => journalUI?.setCelebrationStatus(status),
  onActiveChange: active => {
    if (active) {
      dayClock.requestHold('night', CELEBRATION_NIGHT_GLIDE_SECONDS)
      celebrationCameraRevision = cameraController.userInteractionRevision
      celebrationDragAtStart = cameraController.userInteracting
      targeting.cancel(false)
      cameraController.suppressAutoMotion('celebration')
      cameraController.setTargetLift(CELEBRATION_TARGET_LIFT)
    } else {
      dayClock.releaseHold()
      cameraController.endCelebrationIntro()
      cameraController.setTargetLift(0)
      cameraController.releaseAutoMotion('celebration')
    }
    for (const power of powerIds) tray.setEnabled(power, !active)
  },
  onCameraAct: (act, centre) => {
    const spec = CELEBRATION_ACTS[act - 1]!
    const pose = celebrationActPose(act, cameraController.pose(), centre)
    if (act !== 1) cameraController.endCelebrationIntro()
    if (act === 1
      && !celebrationDragAtStart
      && cameraController.beginCelebrationIntro(
        pose,
        spec.seconds,
        CELEBRATION_INTRO_LOCK_SECONDS,
      )) {
      return
    }
    cameraController.suggestPose(pose, celebrationCameraRevision, spec.seconds)
  },
  onSound: cue => sfx.celebration(cue),
})
tray.setJournalCount(journal.count())
world.bus.on((event) => {
  const before = journal.count()
  const unlocked = journal.observe(event)
  if (!unlocked) return
  journalUI?.toast(unlocked)
  sfx.reward()
  journalUI?.setUnlocked(journal.unlocked)
  tray.setJournalCount(journal.count())
  if (shouldRequestAutomaticCelebration(before, journal.count(), MOMENTS.length)) {
    celebration?.request()
  }
})

function createDirector(generation: number): PrologueDirector {
  return new PrologueDirector({
    blueprint,
    lowFx: startup.lowFx,
    stageRoot,
    camera: cameraController,
    reducedMotion,
    onCue: cue => sfx.prologue(cue.kind),
    applyDay: (params, dt) => applyDay(params, dt),
    onFinished: () => {
      if (flow.generation !== generation || flow.phase !== 'prologue') return
      if (flow.mode === 'replay') {
        beginReplayOutboundCover(generation)
        return
      }
      pendingNormalHandoff = true
    },
  })
}

function beginSettingsReplay(): void {
  if (flow.phase !== 'gameplay') return
  celebration?.cancel()
  settingsUI?.close()
  targeting.cancel(true)

  const next = transitionAppFlow(flow, { type: 'requestReplay' })
  if (next === flow || next.phase !== 'replay-transition') return
  flow = next
  const generation = flow.generation
  replayRestore = {
    camera: cameraController.pose(),
    stagePosition: stageRoot.position.clone(),
    stageRotation: stageRoot.rotation.clone(),
  }
  trayElement.classList.add('gameplay-hidden')
  trayElement.inert = true
  settingsUI?.setVisible(false)

  titleUI.showCover(() => {
    if (
      flow.generation !== generation
      || flow.phase !== 'replay-transition'
      || flow.destination !== 'prologue'
    ) return

    island.group.visible = false
    particles.mesh.visible = false
    const prologue = transitionAppFlow(flow, { type: 'coverReady' })
    if (prologue === flow || prologue.phase !== 'prologue' || prologue.mode !== 'replay') return
    flow = prologue
    director = createDirector(flow.generation)
    titleUI.showPrologue(true)
  })
}

function beginReplayOutboundCover(generation: number): void {
  if (
    flow.generation !== generation
    || flow.phase !== 'prologue'
    || flow.mode !== 'replay'
  ) return

  const transition = transitionAppFlow(flow, { type: 'finishPrologue' })
  if (
    transition === flow
    || transition.phase !== 'replay-transition'
    || transition.destination !== 'gameplay'
  ) return
  flow = transition
  const outboundGeneration = flow.generation

  titleUI.showCover(() => {
    if (
      flow.generation !== outboundGeneration
      || flow.phase !== 'replay-transition'
      || flow.destination !== 'gameplay'
    ) return

    requestAnimationFrame(() => {
      if (
        flow.generation !== outboundGeneration
        || flow.phase !== 'replay-transition'
        || flow.destination !== 'gameplay'
      ) return

      const gameplayFlow = transitionAppFlow(flow, { type: 'coverReady' })
      if (gameplayFlow === flow || gameplayFlow.phase !== 'gameplay') return
      director?.dispose()
      director = null
      island.group.visible = true
      particles.mesh.visible = true
      if (replayRestore) {
        cameraController.setPose(replayRestore.camera)
        stageRoot.position.copy(replayRestore.stagePosition)
        stageRoot.rotation.copy(replayRestore.stageRotation)
      }
      flow = gameplayFlow
      replayRestore = null
      titleUI.hide()
      trayElement.classList.remove('gameplay-hidden')
      trayElement.inert = false
      settingsUI?.setVisible(true)
    })
  })
}

function beginNormalPrologue(): void {
  if (flow.phase !== 'title' || !director) return
  const next = transitionAppFlow(flow, { type: 'begin' })
  if (next === flow || next.phase !== 'prologue') return
  flow = next
  pendingNormalHandoff = false
  renderedFinalPrologue = false
  normalHandoffSwapped = false
  auditBefore = null
  auditMask = null
  sfx.unlock()
  titleUI.showPrologue(canSkipPrologue(flow))
  island.group.visible = false
}

function skipNormalPrologue(): void {
  if (!canSkipPrologue(flow)) return
  director?.skip()
}

const titleUI = createTitleUI(ui, {
  reducedMotion,
  onBegin: beginNormalPrologue,
  onSkip: skipNormalPrologue,
})

function prepareNormalTitle(): void {
  if (flow.phase !== 'title' || director) return
  director = createDirector(flow.generation + 1)
  titleUI.showBegin()
}

prepareNormalTitle()

function swapToFrozenGameplay(): boolean {
  if (!director || flow.phase !== 'prologue') return false
  director.set.group.visible = false
  island.group.visible = true
  stageRoot.rotation.set(0, blueprint.stageRotationY, 0)
  director.dispose()
  director = null
  normalHandoffSwapped = true
  return true
}

function captureAuditBefore(): void {
  if (!handoffAuditEnabled || !director) return
  auditBefore = readFramebuffer(renderer)
  auditMask = projectEmberMask(
    director.set.campfire.group,
    camera,
    auditBefore.width,
    auditBefore.height,
  )
}

function reportHandoffAudit(): void {
  if (!handoffAuditEnabled || !auditBefore) return
  const after = readFramebuffer(renderer)
  if (after.width !== auditBefore.width || after.height !== auditBefore.height) {
    console.error('handoff audit unavailable', {
      reason: 'framebuffer resized during comparison',
      before: { width: auditBefore.width, height: auditBefore.height },
      after: { width: after.width, height: after.height },
    })
    return
  }
  const result = compareFramebuffers(
    auditBefore.pixels,
    after.pixels,
    after.width,
    after.height,
    auditMask,
  )
  if (result.pass) console.info('handoff audit pass', result)
  else console.error('handoff audit fail', result)
}

function finishNormalHandoff(): void {
  if (flow.phase !== 'prologue') return
  const completedMode = flow.mode
  const next = transitionAppFlow(flow, { type: 'finishPrologue' })
  if (next === flow || next.phase !== 'gameplay') return
  flow = next
  if (completedMode === 'first') preferences.markIntroSeen()
  titleUI.hide()
  trayElement.classList.remove('gameplay-hidden')
  trayElement.inert = false
  settingsUI?.setVisible(true)
  pendingNormalHandoff = false
  renderedFinalPrologue = false
  normalHandoffSwapped = false
  auditBefore = null
  auditMask = null
}

function renderScene(): void {
  if (lowFx) renderer.render(scene, camera)
  else composer.render()
}

let first = true
const clock = new QuantizedClock(TIMING.fps)
const loop = new GameLoop(
  (dt) => {
    if (!simulatesGameplay(flow)) return
    dayClock.tick(dt)
    const dayKind = dayClock.kind
    world.dayKind = dayKind
    if (dayKind !== lastDayKind) {
      lastDayKind = dayKind
      if (dayKind === 'night') world.assignNightRoles(rng)
      world.bus.emit({ type: 'day:phase', kind: dayKind })
    }
    clock.advance(dt)
    powers.update(dt)
    world.updateFire(dt, fireRng)
    world.updateGraves(dt)
    world.updateGroundFruit(dt)
    world.relocateDrownedRuins(rng, lowFx)
    world.updateTrees(dt, clock.quantizedTime)
    for (const hut of world.huts) hut.update(dt, clock.quantizedTime)
    world.campfire.update(dt, clock.quantizedTime)
    world.updatePonds(dt, clock.quantizedTime)
    for (const villager of world.villagers) {
      villager.update(dt, clock.quantizedTime, world, island)
    }
    world.repopulate(dt, rng, lowFx)
    world.reseedForest(dt, rng, lowFx)
  },
  (dt) => {
    const swappedThisFrame = pendingNormalHandoff
      && renderedFinalPrologue
      && !normalHandoffSwapped
      && swapToFrozenGameplay()

    if (flow.phase === 'title' && !document.hidden) {
      director?.updateTitlePreview(dt)
    } else if (flow.phase === 'prologue' && !pendingNormalHandoff && !document.hidden) {
      director?.update(dt)
    }

    const gameplayActive = simulatesGameplay(flow)
    if (gameplayActive) {
      targeting.update()
      celebration?.update(dt)
      particles.update(dt)
      for (const power of powerIds) tray.setCooldown(power, powers.cooldown01(power))
      tray.setPhotoEnabled(canArmPower(flow, modalOpen()))
      world.updateFireLights(camera.position)
    }

    const auditingHandoff = handoffAuditEnabled
      && (pendingNormalHandoff || renderedFinalPrologue)
    const freezeCamera = auditingHandoff || swappedThisFrame
    if (!freezeCamera) {
      shake.beginFrame(camera)
      cameraController.update(dt)
      shake.update(dt, camera)
    }

    const ambientDt = auditingHandoff ? 0 : dt
    const sweeping = !gameplayActive && flow.phase === 'prologue' && director !== null
    const dayParams = gameplayActive
      ? dayClock.sample()
      : (sweeping ? director!.dayParams() : canonicalDay)
    applyDay(dayParams, ambientDt)
    nightSky.setLevels(dayParams.starOpacity, dayParams.fireflyLevel)
    nightSky.update(ambientDt, reducedMotion())
    // Clouds drift at time-lapse speed through the prologue so its daylight
    // stretches have visible motion rather than reading as a held frame.
    updateSky(ambientDt, sweeping ? PROLOGUE_CLOUD_DRIFT : 1)
    quality.update(ambientDt, cameraController.distance(), reducedMotion())
    renderScene()

    if (pendingNormalHandoff && !renderedFinalPrologue) {
      captureAuditBefore()
      renderedFinalPrologue = true
    } else if (normalHandoffSwapped) {
      reportHandoffAudit()
      finishNormalHandoff()
    }

    if (first) {
      first = false
      splash.classList.add('gone')
    }
  },
)
loop.start()
const backgroundTicker = createBackgroundTicker(() => loop.backgroundTick())
document.addEventListener('visibilitychange', () => {
  world.foleyMuted = document.hidden
  if (document.hidden && simulatesGameplay(flow)) {
    loop.setBackground(true)
    backgroundTicker.start()
  } else {
    backgroundTicker.stop()
    loop.setBackground(false)
  }
})

// Comparison-only handle (temporary checkout, not committed).
if (import.meta.env.DEV) Object.assign(window, { __clay: { cameraController, dayClock } })

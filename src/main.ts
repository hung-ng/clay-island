import type { PowerId } from './core/events'
import { Sfx } from './audio/sfx'
import { GameLoop, QuantizedClock } from './core/loop'
import { RNG } from './core/rng'
import { Journal } from './discovery/moments'
import { ParticleBurst } from './fx/particles'
import { flash, Shake } from './fx/shake'
import { Intro } from './intro'
import { DragTargeting } from './powers/drag'
import { Lightning } from './powers/lightning'
import { Meteor } from './powers/meteor'
import { PowerManager } from './powers/power'
import { Rain } from './powers/rain'
import { createScene } from './scene'
import { createJournalUI } from './ui/journal'
import { TIMING } from './ui/tokens'
import { createTray } from './ui/tray'
import { spawnVillagers } from './villagers/villager'
import { Island } from './world/island'
import { scatter, World } from './world/world'

const splash = document.getElementById('splash')!
const ui = document.getElementById('ui')!
const { scene, camera, renderer, controls, floaters, updateSky, composer, lowFx } = createScene()

const rng = new RNG(7)
const fireRng = new RNG(13)
const island = new Island(rng)
const world = new World(island)
scatter(world, island, rng, lowFx)
spawnVillagers(world, island, rng, 6, { lowFx })
scene.add(island.group)
floaters.push(island.group)

const powerIds: readonly PowerId[] = ['meteor', 'lightning', 'rain']
const particles = new ParticleBurst(scene)
const shake = new Shake()
const powers = new PowerManager([new Meteor(), new Lightning(), new Rain()], {
  world,
  island,
  scene,
  fx: { particles, shake, flash },
  bus: world.bus,
  rng,
  lowFx,
})
const targeting = new DragTargeting(renderer.domElement, camera, island, world, (power, x, z) => {
  powers.cast(power, x, z)
})
const tray = createTray(ui, {
  onArm: power => targeting.arm(power),
  onCancel: () => targeting.cancel(true),
  cooldowns: () => ({
    meteor: powers.cooldown01('meteor'),
    lightning: powers.cooldown01('lightning'),
    rain: powers.cooldown01('rain'),
  }),
})

let storage: Storage | null = null
try { storage = localStorage } catch { /* Persistence is optional. */ }
const sfx = new Sfx({ storage })
sfx.attach(world.bus)
world.setStepFoley(() => sfx.step())
const unlockAudio = (): void => { sfx.unlock() }
addEventListener('pointerdown', unlockAudio, { capture: true, once: true })
addEventListener('keydown', unlockAudio, { capture: true, once: true })
tray.setMuted(sfx.muted)
tray.onMute(() => {
  sfx.unlock()
  sfx.setMuted(!sfx.muted)
  tray.setMuted(sfx.muted)
})
const journal = new Journal(storage)
const journalUI = createJournalUI(ui, journal, { lowFx })
tray.setJournalCount(journal.count())
world.bus.on((event) => {
  const unlocked = journal.observe(event)
  if (!unlocked) return
  journalUI.toast(unlocked)
  sfx.reward()
  journalUI.setUnlocked(journal.unlocked)
  tray.setJournalCount(journal.count())
})
const trayElement = document.getElementById('tray')!
const intro = new Intro({ camera, controls, tray: trayElement, world })
const skipIntro = (event: Event): void => {
  if (intro.done) return
  intro.skip()
  event.preventDefault()
  event.stopImmediatePropagation()
}
addEventListener('pointerdown', skipIntro, { capture: true })
addEventListener('keydown', skipIntro, { capture: true })

let first = true
const clock = new QuantizedClock(TIMING.fps)
const loop = new GameLoop(
  (dt) => {
    world.updateFire(dt, fireRng)
    world.updateGraves(dt)
    for (const villager of world.villagers) {
      villager.update(dt, clock.quantizedTime, world, island)
    }
    world.repopulate(dt, rng, lowFx)
  },
  (dt) => {
    clock.advance(dt)
    targeting.update()
    powers.update(dt)
    particles.update(dt)
    for (const power of powerIds) {
      tray.setCooldown(power, powers.cooldown01(power))
    }
    for (const tree of world.trees) tree.update(dt, clock.quantizedTime)
    for (const hut of world.huts) hut.update(dt, clock.quantizedTime)
    world.campfire.update(dt, clock.quantizedTime)
    world.updatePonds(clock.quantizedTime)
    world.updateFireLights(camera.position)
    shake.beginFrame(camera)
    intro.update(dt)
    controls.update()
    shake.update(dt, camera)
    updateSky(dt)
    if (lowFx) renderer.render(scene, camera)
    else composer.render()
    if (first) {
      first = false
      splash.classList.add('gone')
    }
  },
)
loop.start()

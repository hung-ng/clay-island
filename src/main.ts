import { GameLoop, QuantizedClock } from './core/loop'
import { RNG } from './core/rng'
import { createScene } from './scene'
import { TIMING } from './ui/tokens'
import { spawnVillagers } from './villagers/villager'
import { Island } from './world/island'
import { scatter, World } from './world/world'

const splash = document.getElementById('splash')!
const { scene, controls, floaters, updateSky, composer, lowFx } = createScene()

const rng = new RNG(7)
const island = new Island(rng)
const world = new World(island)
scatter(world, island, rng, lowFx)
spawnVillagers(world, island, rng, 6, { lowFx })
scene.add(island.group)
floaters.push(island.group)

let first = true
const clock = new QuantizedClock(TIMING.fps)
const loop = new GameLoop(
  (dt) => {
    for (const villager of world.villagers) {
      villager.update(dt, clock.quantizedTime, world, island)
    }
    world.repopulate(dt, rng, lowFx)
  },
  (dt) => {
    clock.advance(dt)
    for (const tree of world.trees) tree.update(dt, clock.quantizedTime)
    for (const hut of world.huts) hut.update(dt, clock.quantizedTime)
    world.campfire.update(dt, clock.quantizedTime)
    controls.update()
    updateSky(dt)
    composer.render()
    if (first) {
      first = false
      splash.classList.add('gone')
    }
  },
)
loop.start()

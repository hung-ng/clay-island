import { CELEBRATION_ACTS, type CelebrationAct } from '../camera/policy'
import type { World } from '../world/world'
import type {
  CelebrationAssignment,
  Villager,
  VillagerCelebrationPhase,
} from '../villagers/villager'
import type { CelebrationFireworks, CelebrationSoundCue } from './fireworks'
import type { CelebrationPoint, CelebrationSite } from './slots'
import { CelebrationClock, type CelebrationSignal } from './state'

export type CelebrationStatus = 'ready' | 'queued' | 'active'

type CelebrationParticipant = Pick<
  Villager,
  | 'id' | 'x' | 'z' | 'alive' | 'canCelebrate' | 'beginCelebration'
  | 'setCelebrationPhase' | 'endCelebration'
>

export type CelebrationDirectorOptions = {
  world: World
  fireworks: Pick<CelebrationFireworks, 'begin' | 'update' | 'reset' | 'dispose'>
  isGameplay(): boolean
  toastsIdle(): boolean
  modalsClosed(): boolean
  powerEffectsIdle(): boolean
  reducedMotion(): boolean
  onStatusChange(status: CelebrationStatus): void
  onActiveChange(active: boolean): void
  onCameraAct(act: CelebrationAct, centre: CelebrationPoint): void
  onSound(cue: CelebrationSoundCue): void
}

export class CelebrationDirector {
  private readonly clock = new CelebrationClock()
  private participants: CelebrationParticipant[] = []
  private ownsActiveInputs = false
  private activeCentre: CelebrationPoint | null = null
  private nextAct = 0
  private disposed = false

  constructor(private readonly options: CelebrationDirectorOptions) {}

  get busy(): boolean { return this.clock.busy }
  get active(): boolean { return this.clock.active }

  request(): boolean {
    if (this.disposed) return false
    if (!this.clock.request()) return false
    this.options.onStatusChange('queued')
    return true
  }

  update(dt: number): void {
    if (this.disposed) return
    if (this.clock.busy && !this.options.isGameplay()) {
      this.cancel()
      return
    }
    if (this.clock.active && this.options.world.hasDangerousFire()) {
      this.cancel()
      return
    }

    const living = this.options.world.villagers.filter(villager => villager.alive)
    const gameplay = this.options.isGameplay()
    const toastsIdle = this.options.toastsIdle()
    const modalsClosed = this.options.modalsClosed()
    const powerEffectsIdle = this.options.powerEffectsIdle()
    const worldReady = living.length > 0
      && !this.options.world.hasDangerousFire()
      && living.every(villager => villager.canCelebrate())
    const canResolveSite = this.clock.phase === 'queued'
      && gameplay
      && toastsIdle
      && modalsClosed
      && powerEffectsIdle
      && worldReady
    const site = canResolveSite
      ? this.options.world.celebrationSite(living.length)
      : null
    const signals = this.clock.update(dt, {
      gameplay,
      toastsIdle,
      modalsClosed,
      powerEffectsIdle,
      worldSafe: worldReady && site !== null,
    })

    for (const signal of signals) this.handleSignal(signal, living, site)
    if (!this.clock.active) return

    while (this.nextAct < CELEBRATION_ACTS.length
      && this.activeCentre !== null
      && this.clock.totalElapsed >= CELEBRATION_ACTS[this.nextAct]!.at) {
      const act = CELEBRATION_ACTS[this.nextAct]!.act
      this.nextAct++
      this.options.onCameraAct(act, this.activeCentre)
    }

    const phase = this.clock.phase as VillagerCelebrationPhase
    for (const participant of this.participants) {
      participant.setCelebrationPhase(phase, this.options.reducedMotion())
    }
    for (const cue of this.options.fireworks.update(dt)) this.options.onSound(cue)
  }

  cancel(): boolean {
    if (!this.clock.cancel()) return false
    this.releaseActiveWork()
    this.options.onStatusChange('ready')
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.cancel()
    this.options.fireworks.dispose()
    this.disposed = true
  }

  private handleSignal(
    signal: CelebrationSignal,
    living: CelebrationParticipant[],
    site: CelebrationSite | null,
  ): void {
    if (signal === 'started') {
      if (!site) {
        this.cancel()
        return
      }
      this.begin(living, site)
      return
    }
    if (signal === 'fireworks' || signal === 'finale') {
      const phase: VillagerCelebrationPhase = signal
      for (const participant of this.participants) {
        participant.setCelebrationPhase(phase, this.options.reducedMotion())
      }
      if (signal === 'finale') this.options.onSound('cheer')
      return
    }
    this.releaseActiveWork()
    this.options.onStatusChange('ready')
  }

  private begin(living: CelebrationParticipant[], site: CelebrationSite): void {
    const { centre, slots } = site
    this.activeCentre = { ...centre }
    this.nextAct = 0
    const origin = {
      x: centre.x,
      y: this.options.world.island.sampleHeight(centre.x, centre.z),
      z: centre.z,
    }
    this.participants = living.filter((participant, order) => {
      const assignment: CelebrationAssignment = {
        slot: slots[order] ?? { x: participant.x, z: participant.z },
        centre,
        order,
      }
      return participant.beginCelebration(assignment)
    })
    this.options.fireworks.begin(origin)
    this.ownsActiveInputs = true
    this.options.onActiveChange(true)
    this.options.onStatusChange('active')
  }

  private releaseActiveWork(): void {
    if (!this.ownsActiveInputs) return
    for (const participant of this.participants) participant.endCelebration()
    this.participants = []
    this.options.fireworks.reset()
    this.activeCentre = null
    this.nextAct = 0
    this.ownsActiveInputs = false
    this.options.onActiveChange(false)
  }
}

import { describe, expect, it, vi } from 'vitest'
import { CelebrationDirector, type CelebrationDirectorOptions } from './director'

function harness() {
  const participant = {
    id: 'villager-0', x: 6, z: 0, alive: true,
    canCelebrate: vi.fn(() => true),
    beginCelebration: vi.fn(() => true),
    setCelebrationPhase: vi.fn(),
    endCelebration: vi.fn(),
  }
  const fireworks = {
    begin: vi.fn(), update: vi.fn(() => []), reset: vi.fn(), dispose: vi.fn(),
  }
  const onActiveChange = vi.fn()
  const onCameraAct = vi.fn()
  const options = {
    world: {
      villagers: [participant],
      island: { sampleHeight: (x: number, z: number) => x - z },
      living: () => 1,
      hasDangerousFire: vi.fn(() => false),
      celebrationSite: vi.fn(() => ({
        centre: { x: 0, z: 0 },
        slots: [{ x: 2.2, z: 0 }],
      })),
    },
    fireworks,
    isGameplay: () => true,
    toastsIdle: () => true,
    modalsClosed: () => true,
    powerEffectsIdle: () => true,
    reducedMotion: () => false,
    onStatusChange: vi.fn(),
    onActiveChange,
    onCameraAct,
    onSound: vi.fn(),
  } as unknown as CelebrationDirectorOptions
  return {
    participant,
    fireworks,
    onActiveChange,
    onCameraAct,
    options,
    subject: new CelebrationDirector(options),
  }
}

describe('CelebrationDirector', () => {
  it('queues idempotently, starts only when ready, and assigns the live villager', () => {
    const { options, participant, fireworks, subject } = harness()
    options.toastsIdle = () => false
    expect(subject.request()).toBe(true)
    expect(subject.request()).toBe(false)
    subject.update(5)
    expect(participant.beginCelebration).not.toHaveBeenCalled()
    options.toastsIdle = () => true
    subject.update(0)
    expect(participant.beginCelebration).toHaveBeenCalledWith({
      slot: { x: 2.2, z: 0 },
      centre: { x: 0, z: 0 },
      order: 0,
    })
    expect(options.onActiveChange).toHaveBeenCalledWith(true)
    expect(options.world.celebrationSite).toHaveBeenCalledWith(1)
    expect(fireworks.begin).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 })
  })

  it('resolves the shared site when a queued request actually starts', () => {
    const { options, participant, fireworks, subject } = harness()
    options.toastsIdle = () => false
    options.world.celebrationSite = vi.fn(() => ({
      centre: { x: 7, z: 2 },
      slots: [{ x: 8, z: 2 }],
    }))
    subject.request()
    subject.update(1)

    options.world.celebrationSite = vi.fn(() => ({
      centre: { x: -3, z: 1 },
      slots: [{ x: -1, z: 1 }],
    }))
    options.toastsIdle = () => true
    subject.update(0)

    expect(participant.beginCelebration).toHaveBeenCalledWith({
      slot: { x: -1, z: 1 },
      centre: { x: -3, z: 1 },
      order: 0,
    })
    expect(fireworks.begin).toHaveBeenCalledWith({ x: -3, y: -4, z: 1 })
  })

  it('propagates phases and releases participants after fourteen seconds', () => {
    const { participant, fireworks, options, subject } = harness()
    subject.request()
    subject.update(0)
    subject.update(4)
    expect(participant.setCelebrationPhase).toHaveBeenCalledWith('fireworks', false)
    subject.update(8)
    expect(participant.setCelebrationPhase).toHaveBeenCalledWith('finale', false)
    expect(options.onSound).toHaveBeenCalledWith('cheer')
    expect(vi.mocked(options.onSound)).toHaveBeenCalledOnce()
    subject.update(2)
    expect(vi.mocked(options.onSound)).toHaveBeenCalledOnce()
    expect(participant.endCelebration).toHaveBeenCalledOnce()
    expect(fireworks.reset).toHaveBeenCalled()
    expect(options.onActiveChange).toHaveBeenLastCalledWith(false)
    expect(subject.active).toBe(false)
  })

  it('aborts active work when dangerous fire appears', () => {
    const { options, participant, subject } = harness()
    subject.request()
    subject.update(0)
    options.world.hasDangerousFire = () => true
    subject.update(0.1)
    expect(participant.endCelebration).toHaveBeenCalledOnce()
    expect(options.onActiveChange).toHaveBeenLastCalledWith(false)
  })

  it('cancels queued work without toggling active input owners', () => {
    const { options, subject } = harness()
    options.toastsIdle = () => false
    subject.request()
    expect(subject.cancel()).toBe(true)
    expect(options.onActiveChange).not.toHaveBeenCalled()
    expect(subject.cancel()).toBe(false)
  })

  it('reads reduced motion live while active', () => {
    const { options, participant, subject } = harness()
    let reduced = false
    options.reducedMotion = () => reduced
    subject.request()
    subject.update(0)
    reduced = true
    subject.update(4)
    expect(participant.setCelebrationPhase).toHaveBeenLastCalledWith('fireworks', true)
  })

  it('dispose is safe after completion and cannot release inputs twice', () => {
    const { onActiveChange, subject } = harness()
    subject.request()
    subject.update(14)
    subject.dispose()
    subject.dispose()
    expect(onActiveChange.mock.calls.filter(([active]) => active === false)).toHaveLength(1)
  })

  it('cues the three camera acts once each and re-arms on replay', () => {
    const { onCameraAct, subject } = harness()
    subject.request()
    subject.update(0)
    expect(onCameraAct).toHaveBeenCalledTimes(1)
    expect(onCameraAct).toHaveBeenLastCalledWith(1, { x: 0, z: 0 })
    subject.update(3.1)
    expect(onCameraAct).toHaveBeenCalledTimes(1)
    subject.update(0.2)
    expect(onCameraAct).toHaveBeenCalledTimes(2)
    expect(onCameraAct).toHaveBeenLastCalledWith(2, { x: 0, z: 0 })
    subject.update(7.8)
    expect(onCameraAct).toHaveBeenLastCalledWith(3, { x: 0, z: 0 })
    subject.update(3)
    expect(onCameraAct).toHaveBeenCalledTimes(3)

    subject.request()
    subject.update(0)
    expect(onCameraAct).toHaveBeenCalledTimes(4)
    expect(onCameraAct).toHaveBeenLastCalledWith(1, { x: 0, z: 0 })
  })

  it('stops cueing later acts after cancellation', () => {
    const { onCameraAct, subject } = harness()
    subject.request()
    subject.update(0)
    expect(onCameraAct).toHaveBeenCalledTimes(1)
    expect(onCameraAct).toHaveBeenLastCalledWith(1, { x: 0, z: 0 })
    subject.cancel()
    subject.update(12)
    subject.update(12)
    expect(onCameraAct).toHaveBeenCalledTimes(1)
  })
})

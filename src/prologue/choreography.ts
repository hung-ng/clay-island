import { CAMERA_HOME, smooth01, type CameraPose, type Vec3 } from '../camera/policy'
import type { VillagerProloguePose } from '../villagers/model'
import type { InitialVillagerSpec, InitialWorldBlueprint } from '../world/blueprint'
import { islandSurfaceY } from '../world/island'

export const PROLOGUE_DURATION = 11
const FPS = 12
const TREE_FINISH = 2.5
export const HUT_BEATS = [
  [3.2, 4.8, 6.4],
  [3.4, 5, 6.6],
  [3.6, 5.2, 6.8],
] as const
const CAMPFIRE_BEATS = [8, 8.8, 9.6] as const

export type PrologueCue = {
  at: number
  kind: 'growth' | 'step' | 'hammer' | 'place' | 'ignite'
  actor?: number
}

export const PROLOGUE_CUES: readonly PrologueCue[] = [
  { at: 0.5, kind: 'growth' },
  { at: 1.25, kind: 'growth' },
  { at: 2, kind: 'growth' },
  { at: 2.7, kind: 'step', actor: 0 },
  { at: 2.9, kind: 'step', actor: 2 },
  { at: 3.1, kind: 'step', actor: 4 },
  { at: 3.2, kind: 'hammer', actor: 0 },
  { at: 3.4, kind: 'hammer', actor: 2 },
  { at: 3.6, kind: 'hammer', actor: 4 },
  { at: 4.8, kind: 'hammer', actor: 1 },
  { at: 5, kind: 'hammer', actor: 3 },
  { at: 5.2, kind: 'hammer', actor: 5 },
  { at: 6.4, kind: 'hammer', actor: 0 },
  { at: 6.6, kind: 'hammer', actor: 2 },
  { at: 6.8, kind: 'hammer', actor: 4 },
  { at: 7.35, kind: 'step', actor: 4 },
  { at: 7.55, kind: 'step', actor: 5 },
  { at: 8, kind: 'place', actor: 4 },
  { at: 8.8, kind: 'place', actor: 5 },
  { at: 9.6, kind: 'place', actor: 4 },
  { at: 10, kind: 'ignite', actor: 5 },
] as const

export type ActorState = {
  position: { x: number; y: number; z: number }
  facing: number
  pose: VillagerProloguePose
  carry: 'wood' | 'stone' | null
  frame: number
}

export type PrologueState = {
  elapsed: number
  frame: number
  treeGrowth: number
  hutStages: readonly [number, number, number]
  campfireProgress: number
  ignited: boolean
  actorStates: readonly ActorState[]
  camera: CameraPose
  reducedMotion: boolean
  finished: boolean
}

type GroundPoint = { x: number; y: number; z: number }

function point(x: number, z: number): GroundPoint {
  return { x, y: islandSurfaceY(x, z), z }
}

function lerpNumber(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function lerpPoint(from: GroundPoint, to: GroundPoint, progress: number): GroundPoint {
  return point(
    lerpNumber(from.x, to.x, progress),
    lerpNumber(from.z, to.z, progress),
  )
}

function facing(position: GroundPoint, target: { x: number; z: number }): number {
  return Math.atan2(target.x - position.x, target.z - position.z)
}

function progressBetween(elapsed: number, from: number, to: number): number {
  return smooth01((elapsed - from) / (to - from))
}

function workPoint(target: { x: number; z: number }, side: number, radius: number): GroundPoint {
  const length = Math.hypot(target.x, target.z)
  if (length <= Number.EPSILON) return point(side * radius, 0)
  const outwardX = target.x / length
  const outwardZ = target.z / length
  const tangentX = -outwardZ
  const tangentZ = outwardX
  return point(
    target.x + outwardX * radius + tangentX * side * 0.72,
    target.z + outwardZ * radius + tangentZ * side * 0.72,
  )
}

function activeBeat(
  elapsed: number,
  actor: number,
  beats: readonly PrologueCue[],
): PrologueCue | undefined {
  return beats.find(cue => cue.actor === actor && elapsed >= cue.at && elapsed < cue.at + 0.4)
}

function actorState(
  elapsed: number,
  frame: number,
  spec: InitialVillagerSpec,
  actor: number,
  huts: readonly { x: number; z: number }[],
  fire: { x: number; z: number },
  reducedMotion: boolean,
): ActorState {
  const initial = point(spec.x, spec.z)
  if (elapsed >= PROLOGUE_DURATION) {
    return { position: initial, facing: spec.facing, pose: 'idle', carry: null, frame }
  }

  const hutIndex = Math.floor(actor / 2) as 0 | 1 | 2
  const target = huts[hutIndex]
  const side = actor % 2 === 0 ? -1 : 1
  const work = workPoint(target, side, 1.45)

  if (actor < 4) {
    const gatherAngle = actor / 4 * Math.PI * 2 + Math.PI / 4
    const gather = point(Math.cos(gatherAngle) * 2.25, Math.sin(gatherAngle) * 2.25)
    let position = initial
    if (elapsed >= 1.2 && elapsed <= 6.8) {
      position = reducedMotion
        ? work
        : lerpPoint(initial, work, progressBetween(elapsed, 1.2, 3.2))
    } else if (elapsed > 6.8 && elapsed <= 10) {
      position = reducedMotion
        ? gather
        : lerpPoint(work, gather, progressBetween(elapsed, 6.8, 8))
    } else if (elapsed > 10) {
      position = reducedMotion
        ? initial
        : lerpPoint(gather, initial, progressBetween(elapsed, 10, PROLOGUE_DURATION))
    }
    const beat = activeBeat(elapsed, actor, PROLOGUE_CUES.filter(cue => cue.kind === 'hammer'))
    const travelling = !reducedMotion && elapsed >= 1.2 && elapsed < 3.2
    return {
      position,
      facing: elapsed >= 1.2 && elapsed <= 6.8
        ? facing(position, target)
        : elapsed > 6.8 && elapsed <= 10
          ? facing(position, fire)
          : spec.facing,
      pose: beat ? 'hammer' : travelling ? 'carry' : elapsed < 1 ? 'wake' : 'idle',
      carry: travelling || (elapsed >= 3.2 && elapsed <= 6.8 && !beat) ? 'wood' : null,
      frame,
    }
  }

  const fireWork = workPoint(fire, side, 1.25)
  let position = initial
  if (elapsed >= 1.2 && elapsed < 7.2) {
    position = reducedMotion
      ? work
      : lerpPoint(initial, work, progressBetween(elapsed, 1.2, 3.2))
  } else if (elapsed >= 7.2 && elapsed <= 10) {
    position = reducedMotion
      ? fireWork
      : lerpPoint(work, fireWork, progressBetween(elapsed, 7.2, 8))
  } else if (elapsed > 10) {
    position = reducedMotion
      ? initial
      : lerpPoint(fireWork, initial, progressBetween(elapsed, 10, PROLOGUE_DURATION))
  }
  const beat = activeBeat(
    elapsed,
    actor,
    PROLOGUE_CUES.filter(
      cue => cue.kind === 'hammer' || cue.kind === 'place' || cue.kind === 'ignite',
    ),
  )
  const buildingTravel = !reducedMotion && elapsed >= 1.2 && elapsed < 3.2
  const fireTravel = !reducedMotion && elapsed >= 7.2 && elapsed < 8
  return {
    position,
    facing: elapsed >= 1.2 && elapsed <= 6.8
      ? facing(position, target)
      : elapsed > 6.8 && elapsed <= 10
        ? facing(position, fire)
        : spec.facing,
    pose: beat?.kind === 'hammer'
      ? 'hammer'
      : beat?.kind === 'ignite'
        ? 'kneel'
        : beat
          ? 'place'
          : buildingTravel || fireTravel
            ? 'carry'
            : elapsed < 1
              ? 'wake'
              : 'idle',
    carry: buildingTravel || (elapsed >= 3.2 && elapsed <= 6.8 && !beat)
      ? 'wood'
      : fireTravel || (elapsed >= 8 && elapsed < 10 && !beat)
        ? 'stone'
        : null,
    frame,
  }
}

function cameraPoint(position: Vec3, target: Vec3): CameraPose {
  return { position: { ...position }, target: { ...target } }
}

function cameraAt(elapsed: number, reducedMotion: boolean): CameraPose {
  if (reducedMotion || elapsed >= PROLOGUE_DURATION) {
    return cameraPoint(CAMERA_HOME.position, CAMERA_HOME.target)
  }
  if (elapsed <= 0) {
    return cameraPoint({ x: 0, y: 14, z: -34 }, CAMERA_HOME.target)
  }
  const progress = elapsed / PROLOGUE_DURATION
  const angle = Math.PI * (1 - progress)
  return cameraPoint({
    x: Math.sin(angle) * 34,
    y: 14,
    z: Math.cos(angle) * 34,
  }, CAMERA_HOME.target)
}

export function prologueStateAt(
  elapsed: number,
  blueprint: InitialWorldBlueprint,
  reducedMotion = false,
): PrologueState {
  const clamped = Math.max(0, Math.min(PROLOGUE_DURATION, elapsed))
  const frame = Math.floor(clamped * FPS)
  const huts = blueprint.props.filter(prop => prop.kind === 'hut' && prop.state === 'built')
  const fire = blueprint.props.find(prop => prop.kind === 'campfire')
  if (huts.length !== 3 || !fire) throw new Error('Initial blueprint must contain three built huts and one campfire')

  const hutStages: readonly [number, number, number] = [
    HUT_BEATS[0].filter(at => at <= clamped).length,
    HUT_BEATS[1].filter(at => at <= clamped).length,
    HUT_BEATS[2].filter(at => at <= clamped).length,
  ]
  const campfireStage = CAMPFIRE_BEATS.filter(at => at <= clamped).length
  const campfireProgress = clamped >= 10 ? 1 : campfireStage * 0.33

  return {
    elapsed: clamped,
    frame,
    treeGrowth: smooth01(clamped / TREE_FINISH),
    hutStages,
    campfireProgress,
    ignited: clamped >= 10,
    actorStates: blueprint.villagers.map((spec, actor) =>
      actorState(clamped, frame, spec, actor, huts, fire, reducedMotion)),
    camera: cameraAt(clamped, reducedMotion),
    reducedMotion,
    finished: clamped >= PROLOGUE_DURATION,
  }
}

export function crossedPrologueCues(previous: number, current: number): PrologueCue[] {
  if (current <= previous) return []
  return PROLOGUE_CUES
    .filter(cue => previous < cue.at && cue.at <= current)
    .map(cue => ({ ...cue }))
}

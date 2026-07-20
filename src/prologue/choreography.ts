import { CAMERA_HOME, smooth01, type CameraPose, type Vec3 } from '../camera/policy'
import { DAY_PERIOD, GOLDEN_T, sampleAt, type DayParams } from '../core/dayClock'
import type { VillagerProloguePose } from '../villagers/model'
import type { InitialVillagerSpec, InitialWorldBlueprint } from '../world/blueprint'
import { islandSurfaceY } from '../world/island'

export const PROLOGUE_DURATION = 17
/** Full day+night cycles the intro sweeps through. */
export const PROLOGUE_CYCLES = 3
/**
 * The sweep starts and ends on the canonical golden phase. The title holds that
 * exact sample and only advances its preview orbit, so beginning anywhere else
 * snaps the sky in a single frame at Begin — first as a leftover starfield, then
 * as a dawn-blue cut. Starting here makes both boundaries continuous, and three
 * whole cycles still pass between them.
 */
const PROLOGUE_START_T = GOLDEN_T
/**
 * Cloud drift multiplier while the time-lapse runs. Gameplay drift is nearly
 * imperceptible by design, which leaves compressed daylight looking like a held
 * frame and makes the repeated cycles obvious.
 */
export const PROLOGUE_CLOUD_DRIFT = 14
const FPS = 12
/**
 * Trees keep growing for the whole intro. Finishing early left the forest frozen
 * while the huts, villagers, and sky all kept moving, which made the run feel
 * repetitive; a slow rise across every cycle gives the eye something that is
 * still visibly changing at the end.
 */
const TREE_FINISH = PROLOGUE_DURATION

/**
 * Trees the villagers fell for timber, so the wood they haul visibly comes from
 * the forest instead of appearing at abstract fetch points. Each felled tree
 * drops to a stump and a replacement grows back in the same spot: gameplay
 * builds all twelve trees `normal`, so the handoff needs a whole forest however
 * many came down along the way.
 */
export const TREE_CHOPS = [
  { tree: 2, at: 6.7, actor: 0 },
  { tree: 5, at: 9.9, actor: 2 },
  { tree: 8, at: 12.6, actor: 1 },
] as const

/** Seconds from the axe landing to the stump, then back to a full canopy. */
const CHOP_FALL = 0.45
const CHOP_REGROW = 2.6

/**
 * Growth for one tree, folding in any felling it suffers. Derived purely from
 * elapsed time so the prologue stays seekable and rewindable.
 */
function treeGrowthAt(elapsed: number, tree: number): number {
  const base = smooth01(elapsed / TREE_FINISH)
  const chop = TREE_CHOPS.find(entry => entry.tree === tree)
  if (!chop || elapsed < chop.at) return base
  const fall = smooth01((elapsed - chop.at) / CHOP_FALL)
  const regrow = smooth01((elapsed - chop.at - CHOP_FALL) / CHOP_REGROW)
  // Down to a stump, then back up to whatever the forest has reached by now.
  return base * (1 - fall) + base * fall * regrow
}

export const HUT_BEATS = [
  [4.4, 7.6, 10.8],
  [4.8, 8, 11.2],
  [5.2, 8.4, 11.6],
] as const
/**
 * The fire is laid and lit during the first night, so the village has its own
 * light source for the two nights that follow rather than working in the dark
 * until the final seconds. The first night runs roughly 1.1s to 3.1s.
 */
const CAMPFIRE_BEATS = [1.3, 1.8, 2.3] as const
const CAMPFIRE_IGNITE = 2.7
/** Each hut rises across roughly two days and two nights, staggered per hut. */
const HUT_BUILD_WINDOWS = [
  [1.2, 12.4],
  [1.8, 13.6],
  [2.4, 14.8],
] as const

export type PrologueCue = {
  at: number
  kind: 'growth' | 'step' | 'hammer' | 'chop' | 'place' | 'ignite'
  actor?: number
}

export const PROLOGUE_CUES: readonly PrologueCue[] = [
  { at: 0.7, kind: 'growth' },
  { at: 0.9, kind: 'step', actor: 4 },
  { at: 1.1, kind: 'step', actor: 5 },
  { at: 1.3, kind: 'place', actor: 4 },
  { at: 1.8, kind: 'growth' },
  { at: 1.8, kind: 'place', actor: 5 },
  { at: 2.3, kind: 'place', actor: 4 },
  { at: 2.7, kind: 'ignite', actor: 5 },
  { at: 2.9, kind: 'growth' },
  { at: 3.8, kind: 'step', actor: 0 },
  { at: 4, kind: 'step', actor: 2 },
  { at: 4.2, kind: 'step', actor: 4 },
  { at: 4.4, kind: 'hammer', actor: 0 },
  { at: 4.8, kind: 'hammer', actor: 2 },
  { at: 5.2, kind: 'hammer', actor: 4 },
  { at: 6.7, kind: 'chop', actor: 0 },
  { at: 7.6, kind: 'hammer', actor: 1 },
  { at: 8, kind: 'hammer', actor: 3 },
  { at: 8.4, kind: 'hammer', actor: 5 },
  { at: 9.9, kind: 'chop', actor: 2 },
  { at: 10.8, kind: 'hammer', actor: 0 },
  { at: 11.2, kind: 'hammer', actor: 2 },
  { at: 11.6, kind: 'hammer', actor: 4 },
  { at: 12.6, kind: 'chop', actor: 1 },
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
  /** Forest-wide growth, unaffected by felling. */
  treeGrowth: number
  /** Per-tree growth including chop dips and regrowth, indexed by tree. */
  treeGrowths: readonly number[]
  hutStages: readonly [number, number, number]
  campfireProgress: number
  ignited: boolean
  actorStates: readonly ActorState[]
  camera: CameraPose
  day: DayParams
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

function hutGrowth(elapsed: number, index: number): number {
  const window = HUT_BUILD_WINDOWS[index]
  if (!window) throw new RangeError(`Missing prologue hut window ${index}`)
  const [from, to] = window
  return smooth01((elapsed - from) / (to - from))
}

/**
 * Redistributes one cycle's progress so the time-lapse lingers where the sky is
 * interesting. A linear sweep parks on the flat day and night keyframes and
 * blows through dawn and dusk in a fraction of a second, which reads as snapping
 * between two lighting states rather than time passing.
 *
 * Each pair maps wall-clock progress to phase progress, both measured from the
 * golden start. The phase values are the day boundaries expressed as fractions
 * of a cycle beginning at `GOLDEN_T`: dusk ends at `0.069`, dawn opens at
 * `0.408`, and full day arrives at `0.444`. Pairing those with larger wall-clock
 * shares spends 10% of each cycle on dusk, 32% on night, and 18% on dawn,
 * leaving the long midday plateau to pass quickly.
 *
 * Monotonic, with both endpoints pinned so cycles join seamlessly.
 */
const DAY_SHAPE = [
  [0, 0],
  [0.1, 0.069],
  [0.42, 0.408],
  [0.6, 0.444],
  [1, 1],
] as const

function shapeCycle(progress: number): number {
  for (let index = 1; index < DAY_SHAPE.length; index++) {
    const [fromX, fromY] = DAY_SHAPE[index - 1]!
    const [toX, toY] = DAY_SHAPE[index]!
    if (progress <= toX) {
      return fromY + (toY - fromY) * ((progress - fromX) / (toX - fromX))
    }
  }
  return 1
}

/**
 * Wall-clock weight per cycle. Identical cycles read as a pulsing loop rather
 * than time passing, so the first establishes at a relaxed pace and the later
 * ones quicken as building intensifies. Lengths are relative: they are
 * normalized against the duration, so only their ratios matter.
 */
const CYCLE_WEIGHTS = [1.28, 0.92, 0.8] as const

/** Cumulative cycle boundaries in weight units, plus the running total. */
function cycleSpans(): { starts: number[]; total: number } {
  const starts: number[] = [0]
  let total = 0
  for (const weight of CYCLE_WEIGHTS) {
    total += weight
    starts.push(total)
  }
  return { starts, total }
}

/**
 * Maps prologue-elapsed seconds onto a virtual day phase without mutating the
 * live gameplay clock. Progress is shaped per cycle to dwell on twilight and
 * night, and the traversed span is measured in those same shaped units so
 * `elapsed === PROLOGUE_DURATION` still lands exactly on the canonical golden
 * handoff phase, which the framebuffer audit requires.
 */
export function prologueDayParams(elapsed: number, reducedMotion = false): DayParams {
  if (reducedMotion) return sampleAt(GOLDEN_T)
  const clamped = Math.max(0, Math.min(PROLOGUE_DURATION, elapsed))
  const { starts, total } = cycleSpans()
  const walked = clamped / PROLOGUE_DURATION * total

  let cycle = 0
  while (cycle < starts.length - 2 && walked >= starts[cycle + 1]!) cycle++
  const from = starts[cycle]!
  const span = starts[cycle + 1]! - from
  const within = span > 0 ? (walked - from) / span : 0

  return sampleAt(PROLOGUE_START_T + (cycle + shapeCycle(within)) * DAY_PERIOD)
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

/** Seconds for one fetch -> hut -> fetch loop. Night slows the cadence. */
const CIRCUIT_SECONDS = 2.6
const NIGHT_CIRCUIT_SCALE = 1.45
const CIRCUIT_PHASE_STEP = 1 / FPS

/** A triangle wave in 0..1 -> 1 -> 0, so the loop reverses without a jump. */
function pingPong(value: number): number {
  const wrapped = ((value % 1) + 1) % 1
  return wrapped < 0.5 ? wrapped * 2 : (1 - wrapped) * 2
}

/**
 * Where an actor fetches materials from. Star light draws the pile inward at
 * night so the shift clusters more tightly around the campfire glow.
 */
function fetchPoint(actor: number, nightAmount = 0): GroundPoint {
  const angle = actor / 6 * Math.PI * 2 + Math.PI / 5
  const amount = Math.max(0, Math.min(1, nightAmount))
  const radius = lerpNumber(3.1, 2.3, amount)
  return point(Math.cos(angle) * radius, Math.sin(angle) * radius)
}

function buildCircuitPhases(): number[] {
  const phases = [0]
  const steps = Math.ceil(PROLOGUE_DURATION / CIRCUIT_PHASE_STEP)
  for (let index = 0; index < steps; index++) {
    const from = index * CIRCUIT_PHASE_STEP
    const to = Math.min(PROLOGUE_DURATION, from + CIRCUIT_PHASE_STEP)
    const night = prologueDayParams((from + to) / 2).kind === 'night'
    const seconds = CIRCUIT_SECONDS * (night ? NIGHT_CIRCUIT_SCALE : 1)
    phases.push(phases[index]! + (to - from) / seconds)
  }
  return phases
}

/** Integrated phase keeps position continuous when the night cadence changes. */
const CIRCUIT_PHASES = buildCircuitPhases()

function circuitPhaseAt(elapsed: number): number {
  const clamped = Math.max(0, Math.min(PROLOGUE_DURATION, elapsed))
  const frame = Math.min(Math.floor(clamped / CIRCUIT_PHASE_STEP), CIRCUIT_PHASES.length - 2)
  const fromTime = frame * CIRCUIT_PHASE_STEP
  const progress = (clamped - fromTime) / CIRCUIT_PHASE_STEP
  return lerpNumber(CIRCUIT_PHASES[frame]!, CIRCUIT_PHASES[frame + 1]!, progress)
}

function circuitPosition(
  elapsed: number,
  actor: number,
  work: GroundPoint,
): { position: GroundPoint; heading: GroundPoint; outbound: boolean } {
  const phase = circuitPhaseAt(elapsed) + actor / 6
  const swing = pingPong(phase)
  const outbound = swing > pingPong(phase - 0.001)
  const fetch = fetchPoint(actor, prologueDayParams(elapsed).starOpacity)
  return {
    position: lerpPoint(fetch, work, smooth01(swing)),
    heading: outbound ? work : fetch,
    outbound,
  }
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
  trees: readonly { x: number; z: number }[],
  reducedMotion: boolean,
): ActorState {
  const initial = point(spec.x, spec.z)
  if (elapsed >= PROLOGUE_DURATION) {
    return { position: initial, facing: spec.facing, pose: 'idle', carry: null, frame }
  }

  const hutIndex = Math.floor(actor / 2) as 0 | 1 | 2
  const target = huts[hutIndex]
  if (!target) throw new RangeError(`Missing prologue hut ${hutIndex}`)
  const side = actor % 2 === 0 ? -1 : 1
  const work = workPoint(target, side, 1.45)

  if (actor < 4) {
    const gatherAngle = actor / 4 * Math.PI * 2 + Math.PI / 4
    const gather = point(Math.cos(gatherAngle) * 2.25, Math.sin(gatherAngle) * 2.25)
    let position = initial
    let heading: { x: number; z: number } = { x: spec.x, z: spec.z }
    let onCircuit = false
    let carrying = false
    if (elapsed >= 1.2 && elapsed <= 13.6) {
      const circuit = circuitPosition(elapsed, actor, work)
      const entry = smooth01((elapsed - 1.2) / 1.6)
      position = reducedMotion
        ? work
        : lerpPoint(initial, circuit.position, entry)
      heading = circuit.heading
      onCircuit = !reducedMotion
      carrying = circuit.outbound
    } else if (elapsed > 13.6 && elapsed <= 15.4) {
      const exit = circuitPosition(13.6, actor, work).position
      position = reducedMotion
        ? gather
        : lerpPoint(exit, gather, progressBetween(elapsed, 13.6, 15.4))
      heading = gather
    } else if (elapsed > 15.4) {
      position = reducedMotion
        ? initial
        : lerpPoint(gather, initial, progressBetween(elapsed, 15.4, PROLOGUE_DURATION))
      heading = initial
    }
    const beat = activeBeat(
      elapsed,
      actor,
      PROLOGUE_CUES.filter(cue => cue.kind === 'hammer' || cue.kind === 'chop'),
    )
    // A chopper breaks off the circuit, stands at the trunk to swing, and hauls
    // the timber back afterwards.
    const chopping = beat?.kind === 'chop' ? TREE_CHOPS.find(c => c.at === beat.at) : undefined
    const chopTree = chopping ? trees[chopping.tree] : undefined
    if (chopping && chopTree) {
      const stand = workPoint(chopTree, side, 1.15)
      const swing = smooth01((elapsed - chopping.at) / 0.3)
      position = reducedMotion ? stand : lerpPoint(position, stand, swing)
      heading = chopTree
    }
    return {
      position,
      facing: beat
        ? facing(position, beat.kind === 'chop' ? heading : target)
        : elapsed >= 1.2 && elapsed <= 15.4
          ? facing(position, heading)
          : spec.facing,
      pose: beat ? 'hammer' : onCircuit ? 'carry' : elapsed < 1 ? 'wake' : 'idle',
      carry: onCircuit && carrying && !beat ? 'wood' : null,
      frame,
    }
  }

  const fireWork = workPoint(fire, side, 1.25)
  let position = initial
  let heading: { x: number; z: number } = { x: spec.x, z: spec.z }
  let onCircuit = false
  let carrying = false
  // These two lay and light the fire through the first night, then join the hut
  // circuits for the rest of the intro so the village has firelight to work by.
  if (elapsed >= 0.6 && elapsed < 3.1) {
    const circuit = circuitPosition(elapsed, actor, fireWork)
    const entry = smooth01((elapsed - 0.6) / 0.8)
    position = reducedMotion
      ? fireWork
      : lerpPoint(initial, circuit.position, entry)
    heading = circuit.heading
    onCircuit = !reducedMotion
    carrying = circuit.outbound
  } else if (elapsed >= 3.1 && elapsed <= 15.4) {
    const fireExit = circuitPosition(3.1, actor, fireWork).position
    const circuit = circuitPosition(elapsed, actor, work)
    const entry = smooth01((elapsed - 3.1) / 1.2)
    position = reducedMotion
      ? work
      : lerpPoint(fireExit, circuit.position, entry)
    heading = circuit.heading
    onCircuit = !reducedMotion
    carrying = circuit.outbound
  } else if (elapsed > 15.4) {
    const workExit = circuitPosition(15.4, actor, work).position
    position = reducedMotion
      ? initial
      : lerpPoint(workExit, initial, progressBetween(elapsed, 15.4, PROLOGUE_DURATION))
    heading = initial
  }
  const beat = activeBeat(
    elapsed,
    actor,
    PROLOGUE_CUES.filter(
      cue => cue.kind === 'hammer' || cue.kind === 'place' || cue.kind === 'ignite',
    ),
  )
  return {
    position,
    facing: beat
      ? facing(position, beat.kind === 'hammer' ? target : fire)
      : elapsed >= 0.6 && elapsed <= 15.4
        ? facing(position, heading)
        : spec.facing,
    pose: beat?.kind === 'hammer'
      ? 'hammer'
      : beat?.kind === 'ignite'
        ? 'kneel'
        : beat
          ? 'place'
          : onCircuit
            ? 'carry'
            : elapsed < 1
              ? 'wake'
              : 'idle',
    carry: onCircuit && carrying && !beat ? 'wood' : null,
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
  // Slight ease so the orbit lingers through the first night.
  const eased = progress + Math.sin(progress * Math.PI) * 0.06 * (1 - progress)
  const angle = Math.PI * (1 - eased)
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
  const treeProps = blueprint.props.filter(prop => prop.kind === 'tree')
  if (huts.length !== 3 || !fire) throw new Error('Initial blueprint must contain three built huts and one campfire')

  const hutStages: readonly [number, number, number] = [
    hutGrowth(clamped, 0),
    hutGrowth(clamped, 1),
    hutGrowth(clamped, 2),
  ]
  const campfireStage = CAMPFIRE_BEATS.filter(at => at <= clamped).length
  const campfireProgress = clamped >= CAMPFIRE_IGNITE ? 1 : campfireStage * 0.33

  return {
    elapsed: clamped,
    frame,
    treeGrowth: smooth01(clamped / TREE_FINISH),
    treeGrowths: treeProps.map((_, tree) => treeGrowthAt(clamped, tree)),
    hutStages,
    campfireProgress,
    ignited: clamped >= CAMPFIRE_IGNITE,
    actorStates: blueprint.villagers.map((spec, actor) =>
      actorState(clamped, frame, spec, actor, huts, fire, treeProps, reducedMotion)),
    camera: cameraAt(clamped, reducedMotion),
    day: prologueDayParams(clamped, reducedMotion),
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

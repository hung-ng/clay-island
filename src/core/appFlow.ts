export type PrologueMode = 'first' | 'returning' | 'replay'

export type AppFlowState =
  | { phase: 'title'; mode: Exclude<PrologueMode, 'replay'>; generation: number }
  | { phase: 'prologue'; mode: PrologueMode; generation: number }
  | { phase: 'gameplay'; generation: number }
  | {
      phase: 'replay-transition'
      mode: 'replay'
      destination: 'prologue' | 'gameplay'
      generation: number
    }

export type AppFlowEvent =
  | { type: 'begin' }
  | { type: 'finishPrologue' }
  | { type: 'requestReplay' }
  | { type: 'coverReady' }

export function initialAppFlow(introSeen: boolean): AppFlowState {
  return { phase: 'title', mode: introSeen ? 'returning' : 'first', generation: 0 }
}

export function canSkipPrologue(state: AppFlowState): boolean {
  return state.phase === 'prologue' && state.mode !== 'first'
}

export function simulatesGameplay(state: AppFlowState): boolean {
  return state.phase === 'gameplay'
}

export function canArmPower(state: AppFlowState, modalOpen: boolean): boolean {
  return simulatesGameplay(state) && !modalOpen
}

export function transitionAppFlow(state: AppFlowState, event: AppFlowEvent): AppFlowState {
  const generation = state.generation + 1

  if (state.phase === 'title' && event.type === 'begin') {
    return { phase: 'prologue', mode: state.mode, generation }
  }
  if (state.phase === 'gameplay' && event.type === 'requestReplay') {
    return { phase: 'replay-transition', mode: 'replay', destination: 'prologue', generation }
  }
  if (state.phase === 'replay-transition' && event.type === 'coverReady') {
    return state.destination === 'prologue'
      ? { phase: 'prologue', mode: 'replay', generation }
      : { phase: 'gameplay', generation }
  }
  if (state.phase === 'prologue' && event.type === 'finishPrologue') {
    return state.mode === 'replay'
      ? { phase: 'replay-transition', mode: 'replay', destination: 'gameplay', generation }
      : { phase: 'gameplay', generation }
  }

  return state
}

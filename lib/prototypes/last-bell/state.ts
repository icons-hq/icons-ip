export const LAST_BELL_STATE_VERSION = 1;

export type LastBellPhase =
  | 'opening'
  | 'classroom'
  | 'corridor'
  | 'power'
  | 'bell'
  | 'complete';

export type LastBellState = {
  phase: LastBellPhase;
  doorLocked: boolean;
  hiding: boolean;
  listening: boolean;
  powerRestored: boolean;
  fireDoorLocked: boolean;
  bellTriggered: boolean;
  captured: boolean;
  checkpoint: 'classroom' | 'corridor' | 'power' | 'post_bell';
};

export type LastBellAction =
  | { type: 'SKIP_OPENING' }
  | { type: 'START_PLAY' }
  | { type: 'LOCK_CLASSROOM_DOOR' }
  | { type: 'TOGGLE_HIDE' }
  | { type: 'TOGGLE_LISTEN' }
  | { type: 'RESTORE_POWER' }
  | { type: 'LOCK_FIRE_DOOR' }
  | { type: 'TRIGGER_BELL' }
  | { type: 'REACH_CHAPTER_EXIT' }
  | { type: 'RESTORE_CHECKPOINT'; checkpointId: 'ch1_handoff' | 'ch1_power_restored' | 'ch1_post_bell_safe' }
  | { type: 'CAPTURED' }
  | { type: 'RETRY' };

export const initialLastBellState: LastBellState = {
  phase: 'opening',
  doorLocked: false,
  hiding: false,
  listening: false,
  powerRestored: false,
  fireDoorLocked: false,
  bellTriggered: false,
  captured: false,
  checkpoint: 'classroom',
};

/**
 * Pure, ordered slice state. Every event is guarded so a stale click or a
 * mobile double-tap cannot skip an objective or create an impossible state.
 */
export function reduceLastBellState(
  state: LastBellState,
  action: LastBellAction,
): LastBellState {
  switch (action.type) {
    case 'SKIP_OPENING':
    case 'START_PLAY':
      return state.phase === 'opening'
        ? { ...state, phase: 'classroom', checkpoint: 'classroom' }
        : state;
    case 'LOCK_CLASSROOM_DOOR':
      return state.phase === 'classroom'
        ? {
            ...state,
            phase: 'corridor',
            doorLocked: true,
            checkpoint: 'corridor',
            hiding: false,
            listening: false,
          }
        : state;
    case 'TOGGLE_HIDE':
      return state.phase === 'classroom' || state.phase === 'corridor'
        ? { ...state, hiding: !state.hiding }
        : state;
    case 'TOGGLE_LISTEN':
      return state.phase === 'corridor' || state.phase === 'power' || state.phase === 'bell'
        ? { ...state, listening: !state.listening }
        : state;
    case 'RESTORE_POWER':
      return state.phase === 'corridor' && state.doorLocked
        ? {
            ...state,
            phase: 'power',
            powerRestored: true,
            checkpoint: 'power',
            listening: false,
          }
        : state;
    case 'LOCK_FIRE_DOOR':
      return state.phase === 'power' && state.powerRestored
        ? { ...state, phase: 'bell', fireDoorLocked: true, listening: false }
        : state;
    case 'TRIGGER_BELL':
      return state.phase === 'bell' && state.powerRestored && state.fireDoorLocked
        ? { ...state, bellTriggered: true, checkpoint: 'post_bell', listening: false }
        : state;
    case 'REACH_CHAPTER_EXIT':
      return state.phase === 'bell' && state.bellTriggered
        ? { ...state, phase: 'complete', listening: false }
        : state;
    case 'RESTORE_CHECKPOINT':
      if (action.checkpointId === 'ch1_power_restored') {
        return {
          ...initialLastBellState,
          phase: 'power',
          doorLocked: true,
          powerRestored: true,
          checkpoint: 'power',
        };
      }
      if (action.checkpointId === 'ch1_post_bell_safe') {
        return {
          ...initialLastBellState,
          phase: 'bell',
          doorLocked: true,
          powerRestored: true,
          fireDoorLocked: true,
          bellTriggered: true,
          checkpoint: 'post_bell',
        };
      }
      return {
        ...initialLastBellState,
        phase: 'corridor',
        doorLocked: true,
        checkpoint: 'corridor',
      };
    case 'CAPTURED':
      return state.phase === 'corridor' || state.phase === 'power' || state.phase === 'bell'
        ? { ...state, captured: true, hiding: false, listening: false }
        : state;
    case 'RETRY':
      if (!state.captured) return state;
      if (state.checkpoint === 'power') {
        return {
          ...initialLastBellState,
          // The player returns just before the panel interaction. Keeping the
          // phase as corridor makes RESTORE_POWER reachable after a retry.
          phase: 'corridor',
          doorLocked: true,
          powerRestored: false,
          checkpoint: 'power',
        };
      }
      if (state.checkpoint === 'post_bell') {
        return {
          ...initialLastBellState,
          phase: 'bell',
          doorLocked: true,
          powerRestored: true,
          fireDoorLocked: true,
          bellTriggered: true,
          checkpoint: 'post_bell',
        };
      }
      return {
        ...initialLastBellState,
        phase: state.checkpoint,
        doorLocked: state.checkpoint !== 'classroom',
        checkpoint: state.checkpoint,
      };
    default:
      return state;
  }
}

export const LAST_BELL_OBJECTIVES: Record<LastBellPhase, string> = {
  opening: '마지막 수업이 끝나기를 기다린다',
  classroom: '문을 잠그고 복도로 나가야 한다',
  corridor: '소리를 듣고 설비실의 비상전원을 찾아라',
  power: '배전반을 올리고 화재문으로 돌아가라',
  bell: '화재문을 잠그고 마지막 종을 울려라',
  complete: 'Chapter 1 — 마지막 종 완료',
};

export function objectiveForState(state: LastBellState): string {
  if (state.phase === 'power' && state.powerRestored) return '비상전원이 돌아왔다. 화재문을 잠가라';
  if (state.phase === 'bell' && state.bellTriggered) return '안전 계단으로 들어가 Chapter 1을 완료하라';
  return LAST_BELL_OBJECTIVES[state.phase];
}

export const LAST_BELL_ANCHORS = {
  classroom_spawn: { x: 0, z: 4 },
  classroom_door: { x: 0, z: 13 },
  desk_hide: { x: -3, z: 6 },
  corridor_listen: { x: 0, z: 20 },
  corridor_hide_left: { x: -2, z: 22 },
  corridor_hide_right: { x: 2, z: 34 },
  bell_hide: { x: 1.7, z: 45 },
  utility_panel: { x: 3, z: 29 },
  fire_door_lock: { x: 0, z: 41 },
  bell_trigger: { x: 0, z: 48 },
  chapter_exit: { x: 0, z: 53 },
} as const;

export type LastBellAnchorId = keyof typeof LAST_BELL_ANCHORS;

export function distanceToAnchor(
  position: { x: number; z: number },
  anchor: LastBellAnchorId,
): number {
  const target = LAST_BELL_ANCHORS[anchor];
  return Math.hypot(position.x - target.x, position.z - target.z);
}

export function canInteractAt(
  state: LastBellState,
  anchor: LastBellAnchorId,
  position: { x: number; z: number },
): boolean {
  if (distanceToAnchor(position, anchor) > 2.25) return false;
  switch (anchor) {
    case 'classroom_door':
      return state.phase === 'classroom' && !state.doorLocked;
    case 'desk_hide':
      return state.phase === 'classroom' || state.phase === 'corridor';
    case 'corridor_hide_left':
    case 'corridor_hide_right':
      return (state.phase === 'corridor' || state.phase === 'power') && !state.bellTriggered;
    case 'bell_hide':
      return state.phase === 'bell' && state.bellTriggered;
    case 'utility_panel':
      return state.phase === 'corridor' && !state.powerRestored;
    case 'fire_door_lock':
      return state.phase === 'power' && state.powerRestored && !state.fireDoorLocked;
    case 'bell_trigger':
      return state.phase === 'bell' && state.fireDoorLocked && !state.bellTriggered;
    case 'chapter_exit':
      return state.phase === 'bell' && state.bellTriggered;
    default:
      return false;
  }
}

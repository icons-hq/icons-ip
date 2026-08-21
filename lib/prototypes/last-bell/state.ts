import { interactionDescriptorFor } from './interactions';

export const LAST_BELL_STATE_VERSION = 2;

export const LAST_BELL_ROUTE_IDS = ['central', 'rear', 'systems'] as const;
export type LastBellRouteId = (typeof LAST_BELL_ROUTE_IDS)[number];
export type LastBellRouteObjective = 'central_listen' | 'rear_key' | 'systems_map';

const ROUTE_OBJECTIVE: Record<LastBellRouteId, LastBellRouteObjective> = {
  central: 'central_listen',
  rear: 'rear_key',
  systems: 'systems_map',
};

const ROUTE_OBJECTIVE_COPY: Record<LastBellRouteObjective, string> = {
  central_listen: '정면 복도에서 Q로 소리를 듣고 동선을 확인하라',
  rear_key: '후문 사물함에서 비상키를 회수하라',
  systems_map: '배전 경로도를 확인해 설비실로 들어가라',
};

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
  checkpoint: 'classroom' | 'corridor' | 'power';
  routeId: LastBellRouteId | null;
  routeObjective: LastBellRouteObjective | null;
};

export type LastBellAction =
  | { type: 'SKIP_OPENING' }
  | { type: 'START_PLAY' }
  | { type: 'LOCK_CLASSROOM_DOOR' }
  | { type: 'SELECT_ROUTE'; routeId: LastBellRouteId }
  | { type: 'COMPLETE_ROUTE_OBJECTIVE'; routeId: LastBellRouteId }
  | { type: 'TOGGLE_HIDE' }
  | { type: 'TOGGLE_LISTEN' }
  | { type: 'RESTORE_POWER' }
  | { type: 'LOCK_FIRE_DOOR' }
  | { type: 'TRIGGER_BELL' }
  | { type: 'REACH_CHAPTER_EXIT' }
  | {
    type: 'RESTORE_CHECKPOINT';
    checkpointId: 'ch1_handoff' | 'ch1_power_restored';
    routeId?: LastBellRouteId;
    routeObjective?: LastBellRouteObjective | null;
  }
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
  routeId: null,
  routeObjective: null,
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
    case 'SELECT_ROUTE':
      return state.phase === 'corridor' && state.routeId === null
        ? { ...state, routeId: action.routeId, routeObjective: ROUTE_OBJECTIVE[action.routeId], listening: false }
        : state;
    case 'COMPLETE_ROUTE_OBJECTIVE':
      return state.phase === 'corridor'
        && state.routeId === action.routeId
        && state.routeObjective === ROUTE_OBJECTIVE[action.routeId]
        && (action.routeId !== 'central' || state.listening)
        ? { ...state, routeObjective: null, listening: false }
        : state;
    case 'TOGGLE_HIDE':
      return state.phase === 'classroom' || state.phase === 'corridor' || state.phase === 'power' || state.phase === 'bell'
        ? { ...state, hiding: !state.hiding }
        : state;
    case 'TOGGLE_LISTEN':
      return state.phase === 'corridor' || state.phase === 'power' || state.phase === 'bell'
        ? { ...state, listening: !state.listening }
        : state;
    case 'RESTORE_POWER':
      return state.phase === 'corridor' && state.doorLocked && state.routeId !== null && state.routeObjective === null
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
        ? { ...state, bellTriggered: true, checkpoint: 'power', listening: false }
        : state;
    case 'REACH_CHAPTER_EXIT':
      return state.phase === 'bell' && state.bellTriggered
        ? { ...state, phase: 'complete', listening: false }
        : state;
    case 'RESTORE_CHECKPOINT':
      if (action.checkpointId === 'ch1_power_restored') {
        if (!action.routeId) return initialLastBellState;
        return {
          ...initialLastBellState,
          phase: 'power',
          doorLocked: true,
          powerRestored: true,
          checkpoint: 'power',
          routeId: action.routeId,
        };
      }
      return {
        ...initialLastBellState,
        phase: 'corridor',
        doorLocked: true,
        checkpoint: 'corridor',
        routeId: action.routeId ?? null,
        routeObjective: action.routeId ? action.routeObjective ?? ROUTE_OBJECTIVE[action.routeId] : null,
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
          // Power is the last safe checkpoint; the panel stays restored so a
          // retry cannot bypass the chase by replaying the post-bell setpiece.
          phase: 'power',
          doorLocked: true,
          powerRestored: true,
          checkpoint: 'power',
          routeId: state.routeId,
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
  if (state.phase === 'corridor' && state.routeId === null) return '정면 · 후문 · 설비실 중 전력 복구 경로를 선택하라';
  if (state.phase === 'corridor' && state.routeObjective) return ROUTE_OBJECTIVE_COPY[state.routeObjective];
  if (state.phase === 'power' && state.powerRestored) return '비상전원이 돌아왔다. 화재문을 잠가라';
  if (state.phase === 'bell' && state.bellTriggered) return '안전 계단으로 들어가 Chapter 1을 완료하라';
  return LAST_BELL_OBJECTIVES[state.phase];
}

export const LAST_BELL_ANCHORS = {
  classroom_spawn: { x: 0, z: 4 },
  classroom_door: { x: 0, z: 13 },
  desk_hide: { x: -3, z: 6 },
  corridor_listen: { x: 0, z: 20 },
  route_central: { x: 0, z: 17.4 },
  route_rear: { x: -1.7, z: 17.4 },
  route_systems: { x: 1.7, z: 17.4 },
  central_listen: { x: 0, z: 23 },
  rear_key: { x: -1.8, z: 24.8 },
  systems_map: { x: 1.8, z: 26.6 },
  corridor_hide_left: { x: -2, z: 22 },
  corridor_hide_right: { x: 2, z: 34 },
  bell_hide: { x: -2, z: 48 },
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

export function nearestInteractableAnchor<const Anchor extends LastBellAnchorId>(
  state: LastBellState,
  anchors: readonly Anchor[],
  position: { x: number; z: number },
): Anchor | null {
  let nearest: Anchor | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    if (!canInteractAt(state, anchor, position)) continue;
    const distance = distanceToAnchor(position, anchor);
    if (distance < nearestDistance) {
      nearest = anchor;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function canInteractAt(
  state: LastBellState,
  anchor: LastBellAnchorId,
  position: { x: number; z: number },
): boolean {
  const interactionRadius = interactionDescriptorFor(anchor)?.radius ?? 2.25;
  if (distanceToAnchor(position, anchor) > interactionRadius) return false;
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
    case 'route_central':
    case 'route_rear':
    case 'route_systems':
      return state.phase === 'corridor' && state.routeId === null;
    case 'central_listen':
      return state.phase === 'corridor' && state.routeId === 'central' && state.routeObjective === 'central_listen' && state.listening;
    case 'rear_key':
      return state.phase === 'corridor' && state.routeId === 'rear' && state.routeObjective === 'rear_key';
    case 'systems_map':
      return state.phase === 'corridor' && state.routeId === 'systems' && state.routeObjective === 'systems_map';
    case 'utility_panel':
      return state.phase === 'corridor' && state.routeId !== null && state.routeObjective === null && !state.powerRestored;
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

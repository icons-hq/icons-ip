import type { LastBellAudioId } from './assets';
import type { LastBellAnchorId, LastBellRouteId } from './state';

export type LastBellInteractiveAnchor = Exclude<
  LastBellAnchorId,
  'classroom_spawn' | 'corridor_listen'
>;

export type LastBellInteractionAction =
  | 'lockClassroomDoor'
  | 'selectRoute'
  | 'completeRouteObjective'
  | 'toggleHide'
  | 'restorePower'
  | 'lockFireDoor'
  | 'triggerBell'
  | 'reachChapterExit';

export type LastBellInteractionDescriptor = {
  anchor: LastBellInteractiveAnchor;
  copy: string;
  action: LastBellInteractionAction;
  routeId?: LastBellRouteId;
  radius?: number;
  audio?: { id: LastBellAudioId; volume: number };
};

/** The only source of truth for player-facing anchor interactions. */
export const INTERACTION_DESCRIPTORS = [
  { anchor: 'classroom_door', copy: '문을 통과해 잠그기', action: 'lockClassroomDoor', audio: { id: 'doorPounding', volume: .42 } },
  { anchor: 'route_central', copy: '정면 복도로 가기', action: 'selectRoute', routeId: 'central' },
  { anchor: 'route_rear', copy: '후문 사물함 길로 가기', action: 'selectRoute', routeId: 'rear' },
  { anchor: 'route_systems', copy: '설비실 안내선을 따라가기', action: 'selectRoute', routeId: 'systems' },
  { anchor: 'central_listen', copy: '들린 동선을 확인하기', action: 'completeRouteObjective', routeId: 'central' },
  { anchor: 'rear_key', copy: '비상키 회수하기', action: 'completeRouteObjective', routeId: 'rear' },
  { anchor: 'systems_map', copy: '배전 경로 확인하기', action: 'completeRouteObjective', routeId: 'systems' },
  { anchor: 'desk_hide', copy: '책상 뒤에 숨기', action: 'toggleHide' },
  { anchor: 'corridor_hide_left', copy: '사물함 틈에 숨기', action: 'toggleHide' },
  { anchor: 'corridor_hide_right', copy: '복도 벽감에 숨기', action: 'toggleHide' },
  { anchor: 'bell_hide', copy: '계단 옆 틈에 숨기', action: 'toggleHide' },
  { anchor: 'utility_panel', copy: '비상전원 올리기', action: 'restorePower', audio: { id: 'breaker', volume: .68 } },
  { anchor: 'fire_door_lock', copy: '화재문을 통과해 잠그기', action: 'lockFireDoor', audio: { id: 'doorPounding', volume: .42 } },
  { anchor: 'bell_trigger', copy: '마지막 종 울리기', action: 'triggerBell', radius: .95, audio: { id: 'bell', volume: .68 } },
  { anchor: 'chapter_exit', copy: '안전 계단으로 들어가기', action: 'reachChapterExit' },
] as const satisfies readonly LastBellInteractionDescriptor[];

export type LastBellInteractionAnchor = (typeof INTERACTION_DESCRIPTORS)[number]['anchor'];

export function interactionDescriptorFor(
  anchor: LastBellAnchorId | null,
): LastBellInteractionDescriptor | undefined {
  return anchor ? INTERACTION_DESCRIPTORS.find((descriptor) => descriptor.anchor === anchor) : undefined;
}

import type { LastBellAudioId } from './assets';
import type { LastBellAnchorId } from './state';

export type LastBellInteractiveAnchor = Exclude<
  LastBellAnchorId,
  'classroom_spawn' | 'corridor_listen'
>;

export type LastBellInteractionAction =
  | 'lockClassroomDoor'
  | 'toggleHide'
  | 'restorePower'
  | 'lockFireDoor'
  | 'triggerBell'
  | 'reachChapterExit';

export type LastBellInteractionDescriptor = {
  anchor: LastBellInteractiveAnchor;
  copy: string;
  action: LastBellInteractionAction;
  radius?: number;
  audio?: { id: LastBellAudioId; volume: number };
};

/** The only source of truth for player-facing anchor interactions. */
export const INTERACTION_DESCRIPTORS = [
  { anchor: 'classroom_door', copy: '문을 통과해 잠그기', action: 'lockClassroomDoor', audio: { id: 'doorPounding', volume: .42 } },
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

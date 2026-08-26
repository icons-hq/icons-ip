import type { LastBellState } from '@/lib/prototypes/last-bell/state';
import { CHAPTER_01_PLAYER_START } from '../content/chapter-01';

export type LastBellCheckpointPosition = { x: number; z: number; yaw: number; chaseSeconds: number };

export function checkpointPositionFor(checkpoint: LastBellState['checkpoint']): LastBellCheckpointPosition {
  if (checkpoint === 'power') return { x: 2.25, z: 27, yaw: Math.PI, chaseSeconds: 0 };
  if (checkpoint === 'corridor') return { x: 0, z: 13.9, yaw: Math.PI, chaseSeconds: 0 };
  return { x: CHAPTER_01_PLAYER_START.x, z: CHAPTER_01_PLAYER_START.z, yaw: Math.PI, chaseSeconds: 0 };
}

import type { LastBellState } from '@/lib/prototypes/last-bell/state';

export type LastBellCheckpointPosition = { x: number; z: number; yaw: number; chaseSeconds: number };

export function checkpointPositionFor(checkpoint: LastBellState['checkpoint']): LastBellCheckpointPosition {
  if (checkpoint === 'power') return { x: 2.25, z: 27, yaw: Math.PI, chaseSeconds: 0 };
  if (checkpoint === 'post_bell') return { x: 0, z: 50, yaw: Math.PI, chaseSeconds: 0 };
  if (checkpoint === 'corridor') return { x: 0, z: 13.9, yaw: Math.PI, chaseSeconds: 0 };
  return { x: 0, z: 9, yaw: Math.PI, chaseSeconds: 0 };
}

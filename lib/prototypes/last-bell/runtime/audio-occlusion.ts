import type { DoorSnapshot } from '../engine/doors';
import { isLastBellNavSegmentWalkable, zoneForLastBellPosition } from './world';
import type { LastBellVec2 } from './types';

export type ZombieAudioOcclusion = Readonly<{
  occluded: boolean;
  sourceZone: string;
  listenerZone: string;
  gain: number;
  lowpassHz: number;
}>;

/**
 * The audio adapter reads the same authored colliders and DoorSnapshot LOS
 * blockers as simulation. A mesh, shadow map, or renderer raycast is never
 * allowed to make a different audible-door decision.
 */
export function zombieAudioOcclusion(
  listener: LastBellVec2,
  source: LastBellVec2,
  doors: readonly DoorSnapshot[],
): ZombieAudioOcclusion {
  const blockedDoor = doors.some((door) => door.blocker.blocksLineOfSight && segmentIntersectsBounds(listener, source, door.blocker.bounds));
  const blockedWorld = !isLastBellNavSegmentWalkable(listener, source, 0);
  const occluded = blockedDoor || blockedWorld;
  return {
    occluded,
    sourceZone: zoneForLastBellPosition(source),
    listenerZone: zoneForLastBellPosition(listener),
    gain: occluded ? .045 : .14,
    lowpassHz: occluded ? 620 : 6_500,
  };
}

function segmentIntersectsBounds(from: LastBellVec2, to: LastBellVec2, bounds: DoorSnapshot['blocker']['bounds']): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .08));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const x = from.x + (to.x - from.x) * ratio;
    const z = from.z + (to.z - from.z) * ratio;
    if (x >= bounds.min.x && x <= bounds.max.x && z >= bounds.min.z && z <= bounds.max.z) return true;
  }
  return false;
}

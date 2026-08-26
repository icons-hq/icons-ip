import { movementBasisFromFacing } from './movement-basis';

export type MovementPosition = { x: number; z: number };
export type MovementInput = { x: number; y: number };
export type LastBellDoorHandoff = { position: MovementPosition; yaw: number };
export type LastBellPortalBounds = {
  min: { x: number; z: number };
  max: { x: number; z: number };
};
export type LastBellClampOptions = {
  fireDoorLocked: boolean;
  /**
   * Current `DoorSystem` truth for the classroom threshold. An animated door
   * blocks crossings from either side until it is passable.
   */
  classroomDoorPassable: boolean;
  /** Only the authored slider portal may cross the classroom wall. */
  classroomDoorPortal?: LastBellPortalBounds;
  /** Review-only boundary; legacy spaces remain outside the mounted slice. */
  maxPlayerZ?: number;
};

export const LAST_BELL_FIXED_STEP = 1 / 30;

const DEFAULT_CLASSROOM_DOOR_PORTAL: LastBellPortalBounds = {
  min: { x: -1.65, z: 12.85 },
  max: { x: 1.65, z: 13.15 },
};
const PLAYER_RADIUS = .26;

/**
 * The fire door retains the original authored atomic handoff. The classroom
 * slider deliberately has no counterpart: it is driven by `DoorSystem`.
 */
export function lastBellFireDoorHandoff(): LastBellDoorHandoff {
  return { position: { x: 0, z: 42.2 }, yaw: Math.PI };
}

/** Move in camera-relative space. Input y=-1 is forward, matching the stick. */
export function stepLastBellPosition(
  position: MovementPosition,
  input: MovementInput,
  yaw: number,
  deltaSeconds: number,
  speed: number,
): MovementPosition {
  const magnitude = Math.hypot(input.x, input.y);
  if (magnitude < .0001) return position;
  const axisX = input.x / Math.max(1, magnitude);
  const forward = -input.y / Math.max(1, magnitude);
  // The legacy camera stores visual yaw (PI faces the authored +Z route),
  // while campaign simulation stores logical facing. Convert once and share
  // the public basis used by keyboard, touch, and gamepad input.
  const basis = movementBasisFromFacing(yaw - Math.PI);
  const worldX = axisX * basis.right.x + forward * basis.forward.x;
  const worldZ = axisX * basis.right.z + forward * basis.forward.z;
  return {
    x: position.x + worldX * speed * deltaSeconds,
    z: position.z + worldZ * speed * deltaSeconds,
  };
}

export function clampLastBellPosition(
  position: MovementPosition,
  options: LastBellClampOptions,
  previousPosition: MovementPosition = position,
): MovementPosition {
  let { x, z } = position;
  const portal = options.classroomDoorPortal ?? DEFAULT_CLASSROOM_DOOR_PORTAL;
  z = Math.max(-1, Math.min(options.maxPlayerZ ?? 53.5, z));

  const enteringFromClassroom = previousPosition.z < portal.min.z && z >= portal.min.z;
  const enteringFromFirstBay = previousPosition.z > portal.max.z && z <= portal.max.z;
  if (enteringFromClassroom || enteringFromFirstBay) {
    const portalPlaneZ = enteringFromClassroom ? portal.min.z : portal.max.z;
    const distanceZ = z - previousPosition.z;
    const interpolation = Math.abs(distanceZ) < .0001 ? 0 : (portalPlaneZ - previousPosition.z) / distanceZ;
    const crossingX = previousPosition.x + (x - previousPosition.x) * interpolation;
    const insidePortal = crossingX >= portal.min.x + PLAYER_RADIUS
      && crossingX <= portal.max.x - PLAYER_RADIUS;

    // A door may be visibly open, but its wall is still solid away from the
    // authored portal. This preserves two-way movement without permitting an
    // off-axis clip through the classroom end wall.
    if (!options.classroomDoorPassable || !insidePortal) {
      z = enteringFromClassroom ? portal.min.z - PLAYER_RADIUS : portal.max.z + PLAYER_RADIUS;
    }
  }

  if (z < 13) x = Math.max(-5.8, Math.min(5.8, x));
  else x = Math.max(-2.25, Math.min(2.25, x));
  if (!options.fireDoorLocked) z = Math.min(z, 40.2);
  // The fire door follows the same atomic handoff contract: forward is free
  // after the interaction, reverse passage through the closed door is blocked.
  if (options.fireDoorLocked && previousPosition.z >= 41.2 && z < 41.2) z = 41.2;
  return { x, z };
}

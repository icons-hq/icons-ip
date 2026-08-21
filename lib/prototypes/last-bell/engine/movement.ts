export type MovementPosition = { x: number; z: number };
export type MovementInput = { x: number; y: number };

export const LAST_BELL_FIXED_STEP = 1 / 30;

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
  const worldX = axisX * Math.cos(yaw) + forward * -Math.sin(yaw);
  const worldZ = axisX * -Math.sin(yaw) + forward * -Math.cos(yaw);
  return {
    x: position.x + worldX * speed * deltaSeconds,
    z: position.z + worldZ * speed * deltaSeconds,
  };
}

export function clampLastBellPosition(
  position: MovementPosition,
  options: { doorLocked: boolean; fireDoorLocked: boolean },
): MovementPosition {
  let { x, z } = position;
  if (z < 13) x = Math.max(-5.8, Math.min(5.8, x));
  else x = Math.max(-2.25, Math.min(2.25, x));
  z = Math.max(-1, Math.min(53.5, z));
  if (!options.doorLocked) z = Math.min(z, 12.2);
  if (options.doorLocked && position.z > 13.8 && z < 13.8) z = 13.8;
  if (!options.fireDoorLocked) z = Math.min(z, 40.2);
  // After the fire-door interaction the authored forward direction remains
  // open, but the player cannot walk back through the locked blocker.
  if (options.fireDoorLocked && position.z > 41.2 && z < 41.2) z = 41.2;
  return { x, z };
}

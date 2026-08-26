/**
 * Renderer-independent movement axes for every Last Bell input device.
 * `facingRadians = 0` looks down the authored positive-Z route; screen-right
 * is negative X because the camera is rendered at `facingRadians + PI`.
 */
export type LastBellMovementBasis = Readonly<{
  forward: Readonly<{ x: number; z: number }>;
  right: Readonly<{ x: number; z: number }>;
}>;

export function movementBasisFromFacing(facingRadians: number): LastBellMovementBasis {
  const facing = Number.isFinite(facingRadians) ? facingRadians : 0;
  return {
    forward: { x: Math.sin(facing), z: Math.cos(facing) },
    right: { x: -Math.cos(facing), z: Math.sin(facing) },
  };
}

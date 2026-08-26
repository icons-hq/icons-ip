import { describe, expect, it } from 'vitest';
import { movementBasisFromFacing } from './movement-basis';
import { clampLastBellPosition, lastBellFireDoorHandoff, stepLastBellPosition } from './movement';

function simulate(frameSeconds: number) {
  let position = { x: 0, z: 4 };
  const yaw = Math.PI;
  const duration = 1;
  for (let elapsed = 0; elapsed < duration - 1e-9; elapsed += frameSeconds) {
    const dt = Math.min(frameSeconds, duration - elapsed);
    position = stepLastBellPosition(position, { x: 0, y: -1 }, yaw, dt, 1.85);
  }
  return position;
}

describe('last bell camera-relative movement', () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    'publishes an orthonormal camera-relative basis at facing %s',
    (facingRadians) => {
      const basis = movementBasisFromFacing(facingRadians);
      const forwardLength = Math.hypot(basis.forward.x, basis.forward.z);
      const rightLength = Math.hypot(basis.right.x, basis.right.z);
      const axisDot = basis.forward.x * basis.right.x + basis.forward.z * basis.right.z;

      expect(forwardLength).toBeCloseTo(1, 10);
      expect(rightLength).toBeCloseTo(1, 10);
      expect(axisDot).toBeCloseTo(0, 10);
      expect(basis.forward.x).toBeCloseTo(Math.sin(facingRadians), 10);
      expect(basis.forward.z).toBeCloseTo(Math.cos(facingRadians), 10);
      expect(basis.right.x).toBeCloseTo(-Math.cos(facingRadians), 10);
      expect(basis.right.z).toBeCloseTo(Math.sin(facingRadians), 10);
    },
  );

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    'keeps a positive screen-right dot at facing %s for the shared keyboard, touch, and gamepad vector',
    (facingRadians) => {
      const basis = movementBasisFromFacing(facingRadians);
      const distance = .37;
      const displacement = { x: basis.right.x * distance, z: basis.right.z * distance };
      const screenRightDot = displacement.x * basis.right.x + displacement.z * basis.right.z;

      expect(screenRightDot).toBeGreaterThan(0);
      expect(screenRightDot).toBeCloseTo(distance, 10);
    },
  );

  it.each([1 / 30, 1 / 60, 1 / 120])('is cadence-independent at %s fps', (frameSeconds) => {
    expect(simulate(frameSeconds).z).toBeCloseTo(5.85, 4);
  });

  it('follows the camera yaw rather than world axes', () => {
    const position = stepLastBellPosition({ x: 0, z: 4 }, { x: 0, y: -1 }, Math.PI / 2, 1, 2);
    expect(position.x).toBeCloseTo(-2, 4);
    expect(position.z).toBeCloseTo(4, 4);
  });

  it('uses an explicit classroom DoorSystem snapshot for both directions of the sliding-door threshold', () => {
    const closed = { fireDoorLocked: false, classroomDoorPassable: false };
    expect(clampLastBellPosition({ x: 0, z: 14 }, closed, { x: 0, z: 12 }).z).toBeCloseTo(12.59, 4);
    expect(clampLastBellPosition({ x: 0, z: 12 }, closed, { x: 0, z: 14 }).z).toBeCloseTo(13.41, 4);

    const open = { fireDoorLocked: false, classroomDoorPassable: true };
    expect(clampLastBellPosition({ x: 0, z: 14 }, open, { x: 0, z: 12 }).z).toBe(14);
    expect(clampLastBellPosition({ x: 0, z: 12 }, open, { x: 0, z: 14 }).z).toBe(12);
  });

  it('allows an open slider crossing only through its authored portal AABB', () => {
    const open = { fireDoorLocked: false, classroomDoorPassable: true };
    expect(clampLastBellPosition({ x: 1.9, z: 14 }, open, { x: 1.9, z: 12 }).z).toBeCloseTo(12.59, 4);
    expect(clampLastBellPosition({ x: -1.9, z: 12 }, open, { x: -1.9, z: 14 }).z).toBeCloseTo(13.41, 4);
    expect(clampLastBellPosition({ x: 1.35, z: 14 }, open, { x: 1.35, z: 12 }).z).toBe(14);
    expect(clampLastBellPosition({ x: -1.35, z: 12 }, open, { x: -1.35, z: 14 }).z).toBe(12);
    expect(clampLastBellPosition({ x: .5, z: 14 }, open, { x: .5, z: 12 }).z).toBe(14);
  });

  it('honours a review-only max boundary without changing legacy defaults', () => {
    const review = { fireDoorLocked: true, classroomDoorPassable: true, maxPlayerZ: 24.6 };
    expect(clampLastBellPosition({ x: 0, z: 29 }, review, { x: 0, z: 24 }).z).toBe(24.6);
  });

  it('keeps the player outside the fire door until the interaction unlocks the passage', () => {
    expect(clampLastBellPosition({ x: 0, z: 42 }, { fireDoorLocked: false, classroomDoorPassable: false }).z).toBe(40.2);
    expect(clampLastBellPosition({ x: 0, z: 42 }, { fireDoorLocked: true, classroomDoorPassable: false }).z).toBe(42);
    expect(clampLastBellPosition({ x: 0, z: 40 }, { fireDoorLocked: true, classroomDoorPassable: false }).z).toBe(40);
  });

  it('keeps the fire-door handoff atomic without giving the classroom slider a teleport path', () => {
    const fire = lastBellFireDoorHandoff().position;
    const unlockedFireDoor = { fireDoorLocked: true, classroomDoorPassable: false };
    expect(fire).toEqual({ x: 0, z: 42.2 });
    expect(clampLastBellPosition({ ...fire, z: 40 }, unlockedFireDoor, fire).z).toBe(41.2);
    expect(clampLastBellPosition({ ...fire, z: 40 }, unlockedFireDoor, { ...fire, z: 41.2 }).z).toBe(41.2);
    expect(clampLastBellPosition({ ...fire, z: 43 }, unlockedFireDoor, fire).z).toBe(43);
  });
});

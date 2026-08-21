import { describe, expect, it } from 'vitest';
import { clampLastBellPosition, lastBellDoorHandoffFor, stepLastBellPosition } from './movement';

function simulate(frameSeconds: number) {
  let position = { x: 0, z: 9 };
  const yaw = Math.PI;
  const duration = 1;
  for (let elapsed = 0; elapsed < duration - 1e-9; elapsed += frameSeconds) {
    const dt = Math.min(frameSeconds, duration - elapsed);
    position = stepLastBellPosition(position, { x: 0, y: -1 }, yaw, dt, 1.85);
  }
  return position;
}

describe('last bell camera-relative movement', () => {
  it.each([1 / 30, 1 / 60, 1 / 120])('is cadence-independent at %s fps', (frameSeconds) => {
    expect(simulate(frameSeconds).z).toBeCloseTo(10.85, 4);
  });

  it('follows the camera yaw rather than world axes', () => {
    const position = stepLastBellPosition({ x: 0, z: 9 }, { x: 0, y: -1 }, Math.PI / 2, 1, 2);
    expect(position.x).toBeCloseTo(-2, 4);
    expect(position.z).toBeCloseTo(9, 4);
  });

  it('keeps the player behind an unlocked classroom door', () => {
    expect(clampLastBellPosition({ x: 0, z: 14 }, { doorLocked: false, fireDoorLocked: false }).z).toBe(12.2);
  });

  it('keeps the player outside the fire door until the interaction unlocks the passage', () => {
    expect(clampLastBellPosition({ x: 0, z: 42 }, { doorLocked: true, fireDoorLocked: false }).z).toBe(40.2);
    expect(clampLastBellPosition({ x: 0, z: 42 }, { doorLocked: true, fireDoorLocked: true }).z).toBe(42);
    expect(clampLastBellPosition({ x: 0, z: 40 }, { doorLocked: true, fireDoorLocked: true }).z).toBe(40);
  });

  it('uses an atomic handoff and keeps both door leaves closed', () => {
    expect(lastBellDoorHandoffFor('classroom')).toEqual({ position: { x: 0, z: 14.2 }, yaw: Math.PI });
    expect(lastBellDoorHandoffFor('fire')).toEqual({ position: { x: 0, z: 42.2 }, yaw: Math.PI });
    expect(clampLastBellPosition({ x: 0, z: 14.2 }, { doorLocked: true, fireDoorLocked: false }, { x: 0, z: 12.2 }).z).toBe(14.2);
    expect(clampLastBellPosition({ x: 0, z: 42.2 }, { doorLocked: true, fireDoorLocked: true }, { x: 0, z: 40.2 }).z).toBe(42.2);
  });

  it('blocks reverse passage after each handoff while allowing forward travel', () => {
    const classroom = lastBellDoorHandoffFor('classroom').position;
    expect(clampLastBellPosition({ ...classroom, z: 12 }, { doorLocked: true, fireDoorLocked: false }, classroom).z).toBe(13.8);
    expect(clampLastBellPosition({ ...classroom, z: 12 }, { doorLocked: true, fireDoorLocked: false }, { ...classroom, z: 13.8 }).z).toBe(13.8);
    const fire = lastBellDoorHandoffFor('fire').position;
    expect(clampLastBellPosition({ ...fire, z: 40 }, { doorLocked: true, fireDoorLocked: true }, fire).z).toBe(41.2);
    expect(clampLastBellPosition({ ...fire, z: 40 }, { doorLocked: true, fireDoorLocked: true }, { ...fire, z: 41.2 }).z).toBe(41.2);
    expect(clampLastBellPosition({ ...fire, z: 43 }, { doorLocked: true, fireDoorLocked: true }, fire).z).toBe(43);
  });
});

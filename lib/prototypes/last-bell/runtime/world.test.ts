import { describe, expect, it } from 'vitest';
import {
  canOccupyLastBellPosition,
  hidingSpotById,
  LAST_BELL_ENCOUNTERS,
  LAST_BELL_INTERACTIONS,
  LAST_BELL_ROUTE_EVIDENCE,
} from './world';

describe('Last Bell authored doorway clearance', () => {
  it('keeps the full decoded classroom doorway traversable for an actor radius', () => {
    // The delivery door spans roughly x=-1.72..1.73. Players may approach
    // off-centre after inspecting the room, so the semantic portal must not
    // narrow that authored aperture to an invisible one-metre slot.
    expect(canOccupyLastBellPosition({ x: 1.35, z: 13.1 }, .26)).toBe(true);
    expect(canOccupyLastBellPosition({ x: -1.35, z: 13.1 }, .26)).toBe(true);
  });
});

describe('Last Bell authored hiding camera contracts', () => {
  it('places the desk camera below the authored tabletop without a torch hotspot', () => {
    const desk = hidingSpotById('ch1.hide.desk');

    expect(desk).not.toBeNull();
    expect(desk?.position).toEqual({ x: -3.35, z: 2.85 });
    expect(desk?.camera.eyeHeightMeters).toBeLessThan(.76);
    expect(desk?.camera.eyeHeightMeters).toBeGreaterThanOrEqual(.62);
    expect(desk?.camera.offset.z).toBeCloseTo(-.08);
    expect(desk?.camera.suppressFlashlight).toBe(true);
  });

  it('keeps the locker camera upright and suppresses light leaking through its door', () => {
    const locker = hidingSpotById('ch1.hide.locker');

    // This is the world-space pivot exported by the authored corridor GLB.
    // Keeping the interaction on a later, invisible corridor coordinate made
    // the visible locker impossible to enter even while the player touched it.
    expect(locker?.position).toEqual({ x: 2.25, z: 15.1 });
    expect(LAST_BELL_INTERACTIONS.find((interaction) => interaction.id === 'ch1.hide.locker')?.position)
      .toEqual(locker?.position);
    expect(locker?.camera.eyeHeightMeters).toBeGreaterThan(1.3);
    expect(locker?.camera.eyeHeightMeters).toBeLessThan(1.6);
    expect(locker?.camera.suppressFlashlight).toBe(true);
  });
});

describe('Last Bell data-driven encounter contracts', () => {
  it('keeps actor ids unique and the live design ceiling at two', () => {
    const actors = LAST_BELL_ENCOUNTERS.flatMap((encounter) => encounter.actors);
    expect(new Set(actors.map((actor) => actor.id)).size).toBe(actors.length);
    expect(actors).toHaveLength(2);
    expect(actors.every((actor) => actor.waypoints.length > 0)).toBe(true);
  });

  it('binds every encounter to positional audio, real cover, and a semantic exit', () => {
    for (const encounter of LAST_BELL_ENCOUNTERS) {
      expect(encounter.audioCue).toMatch(/^audio\.zombie\./);
      expect(encounter.hidingSpotIds.length).toBeGreaterThan(0);
      expect(encounter.hidingSpotIds.every((id) => hidingSpotById(id))).toBe(true);
      expect(encounter.successExit.minZ).toBeGreaterThan(0);
    }
    expect(LAST_BELL_ENCOUNTERS[1]?.trigger).toEqual({
      type: 'interaction',
      interactionId: 'ch1.noise.device',
    });
  });
});

describe('Last Bell authored route-evidence contracts', () => {
  it('binds mandatory searches to existing route meshes and the heavy obstacle interaction', () => {
    expect(LAST_BELL_ROUTE_EVIDENCE.map((evidence) => evidence.id)).toEqual([
      'infirmary-search',
      'broadcast-search',
      'heavy-obstacle',
      'stairwell-candle-shelf',
      'stairwell-blanket-case',
    ]);
    expect(LAST_BELL_ROUTE_EVIDENCE.map((evidence) => evidence.semanticNode)).toEqual([
      'Anchor_KitDetour',
      'BroadcastDesk',
      'HeavyObstacle',
      'Anchor_Candle',
      'Anchor_Blanket',
    ]);
    expect(LAST_BELL_INTERACTIONS.find((interaction) => interaction.id === 'ch1.heavy-obstacle.move')).toMatchObject({
      kind: 'barricade', zoneId: 'utility', position: { x: 0, z: 65.4 },
    });
  });
});

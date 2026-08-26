import { describe, expect, it } from 'vitest';
import { createDoorSystem, type DoorCapability } from './doors';

const classroomDoor: DoorCapability = {
  id: 'door.classroom.slide',
  kind: 'slide',
  closedTransform: { position: { x: 0, y: 1.5, z: 13 }, rotation: { x: 0, y: 0, z: 0 } },
  pivot: { x: 0, y: 1.5, z: 13 },
  axis: { x: 1, y: 0, z: 0 },
  openAmount: 2.1,
  durationSeconds: .8,
  passableThreshold: .5,
  blockerBounds: { min: { x: -1.1, y: 0, z: 12.85 }, max: { x: 1.1, y: 3, z: 13.15 } },
  lockId: 'lock.classroom.slide',
  pressureId: 'pressure.classroom.slide',
  cueIds: {
    opening: 'cue.classroom.opening',
    opened: 'cue.classroom.opened',
    closing: 'cue.classroom.closing',
    closed: 'cue.classroom.closed',
  },
};

function doorAt(system: ReturnType<typeof createDoorSystem>) {
  return system.snapshot().doors[0]!;
}

describe('Last Bell door system', () => {
  it('uses one snapshot for sliding render motion, collider, and LOS', () => {
    const doors = createDoorSystem([classroomDoor]);
    doors.advance({ deltaSeconds: 0, commands: [{ doorId: classroomDoor.id, type: 'open' }] });
    doors.advance({ deltaSeconds: .3 });

    expect(doorAt(doors)).toMatchObject({ state: 'opening', passable: false, render: { kind: 'slide' } });
    expect(doorAt(doors).blocker).toMatchObject({ blocksCollider: true, blocksLineOfSight: true });

    doors.advance({ deltaSeconds: .2 });
    expect(doorAt(doors)).toMatchObject({ passable: true, blocker: { blocksCollider: false, blocksLineOfSight: false } });
    expect(doors.snapshot().passability).toEqual({
      passableDoorIds: ['door.classroom.slide'],
      colliderBlockerDoorIds: [],
      lineOfSightBlockerDoorIds: [],
    });
  });

  it('does not complete a closing lock while an occupant presses the blocker', () => {
    const doors = createDoorSystem([classroomDoor]);
    doors.advance({ deltaSeconds: 1, commands: [{ doorId: classroomDoor.id, type: 'open' }] });
    doors.advance({ deltaSeconds: .5, commands: [{ doorId: classroomDoor.id, type: 'lock' }] });
    const closingProgress = doorAt(doors).openProgress;
    const pressured = doors.advance({
      deltaSeconds: 1 / 30,
      occupants: [{ id: 'player', bounds: classroomDoor.blockerBounds }],
    });

    expect(pressured.doors[0]).toMatchObject({ state: 'pressured', passable: true });
    expect(pressured.doors[0]?.occupants).toEqual(['player']);
    expect(pressured.doors[0]?.openProgress).toBe(closingProgress);
    expect(pressured.events).toContainEqual({ doorId: classroomDoor.id, type: 'pressured', cueId: classroomDoor.pressureId });

    const recovering = doors.advance({ deltaSeconds: 1 / 30, occupants: [{ id: 'player', bounds: classroomDoor.blockerBounds }] });
    expect(recovering.doors[0]?.openProgress).toBeGreaterThan(closingProgress);
    expect(recovering.doors[0]?.openProgress).toBeLessThanOrEqual(classroomDoor.passableThreshold);

    doors.advance({ deltaSeconds: 1, occupants: [] });
    expect(doorAt(doors)).toMatchObject({ state: 'locked', openProgress: 0, passable: false, occupants: [] });
  });

  it('keeps the fixed-step result equivalent at 30/60/120Hz render cadence', () => {
    const simulate = (renderHz: number) => {
      const doors = createDoorSystem([classroomDoor]);
      doors.advance({ deltaSeconds: 0, commands: [{ doorId: classroomDoor.id, type: 'open' }] });
      for (let frame = 0; frame < renderHz * .6; frame += 1) doors.advance({ deltaSeconds: 1 / renderHz });
      const door = doorAt(doors);
      return { state: door.state, openProgress: door.openProgress, passable: door.passable, motionAmount: door.render.motionAmount };
    };

    const at30Hz = simulate(30);
    expect(simulate(60)).toEqual(at30Hz);
    expect(simulate(120)).toEqual(at30Hz);
    expect(at30Hz).toMatchObject({ state: 'opening', passable: true });
  });

  it('supports a hinged fire door from the same authored capability contract', () => {
    const doors = createDoorSystem([{
      ...classroomDoor,
      id: 'door.fire.hinge',
      kind: 'hinge',
      pivot: { x: -1.1, y: 1.5, z: 41 },
      axis: { x: 0, y: 1, z: 0 },
      openAmount: Math.PI / 2,
    }]);

    doors.advance({ deltaSeconds: 1, commands: [{ doorId: 'door.fire.hinge', type: 'open' }] });
    expect(doorAt(doors)).toMatchObject({ state: 'open', render: { kind: 'hinge', motionAmount: Math.PI / 2 } });
  });
});

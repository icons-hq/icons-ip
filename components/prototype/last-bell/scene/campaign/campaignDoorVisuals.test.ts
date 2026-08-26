import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDoorSystem, type DoorCapability } from '@/lib/prototypes/last-bell/engine/doors';
import { applyLastBellStreamedDoorVisuals } from './campaignDoorVisuals';

const fireDoor: DoorCapability = {
  id: 'door.fire',
  kind: 'hinge',
  closedTransform: { position: { x: 0, y: 1.5, z: 67 }, rotation: { x: 0, y: 0, z: 0 } },
  pivot: { x: -1.65, y: 1.5, z: 67 },
  axis: { x: 0, y: 1, z: 0 },
  openAmount: Math.PI / 2,
  durationSeconds: .9,
  passableThreshold: .55,
  blockerBounds: { min: { x: -4, y: 0, z: 66.72 }, max: { x: 4, y: 3, z: 67.28 } },
  lockId: 'lock.fire',
  pressureId: 'pressure.fire',
  cueIds: { opening: 'cue.fire-door.opening', opened: 'cue.fire-door.opened', closing: 'cue.fire-door.closing', closed: 'cue.fire-door.closed' },
};

function streamedStairwell() {
  const root = new THREE.Group();
  const authoredRoute = new THREE.Group();
  authoredRoute.name = 'LOD0_Route';
  authoredRoute.position.z = 67;
  const pivot = new THREE.Group();
  pivot.name = 'DoorFire_Pivot';
  pivot.position.set(-1.65, 1.5, 0);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.8, .1), new THREE.MeshStandardMaterial());
  leaf.name = 'DoorFire_Leaf';
  leaf.position.set(1.65, 0, 0);
  pivot.add(leaf);
  authoredRoute.add(pivot);
  root.add(authoredRoute);
  return { root, pivot, leaf };
}

describe('streamed Last Bell hinge door visuals', () => {
  it('drives the DCC pivot and visible leaf from the exact DoorSystem passability snapshot', () => {
    const doors = createDoorSystem([fireDoor]);
    const { root, pivot, leaf } = streamedStairwell();

    applyLastBellStreamedDoorVisuals(root, doors.snapshot());
    root.updateWorldMatrix(true, true);
    expect(pivot.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([-1.65, 1.5, 67]);
    expect(leaf.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([0, 1.5, 67]);
    expect(leaf.userData.passable).toBe(false);

    doors.advance({ deltaSeconds: .6, commands: [{ doorId: 'door.fire', type: 'open' }] });
    const snapshot = doors.snapshot();
    const door = snapshot.doors.find((candidate) => candidate.id === 'door.fire')!;
    applyLastBellStreamedDoorVisuals(root, snapshot);

    expect(pivot.rotation.y).toBeCloseTo(door.render.motionAmount, 6);
    expect(pivot.userData).toMatchObject({ doorId: 'door.fire', openProgress: door.openProgress, passable: door.passable });
    expect(leaf.userData).toMatchObject({ doorId: 'door.fire', passable: door.passable, visualMotionSource: 'DoorSystem.render.motionAmount' });
    expect(door.passable).toBe(true);
  });
});

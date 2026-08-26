import * as THREE from 'three';
import type { DoorSnapshot, DoorSystemSnapshot } from '@/lib/prototypes/last-bell/engine/doors';

export const LAST_BELL_STREAMED_HINGE_DOORS = {
  'door.fire': { pivotNode: 'DoorFire_Pivot', leafNode: 'DoorFire_Leaf' },
  'door.rooftop': { pivotNode: 'DoorRooftop_Pivot', leafNode: 'DoorRooftop_Leaf' },
} as const;

type StreamedDoorId = keyof typeof LAST_BELL_STREAMED_HINGE_DOORS;

function localPositionForWorld(parent: THREE.Object3D, position: DoorSnapshot['render']['pivot']) {
  parent.updateWorldMatrix(true, false);
  return parent.worldToLocal(new THREE.Vector3(position.x, position.y, position.z));
}

/**
 * Project the one DoorSystem snapshot into the DCC-authored pivot. The DCC
 * leaf is a child of that pivot at the snapshot's closed centre, so setting
 * the exact pivot/closed rotation plus `motionAmount` keeps visuals, collider
 * passability and LOS on one timeline.
 */
export function applyLastBellStreamedDoorVisuals(root: THREE.Object3D, doors: DoorSystemSnapshot): void {
  for (const [doorId, contract] of Object.entries(LAST_BELL_STREAMED_HINGE_DOORS) as [StreamedDoorId, typeof LAST_BELL_STREAMED_HINGE_DOORS[StreamedDoorId]][]) {
    const snapshot = doors.doors.find((door) => door.id === doorId);
    const pivot = root.getObjectByName(contract.pivotNode);
    const leaf = root.getObjectByName(contract.leafNode);
    if (!snapshot || !pivot || !pivot.parent || !leaf || snapshot.render.kind !== 'hinge') continue;

    pivot.position.copy(localPositionForWorld(pivot.parent, snapshot.render.pivot));
    pivot.rotation.set(
      snapshot.render.closedTransform.rotation.x,
      snapshot.render.closedTransform.rotation.y,
      snapshot.render.closedTransform.rotation.z,
    );
    const axis = new THREE.Vector3(snapshot.render.axis.x, snapshot.render.axis.y, snapshot.render.axis.z).normalize();
    pivot.rotateOnAxis(axis, snapshot.render.motionAmount);
    pivot.userData = {
      ...pivot.userData,
      doorId,
      openProgress: snapshot.openProgress,
      passable: snapshot.passable,
      motionAmount: snapshot.render.motionAmount,
      closedTransform: snapshot.render.closedTransform,
    };
    leaf.userData = {
      ...leaf.userData,
      doorId,
      passable: snapshot.passable,
      visualMotionSource: 'DoorSystem.render.motionAmount',
    };
  }
}

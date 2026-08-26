import { describe, expect, it } from 'vitest';
import type { DoorSnapshot } from '../engine/doors';
import { zombieAudioOcclusion } from './audio-occlusion';

const blockingDoor = {
  id: 'door.classroom.slide', state: 'closed', openProgress: 0, passable: false, occupants: [],
  render: { kind: 'slide', closedTransform: { position: { x: 0, y: 0, z: 13 }, rotation: { x: 0, y: 0, z: 0 } }, pivot: { x: 0, y: 0, z: 13 }, axis: { x: 1, y: 0, z: 0 }, motionAmount: 0 },
  blocker: { bounds: { min: { x: -1.1, y: 0, z: 12.85 }, max: { x: 1.1, y: 3, z: 13.15 } }, blocksCollider: true, blocksLineOfSight: true },
} satisfies DoorSnapshot;

describe('zombie positional-audio occlusion', () => {
  it('uses the same closed DoorSnapshot LOS blocker to low-pass and attenuate a groan', () => {
    const mix = zombieAudioOcclusion({ x: 0, z: 11 }, { x: 0, z: 15 }, [blockingDoor]);
    expect(mix).toMatchObject({ occluded: true, listenerZone: 'classroom', sourceZone: 'corridor', gain: .045, lowpassHz: 620 });
  });

  it('keeps a visible same-lane actor bright when no authored wall or door blocks it', () => {
    expect(zombieAudioOcclusion({ x: 0, z: 20 }, { x: 0, z: 24 }, [])).toMatchObject({ occluded: false, gain: .14, lowpassHz: 6_500 });
  });
});

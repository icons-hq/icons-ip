import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyLastBellHidingSpotVisuals, hidingPanelOpenness, syncLastBellHidingSpotAnimations } from './hidingSpotVisuals';

describe('Last Bell authored hiding-panel visuals', () => {
  it('opens the authored panel only during enter/exit, then closes it over hidden cover', () => {
    const entering = hidingPanelOpenness('ch1.hide.locker', { stealthState: 'entering-hide', hidingSpotId: 'ch1.hide.locker', stealthTransitionSeconds: .21 });
    const hidden = hidingPanelOpenness('ch1.hide.locker', { stealthState: 'hidden', hidingSpotId: 'ch1.hide.locker', stealthTransitionSeconds: 0 });
    const exiting = hidingPanelOpenness('ch1.hide.locker', { stealthState: 'exiting-hide', hidingSpotId: 'ch1.hide.locker', stealthTransitionSeconds: .14 });
    expect(entering).toBeGreaterThan(.9);
    expect(hidden).toBe(0);
    expect(exiting).toBeGreaterThan(.9);
  });

  it('drives the real semantic locker panel transform and restores its authored closed pose', () => {
    const root = new THREE.Group();
    const panel = new THREE.Group();
    panel.name = 'Hide_Locker_Corridor_Panel';
    panel.rotation.y = .2;
    root.add(panel);

    applyLastBellHidingSpotVisuals(root, { stealthState: 'entering-hide', hidingSpotId: 'ch1.hide.locker', stealthTransitionSeconds: .21 });
    expect(panel.rotation.y).toBeCloseTo(1.12, 4);
    expect(panel.userData.lastBellHidingAnimation).toBe('Hide_Locker_Corridor_OpenClose');

    applyLastBellHidingSpotVisuals(root, { stealthState: 'hidden', hidingSpotId: 'ch1.hide.locker', stealthTransitionSeconds: 0 });
    expect(panel.rotation.y).toBeCloseTo(.2, 4);
  });

  it('samples the named GLB animation seam at the same fixed transition progress', () => {
    const root = new THREE.Group();
    const panel = new THREE.Group();
    panel.name = 'Hide_Locker_Corridor_Panel';
    root.add(panel);
    const clip = new THREE.AnimationClip('Hide_Locker_Corridor_OpenClose', 1, [
      new THREE.NumberKeyframeTrack('Hide_Locker_Corridor_Panel.rotation[y]', [0, 1], [0, 1]),
    ]);
    const mixer = new THREE.AnimationMixer(root);
    syncLastBellHidingSpotAnimations(mixer, [clip], { stealthState: 'entering-hide', hidingSpotId: 'ch1.hide.locker', stealthTransitionSeconds: .21 });
    expect(panel.rotation.y).toBeCloseTo(1, 4);
  });
});

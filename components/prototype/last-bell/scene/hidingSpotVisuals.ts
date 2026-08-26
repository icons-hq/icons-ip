import * as THREE from 'three';
import type { LastBellPlayerSnapshot, HidingSpotId } from '@/lib/prototypes/last-bell/runtime/types';
import { hidingSpotById } from '@/lib/prototypes/last-bell/runtime/world';

type HidingPanelSeam = Readonly<{
  nodeName: string;
  animationName: string;
  axis: 'y' | 'rotation-y';
  travel: number;
}>;

/** DCC semantic names are stable even if the surrounding GLB hierarchy changes. */
export const LAST_BELL_HIDING_PANEL_SEAMS: Readonly<Record<HidingSpotId, HidingPanelSeam>> = {
  'ch1.hide.desk': {
    nodeName: 'Hide_Desk_Classroom_Cover', animationName: 'Hide_Desk_Classroom_EnterExit', axis: 'y', travel: -.32,
  },
  'ch1.hide.locker': {
    nodeName: 'Hide_Locker_Corridor_Panel', animationName: 'Hide_Locker_Corridor_OpenClose', axis: 'rotation-y', travel: .92,
  },
};

type BoundPanel = Readonly<{ object: THREE.Object3D; base: number }>;
const panelBindings = new WeakMap<THREE.Object3D, Map<HidingSpotId, BoundPanel>>();

/**
 * Projects the renderer-independent PlayerStealthState onto authored panels.
 * Enter/exit are triangular open-close motions; hidden always returns the
 * panel to its closed cover pose. The named clip remains a DCC replacement
 * seam while this transform supplies deterministic fixed-step interpolation.
 */
export function applyLastBellHidingSpotVisuals(root: THREE.Object3D, player: Pick<LastBellPlayerSnapshot, 'stealthState' | 'hidingSpotId' | 'stealthTransitionSeconds'>): void {
  let bindings = panelBindings.get(root);
  if (!bindings) {
    bindings = new Map();
    for (const [id, seam] of Object.entries(LAST_BELL_HIDING_PANEL_SEAMS) as [HidingSpotId, HidingPanelSeam][]) {
      const object = root.getObjectByName(seam.nodeName);
      if (!object) continue;
      bindings.set(id, { object, base: seam.axis === 'y' ? object.position.y : object.rotation.y });
    }
    panelBindings.set(root, bindings);
  }

  for (const [id, binding] of bindings) {
    const seam = LAST_BELL_HIDING_PANEL_SEAMS[id];
    const openness = hidingPanelOpenness(id, player);
    if (seam.axis === 'y') binding.object.position.y = binding.base + seam.travel * openness;
    else binding.object.rotation.y = binding.base + seam.travel * openness;
    binding.object.userData.lastBellHidingAnimation = seam.animationName;
    binding.object.userData.lastBellHidingOpen = openness;
  }
}

export function hidingPanelOpenness(
  id: HidingSpotId,
  player: Pick<LastBellPlayerSnapshot, 'stealthState' | 'hidingSpotId' | 'stealthTransitionSeconds'>,
): number {
  if (player.hidingSpotId !== id) return 0;
  const spot = hidingSpotById(id);
  if (!spot || player.stealthState === 'standing' || player.stealthState === 'crouched' || player.stealthState === 'hidden') return 0;
  const duration = player.stealthState === 'entering-hide' ? spot.entrySeconds : spot.exitSeconds;
  const progress = 1 - Math.max(0, Math.min(1, player.stealthTransitionSeconds / duration));
  return Math.sin(progress * Math.PI);
}

/**
 * Keeps authored GLB clips on the same deterministic transition progress as
 * the panel transform. The explicit transform remains the visual fallback if
 * an old asset has the semantic node but omitted its clip.
 */
export function syncLastBellHidingSpotAnimations(
  mixer: THREE.AnimationMixer,
  clips: readonly THREE.AnimationClip[],
  player: Pick<LastBellPlayerSnapshot, 'stealthState' | 'hidingSpotId' | 'stealthTransitionSeconds'>,
): void {
  for (const [id, seam] of Object.entries(LAST_BELL_HIDING_PANEL_SEAMS) as [HidingSpotId, HidingPanelSeam][]) {
    const clip = clips.find((candidate) => candidate.name === seam.animationName);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    const openness = hidingPanelOpenness(id, player);
    if (openness <= 0) {
      action.stop();
      continue;
    }
    action.enabled = true;
    action.paused = true;
    action.play();
    action.time = openness * clip.duration;
    mixer.update(0);
  }
}

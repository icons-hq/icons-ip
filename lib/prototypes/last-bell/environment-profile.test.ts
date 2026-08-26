import { describe, expect, it } from 'vitest';
import {
  HYOSAN_POST_STRIKE_NIGHT,
  LAST_BELL_ENVIRONMENT_ID,
  LAST_BELL_RETIRED_PROFILE_FALLBACKS,
} from './environment-profile';

describe('Hyosan post-strike night environment profile', () => {
  it('keeps the current frame-zero profile and replacement seams explicit', () => {
    expect(LAST_BELL_ENVIRONMENT_ID).toBe('hyosan-post-strike-night');
    expect(HYOSAN_POST_STRIKE_NIGHT.replacementSeams).toMatchObject({
      entry: 'environment.hyosan.entry',
      classroom: 'environment.hyosan.classroom.destroyed',
      corridor: 'environment.hyosan.corridor.destroyed',
      rooftop: 'environment.hyosan.rooftop.destroyed',
      debrisKit: 'kit.debris.post-strike-school',
    });
    expect(HYOSAN_POST_STRIKE_NIGHT.materialIds).toEqual(expect.arrayContaining([
      'material.charred-concrete',
      'material.exposed-brick',
      'material.smoked-aluminium',
      'material.shattered-glass',
    ]));
    expect(HYOSAN_POST_STRIKE_NIGHT.collisionIds.firstDoor).toBe('collision.hyosan.classroom.first-door');
    expect(HYOSAN_POST_STRIKE_NIGHT.anchorIds).toEqual(expect.arrayContaining(['classroom_spawn', 'classroom_door']));
  });

  it('separates the future rooftop character from narrative and animation data', () => {
    expect(HYOSAN_POST_STRIKE_NIGHT.characters['character.namra.rooftop'].replacementId).toBe('character.namra.rooftop');
    expect(HYOSAN_POST_STRIKE_NIGHT.narrativeCueSeams.rooftopEnding).toBe('cue.rooftop.reunion');
    expect(HYOSAN_POST_STRIKE_NIGHT.animationSeams.namraRooftop).toBe('animation.namra.rooftop');
  });

  it('keeps the former generated classroom plates out of the active profile', () => {
    expect(LAST_BELL_RETIRED_PROFILE_FALLBACKS).toHaveLength(5);
  });
});

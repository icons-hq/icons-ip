import { describe, expect, it } from 'vitest';
import {
  LAST_BELL_CHAPTER_COPY,
  LAST_BELL_OBJECTIVE_COPY,
  LAST_BELL_ROOFTOP_ENDING_KO,
  hidesGameplayHudAtRooftop,
  objectiveCopyForLastBell,
  rooftopEndingState,
} from './narrative';

describe('Last Bell replaceable narrative data', () => {
  it('keeps exactly two chapter titles and the reviewed Korean lines outside UI components', () => {
    expect(Object.keys(LAST_BELL_CHAPTER_COPY)).toEqual(['chapter-01', 'chapter-02']);
    expect(LAST_BELL_ROOFTOP_ENDING_KO.lines).toEqual({
      namraLine01: '너…',
      namraLine02: '인간이 아니네.',
    });
    expect(LAST_BELL_ROOFTOP_ENDING_KO.reviewStatus).toBe('pending');
    expect(LAST_BELL_ROOFTOP_ENDING_KO.characterAssetKey).toBe('character.namra.rooftop');
  });

  it('removes ordinary gameplay HUD as soon as the rooftop-door cinematic begins', () => {
    expect(hidesGameplayHudAtRooftop('sealed')).toBe(false);
    expect(hidesGameplayHudAtRooftop('approach')).toBe(true);
    expect(hidesGameplayHudAtRooftop('recognition')).toBe(true);
    expect(hidesGameplayHudAtRooftop('subdue')).toBe(true);
    expect(hidesGameplayHudAtRooftop('black')).toBe(true);
    expect(objectiveCopyForLastBell('ch1.open-classroom-door')).toBe(LAST_BELL_OBJECTIVE_COPY['ch1.open-classroom-door']);
  });

  it('uses fixed-step rooftop time for the involuntary step and tears down ending audio while suspended', () => {
    const recognition = rooftopEndingState('recognition', 28.4, false);
    expect(recognition).toMatchObject({
      pulseVisible: true,
      involuntaryStepVisible: true,
      line02Visible: true,
      playHeartbeat: true,
    });
    expect(rooftopEndingState('subdue', 0, false)).toMatchObject({
      line01Visible: true,
      line02Visible: true,
      playHeartbeat: true,
    });
    expect(rooftopEndingState('black', 1.7, false).playBlackFootsteps).toBe(true);
    expect(rooftopEndingState('recognition', 28.4, true).playHeartbeat).toBe(false);
    expect(rooftopEndingState('black', 1.7, true).playBlackFootsteps).toBe(false);
  });
});

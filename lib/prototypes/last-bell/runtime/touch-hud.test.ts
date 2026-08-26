import { describe, expect, it } from 'vitest';

import { shouldUseLastBellTouchHud } from './touch-hud';

describe('shouldUseLastBellTouchHud', () => {
  it('keeps desktop pointer controls on a normal desktop viewport', () => {
    expect(shouldUseLastBellTouchHud({ pointerCoarse: false, width: 1280, height: 720 })).toBe(false);
  });

  it('keeps touch controls available in the required 390x844 portrait viewport', () => {
    expect(shouldUseLastBellTouchHud({ pointerCoarse: false, width: 390, height: 844 })).toBe(true);
  });

  it('keeps compact landscape and coarse-pointer devices touch playable', () => {
    expect(shouldUseLastBellTouchHud({ pointerCoarse: false, width: 844, height: 390 })).toBe(true);
    expect(shouldUseLastBellTouchHud({ pointerCoarse: true, width: 1024, height: 768 })).toBe(true);
  });
});

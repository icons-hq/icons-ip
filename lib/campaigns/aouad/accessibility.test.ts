import { describe, expect, it } from 'vitest';
import { cafeteriaActionForPreference } from './accessibility';

describe('AOUAD cafeteria reduced-motion alternative', () => {
  it('offers a static completion action instead of an animated timing requirement', () => {
    expect(cafeteriaActionForPreference(true, false)).toBe('complete');
    expect(cafeteriaActionForPreference(true, true)).toBe('complete');
  });

  it('keeps the timing steps only when motion is allowed', () => {
    expect(cafeteriaActionForPreference(false, false)).toBe('start');
    expect(cafeteriaActionForPreference(false, true)).toBe('attempt');
  });
});

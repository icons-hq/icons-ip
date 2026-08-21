import { describe, expect, it } from 'vitest';
import { usesLastBellTouchLayout } from './responsive';

describe('last bell responsive touch contract', () => {
  it('shows touch controls on coarse landscape tablets and phones', () => {
    expect(usesLastBellTouchLayout({ width: 844, height: 390, pointer: 'coarse' })).toBe(true);
    expect(usesLastBellTouchLayout({ width: 740, height: 360, pointer: 'coarse' })).toBe(true);
  });

  it('does not switch a normal wide fine-pointer desktop to touch controls', () => {
    expect(usesLastBellTouchLayout({ width: 1440, height: 900, pointer: 'fine' })).toBe(false);
  });
});

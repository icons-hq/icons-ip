import { describe, expect, it } from 'vitest';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';

describe('last bell prototype route contract', () => {
  it('is fail-closed behind the dedicated request-time flag', () => {
    expect(isLastBellPrototypeEnabled({})).toBe(false);
    expect(isLastBellPrototypeEnabled({ ICONS_PROTOTYPE: '1' })).toBe(false);
    expect(isLastBellPrototypeEnabled({ ICONS_LAST_BELL_PROTOTYPE: '0' })).toBe(false);
    expect(isLastBellPrototypeEnabled({ ICONS_LAST_BELL_PROTOTYPE: '1' })).toBe(true);
  });
});

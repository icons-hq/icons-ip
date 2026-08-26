import { describe, expect, it } from 'vitest';
import {
  createLastBellActivityClock,
  stepLastBellActivityClock,
} from './activity-clock';

describe('Last Bell visible activity clock', () => {
  it('counts real visible wall time at 5fps instead of the simulation clamp', () => {
    let clock = createLastBellActivityClock(0);
    let activeDurationMs = 0;

    for (let frame = 1; frame <= 5; frame += 1) {
      const next = stepLastBellActivityClock(clock, frame * 200, { active: true, visible: true });
      clock = next.clock;
      activeDurationMs += next.activeDurationMs;
    }

    expect(activeDurationMs).toBe(1000);
  });

  it.each([
    ['paused', false, true],
    ['portrait', false, true],
    ['background', true, false],
  ] as const)('does not count %s time and skips the first resumed frame', (_label, active, visible) => {
    const clock = createLastBellActivityClock(0);
    const excluded = stepLastBellActivityClock(clock, 5000, { active, visible });
    const resumed = stepLastBellActivityClock(excluded.clock, 10000, { active: true, visible: true });
    const steady = stepLastBellActivityClock(resumed.clock, 10200, { active: true, visible: true });

    expect(excluded.activeDurationMs).toBe(0);
    expect(resumed.activeDurationMs).toBe(0);
    expect(steady.activeDurationMs).toBe(200);
  });
});

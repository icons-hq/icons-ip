import { describe, expect, it } from 'vitest';
import {
  createAouadActiveClock,
  stepAouadActiveClock,
} from './active-clock';

describe('AOUAD active clock', () => {
  it('counts the visible interval up to hiding, excludes background time, and resumes from a fresh baseline', () => {
    const started = createAouadActiveClock(0);
    const hidden = stepAouadActiveClock(started, 30_000, { active: true, visible: false });
    const resumed = stepAouadActiveClock(hidden.clock, 90_000, { active: true, visible: true });
    const steady = stepAouadActiveClock(resumed.clock, 100_000, { active: true, visible: true });

    expect(hidden.activeDurationMs).toBe(30_000);
    expect(resumed.activeDurationMs).toBe(0);
    expect(steady.activeDurationMs).toBe(10_000);
    expect(hidden.activeDurationMs + resumed.activeDurationMs + steady.activeDurationMs).toBe(40_000);
  });

  it('counts an active interval only once across duplicate hidden notifications', () => {
    const started = createAouadActiveClock(1_000);
    const hidden = stepAouadActiveClock(started, 4_000, { active: true, visible: false });
    const duplicate = stepAouadActiveClock(hidden.clock, 5_000, { active: true, visible: false });

    expect(hidden.activeDurationMs).toBe(3_000);
    expect(duplicate.activeDurationMs).toBe(0);
  });

  it('ignores negative and backwards timestamps without corrupting the active baseline', () => {
    const started = createAouadActiveClock(1_000);
    const negative = stepAouadActiveClock(started, -1, { active: true, visible: true });
    const backwards = stepAouadActiveClock(negative.clock, 900, { active: true, visible: true });
    const forward = stepAouadActiveClock(backwards.clock, 1_500, { active: true, visible: true });

    expect(negative).toEqual({ clock: started, activeDurationMs: 0 });
    expect(backwards).toEqual({ clock: started, activeDurationMs: 0 });
    expect(forward.activeDurationMs).toBe(500);
  });

  it('charges time up to pause, excludes the pause, and skips the resume baseline', () => {
    const started = createAouadActiveClock(0);
    const paused = stepAouadActiveClock(started, 30_000, { active: false, visible: true });
    const duplicate = stepAouadActiveClock(paused.clock, 35_000, { active: false, visible: true });
    const resumed = stepAouadActiveClock(duplicate.clock, 90_000, { active: true, visible: true });
    const steady = stepAouadActiveClock(resumed.clock, 100_000, { active: true, visible: true });

    expect(paused.activeDurationMs).toBe(30_000);
    expect(duplicate.activeDurationMs).toBe(0);
    expect(resumed.activeDurationMs).toBe(0);
    expect(steady.activeDurationMs).toBe(10_000);
  });
});

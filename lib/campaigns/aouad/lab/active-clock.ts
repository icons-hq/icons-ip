export type AouadActiveClock = {
  lastTimestampMs: number | null;
  active: boolean;
  visible: boolean;
};

export type AouadActiveClockFrame = {
  clock: AouadActiveClock;
  activeDurationMs: number;
};

export function createAouadActiveClock(startedAtMs?: number): AouadActiveClock {
  const started = typeof startedAtMs === 'number' && Number.isFinite(startedAtMs) && startedAtMs >= 0;
  return {
    lastTimestampMs: started ? startedAtMs : null,
    active: started,
    visible: started,
  };
}

/**
 * Counts the interval according to the state that was true before this
 * timestamp. This charges visible play up to a hide/pause boundary exactly
 * once, while the first callback after resuming only establishes a baseline.
 */
export function stepAouadActiveClock(
  clock: AouadActiveClock,
  timestampMs: number,
  { active, visible }: { active: boolean; visible: boolean },
): AouadActiveClockFrame {
  if (
    !Number.isFinite(timestampMs)
    || timestampMs < 0
    || (clock.lastTimestampMs !== null && timestampMs < clock.lastTimestampMs)
  ) {
    return { clock, activeDurationMs: 0 };
  }

  const previousTimestamp = clock.lastTimestampMs;
  return {
    clock: { lastTimestampMs: timestampMs, active, visible },
    activeDurationMs: previousTimestamp === null || !clock.active || !clock.visible
      ? 0
      : timestampMs - previousTimestamp,
  };
}

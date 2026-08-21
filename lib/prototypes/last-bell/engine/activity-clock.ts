export type LastBellActivityClock = {
  lastTimestampMs: number | null;
};

export type LastBellActivityFrame = {
  clock: LastBellActivityClock;
  activeDurationMs: number;
};

export function createLastBellActivityClock(startedAtMs?: number): LastBellActivityClock {
  return {
    lastTimestampMs: typeof startedAtMs === 'number' && Number.isFinite(startedAtMs)
      ? startedAtMs
      : null,
  };
}

/**
 * Tracks user-visible play time independently from the clamped 30Hz
 * simulation. The first frame after an inactive or hidden interval is a
 * discontinuity, so its browser delta is never charged to the run.
 */
export function stepLastBellActivityClock(
  clock: LastBellActivityClock,
  timestampMs: number,
  { active, visible }: { active: boolean; visible: boolean },
): LastBellActivityFrame {
  if (!active || !visible || !Number.isFinite(timestampMs)) {
    return { clock: createLastBellActivityClock(), activeDurationMs: 0 };
  }
  const previousTimestamp = clock.lastTimestampMs;
  const activeDurationMs = previousTimestamp === null
    ? 0
    : Math.max(0, timestampMs - previousTimestamp);
  return {
    clock: createLastBellActivityClock(timestampMs),
    activeDurationMs,
  };
}

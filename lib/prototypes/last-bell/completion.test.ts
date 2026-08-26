import { describe, expect, it } from 'vitest';
import {
  advanceLastBellActiveDuration,
  advanceLastBellSimulationMetrics,
  clearLastBellCompletion,
  createLastBellCompletionRecord,
  createLastBellRunMetrics,
  LAST_BELL_COMPLETION_KEY,
  loadLastBellCompletion,
  recordLastBellCapture,
  recordLastBellRetry,
  saveLastBellCompletion,
  type LastBellCompletionStorage,
} from './completion';
import { LAST_BELL_FIXED_STEP } from './engine/movement';

class MemoryStorage implements LastBellCompletionStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('Last Bell local completion', () => {
  it('persists only a versioned, non-reward completion record', () => {
    const storage = new MemoryStorage();
    const metrics = createLastBellRunMetrics({ runId: 'run-01', startedAt: '2026-08-21T00:00:00.000Z' });
    const record = createLastBellCompletionRecord(metrics, 'central', '2026-08-21T00:01:00.000Z');
    expect(saveLastBellCompletion(storage, record)).toEqual(record);
    expect(loadLastBellCompletion(storage)).toMatchObject({
      authority: 'local-prototype',
      leaderboardEligible: false,
      chapterId: 'chapter-01',
      routeId: 'central',
      result: 'escaped',
    });
    clearLastBellCompletion(storage);
    expect(storage.getItem(LAST_BELL_COMPLETION_KEY)).toBeNull();
  });

  it.each([1 / 30, 1 / 60, 1 / 120])('uses a 30Hz simulation accumulator at %s render cadence', (frameSeconds) => {
    const start = '2026-08-21T00:00:00.000Z';
    let metrics = createLastBellRunMetrics({ runId: `cadence-${frameSeconds}`, startedAt: start });
    let elapsed = 0;
    let accumulator = 0;
    let ticks = 0;
    while (elapsed < 1 - 1e-9) {
      const delta = Math.min(frameSeconds, 1 - elapsed);
      elapsed += delta;
      metrics = advanceLastBellActiveDuration(metrics, delta * 1000);
      accumulator += delta;
      while (accumulator >= LAST_BELL_FIXED_STEP - 1e-12) {
        metrics = advanceLastBellSimulationMetrics(metrics, LAST_BELL_FIXED_STEP * 1000, {
          listening: ticks < 10,
          hiding: ticks >= 10 && ticks < 20,
          running: ticks >= 20,
        });
        ticks += 1;
        accumulator -= LAST_BELL_FIXED_STEP;
      }
    }
    const record = createLastBellCompletionRecord(metrics, 'systems', '2026-08-21T00:00:01.000Z');
    expect(ticks).toBe(30);
    expect(record.activeDurationMs).toBe(1000);
    expect(metrics.listeningDurationMs).toBeCloseTo(1000 / 3, 6);
    expect(metrics.hidingDurationMs).toBeCloseTo(1000 / 3, 6);
    expect(metrics.runningDurationMs).toBeCloseTo(1000 / 3, 6);
  });

  it('keeps 5fps visible activity on wall time while simulation catch-up stays clamped', () => {
    let metrics = createLastBellRunMetrics({ runId: 'five-fps-run', startedAt: '2026-08-21T00:00:00.000Z' });
    let accumulator = 0;
    let ticks = 0;
    for (let frame = 0; frame < 5; frame += 1) {
      metrics = advanceLastBellActiveDuration(metrics, 200);
      accumulator += Math.min(.2, .1);
      while (accumulator >= LAST_BELL_FIXED_STEP - 1e-12) {
        metrics = advanceLastBellSimulationMetrics(metrics, LAST_BELL_FIXED_STEP * 1000, {
          listening: true,
          hiding: false,
          running: false,
        });
        ticks += 1;
        accumulator -= LAST_BELL_FIXED_STEP;
      }
    }

    expect(metrics.activeDurationMs).toBe(1000);
    expect(ticks).toBe(15);
    expect(metrics.listeningDurationMs).toBeCloseTo(500, 6);
  });

  it('counts capture and retry separately before selecting a resilient style', () => {
    let metrics = createLastBellRunMetrics({ runId: 'run-02', startedAt: '2026-08-21T00:00:00.000Z' });
    metrics = recordLastBellCapture(metrics);
    metrics = recordLastBellRetry(metrics);
    metrics = recordLastBellCapture(metrics);
    const record = createLastBellCompletionRecord(metrics, 'rear', '2026-08-21T00:00:02.000Z');
    expect(record).toMatchObject({ captureCount: 2, retryCount: 1, playStyle: 'resilient' });
  });

  it('clears malformed or over-specified data instead of exposing it to the popup', () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_BELL_COMPLETION_KEY, JSON.stringify({ schemaVersion: 1, injected: true }));
    expect(loadLastBellCompletion(storage)).toBeNull();
    expect(storage.getItem(LAST_BELL_COMPLETION_KEY)).toBeNull();
  });
});

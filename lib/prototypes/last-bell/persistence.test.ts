import { describe, expect, it } from 'vitest';
import { createLastBellRunMetrics } from './completion';
import {
  clearLastBellCheckpoint,
  checkpointIdLabel,
  LAST_BELL_CHECKPOINT_KEY,
  LAST_BELL_CHECKPOINT_TTL_MS,
  loadLastBellCheckpoint,
  saveLastBellCheckpoint,
  type CheckpointStorage,
} from './persistence';

class MemoryStorage implements CheckpointStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const semantic = { phase: 'power' as const, doorLocked: true, powerRestored: true, fireDoorLocked: false, bellTriggered: false };
const metrics = createLastBellRunMetrics({ runId: 'checkpoint-run', startedAt: '2026-08-21T00:00:00.000Z' });

describe('last bell local checkpoint adapter', () => {
  it('round-trips a v2 semantic checkpoint with its route and deterministic run metrics', () => {
    const storage = new MemoryStorage();
    const now = Date.parse('2026-08-21T00:00:00.000Z');
    const saved = saveLastBellCheckpoint(storage, 'ch1_power_restored', semantic, metrics, 'systems', null, now);
    expect(saved).toMatchObject({ schemaVersion: 2, stateVersion: 2, routeId: 'systems', routeObjective: null, runMetrics: metrics });
    expect(saved?.expiresAt).toBe('2026-08-22T00:00:00.000Z');
    expect(loadLastBellCheckpoint(storage, now + LAST_BELL_CHECKPOINT_TTL_MS - 1)).toMatchObject({ checkpointId: 'ch1_power_restored', routeId: 'systems', runId: 'checkpoint-run' });
    expect(loadLastBellCheckpoint(storage, now + LAST_BELL_CHECKPOINT_TTL_MS)).toBeNull();
    expect(storage.getItem(LAST_BELL_CHECKPOINT_KEY)).toBeNull();
  });

  it('rejects a power checkpoint without a completed route', () => {
    const storage = new MemoryStorage();
    expect(saveLastBellCheckpoint(storage, 'ch1_power_restored', semantic, metrics, null, null)).toBeNull();
  });

  it('deletes malformed, version-mismatched, and legacy v1 payloads as a safe new run', () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_BELL_CHECKPOINT_KEY, JSON.stringify({ schemaVersion: 99 }));
    expect(loadLastBellCheckpoint(storage)).toBeNull();
    expect(storage.getItem(LAST_BELL_CHECKPOINT_KEY)).toBeNull();

    const saved = saveLastBellCheckpoint(storage, 'ch1_power_restored', semantic, metrics, 'rear', null);
    const legacy = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.routeId;
    delete legacy.routeObjective;
    delete legacy.runMetrics;
    storage.setItem(LAST_BELL_CHECKPOINT_KEY, JSON.stringify(legacy));
    expect(loadLastBellCheckpoint(storage)).toBeNull();
    expect(storage.getItem(LAST_BELL_CHECKPOINT_KEY)).toBeNull();
  });

  it('clears the checkpoint when the Chapter is complete', () => {
    const storage = new MemoryStorage();
    saveLastBellCheckpoint(storage, 'ch1_handoff', { ...semantic, phase: 'corridor' }, metrics, null, null);
    clearLastBellCheckpoint(storage);
    expect(loadLastBellCheckpoint(storage)).toBeNull();
  });

  it('labels the power checkpoint as restored, not before restoration', () => {
    expect(checkpointIdLabel('ch1_power_restored')).toBe('전력 복구 후');
  });
});

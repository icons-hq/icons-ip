import { describe, expect, it } from 'vitest';
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

describe('last bell local checkpoint adapter', () => {
  it('round-trips a versioned semantic checkpoint for 24 hours', () => {
    const storage = new MemoryStorage();
    const now = Date.parse('2026-08-21T00:00:00.000Z');
    const saved = saveLastBellCheckpoint(storage, 'ch1_power_restored', semantic, now);
    expect(saved?.expiresAt).toBe('2026-08-22T00:00:00.000Z');
    expect(loadLastBellCheckpoint(storage, now + LAST_BELL_CHECKPOINT_TTL_MS - 1)?.checkpointId).toBe('ch1_power_restored');
    expect(loadLastBellCheckpoint(storage, now + LAST_BELL_CHECKPOINT_TTL_MS)).toBeNull();
    expect(storage.getItem(LAST_BELL_CHECKPOINT_KEY)).toBeNull();
  });

  it('deletes malformed or version-mismatched payloads', () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_BELL_CHECKPOINT_KEY, JSON.stringify({ schemaVersion: 99 }));
    expect(loadLastBellCheckpoint(storage)).toBeNull();
    expect(storage.getItem(LAST_BELL_CHECKPOINT_KEY)).toBeNull();
    storage.setItem(LAST_BELL_CHECKPOINT_KEY, '{bad json');
    expect(loadLastBellCheckpoint(storage)).toBeNull();
  });

  it('rejects the removed post-bell checkpoint payload', () => {
    const storage = new MemoryStorage();
    saveLastBellCheckpoint(storage, 'ch1_power_restored', semantic);
    const payload = JSON.parse(storage.getItem(LAST_BELL_CHECKPOINT_KEY) ?? '{}') as Record<string, unknown>;
    payload.checkpointId = 'ch1_post_bell_safe';
    storage.setItem(LAST_BELL_CHECKPOINT_KEY, JSON.stringify(payload));
    expect(loadLastBellCheckpoint(storage)).toBeNull();
    expect(storage.getItem(LAST_BELL_CHECKPOINT_KEY)).toBeNull();
  });

  it('clears the checkpoint when the Chapter is complete', () => {
    const storage = new MemoryStorage();
    saveLastBellCheckpoint(storage, 'ch1_handoff', { ...semantic, phase: 'corridor' });
    clearLastBellCheckpoint(storage);
    expect(loadLastBellCheckpoint(storage)).toBeNull();
  });

  it('labels the power checkpoint as restored, not before restoration', () => {
    expect(checkpointIdLabel('ch1_power_restored')).toBe('전력 복구 후');
  });
});

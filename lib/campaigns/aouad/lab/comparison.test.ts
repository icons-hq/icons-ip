import { describe, expect, it } from 'vitest';
import {
  clearAouadComparisonResult,
  comparisonResultFromLastBell,
  comparisonStorageKey,
  createAouadComparisonResult,
  loadAouadComparisonResult,
  saveAouadComparisonResult,
  type AouadComparisonStorage,
} from './comparison';
import { createLastBellCompletionRecord, createLastBellRunMetrics } from '@/lib/prototypes/last-bell/completion';

class MemoryStorage implements AouadComparisonStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('AOUAD G2 comparison result contract', () => {
  it('persists only strict local, non-reward results by candidate', () => {
    const storage = new MemoryStorage();
    const result = createAouadComparisonResult({
      candidateId: 'infection-record',
      runId: 'infection-run-001',
      startedAt: '2026-08-21T00:00:00.000Z',
      completedAt: '2026-08-21T00:00:04.000Z',
      activeDurationMs: 3999.7,
      retryCount: 1,
      resultType: 'escaped',
    });
    expect(saveAouadComparisonResult(storage, result)).toMatchObject({ authority: 'local-prototype', rewardEligible: false, activeDurationMs: 4000 });
    expect(loadAouadComparisonResult(storage, 'infection-record')).toEqual(result);
    clearAouadComparisonResult(storage, 'infection-record');
    expect(storage.getItem(comparisonStorageKey('infection-record'))).toBeNull();
  });

  it('deletes malformed or cross-candidate values rather than exposing a comparison result', () => {
    const storage = new MemoryStorage();
    storage.setItem(comparisonStorageKey('survival-arcade'), JSON.stringify({ schemaVersion: 1, candidateId: 'last-bell' }));
    expect(loadAouadComparisonResult(storage, 'survival-arcade')).toBeNull();
    expect(storage.getItem(comparisonStorageKey('survival-arcade'))).toBeNull();
  });

  it('adapts a valid Last Bell local completion without adding reward authority', () => {
    const record = createLastBellCompletionRecord(
      createLastBellRunMetrics({ runId: 'last-bell-run', startedAt: '2026-08-21T00:00:00.000Z' }),
      'rear',
      '2026-08-21T00:00:30.000Z',
    );
    expect(comparisonResultFromLastBell(record)).toMatchObject({
      candidateId: 'last-bell',
      resultType: 'escaped-rear',
      authority: 'local-prototype',
      rewardEligible: false,
    });
  });
});

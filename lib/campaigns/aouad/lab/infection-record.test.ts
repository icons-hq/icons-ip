import { describe, expect, it } from 'vitest';
import { advanceInfectionRecord, initialInfectionRecordState } from './infection-record';

describe('infection record branch engine', () => {
  it('produces an escaped result only through the low-exposure path', () => {
    let state = advanceInfectionRecord(initialInfectionRecordState, 'start');
    state = advanceInfectionRecord(state, 'listen');
    state = advanceInfectionRecord(state, 'hide');
    state = advanceInfectionRecord(state, 'stairs');
    expect(state).toMatchObject({ stage: 'result', exposure: 0, resultType: 'escaped' });
  });

  it('records a quarantined middle branch and an explicit infected failure', () => {
    let quarantined = advanceInfectionRecord(initialInfectionRecordState, 'start');
    quarantined = advanceInfectionRecord(quarantined, 'rush');
    quarantined = advanceInfectionRecord(quarantined, 'hide');
    quarantined = advanceInfectionRecord(quarantined, 'stairs');
    expect(quarantined.resultType).toBe('quarantined');

    let infected = advanceInfectionRecord(initialInfectionRecordState, 'start');
    infected = advanceInfectionRecord(infected, 'rush');
    infected = advanceInfectionRecord(infected, 'relay');
    infected = advanceInfectionRecord(infected, 'stairs');
    expect(infected).toMatchObject({ stage: 'result', exposure: 2, resultType: 'infected' });
  });

  it('rejects stale choices that would skip a scene', () => {
    const started = advanceInfectionRecord(initialInfectionRecordState, 'start');
    expect(advanceInfectionRecord(started, 'stairs')).toEqual(started);
  });
});

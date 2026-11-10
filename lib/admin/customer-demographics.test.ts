import { describe, expect, it } from 'vitest';
import { DEMOGRAPHIC_AGE_LABELS, normalizeDemographicFilters, parseDemographicReport, type DemographicReport } from './customer-demographics';
export function demographicFixture(): DemographicReport {
  return { scope: 'members', grain: null, from: null, to: null, ageAsOf: '2026-10-19', asOf: '2026-10-19T01:00:00Z', minimumCount: 10,
    cells: Object.keys(DEMOGRAPHIC_AGE_LABELS).flatMap(ageBand => ['female', 'male', 'other', 'undisclosed'].map(gender => ({ ageBand, gender, count: null }))) as DemographicReport['cells'] };
}
describe('protected customer demographic report', () => {
  it('accepts ten and null without treating null as zero', () => {
    const data = demographicFixture(); data.cells[0].count = 10;
    expect(parseDemographicReport(data)).toEqual(data);
  });
  it.each([0, 1, 9, -1, 10.1, Number.MAX_SAFE_INTEGER + 1])('rejects a leaked/invalid count %s', count => {
    const data = demographicFixture(); data.cells[0].count = count; expect(parseDemographicReport(data)).toBeNull();
  });
  it('rejects raw totals, missing categories and duplicates', () => {
    const data = demographicFixture();
    expect(parseDemographicReport({ ...data, total: 19 })).toBeNull();
    expect(parseDemographicReport({ ...data, cells: data.cells.slice(1) })).toBeNull();
    data.cells[1] = data.cells[0]; expect(parseDemographicReport(data)).toBeNull();
  });
  it('rejects a single hidden remainder', () => {
    const data = demographicFixture(); data.cells.forEach(cell => { cell.count = 10; }); data.cells[0].count = null;
    expect(parseDemographicReport(data)).toBeNull();
    data.cells[1].count = null; expect(parseDemographicReport(data)).not.toBeNull();
  });
  it('validates closed purchase periods and ignores period fields for the current member view', () => {
    const now = new Date('2026-10-19T01:00:00Z');
    expect(normalizeDemographicFilters({ scope: 'members', from: 'bad' }, now).error).toBeUndefined();
    expect(normalizeDemographicFilters({ scope: 'purchasers', grain: 'month', from: '2026-09-01', to: '2026-09-30' }, now).error).toBeUndefined();
    expect(normalizeDemographicFilters({ scope: 'purchasers', grain: 'month', from: '2026-09-02', to: '2026-09-30' }, now).error).toBeTruthy();
    expect(normalizeDemographicFilters({ scope: 'secret' }, now).error).toBeTruthy();
  });
});

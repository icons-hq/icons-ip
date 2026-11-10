import { describe, expect, it } from 'vitest';
import { normalizePgSettlementFilters } from './console';
import { parsePgSettlementJob, parsePgSettlementReport } from './report';
import { SETTLEMENT_FIXTURE_JOB, settlementReportFixture } from './fixture';
const filters = normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-10-31', mode: 'test' });
describe('settlement read projection', () => {
  it('accepts complete and zero-record snapshots but never treats an absent snapshot as zero', () => {
    const report = settlementReportFixture(); expect(parsePgSettlementReport(report, filters)).toEqual(report);
    const empty = { ...report, coverage: 'empty', snapshot: { ...report.snapshot!, recordCount: 0 }, transactions: [], totals: [], daily: [], fees: [], pagination: { ...report.pagination, total: 0 } };
    expect(parsePgSettlementReport(empty, filters)?.coverage).toBe('empty');
    const missing = { ...empty, coverage: 'uncollected', snapshot: null, fingerprint: null };
    expect(parsePgSettlementReport(missing, filters)?.coverage).toBe('uncollected');
    expect(parsePgSettlementReport({ ...missing, transactions: report.transactions }, filters)).toBeNull();
  });
  it('rejects another period, environment, explicit snapshot, or inconsistent cursor', () => {
    const report = settlementReportFixture();
    for (const patch of [{ mode: 'live' }, { endDate: '2026-10-30' }, { state: 'collecting', scan: 1, completedAt: null }]) {
      expect(parsePgSettlementReport({ ...report, snapshot: { ...report.snapshot, ...patch } }, filters)).toBeNull();
    }
    expect(parsePgSettlementReport(report, { ...filters, importId: '287b949d-af67-4398-b0d2-09adbd123459' })).toBeNull();
    expect(parsePgSettlementJob({ ...SETTLEMENT_FIXTURE_JOB, scan: '1' })).toBeNull();
    expect(parsePgSettlementJob({ ...SETTLEMENT_FIXTURE_JOB, state: 'complete' })).toBeNull();
  });
  it('drops future private properties instead of spreading server records into clients', () => {
    const report = settlementReportFixture();
    const result = parsePgSettlementReport({ ...report, mId: 'private-mid', snapshot: { ...report.snapshot, scopeHash: 'private-scope', merchantId: 'private-mid', profileId: 'private-profile', billingProfileId: 'private-profile' }, transactions: [{ ...report.transactions[0], paymentKey: 'private-key', card: 'private-card' }] }, filters);
    expect(result).toEqual(report); expect(JSON.stringify(result)).not.toContain('private-');
  });
  it('requires all filtered rows and a fingerprint for exports, with exact decimal strings', () => {
    const report = settlementReportFixture();
    expect(parsePgSettlementReport({ ...report, pagination: { ...report.pagination, pageSize: 20000 } }, filters, true)).not.toBeNull();
    expect(parsePgSettlementReport({ ...report, pagination: { ...report.pagination, total: 2 } }, filters, true)).toBeNull();
    expect(parsePgSettlementReport({ ...report, fingerprint: null }, filters, true)).toBeNull();
    expect(parsePgSettlementReport({ ...report, transactions: [{ ...report.transactions[0], amount: 13000 }] }, filters)).toBeNull();
    expect(parsePgSettlementReport({ ...report, transactions: [report.transactions[0], report.transactions[0]] }, filters)).toBeNull();
  });
});

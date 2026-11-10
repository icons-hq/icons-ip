import type { PgSettlementJob, PgSettlementReport, PgSettlementTransaction } from './report';

export const SETTLEMENT_FIXTURE_JOB: PgSettlementJob = {
  integration: 'toss_payment', accountId: '287b949d-af67-4398-b0d2-09adbd123459',
  id: '287b949d-af67-4398-b0d2-09adbd123450', operationId: '287b949d-af67-4398-b0d2-09adbd123451',
  dateType: 'paidOutDate', startDate: '2026-10-01', endDate: '2026-10-31', mode: 'test',
  state: 'collecting', scan: 1, nextPage: 1, recordCount: 0, sourceCount: 0,
  startedAt: '2026-10-13T13:00:00Z', updatedAt: '2026-10-13T13:00:00Z', completedAt: null, errorCode: null,
};
export const SETTLEMENT_FIXTURE_TRANSACTION: PgSettlementTransaction = {
  id: '287b949d-af67-4398-b0d2-09adbd123452', kind: 'approval', currency: 'KRW', method: '카드',
  amount: '13000', interestFee: '0', fees: [{ type: 'BASE', fee: '315.45' }], supplyAmount: '286.77', vat: '28.68', payOutAmount: '12684.55', cancelAmount: null,
  approvedAt: '2026-10-10T12:30:00+09:00', soldDate: '2026-10-10', paidOutDate: '2026-10-14', canceledAt: null,
  matchState: 'matched', matchReason: 'verified', purpose: 'order', referenceId: '287b949d-af67-4398-b0d2-09adbd123453', orderNumber: '287B949D',
};
export function settlementReportFixture(): PgSettlementReport {
  const snapshot: PgSettlementJob = { ...SETTLEMENT_FIXTURE_JOB, state: 'complete', scan: 2, recordCount: 1, sourceCount: 2, completedAt: '2026-10-13T13:05:00Z' };
  const total = { currency: 'KRW', kind: 'approval' as const, count: 1, amount: '13000', interestFee: '0', feeAmount: '315.45', supplyAmount: '286.77', vat: '28.68', payOutAmount: '12684.55', cancelAmount: '0' };
  return { coverage: 'complete', snapshot, jobs: [snapshot], totals: [total], daily: [{ ...total, date: '2026-10-14' }], transactions: [{ ...SETTLEMENT_FIXTURE_TRANSACTION }],
    fees: [{ currency: 'KRW', kind: 'approval', type: 'BASE', count: 1, fee: '315.45' }], pagination: { page: 1, pageSize: 20, total: 1 }, fingerprint: 'b'.repeat(64) };
}

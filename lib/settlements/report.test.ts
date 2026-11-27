import { describe, expect, it } from 'vitest';
import { normalizePgSettlementFilters } from './console';
import { PG_SETTLEMENT_FEE_LABELS, PG_SETTLEMENT_MATCH_LABELS, PG_SETTLEMENT_MATCH_REASON_LABELS, parsePgSettlementJob, parsePgSettlementReport, pgSettlementFeeLabel, pgSettlementMatchReason } from './report';
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

describe('비교 결과 이름표', () => {
  /* DB private.pg_settlement_match가 돌려주는 이유 코드 전부(상태별로 묶음). 코드가 늘면 화면 말도 함께 늘려야 한다. */
  const MATCHED = ['verified'], UNLINKED = ['payment_not_found', 'payment_not_finalized', 'unsupported_purpose', 'transaction_evidence_missing'];
  const MISMATCH = ['ambiguous_payment', 'payment_identity_mismatch', 'reference_mismatch', 'amount_mismatch', 'integration_binding_mismatch', 'integration_binding_missing', 'ambiguous_refund', 'refund_amount_mismatch'];
  it('상태 이름은 맞음·연결 안 됨·다름이고 이유 코드마다 운영자가 읽는 한 문장이 있다', () => {
    expect(PG_SETTLEMENT_MATCH_LABELS).toEqual({ matched: '맞음', unlinked: '연결 안 됨', mismatch: '다름' });
    expect(Object.keys(PG_SETTLEMENT_MATCH_REASON_LABELS).sort()).toEqual([...MATCHED, ...UNLINKED, ...MISMATCH].sort());
    for (const code of [...MATCHED, ...UNLINKED, ...MISMATCH]) {
      const sentence = pgSettlementMatchReason(code);
      expect(sentence, code).toMatch(/[.]$/); expect(sentence, code).not.toMatch(/수집|\bPG\b|근거|[a-z]+_[a-z_]+|불일치|미연결/);
    }
    expect(new Set(Object.values(PG_SETTLEMENT_MATCH_REASON_LABELS)).size).toBe(Object.keys(PG_SETTLEMENT_MATCH_REASON_LABELS).length);
  });
  it('이유를 모르면 영문 코드를 보이지 않고 개발 담당자에게 알리라고 말한다', () => {
    for (const reason of [null, '', 'brand_new_code']) { const sentence = pgSettlementMatchReason(reason); expect(sentence).toBe('이유를 알 수 없습니다. 개발 담당자에게 알려 주세요.'); expect(sentence).not.toContain('brand_new_code'); }
  });
  it('처음 보는 수수료 종류는 기타 수수료로 부르고 아는 종류는 그대로 부른다', () => {
    expect(pgSettlementFeeLabel('BASE')).toBe('기본 수수료'); expect(pgSettlementFeeLabel('ETC')).toBe('기타 수수료');
    expect(pgSettlementFeeLabel('SOMETHING_NEW')).toBe('기타 수수료'); expect(pgSettlementFeeLabel('SOMETHING_NEW')).not.toContain('SOMETHING');
    for (const label of Object.values(PG_SETTLEMENT_FEE_LABELS)) expect(label).not.toMatch(/\bPG\b/);
  });
});

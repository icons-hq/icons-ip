import { describe, expect, it } from 'vitest';
import { normalizePgSettlementFilters, pgSettlementHref, settlementFailureLabel } from './console';

describe('settlement console filters', () => {
  const now = new Date('2026-10-31T15:01:00Z');
  it('defaults to this month in Korea and separates test from live statements', () => {
    expect(normalizePgSettlementFilters({}, now)).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-01', mode: 'live', tab: 'daily', rangeError: null });
    expect(normalizePgSettlementFilters({ mode: 'test' }, now).mode).toBe('test');
  });
  it('does not silently replace an invalid or reversed period with a different statement', () => {
    for (const [from, to] of [['2026-10-31', '2026-10-01'], ['2026-10-01', '2026-11-01'], ['2026-02-30', '2026-03-01']]) {
      const parsed = normalizePgSettlementFilters({ from, to }, now);
      expect(parsed.startDate).toBe(from); expect(parsed.endDate).toBe(to); expect(parsed.rangeError).not.toBeNull();
    }
  });
  it('retains range and transaction filters while switching tabs or pages', () => {
    const filters = normalizePgSettlementFilters({ tab: 'transactions', mode: 'test', query: '주문 1', kind: 'cancel', match: 'mismatch', currency: 'KRW', pageSize: '50', import: 'aa7b8b20-6e2e-40c9-9d2d-dff9fb053c30' }, now);
    const href = pgSettlementHref(filters, { tab: 'fees', page: 2 });
    expect(normalizePgSettlementFilters(Object.fromEntries(new URL(href, 'http://localhost').searchParams), now)).toEqual({ ...filters, tab: 'fees', page: 2 });
  });
  it('bounds URL input and never renders raw error text', () => {
    const filters = normalizePgSettlementFilters({ page: '-1', pageSize: '20000', query: 'q'.repeat(101), currency: '<script>', import: 'private-key' }, now);
    expect(filters).toMatchObject({ page: 1, pageSize: 20, query: 'q'.repeat(100), currency: '', importId: null });
    expect(settlementFailureLabel('private-provider-error')).not.toContain('private-provider-error');
  });
});

it('정기결제 프로필 선택을 페이지·파일 URL에 보존하고 잘못된 계정은 실패한다', () => {
  const key = '287b949d-af67-4398-b0d2-09adbd123456';
  const filters = normalizePgSettlementFilters({ account: key, mode: 'test' });expect(filters.account).toBe(key);expect(filters.rangeError).toBeNull();
  expect(new URL(pgSettlementHref(filters, { page: 2 }), 'http://localhost').searchParams.get('account')).toBe(key);
  expect(normalizePgSettlementFilters({ account: 'billing:bad' }).rangeError).not.toBeNull();
});

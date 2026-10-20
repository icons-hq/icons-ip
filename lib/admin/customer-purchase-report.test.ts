import { describe, expect, it } from 'vitest';
import { customerPurchaseHref, customerPurchaseLatestPeriod, customerPurchasePreviousPeriod, normalizeCustomerPurchaseFilters } from './customer-purchase-report';

const now = new Date('2026-10-13T16:00:00Z');
describe('고객 구매 분석 기간', () => {
  it('한국 날짜의 마감 월·주로 기본값과 비교기간을 정한다', () => {
    expect(customerPurchaseLatestPeriod('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(customerPurchaseLatestPeriod('week', now)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(customerPurchaseLatestPeriod('month', new Date('2026-09-30T14:59:59Z')).to).toBe('2026-08-31');
    expect(customerPurchaseLatestPeriod('month', new Date('2026-09-30T15:00:00Z')).to).toBe('2026-09-30');
    expect(customerPurchaseLatestPeriod('week', new Date('2026-10-11T14:59:59Z')).to).toBe('2026-10-04');
    expect(customerPurchaseLatestPeriod('week', new Date('2026-10-11T15:00:00Z')).to).toBe('2026-10-11');
  });
  it('윤년·연도 경계를 달 개수로 비교하며 임의 기간 일수를 월간으로 바꾸지 않는다', () => {
    expect(customerPurchasePreviousPeriod('2024-01-01', '2024-03-31', 'month')).toEqual({ from: '2023-10-01', to: '2023-12-31' });
    expect(normalizeCustomerPurchaseFilters({ from: '2024-01-01', to: '2024-12-31' }, now).error).toBeUndefined();
    expect(normalizeCustomerPurchaseFilters({ from: '2024-01-01', to: '2025-01-31' }, now).error).toMatch('366');
    expect(customerPurchasePreviousPeriod('2025-12-29', '2026-01-11', 'week')).toEqual({ from: '2025-12-15', to: '2025-12-28' });
  });
  it.each([
    [{ from: '2026-02-30', to: '2026-03-31' }, '올바르게'],
    [{ from: '2026-09-02', to: '2026-09-30' }, '월 첫날'],
    [{ grain: 'week', from: '2026-10-06', to: '2026-10-11' }, '월요일'],
    [{ from: '2026-10-01', to: '2026-10-31' }, '마감된'],
    [{ grain: 'day' }, '지원하지'],
    [{ from: '2009-12-01', to: '2009-12-31' }, '2010년'],
    [{ compareFrom: '2026-08-02', compareTo: '2026-08-31' }, '월 첫날'],
  ])('잘못된 조회·비교를 실패로 구분한다 %o', (query, expected) => {
    expect(normalizeCustomerPurchaseFilters(query, now).error).toContain(expected);
  });
  it('비교 해제는 숨겨진 비교 값을 RPC나 URL에 보내지 않는다', () => {
    const filters = normalizeCustomerPurchaseFilters({ compare: 'off', compareFrom: 'bad', compareTo: 'bad' }, now);
    expect(filters.error).toBeUndefined();
    expect(customerPurchaseHref(filters)).not.toContain('compareFrom');
    expect(customerPurchaseHref(filters)).toContain('compare=off');
  });
});

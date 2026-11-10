import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
import { getCustomerPurchaseReport } from './customer-purchase-report.server';
import { normalizeCustomerPurchaseFilters } from './customer-purchase-report';
import { customerPurchaseFixture } from './customer-purchase-report.fixture';
const filters = normalizeCustomerPurchaseFilters({}, new Date('2026-10-13T16:00:00Z'));
beforeEach(() => { rpc.mockReset(); });
describe('고객 구매 분석 읽기 경계', () => {
  it('한 RPC로 화면·비교·13개월 집계를 받고 필터를 정확히 전달한다', async () => {
    rpc.mockResolvedValue({ data: customerPurchaseFixture(), error: null });
    await expect(getCustomerPurchaseReport(filters)).resolves.toMatchObject({ current: { from: '2026-09-01' } });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_customer_purchase_report', { p_grain: 'month', p_from: '2026-09-01', p_to: '2026-09-30', p_compare_from: '2026-08-01', p_compare_to: '2026-08-31' });
  });
  it('불완전·오래된·정밀도 손실 응답을 정상 통계로 노출하지 않는다', async () => {
    for (const mutate of [
      (d: ReturnType<typeof customerPurchaseFixture>) => { d.trend.pop(); },
      (d: ReturnType<typeof customerPurchaseFixture>) => { d.current.from = '2026-08-01'; },
      (d: ReturnType<typeof customerPurchaseFixture>) => { d.current.rows[0].productSalesAmount = Number.MAX_SAFE_INTEGER + 1; },
      (d: ReturnType<typeof customerPurchaseFixture>) => { d.current.rows[0].monetaryIssueOrderCount = 1; },
    ]) {
      const data = customerPurchaseFixture(); mutate(data); rpc.mockResolvedValueOnce({ data, error: null });
      await expect(getCustomerPurchaseReport(filters)).rejects.toThrow('응답이 올바르지');
    }
  });
  it('권한 회수·집계 실패를 0건으로 바꾸지 않는다', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'operator_capability_required' } });
    await expect(getCustomerPurchaseReport(filters)).rejects.toThrow('operator_capability_required');
    rpc.mockClear(); await expect(getCustomerPurchaseReport({ ...filters, error: '기간 오류' })).rejects.toThrow('기간 오류'); expect(rpc).not.toHaveBeenCalled();
  });
});

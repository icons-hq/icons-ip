import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { getAdminClaimsReport, getAdminCustomerReport, getAdminSalesReport } from './stats.server';
import { adminStatsComparisonFilters, normalizeAdminStatsFilters } from './stats';
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: {}, error: null }); });
describe('통계 RPC 범위 전달', () => {
  it('세 집계가 같은 KST 반열린 날짜범위를 사용한다', async () => {
    const filters = normalizeAdminStatsFilters({ from: '2026-10-01', to: '2026-10-12', ip: 'test' });
    await Promise.all([getAdminSalesReport(filters), getAdminClaimsReport(filters), getAdminCustomerReport(filters)]);
    for (const [name, params] of mocks.rpc.mock.calls) {
      expect(params.p_from).toBe('2026-09-30T15:00:00.000Z'); expect(params.p_to).toBe('2026-10-12T15:00:00.000Z');
      if (name === 'admin_sales_report') expect(params.p_ip_id).toBe('test');
    }
  });
  it('세 집계의 전년 윤일 범위와 상품 IP가 RPC 입력에서 일치한다', async () => {
    const filters = adminStatsComparisonFilters(normalizeAdminStatsFilters({ from: '2024-02-29', to: '2024-02-29', compare: 'year', ip: 'sample' }))!;
    await Promise.all([getAdminSalesReport(filters), getAdminClaimsReport(filters), getAdminCustomerReport(filters)]);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    for (const [name, params] of mocks.rpc.mock.calls) {
      expect(params.p_from).toBe('2023-02-27T15:00:00.000Z'); expect(params.p_to).toBe('2023-02-28T15:00:00.000Z');
      if (name === 'admin_sales_report') expect(params.p_ip_id).toBe('sample');
      else expect(params).not.toHaveProperty('p_ip_id');
    }
  });
});

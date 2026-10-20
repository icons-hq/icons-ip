import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { getAdminSalesGoodsExport, getAdminSalesGoodsPage } from './stats-sales-goods.server';
import { adminStatsComparisonFilters, normalizeAdminStatsFilters } from './stats';
const empty = { rows: [], totalCount: 0, page: 1, pageSize: 10001, asOf: '2026-10-14T00:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: empty, error: null }); });
describe('상품 전체 순위 로더', () => {
  it('전체 엑셀을 첫 페이지의 sentinel 크기로 한 번 조회한다', async () => {
    await getAdminSalesGoodsExport(normalizeAdminStatsFilters({ from: '2026-10-01', to: '2026-10-12', ip: 'qa' }));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_sales_goods_page', { p_from: '2026-09-30T15:00:00.000Z', p_to: '2026-10-12T15:00:00.000Z', p_ip_id: 'qa', p_page: 1, p_page_size: 10001 });
  });
  it('366일 선택에서 파생된 전년 367일을 재정규화하거나 자르지 않는다', async () => {
    const current = normalizeAdminStatsFilters({ from: '2025-02-28', to: '2026-02-28', compare: 'year' });
    const previous = adminStatsComparisonFilters(current)!;
    expect(current.rangeError).toBeUndefined(); expect(previous).toMatchObject({ from: '2024-02-28', to: '2025-02-28' });
    await getAdminSalesGoodsExport(previous);
    const args = mocks.rpc.mock.calls[0][1];
    expect(args.p_from).toBe('2024-02-27T15:00:00.000Z'); expect(args.p_to).toBe('2025-02-28T15:00:00.000Z');
    expect((Date.parse(args.p_to) - Date.parse(args.p_from)) / 86400000).toBe(367);
  });
  it('요청한 21위 페이지를 그대로 전달하고 RPC 실패·행 누락을 숨기지 않는다', async () => {
    const filters = { days: 30 as const, ipId: '' };
    mocks.rpc.mockResolvedValueOnce({ data: { ...empty, totalCount: 21, page: 2, pageSize: 20, rows: [] }, error: null });
    await expect(getAdminSalesGoodsPage(filters, { page: 2, pageSize: 20 })).rejects.toThrow('Incomplete');
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_page: 2, p_page_size: 20, p_ip_id: null });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'operator_capability_required' } });
    await expect(getAdminSalesGoodsExport(filters)).rejects.toThrow('operator_capability_required');
  });
});

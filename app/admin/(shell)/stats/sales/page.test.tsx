import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), sales: vi.fn(), goods: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/stats.server', () => ({ getAdminSalesReport: mocks.sales }));
vi.mock('@/lib/admin/stats-sales-goods.server', () => ({ getAdminSalesGoodsPage: mocks.goods }));
import Page from './page';
beforeEach(() => { vi.clearAllMocks(); mocks.sales.mockResolvedValue({}); mocks.goods.mockResolvedValue({}); });
describe('판매분석 상품 페이지 경계', () => {
  it('stats.read 게이트가 모든 집계보다 먼저다', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('forbidden'));
    await expect(Page({ searchParams: Promise.resolve({ goodsPage: '2' }) })).rejects.toThrow('forbidden');
    expect(mocks.sales).not.toHaveBeenCalled(); expect(mocks.goods).not.toHaveBeenCalled();
  });
  it('동일 기간·IP를 페이지 RPC에 주고 비교보고서는 기존 조회를 유지한다', async () => {
    await Page({ searchParams: Promise.resolve({ from: '2026-10-01', to: '2026-10-12', ip: 'qa', compare: 'year', bucket: 'week', goodsPage: '2', goodsPageSize: '50' }) });
    expect(mocks.guard).toHaveBeenCalledWith('/admin/stats/sales'); expect(mocks.sales).toHaveBeenCalledTimes(2);
    expect(mocks.goods).toHaveBeenCalledTimes(2);
    expect(mocks.goods).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: '2026-10-01', to: '2026-10-12', ipId: 'qa', comparisonMode: 'year', bucket: 'week' }), { page: 2, pageSize: 50 }, expect.any(Date));
    expect(mocks.goods).toHaveBeenNthCalledWith(2, expect.objectContaining({ from: '2025-10-01', to: '2025-10-12', ipId: 'qa' }), { page: 1, pageSize: 20 }, expect.any(Date));
  });
  it('유효하지 않은 날짜는 새 집계도 실행하지 않는다', async () => {
    await Page({ searchParams: Promise.resolve({ from: '2026-02-30', to: '2026-03-01' }) });
    expect(mocks.goods).not.toHaveBeenCalled(); expect(mocks.sales).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminGoodsList } from './goods-list.server';
import { normalizeGoodsListFilters } from './goods-list';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
vi.mock('./catalog.server', () => ({ getAdminCatalogRecords: vi.fn() }));
vi.mock('./goods-variants.server', () => ({ loadAdminGoodsVariants: vi.fn() }));
const decision = { state: 'blocked', checkedAt: '2026-09-15T03:00:00Z', publication: 'draft', operation: 'active', availableQty: 0,
  publicReview: 'required', saleSettings: 'blocked', reviewRequired: true, reasonCodes: ['draft', 'stock_unavailable'], blockingCodes: ['draft', 'stock_unavailable'],
  activeStockQty: 0, lowStockOptionCount: 0, noticeComplete: true, priceMin: 12345, priceMax: 17890 };
const row = { id: 'g1', code: 'CODE-1', name: '상품', ipId: 'ip', ipTitle: 'IP', imagePath: null, categoryName: '문구',
  publishedAt: null, archivedAt: null, stock: 'ok', stockQty: 0, readiness: decision };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => {
    const builder = { select: () => builder, order: () => builder, range: () => Promise.resolve({ data: [], error: null }) };
    return builder;
  });
});
describe('goods workspace server boundary', () => {
  it('passes combined category/readiness/search/stock scope before server paging and retains exact prices', async () => {
    mocks.rpc.mockResolvedValue({ data: { rows: Array.from({ length: 20 }, (_, index) => ({ ...row, id: `g${index}` })), total: 1000 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({ q: 'CODE', page: '2', ipId: 'ip', categoryId: '00000000-0000-4000-8000-000000000001', readiness: 'stock_unavailable', status: 'draft', stock: 'soldout' }));
    expect(result.goods).toHaveLength(20); expect(result.total).toBe(1000);
    expect(result.goods[0]).toMatchObject({ code: 'CODE-1', categoryName: '문구', priceMin: 12345, priceMax: 17890, readiness: { availableQty: 0 } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_workspace', { p_query: 'CODE', p_ip_id: 'ip', p_status: 'draft', p_stock: 'soldout',
      p_category_id: '00000000-0000-4000-8000-000000000001', p_readiness: 'stock_unavailable', p_limit: 20, p_offset: 20 });
    expect(mocks.from.mock.calls.map(call => call[0])).toEqual(['ips', 'catalog_categories']);
  });
  it('corrects a page after a queue shrinks and retains all other scope', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { rows: [], total: 20 }, error: null }).mockResolvedValueOnce({ data: { rows: [row], total: 20 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({ page: '99', readiness: 'review_required' }));
    expect(result.filters).toMatchObject({ page: 1, readiness: 'review_required' });
    expect(result.goods).toHaveLength(1);
  });
  it('does not report an infrastructure failure or missing count as a successful empty list', async () => {
    for (const value of [{ data: null, error: { message: 'private diagnostic' } }, { data: { rows: [] }, error: null }, { data: { rows: [], total: null }, error: null }]) {
      mocks.rpc.mockResolvedValueOnce(value);
      await expect(loadAdminGoodsList(normalizeGoodsListFilters({}))).rejects.toThrow('상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  });
});

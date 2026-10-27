import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminGoodsList } from './goods-list.server';
import { goodsConsoleFilterValues, normalizeGoodsListFilters } from './goods-list';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ ...mocks, rpc: (name: string, args: unknown) => ['admin_goods_ip_options', 'admin_goods_origin_options'].includes(name) ? Promise.resolve({ data: [], error: null }) : mocks.rpc(name, args) }) }));
vi.mock('./catalog.server', () => ({ getAdminCatalogRecords: vi.fn() }));
vi.mock('./goods-variants.server', () => ({ loadAdminGoodsVariants: vi.fn() }));
const decision = { state: 'blocked', checkedAt: '2026-09-15T03:00:00Z', publication: 'draft', operation: 'active', availableQty: 0,
  publicReview: 'required', saleSettings: 'blocked', reviewRequired: true, reasonCodes: ['draft', 'stock_unavailable'], blockingCodes: ['draft', 'stock_unavailable'],
  activeStockQty: 0, lowStockOptionCount: 0, noticeComplete: true, priceMin: 12345, priceMax: 17890 };
const counts = { all: 1000, active: 900, draft: 600, published: 300, archived: 100 };
const row = { id: 'g1', code: 'CODE-1', name: '상품', ipId: 'ip', ipTitle: 'IP', imagePath: null, categoryName: '문구',
  publishedAt: null, archivedAt: null, stock: 'ok', stockQty: 0, readiness: decision };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation((table: string) => {
    const rows = table === 'goods' ? [{ id: 'g1', price: 12000 }, { id: 'g2', price: 9000 }]
      : table === 'goods_variants' ? [{ id: 'v1', good_id: 'g1', stock_qty: 7 }, { id: 'v2', good_id: 'g2', stock_qty: 1 }, { id: 'v3', good_id: 'g2', stock_qty: 2 }] : [];
    const result = Promise.resolve({ data: rows, error: null });
    const builder = { select: () => builder, order: () => builder, in: () => builder, is: () => builder,
      limit: () => result, range: () => Promise.resolve({ data: [], error: null }), then: result.then.bind(result) };
    return builder;
  });
});
describe('goods workspace server boundary', () => {
  it('uses the selected page size and passes detail predicates before DB sorting and paging', async () => {
    mocks.rpc.mockResolvedValue({ data: { rows: [row], total: 100, statusCounts: counts }, error: null });
    const filters = normalizeGoodsListFilters({ page: '2', pageSize: '50', field: 'name', q: '상품', from: '2026-10-01', to: '2026-10-12', dateField: 'updated', sort: 'stock_desc', image: 'without' });
    const data = await loadAdminGoodsList(filters);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_console', expect.objectContaining({ p_limit: 50, p_offset: 50, p_filters: expect.objectContaining({ field: 'name', from: '2026-10-01', to: '2026-10-12', dateField: 'updated', sort: 'stock_desc', image: 'without' }) }));
    expect(data).toMatchObject({ counts, pageSize: 50 });
  });
  it('passes combined category/readiness/search/stock scope before server paging and retains exact prices', async () => {
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, rows: Array.from({ length: 20 }, (_, index) => ({ ...row, id: `g${index}` })), total: 1000 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({ q: 'CODE', page: '2', ipId: 'ip', categoryId: '00000000-0000-4000-8000-000000000001', readiness: 'stock_unavailable', status: 'draft', stock: 'soldout' }));
    expect(result.goods).toHaveLength(20); expect(result.total).toBe(1000);
    expect(result.goods[0]).toMatchObject({ code: 'CODE-1', categoryName: '문구', priceMin: 12345, priceMax: 17890, readiness: { availableQty: 0 } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_console', { p_query: 'CODE', p_ip_id: 'ip', p_status: 'draft', p_stock: 'soldout',
      p_category_id: '00000000-0000-4000-8000-000000000001', p_readiness: 'stock_unavailable', p_filters: goodsConsoleFilterValues(normalizeGoodsListFilters({})), p_limit: 20, p_offset: 20 });
    // Besides the category filter, only the current page's base prices and active options are read (inline edit).
    expect(mocks.from.mock.calls.map(call => call[0]).sort()).toEqual(['catalog_categories', 'goods', 'goods_variants']);
  });
  it('enables inline stock editing only for goods with exactly one active option', async () => {
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, rows: [row, { ...row, id: 'g2' }], total: 2 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({}));
    expect(result.goods[0]).toMatchObject({ basePrice: 12000, activeVariantCount: 1, inlineStock: { variantId: 'v1', stockQty: 7 } });
    expect(result.goods[1]).toMatchObject({ basePrice: 9000, activeVariantCount: 2, inlineStock: null });
  });
  it('corrects a page after a queue shrinks and retains all other scope', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { statusCounts: counts, rows: [], total: 20 }, error: null }).mockResolvedValueOnce({ data: { statusCounts: counts, rows: [row], total: 20 }, error: null });
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

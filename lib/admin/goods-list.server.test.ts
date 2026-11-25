import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminGoodsList } from './goods-list.server';
import { goodsConsoleFilterValues, normalizeGoodsListFilters } from './goods-list';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), visible: [] as string[], visibleError: false, selects: [] as string[], filters: [] as string[], supplies: null as unknown[] | null, inFilters: [] as string[], salePeriods: null as unknown[] | null, saleIds: [] as string[] }));
const priceStates = [{ id: 'g1', price: 12000, compareAtPrice: null, activeDiscountEndsAt: null }, { id: 'g2', price: 9000, compareAtPrice: 11000, activeDiscountEndsAt: '2026-10-30T00:00:00Z' }];
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ ...mocks, rpc: (name: string, args: unknown) => ['admin_goods_ip_options', 'admin_goods_origin_options'].includes(name) ? Promise.resolve({ data: [], error: null })
  : name === 'admin_goods_list_price_states' ? Promise.resolve({ data: priceStates, error: null }) : mocks.rpc(name, args) }) }));
vi.mock('./catalog.server', () => ({ getAdminCatalogRecords: vi.fn() }));
vi.mock('./goods-variants.server', () => ({ loadAdminGoodsVariants: vi.fn() }));
const decision = { state: 'blocked', checkedAt: '2026-09-15T03:00:00Z', publication: 'draft', operation: 'active', availableQty: 0,
  publicReview: 'required', saleSettings: 'blocked', reviewRequired: true, reasonCodes: ['draft', 'stock_unavailable'], blockingCodes: ['draft', 'stock_unavailable'],
  activeStockQty: 0, lowStockOptionCount: 0, noticeComplete: true, priceMin: 12345, priceMax: 17890 };
const counts = { all: 1000, active: 900, draft: 600, published: 300, archived: 100 };
const row = { id: 'g1', code: 'CODE-1', name: '상품', ipId: 'ip', ipTitle: 'IP', imagePath: null, categoryName: '문구',
  publishedAt: null, archivedAt: null, stock: 'ok', stockQty: 0, readiness: decision };
beforeEach(() => {
  vi.clearAllMocks(); mocks.visible = []; mocks.visibleError = false; mocks.selects = []; mocks.filters = []; mocks.supplies = null; mocks.inFilters = []; mocks.salePeriods = []; mocks.saleIds = [];
  mocks.from.mockImplementation((table: string) => {
    const rows = table === 'goods_variants' ? [{ id: 'v1', good_id: 'g1', stock_qty: 7, name: '기본', code: 'V-1' }, { id: 'v2', good_id: 'g2', stock_qty: 1, name: '블루', code: 'V-2' },
      { id: 'v3', good_id: 'g2', stock_qty: 2, name: '레드', code: 'V-3' }]
      : table === 'goods' ? mocks.visible.map(id => ({ id })) : [];
    const saleRows = mocks.salePeriods;
    const result = Promise.resolve(table === 'goods' && mocks.visibleError ? { data: null, error: { message: 'denied' } } : { data: rows, error: null });
    let columns = '';
    const builder = { select: (selected: string) => { columns = selected; mocks.selects.push(`${table}:${selected}`); return builder; }, order: () => builder,
      in: (column: string, values: string[]) => { if (columns.includes('supply')) mocks.inFilters.push(`${column}:${values.join(',')}`); if (columns.includes('sale_starts_at')) mocks.saleIds.push(...values); return builder; },
      is: (column: string, value: unknown) => { mocks.filters.push(`${table}:is:${column}:${value}`); return builder; },
      not: (column: string, op: string, value: unknown) => { mocks.filters.push(`${table}:not:${column}:${op}:${value}`); return builder; },
      eq: (column: string, value: unknown) => { mocks.filters.push(`${table}:eq:${column}:${value}`); return builder; },
      limit: () => columns.includes('supply') ? Promise.resolve(mocks.supplies ? { data: mocks.supplies, error: null } : { data: null, error: { message: 'denied' } }) : result, range: () => Promise.resolve({ data: [], error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => (columns.includes('sale_starts_at')
        ? Promise.resolve(saleRows ? { data: saleRows, error: null } : { data: null, error: { message: 'denied' } }) : result).then(resolve, reject) };
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
      p_category_id: '00000000-0000-4000-8000-000000000001', p_readiness: 'stock_unavailable', p_filters: goodsConsoleFilterValues(normalizeGoodsListFilters({})), p_limit: 50, p_offset: 50 });
    // Besides the category filter, only the current page's base prices and active options are read (inline edit).
    expect(mocks.from.mock.calls.map(call => call[0]).sort()).toEqual(['catalog_categories', 'goods', 'goods_variants']);
  });
  it('품절(out_of_stock)·판매중지(stopped) 판매상태 필터를 목록 RPC의 p_stock 그대로 보낸다(MD-0026)', async () => {
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, rows: [], total: 0 }, error: null });
    for (const stock of ['out_of_stock', 'stopped']) {
      await loadAdminGoodsList(normalizeGoodsListFilters({ stock }));
      expect(mocks.rpc).toHaveBeenLastCalledWith('admin_search_goods_console', expect.objectContaining({ p_stock: stock }));
    }
  });
  it('상품번호 링크 목적지: 고객 화면과 같은 공개 조건(전시·미보관·판매 제한 없음·IP 공개)을 만족하는 상품만 고객 화면으로 연다', async () => {
    mocks.visible = ['g1'];
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, rows: [row, { ...row, id: 'g2' }], total: 2 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({}));
    expect(result.goods.map(good => [good.id, good.customerVisible])).toEqual([['g1', true], ['g2', false]]);
    expect(mocks.selects).toContain('goods:id,ips!inner(id)');
    for (const filter of ['goods:is:archived_at:null', 'goods:not:published_at:is:null', 'goods:eq:sale_restriction:none', 'goods:is:ips.archived_at:null', 'goods:not:ips.published_at:is:null'])
      expect(mocks.filters).toContain(filter);
    // 읽기에 실패하면 모두 미리보기로 보낸다(목록은 그대로).
    mocks.visibleError = true;
    expect((await loadAdminGoodsList(normalizeGoodsListFilters({}))).goods.map(good => good.customerVisible)).toEqual([false, false]);
  });
  it('enables inline stock editing only for goods with exactly one active option', async () => {
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, rows: [row, { ...row, id: 'g2' }], total: 2 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({}));
    expect(result.goods[0]).toMatchObject({ basePrice: 12000, compareAtPrice: null, activeDiscountEndsAt: null, activeVariantCount: 1, inlineStock: { variantId: 'v1', stockQty: 7 }, inlineOptions: null });
    expect(result.goods[1]).toMatchObject({ basePrice: 9000, compareAtPrice: 11000, activeDiscountEndsAt: '2026-10-30T00:00:00Z', activeVariantCount: 2, inlineStock: null });
    // 옵션이 여럿이면 옵션별 재고 창이 옵션 이름·옵션 자동코드·실재고를 상품 수정의 옵션 순서로 받는다(1014-106).
    expect(result.goods[1].inlineOptions).toEqual([{ variantId: 'v2', name: '블루', code: 'V-2', stockQty: 1 }, { variantId: 'v3', name: '레드', code: 'V-3', stockQty: 2 }]);
    expect(mocks.selects).toContain('goods_variants:id,good_id,stock_qty,name,code');
  });
  it('판매 가능 0개인 전시 상품만 예약 상태를 읽어, 예약판매만 있는 상품에 예약 상태 문구를 싣는다(접수 전은 예약 접수 전)', async () => {
    const at = '2026-11-25T03:00:00.000Z';
    const scheduled = { mode: 'preorder', availableQty: 0, policyId: 'a1000000-0000-4000-8000-000000000001', policyRevision: 1, state: 'scheduled',
      startsAt: '2026-12-02T02:00:00.000Z', endsAt: '2026-12-13T14:59:00.000Z', expectedShipDate: '2026-12-14', calculatedAt: at, nextChangeAt: '2026-12-02T02:00:00.000Z' };
    const stock = { mode: 'stock', availableQty: 0, policyId: null, policyRevision: null, state: 'stock', startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: at, nextChangeAt: null };
    const published = { ...decision, state: 'blocked', publication: 'published', reasonCodes: ['stock_unavailable'], blockingCodes: ['stock_unavailable'] };
    mocks.supplies = [{ good_id: 'pre', supply: scheduled }, { good_id: 'pre', supply: scheduled }, { good_id: 'mixed', supply: scheduled }, { good_id: 'mixed', supply: stock }];
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, total: 5, rows: [
      { ...row, id: 'pre', publishedAt: '2026-11-19T00:00:00Z', readiness: published },
      { ...row, id: 'mixed', publishedAt: '2026-11-19T00:00:00Z', readiness: published },
      { ...row, id: 'draft', readiness: decision },
      { ...row, id: 'stopped', publishedAt: '2026-11-19T00:00:00Z', stock: 'soldout', readiness: published },
      { ...row, id: 'selling', publishedAt: '2026-11-19T00:00:00Z', readiness: { ...published, state: 'ready', availableQty: 4, reasonCodes: [], blockingCodes: [] } },
    ] }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({}));
    expect(mocks.selects).toContain('goods_variants:good_id,supply:goods_variant_supply');
    expect(mocks.inFilters).toEqual(['good_id:pre,mixed']);
    expect(result.goods.map(good => [good.id, good.preorderSaleLabel])).toEqual([['pre', '예약 접수 전'], ['mixed', null], ['draft', null], ['stopped', null], ['selling', null]]);
    // 예약 상태를 읽지 못하면 배지는 지금처럼 품절이다.
    mocks.supplies = null;
    expect((await loadAdminGoodsList(normalizeGoodsListFilters({}))).goods[0].preorderSaleLabel).toBeNull();
  });
  it('판매중지가 아닌 전시 상품의 판매기간을 읽어 시작 전은 판매 예정, 끝난 뒤는 판매 종료 문구를 싣고, 읽지 못하면 비운다', async () => {
    const ready = { ...decision, state: 'ready', publication: 'published', availableQty: 3, reasonCodes: [], blockingCodes: [] };
    mocks.salePeriods = [
      { id: 'soon', sale_starts_at: '2999-01-01T00:00:00Z', sale_ends_at: '2999-02-01T00:00:00Z' },
      { id: 'over', sale_starts_at: '2000-01-01T00:00:00Z', sale_ends_at: '2000-02-01T00:00:00Z' },
      { id: 'open', sale_starts_at: '2000-01-01T00:00:00Z', sale_ends_at: '2999-02-01T00:00:00Z' },
      { id: 'plain', sale_starts_at: null, sale_ends_at: null },
    ];
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, total: 6, rows: [
      ...['soon', 'over', 'open', 'plain'].map(id => ({ ...row, id, publishedAt: '2026-11-19T00:00:00Z', readiness: ready })),
      { ...row, id: 'draft', readiness: decision },
      { ...row, id: 'stopped', publishedAt: '2026-11-19T00:00:00Z', stock: 'soldout', readiness: ready },
    ] }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({}));
    expect(mocks.selects).toContain('goods:id,sale_starts_at,sale_ends_at');
    expect(mocks.saleIds).toEqual(['soon', 'over', 'open', 'plain']);
    expect(result.goods.map(good => [good.id, good.salePeriodLabel])).toEqual([['soon', '판매 예정'], ['over', '판매 종료'], ['open', null], ['plain', null], ['draft', null], ['stopped', null]]);
    mocks.salePeriods = null;
    expect((await loadAdminGoodsList(normalizeGoodsListFilters({}))).goods[0].salePeriodLabel).toBeNull();
  });
  it('corrects a page after a queue shrinks and retains all other scope', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { statusCounts: counts, rows: [], total: 20 }, error: null }).mockResolvedValueOnce({ data: { statusCounts: counts, rows: [row], total: 20 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({ page: '99', readiness: 'review_required' }));
    expect(result.filters).toMatchObject({ page: 1, readiness: 'review_required' });
    expect(result.goods).toHaveLength(1);
  });
  it('returns stock card counts from the same response as the list', async () => {
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, stockCounts: { out_of_stock: 3, low: 0, ignored: 9 }, rows: [row], total: 1 }, error: null });
    expect((await loadAdminGoodsList(normalizeGoodsListFilters({ stock: 'low' }))).stockCounts).toEqual({ out_of_stock: 3, low: 0 });
  });
  it('상품번호와 판매대기·판매중지·판매종료 칸 건수를 같은 응답에서 읽고, 없거나 어긋나면 칸만 비운다(S36-009·SHEET-036)', async () => {
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, saleStateCounts: { scheduled: 2, stopped: 1, ended: 0, ignored: 4 }, rows: [{ ...row, productNo: 1042 }, { ...row, id: 'g2', productNo: '7' }], total: 2 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({}));
    expect(result.saleStateCounts).toEqual({ scheduled: 2, stopped: 1, ended: 0 });
    expect(result.goods.map(good => good.productNo)).toEqual([1042, null]);
    for (const saleStateCounts of [undefined, null, { scheduled: 1, stopped: 1 }, { scheduled: -1, stopped: 0, ended: 0 }, { scheduled: '1', stopped: 0, ended: 0 }]) {
      mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, saleStateCounts, rows: [row], total: 1 }, error: null });
      const fallback = await loadAdminGoodsList(normalizeGoodsListFilters({}));
      expect(fallback.saleStateCounts).toBeNull();
      expect(fallback.goods).toHaveLength(1);
      expect(fallback.goods[0].productNo).toBeNull();
    }
  });
  it.each([
    ['missing (app deployed before the DB)', undefined],
    ['null', null],
    ['not an object', 'x'],
    ['missing key', { out_of_stock: 1 }],
    ['negative', { out_of_stock: -1, low: 0 }],
    ['fractional', { out_of_stock: 1.5, low: 0 }],
    ['string', { out_of_stock: '1', low: 0 }],
  ])('keeps the list open and reports no stock counts when they are %s', async (_label, stockCounts) => {
    mocks.rpc.mockResolvedValue({ data: { statusCounts: counts, stockCounts, rows: [row], total: 1 }, error: null });
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({}));
    expect(result.stockCounts).toBeNull();
    expect(result.goods).toHaveLength(1);
  });
  it('does not report an infrastructure failure or missing count as a successful empty list', async () => {
    for (const value of [{ data: null, error: { message: 'private diagnostic' } }, { data: { rows: [] }, error: null }, { data: { rows: [], total: null }, error: null }]) {
      mocks.rpc.mockResolvedValueOnce(value);
      await expect(loadAdminGoodsList(normalizeGoodsListFilters({}))).rejects.toThrow('상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  });
});

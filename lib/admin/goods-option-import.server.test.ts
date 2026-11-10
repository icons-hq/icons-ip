import { beforeEach, expect, it, vi } from 'vitest';
import { goodsOptionImportTargetVersion } from './goods-option-import';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks }));
vi.mock('@/lib/media', () => ({ publicMediaUrl: (path: string) => `https://media.test/${path}` }));
import { readGoodsOptionImportSource, searchGoodsOptionImportSources } from './goods-option-import.server';
const variantId = '11111111-1111-4111-8111-111111111111';
const source = { id: 'source', name: '원본', code: 'SRC', price: 10000, archived_at: null, updated_at: '2026-10-14T00:00:00Z', goods_variants: [
  { id: variantId, name: '빨강', attributes: { 색상: '빨강' }, price: 13000, archived_at: null, sort_order: 0, updated_at: '2026-10-14T00:00:00Z', stock_qty: 999, erp_code: 'PRIVATE' },
  { id: 'stopped', name: '중지', attributes: { 색상: '중지' }, price: 15000, archived_at: '2026-10-13T00:00:00Z', sort_order: 1 },
] };
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: [], error: null }); const builder = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.single }; mocks.from.mockReturnValue(builder); mocks.select.mockReturnValue(builder); mocks.eq.mockReturnValue(builder); });
it('일반 저장 가격과 활성 선택형 옵션을 한 관계 조회로 읽고 원본 재고·ERP·옵션 ID를 반환하지 않는다', async () => {
  mocks.single.mockResolvedValueOnce({ data: { ...source, live_price: 1, sale_price: 2 }, error: null });
  const result = await readGoodsOptionImportSource('source', null);
  expect(result.targetVersion).toBe('new'); expect(result.source).toMatchObject({ basePrice: 10000, rows: [{ name: '빨강', price: 13000, attributes: { 색상: '빨강' } }] });
  expect(JSON.stringify(result.source)).not.toMatch(/stock|erp|PRIVATE|11111111/);
  expect(mocks.select.mock.calls[0][0]).toContain('price'); expect(mocks.select.mock.calls[0][0]).not.toMatch(/stock_qty|erp|sale_price|price_period/);
  expect(mocks.eq).toHaveBeenCalledExactlyOnceWith('id', 'source'); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('대상 저장본 버전으로 가격·재고·옵션 일치를 확인하고 공개·보관된 대상은 거부한다', async () => {
  const target = { id: 'target', price: 20000, compare_at_price: null, show_discount_rate: true, published_at: null, archived_at: null,
    goods_variants: [{ id: variantId, code: 'DST-01', name: '기존 빨강', attributes: { 색상: '빨강' }, price: 21000, stock_qty: 4, low_stock_threshold: null, is_default: true, archived_at: null }] };
  mocks.single.mockResolvedValueOnce({ data: source, error: null }).mockResolvedValueOnce({ data: target, error: null });
  expect((await readGoodsOptionImportSource('source', 'target')).targetVersion).toBe(goodsOptionImportTargetVersion({ id: 'target', price: 20000, compareAtPrice: null, publishedAt: null, archivedAt: null, variants: [
    { id: variantId, code: 'DST-01', name: '기존 빨강', attributes: { 색상: '빨강' }, price: 21000, stockQty: 4, isDefault: true, archivedAt: null },
  ] }));
  expect(mocks.rpc).toHaveBeenCalledWith('admin_list_goods_variant_external_identities', { target_good_id: 'target' });
  mocks.single.mockResolvedValueOnce({ data: source, error: null }).mockResolvedValueOnce({ data: target, error: null });
  mocks.rpc.mockResolvedValueOnce({ data: [{ variant_id: variantId, good_id: 'target', erp_code: 'ERP-new', erp_name: '변경된 ERP', barcode: '00002', updated_at: '2026-10-14T01:00:00Z' }], error: null });
  const changedIdentity = (await readGoodsOptionImportSource('source', 'target')).targetVersion;
  expect(changedIdentity).toContain('ERP-new'); expect(changedIdentity).toContain('변경된 ERP'); expect(changedIdentity).toContain('00002'); expect(changedIdentity).toContain('2026-10-14T01:00:00Z');
  for (const changed of [{ ...target, published_at: '2026-10-14T00:00:00Z' }, { ...target, archived_at: '2026-10-14T00:00:00Z' }]) {
    mocks.single.mockResolvedValueOnce({ data: source, error: null }).mockResolvedValueOnce({ data: changed, error: null });
    await expect(readGoodsOptionImportSource('source', 'target')).rejects.toThrow('공개 중이거나 보관');
  }
});
it('원본 구성·가격 변경은 새 버전을 만들고 보관·누락·잘못된 응답은 실패한다', async () => {
  mocks.single.mockResolvedValueOnce({ data: source, error: null }).mockResolvedValueOnce({ data: { ...source, price: 9000 }, error: null });
  const before = await readGoodsOptionImportSource('source', null), after = await readGoodsOptionImportSource('source', null);
  expect(before.source.version).not.toBe(after.source.version);
  for (const data of [null, { ...source, archived_at: '2026-10-14T00:00:00Z' }, { ...source, goods_variants: [] }]) {
    mocks.single.mockResolvedValueOnce({ data, error: null }); await expect(readGoodsOptionImportSource('source', null)).rejects.toThrow();
  }
});
it('기존 상품 검색 계약의 필터와 페이지를 사용하고 재고 집계 등은 투영에서 제외한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { rows: [{ id: 'source', code: 'SRC', name: '원본', categoryName: '키링', imagePath: null, publishedAt: null, archivedAt: null, stockQty: 999 }], total: 21 }, error: null });
  const result = await searchGoodsOptionImportSources({ query: 'SRC', field: 'code', categoryId: '', page: 2 });
  expect(result).toMatchObject({ total: 21, page: 2, pageSize: 20 }); expect(result.rows[0]).not.toHaveProperty('stockQty');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_console', expect.objectContaining({ p_query: 'SRC', p_status: 'active', p_limit: 20, p_offset: 20, p_filters: expect.objectContaining({ field: 'code' }) }));
  mocks.rpc.mockResolvedValueOnce({ data: { rows: [], total: null }, error: null });
  await expect(searchGoodsOptionImportSources({ query: '', field: 'name', categoryId: '', page: 1 })).rejects.toThrow();
});

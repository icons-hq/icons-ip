import { beforeEach, expect, it, vi } from 'vitest';
import { GoodsOptionImportError, goodsOptionImportTargetVersion } from './goods-option-import';
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
/* 불러올 수 없는 원인은 운영자에게 그대로 보여도 되는 오류(GoodsOptionImportError)로 가려 던진다. 조회 실패 같은 그 밖의 오류는 일반 오류다. */
it('불러올 수 없는 상품은 원인마다 다른 안내로 거절한다', async () => {
  const variant = source.goods_variants[0];
  const cases: [Record<string, unknown>[], string][] = [
    [[{ ...variant, archived_at: '2026-10-13T00:00:00Z' }], '옵션이 모두 사용 중지돼 있어 불러올 옵션이 없습니다'],
    [[{ ...variant, attributes: {} }], '옵션 없이 파는 상품이라 불러올 옵션이 없습니다'],
    [[variant, { ...variant, id: 'plain', attributes: {}, sort_order: 1 }], '옵션값이 없는 옵션이 섞여 있어 불러올 수 없습니다'],
    [[variant, { ...variant, id: 'two-axes', attributes: { 색상: '파랑', 사이즈: 'M' }, sort_order: 1 }], '옵션마다 옵션명이 달라 불러올 수 없습니다'],
    [[variant, { ...variant, id: 'same', sort_order: 1 }], '옵션값이 똑같은 옵션이 두 개 있어 불러올 수 없습니다'],
    [Array.from({ length: 101 }, (_, index) => ({ ...variant, id: `v${index}`, attributes: { 번호: String(index) }, sort_order: index })), '사용 중인 옵션이 101개라 불러올 수 없습니다'],
  ];
  for (const [goods_variants, reason] of cases) {
    mocks.single.mockResolvedValueOnce({ data: { ...source, goods_variants }, error: null });
    const error = await readGoodsOptionImportSource('source', null).catch((caught: unknown) => caught);
    expect(error, reason).toBeInstanceOf(GoodsOptionImportError);
    expect((error as Error).message).toContain(reason);
  }
  mocks.single.mockResolvedValueOnce({ data: null, error: { message: 'connection refused' } });
  const lookup = await readGoodsOptionImportSource('source', null).catch((caught: unknown) => caught);
  expect(lookup).not.toBeInstanceOf(GoodsOptionImportError);
});
it('기존 상품 검색 계약의 필터와 페이지를 사용하고 재고 집계 등은 투영에서 제외한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { rows: [{ id: 'source', code: 'SRC', name: '원본', categoryName: '키링', imagePath: null, publishedAt: null, archivedAt: null, stockQty: 999 }], total: 21 }, error: null });
  const result = await searchGoodsOptionImportSources({ query: 'SRC', field: 'code', categoryId: '', page: 2 });
  expect(result).toMatchObject({ total: 21, page: 2, pageSize: 20 }); expect(result.rows[0]).not.toHaveProperty('stockQty');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_console', expect.objectContaining({ p_query: 'SRC', p_status: 'active', p_limit: 20, p_offset: 20, p_filters: expect.objectContaining({ field: 'code' }) }));
  mocks.rpc.mockResolvedValueOnce({ data: { rows: [], total: null }, error: null });
  await expect(searchGoodsOptionImportSources({ query: '', field: 'name', categoryId: '', page: 1 })).rejects.toThrow();
});
/* 화면 규칙 2: 옵션 불러오기 선택창은 선택형 옵션이 있는 상품만 찾는 전용 조회를 쓴다. DB가 걸러야 총 개수·페이지가 맞는다. */
it('옵션 원본 조건이 있으면 전용 조회로 걸러 총 개수와 페이지가 맞고, 조건이 없는 호출은 기존 조회 그대로다', async () => {
  const category = '11111111-1111-4111-8111-111111111111';
  mocks.rpc.mockResolvedValueOnce({ data: { rows: [{ id: 'source', code: 'SRC', name: '원본', categoryName: '키링', imagePath: 'goods/a.webp', publishedAt: '2026-11-01T00:00:00Z', archivedAt: null }], total: 41 }, error: null });
  const result = await searchGoodsOptionImportSources({ query: '키링', field: 'name', categoryId: category, page: 3, optionSourcesOnly: true, excludeGoodId: 'target' });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_search_goods_option_sources',
    { p_query: '키링', p_field: 'name', p_category_id: category, p_exclude_good_id: 'target', p_limit: 20, p_offset: 40 });
  expect(result).toEqual({ rows: [{ id: 'source', code: 'SRC', name: '원본', categoryName: '키링', imageUrl: 'https://media.test/goods/a.webp', published: true }], total: 41, page: 3, pageSize: 20 });
  /* 마지막 페이지를 넘긴 요청은 걸러 낸 총 개수로 마지막 페이지를 다시 읽는다. */
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValueOnce({ data: { rows: [], total: 21 }, error: null }).mockResolvedValueOnce({ data: { rows: [], total: 21 }, error: null });
  expect(await searchGoodsOptionImportSources({ query: '', field: 'code', categoryId: '', page: 9, optionSourcesOnly: true })).toMatchObject({ total: 21, page: 2 });
  expect(mocks.rpc.mock.calls.map(call => [call[0], call[1].p_offset, call[1].p_exclude_good_id])).toEqual([['admin_search_goods_option_sources', 160, null], ['admin_search_goods_option_sources', 20, null]]);
  /* 조건이 없으면(공용 상품 선택창·복사등록) 기존 조회를 같은 인자로 부른다. 제외 상품만 온 경우도 기존 조회다. */
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
  await searchGoodsOptionImportSources({ query: '', field: 'name', categoryId: '', page: 1 });
  await searchGoodsOptionImportSources({ query: '', field: 'name', categoryId: '', page: 1, excludeGoodId: 'target' });
  for (const call of mocks.rpc.mock.calls) {
    expect(call[0]).toBe('admin_search_goods_console');
    expect(Object.keys(call[1]).sort()).toEqual(['p_category_id', 'p_filters', 'p_ip_id', 'p_limit', 'p_offset', 'p_query', 'p_readiness', 'p_status', 'p_stock']);
    expect(call[1]).toMatchObject({ p_query: '', p_ip_id: '', p_status: 'active', p_stock: 'all', p_category_id: null, p_readiness: 'all', p_limit: 20, p_offset: 0 });
  }
});
/* 화면 규칙 2: 고시 '다른 상품에서 복사' 선택창은 고시를 적어 둔 상품만 찾는 전용 조회를 쓴다. 인자와 응답 모양은 옵션 원본 조회와 같다. */
it('고시 원본 조건이 있으면 고시 전용 조회로 걸러 총 개수와 페이지가 맞는다', async () => {
  const category = '11111111-1111-4111-8111-111111111111';
  mocks.rpc.mockResolvedValueOnce({ data: { rows: [{ id: 'source', code: 'SRC', name: '원본', categoryName: null, imagePath: null, publishedAt: null, archivedAt: null, noticeMaker: '싣지 않는 값' }], total: 41 }, error: null });
  const result = await searchGoodsOptionImportSources({ query: '키링', field: 'code', categoryId: category, page: 3, noticeSourcesOnly: true, excludeGoodId: 'target' });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_search_goods_notice_sources',
    { p_query: '키링', p_field: 'code', p_category_id: category, p_exclude_good_id: 'target', p_limit: 20, p_offset: 40 });
  expect(result).toEqual({ rows: [{ id: 'source', code: 'SRC', name: '원본', categoryName: null, imageUrl: null, published: false }], total: 41, page: 3, pageSize: 20 });
  /* 저장 전인 새 상품은 뺄 상품이 없다. 마지막 페이지를 넘긴 요청은 걸러 낸 총 개수로 마지막 페이지를 다시 읽는다. */
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValueOnce({ data: { rows: [], total: 21 }, error: null }).mockResolvedValueOnce({ data: { rows: [], total: 21 }, error: null });
  expect(await searchGoodsOptionImportSources({ query: '', field: 'name', categoryId: '', page: 9, noticeSourcesOnly: true })).toMatchObject({ total: 21, page: 2 });
  expect(mocks.rpc.mock.calls.map(call => [call[0], call[1].p_offset, call[1].p_category_id, call[1].p_exclude_good_id]))
    .toEqual([['admin_search_goods_notice_sources', 160, null, null], ['admin_search_goods_notice_sources', 20, null, null]]);
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
  await expect(searchGoodsOptionImportSources({ query: '', field: 'name', categoryId: '', page: 1, noticeSourcesOnly: true })).rejects.toThrow('상품과 옵션을 불러오지 못했습니다.');
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryDisplaySqlQuery, parseCategoryDisplayGood, parseCategoryDisplayPage, hydrateCategoryDisplayPage, loadCategoryDisplayPage } from './category-display.server';
import { toGood, type GoodRow } from './catalog';
import { initialGoodOption, purchasableOptionQty } from './goods-options';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), appearance: vi.fn(), summaries: vi.fn() }));
vi.mock('./supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('./goods-listing-appearance.server', () => ({ loadGoodsListingAppearance: mocks.appearance }));
vi.mock('./goods-review-summary.server', () => ({ loadGoodsReviewSummaries: mocks.summaries }));
const id = '93930000-0000-4000-8000-000000000011', now = '2026-10-14T00:00:00Z';
const query = { displayCategory: id, view: 'all' as const, ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended' as const };
function row() {
  const pricing = { regularPrice: 1000, effectivePrice: 700, pricePeriodId: id, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', calculatedAt: now, nextChangeAt: '2026-11-01T00:00:00Z' };
  const supply = { mode: 'preorder', availableQty: 4, policyId: id, policyRevision: 1, state: 'open', startsAt: pricing.startsAt, endsAt: pricing.endsAt, expectedShipDate: '2026-12-01', calculatedAt: now, nextChangeAt: pricing.endsAt };
  return { id: 'g1', ip_id: 'ip1', ip_name: '독립 추천 IP', name: '상품', type: '문구', price: 1000, compare_at_price: 1200, stock_qty: 0, stock: 'soldout', image_path: null, bg: '#fff', badge: null,
    sale_restriction: 'none', custom_inputs_enabled: false, custom_inputs_revision: 0, custom_input_fields: [], show_discount_rate: true,
    goods_variants: [{ id, name: '옵션', code: 'OPT1', price: 1000, stock_qty: 0, is_default: true, attributes: {}, archived_at: null, sort_order: 0, pricing, supply }] };
}
function page() { return { category: { id, name: '전시' }, checkedAt: now, token: 'a'.repeat(32), offset: 0, nextOffset: null, total: 1, filteredTotal: 1, priceCeil: 700,
  rows: [row()], ipFacets: [{ value: 'ip1', label: 'IP', count: 1 }], typeFacets: [{ value: '문구', label: '문구', count: 1 }], banner: null, video: null, recommendations: null }; }
beforeEach(() => { vi.clearAllMocks(); mocks.appearance.mockResolvedValue(new Map()); mocks.summaries.mockResolvedValue({}); });
describe('전시 공개 DTO', () => {
  it('RPC typeFacets 의 옛 유형 값은 거르고 예약판매만 남긴다', () => {
    const source = page(); source.typeFacets = [{ value: '문구', label: '문구', count: 1 }, { value: '예약판매', label: '예약판매', count: 1 }];
    expect(parseCategoryDisplayPage(source, query)?.result.typeFacets).toEqual([{ value: '예약판매', label: '예약판매', count: 1 }]);
    expect(parseCategoryDisplayPage(page(), query)?.result.typeFacets).toEqual([]);
  });
  it('RPC 에 보내는 types 는 예약판매만이다', () => {
    expect(categoryDisplaySqlQuery({ ...query, types: ['키링', '예약판매'] }).types).toEqual(['예약판매']);
  });
  it('기간 할인가·예약판매 물량을 기존 toGood와 같은 옵션 변환으로 표시한다', () => {
    const source = row(), result = parseCategoryDisplayGood(source);
    expect(result).toEqual(toGood(source as unknown as GoodRow, () => ''));
    expect(result?.price).toBe(700); expect(result?.stockQty).toBe(4);
    expect(result?.options?.[0].supply?.state).toBe('open');
  });
  /* ADR-0050 — 전시 투영이 싣는 상품 자동코드로 카드 링크가 공개 상세의 정식 주소로 바로 간다. */
  it('전시 투영의 상품 자동코드를 상품에 싣는다', () => {
    expect(parseCategoryDisplayGood({ ...row(), code: 'HSQ-0059' })?.code).toBe('HSQ-0059');
    expect(parseCategoryDisplayGood(row())).not.toHaveProperty('code');
  });
  it('가격·공급 계약이 깨진 옵션을 조용히 버리고 성공하지 않는다', () => {
    const source = row(); source.goods_variants[0].pricing.effectivePrice = 1200;
    expect(parseCategoryDisplayGood(source)).toBeNull();
    const badSupply = row(); badSupply.goods_variants[0].supply.state = 'closed';
    expect(parseCategoryDisplayGood(badSupply)).toBeNull();
  });
  it('랜덤 판매 상품은 전시 RPC가 싣는 랜덤 한 줄 하나로 목록 빠른 담기가 된다(D5②)', () => {
    // private.category_display_public_variants 는 랜덤 굿즈의 옵션 행 대신 goods_random_option 한 줄(장바구니 키·풀 합계)만 싣는다.
    const base = row(), key = '93930000-0000-4000-8000-000000000077';
    const supply = { mode: 'stock', availableQty: 60, policyId: null, policyRevision: null, state: 'stock',
      startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: now, nextChangeAt: null };
    const source = { ...base, stock_qty: 60, stock: 'ok',
      goods_variants: [{ ...base.goods_variants[0], id: key, name: '랜덤', code: '', stock_qty: 60, supply }] };
    const good = parseCategoryDisplayGood(source);
    expect(good?.options).toHaveLength(1);
    expect(good?.options?.[0]).toMatchObject({ id: key, name: '랜덤', stockQty: 60 });
    // AddToCartButton 은 옵션이 하나면 '옵션 선택' 대신 바로 담고, 키(기본 옵션)로 담는다.
    expect(initialGoodOption(good!)?.id).toBe(key);
    expect(purchasableOptionQty(good!.options![0])).toBe(60);
  });
  it('페이지 개수·전체 수·토큰·중복 ID 불일치를 거절한다', () => {
    expect(parseCategoryDisplayPage(page(), query)?.result.goods).toHaveLength(1);
    expect(parseCategoryDisplayPage({ ...page(), filteredTotal: 2 }, query)).toBeNull();
    expect(parseCategoryDisplayPage({ ...page(), nextOffset: 20 }, query)).toBeNull();
    expect(parseCategoryDisplayPage({ ...page(), token: 'invalid' }, query)).toBeNull();
    expect(parseCategoryDisplayPage({ ...page(), rows: [row(), row()], total: 2, filteredTotal: 2 }, query)).toBeNull();
  });
  /* 상품 표시문구 여러 개(migration 20261125140000): 전시 투영의 badges를 고른 순서대로 싣고, 모양이 틀리면 거절한다. */
  it('전시 투영의 표시문구 목록을 고른 순서대로 목록·추천 카드에 싣는다', () => {
    const source = { ...row(), badge: 'EXCLUSIVE', badges: ['EXCLUSIVE', 'NEW'] };
    expect(parseCategoryDisplayGood(source)?.badges).toEqual(['EXCLUSIVE', 'NEW']);
    expect(parseCategoryDisplayGood({ ...row(), badges: 'NEW' })).toBeNull();
    expect(parseCategoryDisplayGood({ ...row(), badges: ['NEW', 1] })).toBeNull();
    /* badges를 싣지 않는 옛 투영은 첫 값 badge 하나로 읽는다(카드 칩 판정은 goodBadgeList). */
    expect(parseCategoryDisplayGood({ ...row(), badge: 'NEW' })?.badges).toBeUndefined();
    const result = parseCategoryDisplayPage({ ...page(), recommendations: { title: '추천', rows: [{ ...source, id: 'g2' }] } }, query);
    expect(result?.recommendations?.goods[0]).toMatchObject({ badge: 'EXCLUSIVE', badges: ['EXCLUSIVE', 'NEW'] });
  });
  it('메인 스코프 밖 추천상품도 자체 IP 이름을 유지한다', () => {
    const result = parseCategoryDisplayPage({ ...page(), recommendations: { title: '추천', rows: [{ ...row(), id: 'g2', ip_id: 'outside' }] } }, query);
    expect(result?.recommendations?.goods[0].brand).toBe('독립 추천 IP');
  });
  it('공개 페이지와 미리보기 공통 변환이 표시 설정과 지운 화면 목적지 게이트를 적용한다', async () => {
    const input = parseCategoryDisplayPage(page(), query)!;
    input.banner = { id, title: '', subtitle: null, imageUrl: 'image', mobileImageUrl: null, href: '/packs', imageAlt: '', imageDim: 'none', textColor: 'white' };
    const appearance = { colors: [], gallery: [], description: '설명' };
    mocks.appearance.mockResolvedValue(new Map([['g1', appearance]]));
    const result = await hydrateCategoryDisplayPage(input, {} as SupabaseClient);
    expect(result.result.goods[0].listingAppearance).toEqual(appearance); expect(result.banner).toBeNull();
    /* 지운 굿즈 마켓 화면(ADR-0052)으로 가는 배너도 같은 자리에서 걷어낸다. */
    const market = parseCategoryDisplayPage(page(), query)!;
    market.banner = { id, title: '', subtitle: null, imageUrl: 'image', mobileImageUrl: null, href: '/market', imageAlt: '', imageDim: 'none', textColor: 'white' };
    expect((await hydrateCategoryDisplayPage(market, {} as SupabaseClient)).banner).toBeNull();
  });
  it('목록 카드 별점은 이 페이지 상품 몫만 배치로 읽고, 실패하면 별점만 숨긴다(CL-02)', async () => {
    const client = { rpc: vi.fn() } as unknown as SupabaseClient;
    mocks.summaries.mockResolvedValueOnce({ g1: { count: 4, average: 4.5 } });
    const result = await hydrateCategoryDisplayPage(parseCategoryDisplayPage(page(), query)!, client);
    expect(mocks.summaries).toHaveBeenCalledWith(client, ['g1']);
    expect(result.result.reviewSummaries).toEqual({ g1: { count: 4, average: 4.5 } });
    mocks.summaries.mockRejectedValueOnce(new Error('rpc'));
    const fallback = await hydrateCategoryDisplayPage(parseCategoryDisplayPage(page(), query)!, client);
    expect(fallback.result.reviewSummaries).toEqual({});
    expect(fallback.result.goods).toHaveLength(1);
  });
  it('다른 카테고리 또는 요청 offset과 다른 응답을 거절한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...page(), category: { id: '93930000-0000-4000-8000-000000000012', name: '다른 전시' } }, error: null });
    await expect(loadCategoryDisplayPage(id, query)).rejects.toThrow();
    mocks.rpc.mockResolvedValueOnce({ data: page(), error: null });
    await expect(loadCategoryDisplayPage(id, query, 20, 'a'.repeat(32))).rejects.toThrow();
  });
});

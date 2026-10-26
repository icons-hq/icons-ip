import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCategoryDisplayGood, parseCategoryDisplayPage, hydrateCategoryDisplayPage, loadCategoryDisplayPage } from './category-display.server';
import { toGood, type GoodRow } from './catalog';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), appearance: vi.fn(), rewards: vi.fn(), summaries: vi.fn() }));
vi.mock('./supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('./goods-listing-appearance.server', () => ({ loadGoodsListingAppearance: mocks.appearance }));
vi.mock('./card-rewards/gate.server', () => ({ readCardRewardsEnabled: mocks.rewards }));
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
beforeEach(() => { vi.clearAllMocks(); mocks.appearance.mockResolvedValue(new Map()); mocks.rewards.mockResolvedValue(true); mocks.summaries.mockResolvedValue({}); });
describe('전시 공개 DTO', () => {
  it('기간 할인가·예약판매 물량을 기존 toGood와 같은 옵션 변환으로 표시한다', () => {
    const source = row(), result = parseCategoryDisplayGood(source);
    expect(result).toEqual(toGood(source as unknown as GoodRow, () => ''));
    expect(result?.price).toBe(700); expect(result?.stockQty).toBe(4);
    expect(result?.options?.[0].supply?.state).toBe('open');
  });
  it('가격·공급 계약이 깨진 옵션을 조용히 버리고 성공하지 않는다', () => {
    const source = row(); source.goods_variants[0].pricing.effectivePrice = 1200;
    expect(parseCategoryDisplayGood(source)).toBeNull();
    const badSupply = row(); badSupply.goods_variants[0].supply.state = 'closed';
    expect(parseCategoryDisplayGood(badSupply)).toBeNull();
  });
  it('페이지 개수·전체 수·토큰·중복 ID 불일치를 거절한다', () => {
    expect(parseCategoryDisplayPage(page(), query)?.result.goods).toHaveLength(1);
    expect(parseCategoryDisplayPage({ ...page(), filteredTotal: 2 }, query)).toBeNull();
    expect(parseCategoryDisplayPage({ ...page(), nextOffset: 20 }, query)).toBeNull();
    expect(parseCategoryDisplayPage({ ...page(), token: 'invalid' }, query)).toBeNull();
    expect(parseCategoryDisplayPage({ ...page(), rows: [row(), row()], total: 2, filteredTotal: 2 }, query)).toBeNull();
  });
  it('메인 스코프 밖 추천상품도 자체 IP 이름을 유지한다', () => {
    const result = parseCategoryDisplayPage({ ...page(), recommendations: { title: '추천', rows: [{ ...row(), id: 'g2', ip_id: 'outside' }] } }, query);
    expect(result?.recommendations?.goods[0].brand).toBe('독립 추천 IP');
  });
  it('공개 페이지와 미리보기 공통 변환이 표시 설정과 리워드 목적지 게이트를 적용한다', async () => {
    const input = parseCategoryDisplayPage(page(), query)!;
    input.banner = { id, title: '', subtitle: null, imageUrl: 'image', mobileImageUrl: null, href: '/packs', imageAlt: '', imageDim: 'none', textColor: 'white' };
    const appearance = { colors: [], gallery: [], description: '설명' };
    mocks.appearance.mockResolvedValue(new Map([['g1', appearance]])); mocks.rewards.mockResolvedValue(false);
    const result = await hydrateCategoryDisplayPage(input, {} as SupabaseClient);
    expect(result.result.goods[0].listingAppearance).toEqual(appearance); expect(result.banner).toBeNull();
  });
  it('목록 카드 별점은 이 페이지 굿즈 몫만 배치로 읽고, 실패하면 별점만 숨긴다(CL-02)', async () => {
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

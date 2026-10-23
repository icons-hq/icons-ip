import { describe, expect, it } from 'vitest';
import type { HomeGoodsCard } from './home-catalog';
import { buildHomeReviewBestBand, buildHomeSalesBestBand, emptyHomeProductRankings, homeReviewBandRating, readHomeReviewRule, readHomeSalesRule, selectHomeReviewGoods, type HomeProductRankings } from './home-ranking';

const goods: HomeGoodsCard[] = Array.from({ length: 22 }, (_, index) => ({
  id: `g${index}`, name: `상품 ${index}`, brand: null, price: 1000, badge: null,
  imageBg: '#eee', href: `/shop/g${index}`, soldOut: index === 0,
}));
function rankings(): HomeProductRankings {
  return {
    ...emptyHomeProductRankings(), salesAvailable: true, reviewsAvailable: true,
    sales: { realtime: ['g0', 'g1', 'g2', 'g3'], daily: ['missing', 'g2', 'g2', 'g1'], weekly: ['g3'], monthly: [] },
    reviewStatistics: goods.map((good, index) => ({
      goodId: good.id, ratingAverage: index === 2 ? 2.9 : 4.5, reviewCount: index + 1,
      recentReviewAt: index === 1 ? null : `2026-10-${String(5 + (index % 7)).padStart(2, '0')}T00:00:00Z`,
      representative: { id: `review-${index}`, rating: 5, body: '실제 공개 후기 본문', authorName: '공개 닉네임', createdAt: '2026-09-20T00:00:00Z' },
    })),
  };
}

describe('ranked home modules', () => {
  it('keeps all four periods and selected default without fabricating missing catalog cards', () => {
    const band = buildHomeSalesBestBand('sales', '판매량 BEST', { exposure: 'all', period: 'weekly' }, goods, rankings());
    expect(band.tabs.map((tab) => tab.label)).toEqual(['실시간', '일간', '주간', '월간']);
    expect(band.defaultTabId).toBe('sales-weekly');
    expect(band.tabs[0].goods[0].soldOut).toBe(true);
    expect(band.tabs[1].goods.map((good) => good.id)).toEqual(['g2', 'g1']);
    expect(band.tabs[3].goods).toEqual([]);
  });

  it('automatic reviews use recent-review candidates, reject low ratings and cap at six', () => {
    const selected = selectHomeReviewGoods({ mode: 'rating' }, goods, rankings());
    expect(selected).toHaveLength(6);
    expect(selected.map((good) => good.id)).not.toContain('g1');
    expect(selected.map((good) => good.id)).not.toContain('g2');
    expect(selected[0].id).toBe('g13');
    expect(selected[0].review.body).toBe('실제 공개 후기 본문');
  });

  it('manual reviews preserve order and allow older reviews but hide the complete section below four eligible goods', () => {
    const rule = { mode: 'manual' as const, goodIds: ['g4', 'g1', 'g2', 'g3', 'g0'] };
    const band = buildHomeReviewBestBand('review', '구매 후기', rule, goods, rankings());
    expect(band.goods.map((good) => good.id)).toEqual(['g4', 'g1', 'g3', 'g0']);
    expect(buildHomeReviewBestBand('review', '구매 후기', rule, goods.filter((good) => good.id !== 'g4'), rankings()).goods).toEqual([]);
    expect(selectHomeReviewGoods({ mode: 'manual', goodIds: goods.map((good) => good.id) }, goods, rankings())).toHaveLength(20);
  });

  it('rejects unknown, ambiguous or duplicate saved rules while preserving an empty manual draft', () => {
    expect(readHomeSalesRule({ exposure_mode: 'all', period: 'weekly' })).toEqual({ exposure: 'all', period: 'weekly' });
    expect(readHomeSalesRule({ exposure_mode: 'all', period: 'weekly', good_ids: [] })).toBeNull();
    expect(readHomeSalesRule({ exposure_mode: 'all', period: 'yearly' })).toBeNull();
    expect(readHomeReviewRule({ selection_mode: 'rating' })).toEqual({ mode: 'rating' });
    expect(readHomeReviewRule({ selection_mode: 'rating', good_ids: [] })).toBeNull();
    expect(readHomeReviewRule({ selection_mode: 'manual', good_ids: ['g1', 'g1'] })).toBeNull();
    expect(readHomeReviewRule({ selection_mode: 'manual', good_ids: [] })).toEqual({ mode: 'manual', goodIds: [] });
  });

  it('unavailable aggregates cannot look like a successful ranking', () => {
    const unavailable = emptyHomeProductRankings();
    expect(selectHomeReviewGoods({ mode: 'manual', goodIds: ['g0', 'g1', 'g3', 'g4'] }, goods, unavailable)).toEqual([]);
    expect(buildHomeSalesBestBand('sales', 'BEST', { exposure: 'single', period: 'daily' }, goods, unavailable).tabs[0].goods).toEqual([]);
  });

  /* L4b — 리뷰 BEST 밴드의 '★ 평균 · 리뷰 N'은 같은 홈의 카드 별점과 같은 그룹 범위 요약을 보이고, 선정은 굿즈 단위 집계 그대로다. */
  it('review band shows the group-scope summary while selection and order stay on the goods-level statistic', () => {
    /* g13 은 굿즈 단위 평균 4.5 로 첫째, g12 는 그룹 범위로 묶여 요약 평균이 2.0 이어도 선정 기준(굿즈 단위 ≥3)으로 남는다. */
    const grouped = goods.map((good) => (good.id === 'g12' ? { ...good, reviewSummary: { count: 30, average: 2 } }
      : good.id === 'g2' ? { ...good, reviewSummary: { count: 9, average: 4.9 } } : good));
    const selected = selectHomeReviewGoods({ mode: 'rating' }, grouped, rankings());

    expect(selected.map((good) => good.id)).toEqual(selectHomeReviewGoods({ mode: 'rating' }, goods, rankings()).map((good) => good.id));
    expect(selected.map((good) => good.id)).toContain('g12');
    /* 굿즈 단위 평균 2.9 인 g2 는 그룹 요약이 4.9 여도 뽑히지 않는다. */
    expect(selected.map((good) => good.id)).not.toContain('g2');

    const g12 = selected.find((good) => good.id === 'g12')!;
    expect([g12.ratingAverage, g12.reviewCount]).toEqual([4.5, 13]);
    expect(homeReviewBandRating(g12)).toEqual({ average: 2, count: 30 });
    /* 요약을 읽지 못한 실행은 선정 집계값을 그대로 보인다. */
    expect(homeReviewBandRating(selected.find((good) => good.id === 'g13')!)).toEqual({ average: 4.5, count: 14 });
  });
});

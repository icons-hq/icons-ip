import { describe, expect, it } from 'vitest';
import type { HomeGoodsCard } from './home-catalog';
import { buildHomeReviewBestBand, buildHomeSalesBestBand, eligibleHomeReviewGoodIds, emptyHomeProductRankings, homeReviewBandRating, homeReviewBandStatistics, readHomeReviewRule, readHomeSalesRule, selectHomeReviewGoods, type HomeProductRankings } from './home-ranking';

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

  /* L4b(2026-10-26 리드 결정) — 리뷰 BEST 밴드는 선정(평균 3 이상)·자동 정렬·'★ 평균 · 리뷰 N' 표시를 모두 같은 홈의 카드
     별점과 같은 그룹상품 범위 요약(reviewSummary)으로 한다. 요약이 없는 굿즈만 굿즈 단위 후보 집계로 폴백한다. */
  it('automatic reviews judge and order by the group-scope summary and show the same number', () => {
    /* g12 는 굿즈 단위 4.5 지만 그룹 범위 2.0 이라 빠지고, g2 는 굿즈 단위 2.9 지만 그룹 범위 4.9 라 맨 앞에 선다. */
    const grouped = goods.map((good) => (good.id === 'g12' ? { ...good, reviewSummary: { count: 30, average: 2 } }
      : good.id === 'g2' ? { ...good, reviewSummary: { count: 9, average: 4.9 } } : good));
    const selected = selectHomeReviewGoods({ mode: 'rating' }, grouped, rankings());

    expect(selected.map((good) => good.id)).not.toContain('g12');
    expect(selected[0].id).toBe('g2');
    expect(selected).toHaveLength(6);
    /* 선정·정렬에 쓴 값이 카드 값이고, 화면에 보이는 값도 같다 — 보이는 평균은 3 이상이고 내림차순이다. */
    const shown = selected.map((good) => homeReviewBandRating(good));
    expect(shown[0]).toEqual({ average: 4.9, count: 9 });
    expect(selected.map((good) => [good.ratingAverage, good.reviewCount])).toEqual(shown.map((rating) => [rating.average, rating.count]));
    expect(shown.every((rating) => rating.average >= 3)).toBe(true);
    expect(shown.map((rating) => rating.average)).toEqual([...shown.map((rating) => rating.average)].sort((a, b) => b - a));
    /* 대표 후기·최근 후기시각은 후보 RPC 그대로다. */
    expect(selected[0].review.id).toBe('review-2');
  });

  it('falls back to the goods-level statistic only for goods without a group-scope summary', () => {
    /* 요약을 읽지 않은 스냅샷은 굿즈 단위 판정 그대로다. */
    const withoutSummaries = selectHomeReviewGoods({ mode: 'rating' }, goods, rankings());
    expect(withoutSummaries[0].id).toBe('g13');
    expect(homeReviewBandRating(withoutSummaries[0])).toEqual({ average: 4.5, count: 14 });
    /* 일부 묶음만 요약이 있으면 그 굿즈만 그룹 범위다(나머지는 폴백). */
    const partial = goods.map((good) => (good.id === 'g20' ? { ...good, reviewSummary: { count: 40, average: 4.75 } } : good));
    const selected = selectHomeReviewGoods({ mode: 'rating' }, partial, rankings());
    expect(selected.map((good) => good.id).slice(0, 2)).toEqual(['g20', 'g13']);
    expect(homeReviewBandRating(selected[0])).toEqual({ average: 4.75, count: 40 });
    expect(homeReviewBandRating(selected[1])).toEqual({ average: 4.5, count: 14 });
  });

  /* 격리 스택 실측 모양(2026-10-26): 직접 선정 [maple-01, maple-02, g3, maple-03, snow-001]에서 maple-02 는 자기 리뷰 5.00/1 이지만
     그룹 범위 2.33/3, maple-03 은 2.67/3 이다. 둘 다 보이는 평균이 3 미만이라 빠지고, 남은 3개는 4개 미만이라 영역 전체가 숨는다. */
  it('manual selection drops goods whose visible group-scope average is below three and hides the band below four', () => {
    const stat = (goodId: string, ratingAverage: number, reviewCount: number) => ({ goodId, ratingAverage, reviewCount, recentReviewAt: null,
      representative: { id: `review-${goodId}`, rating: 5, body: '실제 공개 후기 본문', authorName: '공개 닉네임', createdAt: '2026-09-20T00:00:00Z' } });
    const summaries = [{ count: 3, average: 4.33 }, { count: 3, average: 2.33 }, { count: 2, average: 4.5 }, { count: 3, average: 2.67 }, { count: 1, average: 4 }, { count: 2, average: 3 }];
    const cards = goods.slice(0, 6).map((good, index) => ({ ...good, id: `m${index}`, soldOut: false, reviewSummary: summaries[index] }));
    const reviewRankings = { ...emptyHomeProductRankings(), reviewsAvailable: true,
      reviewStatistics: [stat('m0', 4.33, 3), stat('m1', 5, 1), stat('m2', 4.5, 2), stat('m3', 2.67, 3), stat('m4', 4, 1), stat('m5', 3, 2)] };
    const rule = { mode: 'manual' as const, goodIds: ['m0', 'm1', 'm2', 'm3', 'm4'] };

    expect(selectHomeReviewGoods(rule, cards, reviewRankings).map((good) => good.id)).toEqual(['m0', 'm2', 'm4']);
    expect(buildHomeReviewBestBand('review', '리뷰 베스트', rule, cards, reviewRankings).goods).toEqual([]);
    /* 같은 기준으로 3점 이상인 굿즈가 하나 더 있으면 순서를 지켜 보인다(3.00 은 자격이 있다). */
    const band = buildHomeReviewBestBand('review', '리뷰 베스트', { mode: 'manual', goodIds: [...rule.goodIds, 'm5'] }, cards, reviewRankings);
    expect(band.goods.map((good) => good.id)).toEqual(['m0', 'm2', 'm4', 'm5']);
    expect(band.goods.map((good) => homeReviewBandRating(good).average)).toEqual([4.33, 4.5, 4, 3]);
    /* 어드민 상품 선택기가 고를 수 있는 상품도 같은 판정이다. */
    expect([...eligibleHomeReviewGoodIds(reviewRankings.reviewStatistics, cards)].sort()).toEqual(['m0', 'm2', 'm4', 'm5']);
    expect(homeReviewBandStatistics(reviewRankings.reviewStatistics, cards).find((row) => row.goodId === 'm1'))
      .toMatchObject({ ratingAverage: 2.33, reviewCount: 3, representative: { id: 'review-m1' } });
  });
});

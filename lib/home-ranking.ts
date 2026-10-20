import type { HomeBestTab, HomeGoodsCard } from '@/lib/home-catalog';

export const HOME_SALES_PERIODS = ['realtime', 'daily', 'weekly', 'monthly'] as const;
export type HomeSalesPeriod = typeof HOME_SALES_PERIODS[number];
export const HOME_SALES_PERIOD_LABELS: Record<HomeSalesPeriod, string> = {
  realtime: '실시간', daily: '일간', weekly: '주간', monthly: '월간',
};
export const HOME_SALES_GOODS_LIMIT = 4;
export const HOME_REVIEW_GOODS_MIN = 4;
export const HOME_REVIEW_AUTO_LIMIT = 6;
export const HOME_REVIEW_MANUAL_LIMIT = 20;
export const HOME_REVIEW_MIN_RATING = 3;

export interface HomeSalesRule { exposure: 'single' | 'all'; period: HomeSalesPeriod }
export type HomeReviewRule = { mode: 'rating' } | { mode: 'manual'; goodIds: string[] };
export interface HomeRepresentativeReview {
  id: string; rating: number; body: string; authorName: string; createdAt: string;
  eventDisclosure?: import('@/lib/review-events').ReviewEventDisclosure;
}
export interface HomeReviewStatistic {
  goodId: string; ratingAverage: number; reviewCount: number;
  recentReviewAt: string | null;
  representative: HomeRepresentativeReview;
}
export interface HomeProductRankings {
  sales: Record<HomeSalesPeriod, string[]>;
  reviewStatistics: HomeReviewStatistic[];
  salesAvailable: boolean;
  reviewsAvailable: boolean;
}
export interface HomeSalesBestBand {
  id: string; title: string; tabs: HomeBestTab[]; defaultTabId: string;
}
export interface HomeReviewGoodsCard extends HomeGoodsCard {
  ratingAverage: number; reviewCount: number;
  review: HomeRepresentativeReview;
}
export interface HomeReviewBestBand { id: string; title: string; goods: HomeReviewGoodsCard[] }

export function emptyHomeProductRankings(): HomeProductRankings {
  return { sales: { realtime: [], daily: [], weekly: [], monthly: [] }, reviewStatistics: [], salesAvailable: false, reviewsAvailable: false };
}

export function isHomeSalesPeriod(value: unknown): value is HomeSalesPeriod {
  return typeof value === 'string' && (HOME_SALES_PERIODS as readonly string[]).includes(value);
}

export function readHomeSalesRule(payload: Record<string, unknown> | null): HomeSalesRule | null {
  if (!payload || !isHomeSalesPeriod(payload.period)
    || (payload.exposure_mode !== 'single' && payload.exposure_mode !== 'all')
    || Object.keys(payload).some((key) => key !== 'period' && key !== 'exposure_mode')) return null;
  return { exposure: payload.exposure_mode, period: payload.period };
}

export function readHomeReviewRule(payload: Record<string, unknown> | null): HomeReviewRule | null {
  if (!payload) return null;
  if (payload.selection_mode === 'rating' && Object.keys(payload).length === 1) return { mode: 'rating' };
  if (payload.selection_mode !== 'manual' || !Array.isArray(payload.good_ids)
    || payload.good_ids.length > HOME_REVIEW_MANUAL_LIMIT
    || payload.good_ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
    || new Set(payload.good_ids).size !== payload.good_ids.length
    || Object.keys(payload).some((key) => key !== 'selection_mode' && key !== 'good_ids')) return null;
  return { mode: 'manual', goodIds: payload.good_ids };
}

/** Ranking IDs originate in the aggregate RPC; public catalog cards remain the final eligibility boundary. */
export function buildHomeSalesBestBand(
  id: string, title: string, rule: HomeSalesRule, goods: readonly HomeGoodsCard[], rankings: HomeProductRankings,
): HomeSalesBestBand {
  const byId = new Map(goods.map((good) => [good.id, good]));
  const periods = rule.exposure === 'all' ? HOME_SALES_PERIODS : [rule.period];
  return {
    id, title, defaultTabId: `${id}-${rule.period}`,
    tabs: periods.map((period) => ({
      id: `${id}-${period}`, label: HOME_SALES_PERIOD_LABELS[period],
      goods: rankings.salesAvailable ? [...new Set(rankings.sales[period])].flatMap((goodId) => {
        const good = byId.get(goodId);
        return good ? [good] : [];
      }).slice(0, HOME_SALES_GOODS_LIMIT) : [],
    })),
  };
}

export function eligibleHomeReviewStatistics(statistics: readonly HomeReviewStatistic[]) {
  return statistics.filter((row) => Number.isFinite(row.ratingAverage)
    && row.ratingAverage >= HOME_REVIEW_MIN_RATING && row.ratingAverage <= 5
    && Number.isSafeInteger(row.reviewCount) && row.reviewCount > 0
    && row.representative && row.representative.rating >= 1 && row.representative.rating <= 5
    && Number.isFinite(Date.parse(row.representative.createdAt)));
}

/** A hidden/deleted review or unpublished product can bring an existing selection below four. */
export function selectHomeReviewGoods(
  rule: HomeReviewRule, goods: readonly HomeGoodsCard[], rankings: HomeProductRankings,
): HomeReviewGoodsCard[] {
  if (!rankings.reviewsAvailable) return [];
  const byId = new Map(goods.map((good) => [good.id, good]));
  const statistics = eligibleHomeReviewStatistics(rankings.reviewStatistics);
  const byGoodId = new Map(statistics.map((row) => [row.goodId, row]));
  const ids = rule.mode === 'manual' ? rule.goodIds : [...statistics]
    .filter((row) => byId.has(row.goodId) && row.recentReviewAt && Number.isFinite(Date.parse(row.recentReviewAt)))
    .sort((a, b) => b.ratingAverage - a.ratingAverage
      || Date.parse(b.recentReviewAt!) - Date.parse(a.recentReviewAt!) || a.goodId.localeCompare(b.goodId, 'en'))
    .slice(0, HOME_REVIEW_AUTO_LIMIT).map((row) => row.goodId);
  return [...new Set(ids)].flatMap((goodId) => {
    const good = byId.get(goodId);
    const statistic = byGoodId.get(goodId);
    return good && statistic ? [{ ...good, ratingAverage: statistic.ratingAverage, reviewCount: statistic.reviewCount, review: statistic.representative }] : [];
  }).slice(0, rule.mode === 'manual' ? HOME_REVIEW_MANUAL_LIMIT : HOME_REVIEW_AUTO_LIMIT);
}

export function buildHomeReviewBestBand(
  id: string, title: string, rule: HomeReviewRule, goods: readonly HomeGoodsCard[], rankings: HomeProductRankings,
): HomeReviewBestBand {
  const selected = selectHomeReviewGoods(rule, goods, rankings);
  return { id, title, goods: selected.length >= HOME_REVIEW_GOODS_MIN ? selected : [] };
}

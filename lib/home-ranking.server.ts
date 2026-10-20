import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { loadReviewEventDisclosures } from '@/lib/review-events.server';
import { emptyHomeProductRankings, HOME_SALES_PERIODS, type HomeProductRankings, type HomeReviewStatistic } from '@/lib/home-ranking';

/** Cached only within this render request. Visibility and ratings must not survive moderation changes in a shared cache. */
const loadRankings = cache(async (serializedGoodIds: string): Promise<HomeProductRankings> => {
  const result = emptyHomeProductRankings();
  if (!getSupabaseConfig().isConfigured) return result;
  const goodIds = JSON.parse(serializedGoodIds) as string[];
  const eligibleIds = new Set(goodIds);
  const client = await createClient();
  const chunks: string[][] = [];
  for (let index = 0; index < goodIds.length; index += 200) chunks.push(goodIds.slice(index, index + 200));
  const [sales, reviews] = await Promise.all([
    client.rpc('get_home_sales_rankings'),
    Promise.all(chunks.map((ids) => client.rpc('get_home_review_candidates', { p_good_ids: ids }))),
  ]);
  if (!sales.error && sales.data && typeof sales.data === 'object' && !Array.isArray(sales.data)) {
    result.salesAvailable = HOME_SALES_PERIODS.every((period) => Array.isArray(sales.data[period]));
    if (result.salesAvailable) for (const period of HOME_SALES_PERIODS) {
      result.sales[period] = [...new Set((sales.data[period] as unknown[]).filter(
        (id): id is string => typeof id === 'string' && eligibleIds.has(id),
      ))].slice(0, 4);
    }
  }
  result.reviewsAvailable = reviews.every((review) => !review.error && Array.isArray(review.data));
  if (result.reviewsAvailable) result.reviewStatistics = reviews.flatMap((review) => (
    (review.data ?? []) as { goodId: unknown; ratingAverage: unknown; reviewCount: unknown; recentReviewAt: unknown; representative: unknown }[]
  )).flatMap((row): HomeReviewStatistic[] => {
    const ratingAverage = Number(row.ratingAverage);
    const reviewCount = Number(row.reviewCount);
    const review = row.representative && typeof row.representative === 'object' ? row.representative as Record<string, unknown> : null;
    return typeof row.goodId === 'string' && eligibleIds.has(row.goodId)
      && Number.isFinite(ratingAverage) && ratingAverage >= 1 && ratingAverage <= 5
      && Number.isSafeInteger(reviewCount) && reviewCount > 0
      && review && typeof review.id === 'string' && typeof review.rating === 'number' && Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5
      && typeof review.body === 'string' && typeof review.authorName === 'string' && typeof review.createdAt === 'string' && Number.isFinite(Date.parse(review.createdAt))
      ? [{ goodId: row.goodId, ratingAverage, reviewCount,
        recentReviewAt: typeof row.recentReviewAt === 'string' && Number.isFinite(Date.parse(row.recentReviewAt)) ? row.recentReviewAt : null,
        representative: { id: review.id, rating: review.rating, body: review.body, authorName: review.authorName, createdAt: review.createdAt },
      }] : [];
  });
  const disclosureChunks = [];
  for (let index = 0; index < result.reviewStatistics.length; index += 500) disclosureChunks.push(result.reviewStatistics.slice(index, index + 500).map(row => row.representative.id));
  const disclosures = new Map((await Promise.all(disclosureChunks.map(loadReviewEventDisclosures))).flatMap(map => [...map]));
  result.reviewStatistics = result.reviewStatistics.map(row => ({ ...row, representative: { ...row.representative, eventDisclosure: disclosures.get(row.representative.id) } }));
  return result;
});

export function loadHomeProductRankings(goods: readonly { id: string }[]) {
  return loadRankings(JSON.stringify([...new Set(goods.map((good) => good.id))].sort()));
}

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getAdminReviewInsights } from './review-insights.server';
import type { ReviewInsightFilters } from './review-insights';
import { parseReviewRatingHistory, type ReviewRatingHistoryResult } from './review-rating-history';

/** A failed history read never discards the live summary or product results. */
export async function getAdminReviewInsightsWithHistory(filters: ReviewInsightFilters) {
  let data = await getAdminReviewInsights(filters);
  let history: ReviewRatingHistoryResult = { kind: 'error' };
  try {
    const client = await createClient();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await client.rpc('admin_review_rating_comparison', { p_as_of: data.asOf });
      if (result.error?.code === 'PT409' && result.error.message === 'review_rating_date_changed' && attempt === 0) {
        data = await getAdminReviewInsights(filters);
        continue;
      }
      const parsed = result.error ? null : parseReviewRatingHistory(result.data, data.asOf);
      if (parsed) history = { kind: 'ready', data: parsed };
      break;
    }
  } catch { /* Keep the successful live response, including on retry failure. */ }
  return { data, history };
}

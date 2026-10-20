import { ReviewInsightsScreen } from '@/components/admin/screens/ReviewInsightsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeReviewInsightFilters, REVIEW_INSIGHTS_PATH } from '@/lib/admin/review-insights';
import { getAdminReviewInsightsWithHistory } from '@/lib/admin/review-rating-history.server';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  await requireAdminScreenAccess(REVIEW_INSIGHTS_PATH);
  const filters=normalizeReviewInsightFilters(await searchParams);
  const { data, history } = await getAdminReviewInsightsWithHistory(filters);
  return <ReviewInsightsScreen data={data} history={history} filters={filters}/>;
}

import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminReviewEvents } from '@/lib/admin/review-events.server';
import { normalizeReviewEventFilters, REVIEW_EVENTS_ADMIN_PATH } from '@/lib/review-events';
import { ReviewEventListScreen } from '@/components/admin/screens/ReviewEventListScreen';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(REVIEW_EVENTS_ADMIN_PATH);
  return <ReviewEventListScreen data={await loadAdminReviewEvents(normalizeReviewEventFilters(await searchParams))} />;
}

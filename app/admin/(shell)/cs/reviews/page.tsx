import { ReviewConsoleScreen } from '@/components/admin/screens/ReviewConsoleScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminReviewFilters } from '@/lib/admin/reviews';
import { getAdminReviewConsoleData } from '@/lib/admin/reviews.server';

export default async function AdminCsReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 리뷰 조회를 막지 못한다.
   */
  await requireAdminScreenAccess('/admin/cs/reviews');
  const query = await searchParams;

  const data = await getAdminReviewConsoleData(normalizeAdminReviewFilters(query));

  return <ReviewConsoleScreen data={data} />;
}

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
  const auth=await requireAdminScreenAccess('/admin/cs/reviews');
  const query = await searchParams;

  const data = await getAdminReviewConsoleData(normalizeAdminReviewFilters(query));

  /* 뒤집힌 기간은 정규화가 조건을 버린다. 오류 없이 전체 기간이 나오면 운영자는 조회가 맞다고 읽는다. */
  const dateRangeInvalid = typeof query.from === 'string' && typeof query.to === 'string' && query.from !== '' && query.to !== '' && query.from > query.to;

  return <ReviewConsoleScreen data={data} accountId={auth.user.id} initialDetail={typeof query.detail==='string'?query.detail:null} dateRangeInvalid={dateRangeInvalid} />;
}

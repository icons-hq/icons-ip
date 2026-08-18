import { notFound } from 'next/navigation';
import { ClaimQueueScreen } from '@/components/admin/screens/ClaimQueueScreen';
import { adminClaimBasePath, normalizeAdminClaimFilters } from '@/lib/admin/claims';
import { getAdminClaimConsoleData } from '@/lib/admin/claims.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { orderClaimTypeForSlug } from '@/lib/orders/claims';

/*
 * 취소·반품·교환 3화면(#252).
 *
 * 라우트는 하나지만 사이드바 항목은 셋이다 — `adminClaimBasePath`가 만드는 경로가
 * `lib/admin/navigation.ts`의 href와 글자 그대로 같아야 게이트가 그 화면을 찾는다.
 * 모르는 세그먼트는 404다. 게이트에 임의 문자열을 넘기면 화면을 못 찾아 조용히
 * 통과할 수 있다.
 */
export default async function AdminSalesClaimsPage({
  params,
  searchParams,
}: PageProps<'/admin/sales/claims/[claimType]'>) {
  const { claimType: slug } = await params;
  const claimType = orderClaimTypeForSlug(slug);
  if (!claimType) notFound();

  /* 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
     layout과 page를 병렬로 렌더하므로 layout의 redirect가 클레임 조회를 막지 못한다. */
  await requireAdminScreenAccess(adminClaimBasePath(claimType));
  const query = await searchParams;

  const data = await getAdminClaimConsoleData(
    claimType,
    normalizeAdminClaimFilters(query),
  );

  return <ClaimQueueScreen data={data} />;
}

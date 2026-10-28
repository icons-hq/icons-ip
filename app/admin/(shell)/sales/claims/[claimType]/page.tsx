import { notFound, redirect } from 'next/navigation';
import { ClaimDetailScreen } from '@/components/admin/screens/ClaimDetailScreen';
import { ClaimPreviewDialog } from '@/components/admin/screens/ClaimPreviewDialog';
import { ClaimQueueScreen } from '@/components/admin/screens/ClaimQueueScreen';
import {
  adminClaimBasePath,
  adminClaimDetailHref,
  adminClaimHref,
  adminClaimPreviewHref,
  adminClaimPreviewId,
  normalizeAdminClaimFilters,
} from '@/lib/admin/claims';
import { getAdminClaimConsoleData } from '@/lib/admin/claims.server';
import { loadAdminClaimWorkspace } from '@/lib/admin/claim-preview.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ORDER_CLAIM_TYPE_LABELS, orderClaimReferenceLabel, orderClaimTypeForSlug } from '@/lib/orders/claims';
import { canAccessAdminScreen } from '@/lib/admin/access';
import { adminScreenForPath } from '@/lib/admin/navigation';
import { REFUND_TRANSFERS_PATH } from '@/lib/admin/refund-transfers';

/*
 * 취소·반품·교환 3화면(#252).
 *
 * 라우트는 하나지만 사이드바 항목은 셋이다 — `adminClaimBasePath`가 만드는 경로가
 * `lib/admin/navigation.ts`의 href와 글자 그대로 같아야 게이트가 그 화면을 찾는다.
 * 모르는 세그먼트는 404다. 게이트에 임의 문자열을 넘기면 화면을 못 찾아 조용히
 * 통과할 수 있다.
 *
 * 요청번호를 누르면 `?claimId=`로 같은 목록 위에 상세 팝업이 열린다(R8). 팝업 안의 처리와
 * 목록 일괄 처리는 결제사 취소(사전 조회·취소·사후 조회 각 8초 + DB)를 바로 발행하므로
 * 상세 라우트와 같은 함수 예산을 이 목록 라우트에도 둔다.
 */
export const maxDuration = 60;

export default async function AdminSalesClaimsPage({
  params,
  searchParams,
}: PageProps<'/admin/sales/claims/[claimType]'>) {
  const { claimType: slug } = await params;
  const claimType = orderClaimTypeForSlug(slug);
  if (!claimType) notFound();

  /* 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
     layout과 page를 병렬로 렌더하므로 layout의 redirect가 클레임 조회를 막지 못한다. */
  const auth = await requireAdminScreenAccess(adminClaimBasePath(claimType));
  const query = await searchParams;
  const filters = normalizeAdminClaimFilters(query, claimType);
  const previewId = adminClaimPreviewId(query.claimId);

  const [data, workspace] = await Promise.all([
    getAdminClaimConsoleData(claimType, filters),
    previewId ? loadAdminClaimWorkspace(previewId) : Promise.resolve(null),
  ]);
  /* 유형이 바뀐 요청(반품↔교환 전환)은 그 유형의 목록 위에서 연다. */
  if (previewId && workspace && workspace.detail.claim.claimType !== claimType) {
    redirect(adminClaimPreviewHref(workspace.detail.claim.claimType, previewId));
  }

  const closeHref = adminClaimHref(claimType, filters);
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claimType];

  return <>
    <ClaimQueueScreen data={data} canViewRefundTransfers={canAccessAdminScreen(auth, adminScreenForPath(REFUND_TRANSFERS_PATH))} />
    {previewId ? (
      <ClaimPreviewDialog
        closeHref={closeHref}
        key={previewId}
        title={workspace
          ? `${typeLabel} ${orderClaimReferenceLabel(workspace.detail.claim.reference)} 상세 · 처리`
          : `${typeLabel} 요청 상세`}
      >
        {workspace ? (
          <ClaimDetailScreen
            actorId={auth.user.id}
            backHref={closeHref}
            cancellationForm={workspace.cancellationForm}
            carriers={workspace.carriers}
            detail={workspace.detail}
            detailHref={adminClaimDetailHref(claimType, previewId, filters)}
            embedded
          />
        ) : (
          <p role="alert">요청을 찾을 수 없습니다. 처리됐거나 접근 권한이 바뀌었을 수 있습니다. 목록을 새로고침해주세요.</p>
        )}
      </ClaimPreviewDialog>
    ) : null}
  </>;
}

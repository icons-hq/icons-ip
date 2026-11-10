import { notFound, redirect } from 'next/navigation';
import { ClaimDetailScreen } from '@/components/admin/screens/ClaimDetailScreen';
import {
  adminClaimBackHref,
  adminClaimBasePath,
} from '@/lib/admin/claims';
import { loadAdminClaimWorkspace } from '@/lib/admin/claim-preview.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { orderClaimTypeForSlug } from '@/lib/orders/claims';

/* 이 화면의 서버 액션은 결제사 취소를 바로 발행하고 결과를 조회로 확인한다
   (사전 조회·취소·사후 조회 각 8초 + DB). 페이지 단위 maxDuration이 액션 예산이다. */
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function AdminSalesClaimDetailPage({
  params,
  searchParams,
}: PageProps<'/admin/sales/claims/[claimType]/[claimId]'>) {
  const { claimId: rawClaimId, claimType: slug } = await params;
  const claimType = orderClaimTypeForSlug(slug);
  if (!claimType) notFound();

  const access = await requireAdminScreenAccess(adminClaimBasePath(claimType));

  const claimId = rawClaimId.toLowerCase();
  if (!UUID_PATTERN.test(claimId)) notFound();

  const query = await searchParams;
  /* 목록 위 팝업(?claimId=)과 같은 로더다(R8). */
  const workspace = await loadAdminClaimWorkspace(claimId);
  if (!workspace) notFound();
  const { cancellationForm, carriers, detail } = workspace;
  /* 유형 전환 전의 링크도 현재 요청의 큐로 연결한다. */
  if (detail.claim.claimType !== claimType) redirect(`${adminClaimBasePath(detail.claim.claimType)}/${claimId}`);

  return (
    <ClaimDetailScreen
      actorId={access.user.id}
      backHref={adminClaimBackHref(claimType, query.back)}
      cancellationForm={cancellationForm}
      carriers={carriers}
      detail={detail}
    />
  );
}

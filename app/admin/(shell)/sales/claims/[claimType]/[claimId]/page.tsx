import { notFound } from 'next/navigation';
import { ClaimDetailScreen } from '@/components/admin/screens/ClaimDetailScreen';
import {
  adminClaimBackHref,
  adminClaimBasePath,
} from '@/lib/admin/claims';
import { loadAdminClaimDetail } from '@/lib/admin/claims.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { BUSINESS_INFO } from '@/lib/legal/business-info';
import { orderReferenceLabel } from '@/lib/orders';
import {
  buildKorpayCancellationForm,
  orderClaimTypeForSlug,
} from '@/lib/orders/claims';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function AdminSalesClaimDetailPage({
  params,
  searchParams,
}: PageProps<'/admin/sales/claims/[claimType]/[claimId]'>) {
  const { claimId: rawClaimId, claimType: slug } = await params;
  const claimType = orderClaimTypeForSlug(slug);
  if (!claimType) notFound();

  await requireAdminScreenAccess(adminClaimBasePath(claimType));

  const claimId = rawClaimId.toLowerCase();
  if (!UUID_PATTERN.test(claimId)) notFound();

  const query = await searchParams;
  const [detail, carriers] = await Promise.all([
    loadAdminClaimDetail(claimId),
    getShippingCarrierRegistry(),
  ]);
  if (!detail) notFound();
  /* 목록 세그먼트와 실제 클레임 유형이 다르면 뒤로가기와 액션이 엉뚱한 큐를
     가리킨다. 유형이 맞는 화면에서만 연다. */
  if (detail.claim.claimType !== claimType) notFound();

  /* 코페이 취소 접수는 API가 아니라 이메일이다(#208). 결제가 코페이일 때만
     양식을 만든다 — 상호명이 비어 있으면 지어내지 않고 "확인 필요"로 남긴다. */
  const cancellationForm = detail.payment?.provider === 'korpay' && detail.order
    ? buildKorpayCancellationForm({
      amount: detail.payment.amount,
      merchantName: BUSINESS_INFO.companyName.trim() || '확인 필요',
      orderId: detail.order.id,
      orderReference: orderReferenceLabel(detail.order.id),
      paidAt: detail.payment.createdAt,
      reason: detail.claim.reason,
    })
    : null;

  return (
    <ClaimDetailScreen
      backHref={adminClaimBackHref(claimType, query.back)}
      cancellationForm={cancellationForm}
      carriers={carriers}
      detail={detail}
    />
  );
}

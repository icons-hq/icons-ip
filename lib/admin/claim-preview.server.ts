import 'server-only';

import { loadAdminClaimDetail } from '@/lib/admin/claims.server';
import { getBusinessInfo } from '@/lib/legal/business-info.server';
import { orderReferenceLabel } from '@/lib/orders';
import { buildKorpayCancellationForm } from '@/lib/orders/claims';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';

/**
 * 클레임 상세 화면 한 벌을 그리는 데 필요한 것(R8).
 *
 * 독립 상세 라우트와 목록 위 팝업(`?claimId=`)이 같은 로더를 쓴다 — 둘 중 한쪽만 고치면
 * 팝업에서 보이는 처리 패널과 상세 화면의 처리 패널이 갈라진다.
 *
 * 코페이 취소 접수는 API가 아니라 이메일이다(#208). 결제가 코페이일 때만 양식을 만든다 —
 * 상호명이 비어 있으면 지어내지 않고 "확인 필요"로 남긴다.
 */
export async function loadAdminClaimWorkspace(claimId: string) {
  const [detail, carriers] = await Promise.all([
    loadAdminClaimDetail(claimId),
    getShippingCarrierRegistry(),
  ]);
  if (!detail) return null;

  const cancellationForm = detail.payment?.provider === 'korpay' && detail.order
    ? buildKorpayCancellationForm({
      amount: detail.payment.amount,
      merchantName: (await getBusinessInfo()).companyName.trim() || '확인 필요',
      orderId: detail.order.id,
      orderReference: orderReferenceLabel(detail.order.id, detail.order.orderNumber),
      paidAt: detail.payment.createdAt,
      reason: detail.claim.reason,
    })
    : null;

  return { detail, carriers, cancellationForm };
}

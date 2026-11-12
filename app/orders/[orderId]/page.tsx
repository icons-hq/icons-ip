import { loadMyOrderDownloads } from '@/lib/order-downloads.server';
import { loadMyOrderProduction } from '@/lib/order-production.server';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { OrderDetail } from '@/components/screens/OrderDetail';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { loadOrderRetrySources, loadPendingCardPaymentReading } from '@/lib/checkout.server';
import { loadOrderDetail } from '@/lib/orders.server';
import { loadOrderReviewTargets } from '@/lib/reviews.server';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { loadMyOrderClaimTypeHistory } from '@/lib/orders/claim-type-conversion.server';
import { loadMyOrderClaimReasonHistory } from '@/lib/orders/claim-reason-change.server';
import { loadMyOrderRefundDeduction, loadReturnFeeDeductionPolicy } from '@/lib/claims/return-fee-deduction.server';

export const metadata: Metadata = {
  title: '주문 상세 — ICONS',
  description: '주문한 굿즈, 배송지, 결제와 카드팩 발급 내역을 확인하세요.',
};

export default async function Page({ params }: PageProps<'/orders/[orderId]'>) {
  const { orderId: rawOrderId } = await params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) notFound();

  const auth = await getCurrentAuthState();
  const next = `/orders/${orderId}`;
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  /* 리뷰 대상은 배송완료 이상 주문에서만 행이 돌아온다(#254). 그 판정을 화면이
     다시 하지 않도록 RPC 결과를 그대로 넘긴다. */
  const [order, cardRewardsEnabled, reviewTargets, claimTypeHistory, claimReasonHistory, production, downloads, refundDeduction, returnFeePolicy] = await Promise.all([
    loadOrderDetail(auth.user.id, orderId),
    readCardRewardsEnabled(),
    loadOrderReviewTargets(orderId),
    loadMyOrderClaimTypeHistory(orderId),
    loadMyOrderClaimReasonHistory(orderId),
    loadMyOrderProduction(orderId),
    loadMyOrderDownloads(orderId),
    loadMyOrderRefundDeduction(orderId),
    loadReturnFeeDeductionPolicy(),
  ]);
  if (!order) notFound();

  /* 결제 없이 닫힌 장바구니·바로구매 카드 주문은 여기서 다시 결제한다(QA1 S-D2-15). 출처는 보류 원장에서 읽는다. */
  const retry = order.paymentMethod === 'card' && order.status === 'canceled' && !order.giftId
    ? (await loadOrderRetrySources(auth.user.id, [order.id])).get(order.id.toLowerCase()) ?? null
    : null;

  /* 결제 대기 카드 주문만 결제 시도 원장을 더 읽어 결제 화면과 같은 결제 국면으로 안내한다. */
  const cardPayment = await loadPendingCardPaymentReading(auth.user.id, {
    id: order.id,
    status: order.status,
    paymentMethod: order.paymentMethod,
    expiresAt: order.expiresAt,
    ledgerPaymentStatus: order.payment?.status ?? null,
    cancellationRequestStatus: order.cancellationRequest?.status ?? null,
  });

  return (
    <OrderDetail
      viewerId={auth.user.id}
      cardPayment={cardPayment}
      cardRewardsEnabled={cardRewardsEnabled}
      order={order}
      production={production}
      downloads={downloads}
      reviewTargets={reviewTargets}
      claimTypeHistory={claimTypeHistory}
      claimReasonHistory={claimReasonHistory}
      retry={retry}
      refundDeduction={refundDeduction}
      returnFeePolicy={returnFeePolicy}
    />
  );
}

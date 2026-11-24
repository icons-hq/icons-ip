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
import { loadMyOrderClaimTypeHistory } from '@/lib/orders/claim-type-conversion.server';
import { loadMyOrderClaimReasonHistory } from '@/lib/orders/claim-reason-change.server';
import { loadMyOrderRefundDeduction, loadReturnFeeDeductionPolicy } from '@/lib/claims/return-fee-deduction.server';
import { loadMyOrderReturnPickup } from '@/lib/orders/return-pickup.server';
import { loadMyOrderPartialCancellations } from '@/lib/orders/partial-cancellation.server';
import { loadMyOrderClaimItems, loadMyOrderPartialReturnContext } from '@/lib/orders/partial-return.server';
import { loadOrdererInfo } from '@/lib/orders/orderer.server';
import { loadMyOrderPaymentDisplay } from '@/lib/orders/payment-display.server';
import { loadMyOrderVirtualAccount } from '@/lib/payments/virtual-account.server';
import { ORDER_RECEIPT_NOTICE_PARAM, ORDER_RECEIPT_NOTICE_UNAVAILABLE } from '@/lib/orders/receipt';

export const metadata: Metadata = {
  title: '주문 상세 — 엑스스퀘어',
  description: '주문한 굿즈, 배송지, 결제 내역을 확인하세요.',
};

export default async function Page({ params, searchParams }: PageProps<'/orders/[orderId]'>) {
  const { orderId: rawOrderId } = await params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) notFound();
  /* 결제 영수증 경로(`/orders/[id]/receipt`)가 결제사 영수증을 못 찾으면 `?receipt=unavailable`로 돌려보낸다(MD-0038). */
  const receiptNotice = (await searchParams)[ORDER_RECEIPT_NOTICE_PARAM] === ORDER_RECEIPT_NOTICE_UNAVAILABLE;

  const auth = await getCurrentAuthState();
  const next = `/orders/${orderId}`;
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  /* 리뷰 대상은 배송완료 이상 주문에서만 행이 돌아온다(#254). 그 판정을 화면이
     다시 하지 않도록 RPC 결과를 그대로 넘긴다. */
  const [order, reviewTargets, claimTypeHistory, claimReasonHistory, production, downloads, refundDeduction, returnFeePolicy, returnPickup, partialCancellations, orderer, paymentDisplay, partialReturn, claimItems, virtualAccount] = await Promise.all([
    loadOrderDetail(auth.user.id, orderId),
    loadOrderReviewTargets(orderId),
    loadMyOrderClaimTypeHistory(orderId),
    loadMyOrderClaimReasonHistory(orderId),
    loadMyOrderProduction(orderId),
    loadMyOrderDownloads(orderId),
    loadMyOrderRefundDeduction(orderId),
    loadReturnFeeDeductionPolicy(),
    loadMyOrderReturnPickup(orderId),
    loadMyOrderPartialCancellations(orderId),
    /* 주문자 정보(MD-0037)와 결제수단 표시는 보강이다 — 읽지 못해도 주문 상세는 열리고 해당 칸만 비거나 대체 라벨이 된다. */
    loadOrdererInfo(auth),
    loadMyOrderPaymentDisplay(orderId),
    /* 부분 반품(ADR-0047): 스위치가 꺼져 있거나 읽지 못하면 반품 폼은 주문 전체만 받는다. */
    loadMyOrderPartialReturnContext(orderId),
    loadMyOrderClaimItems(orderId),
    /* 토스 가상계좌 입금 오류 되돌림(ADR-0049 결정 4)의 재입금 안내 — 본인 주문만 값이 있고, 읽지 못하면 안내만 빠진다. */
    loadMyOrderVirtualAccount(orderId),
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
      order={order}
      production={production}
      downloads={downloads}
      reviewTargets={reviewTargets}
      claimTypeHistory={claimTypeHistory}
      claimReasonHistory={claimReasonHistory}
      retry={retry}
      refundDeduction={refundDeduction}
      returnFeePolicy={returnFeePolicy}
      returnPickup={returnPickup}
      partialCancellations={partialCancellations}
      partialReturn={partialReturn}
      claimItems={claimItems}
      orderer={orderer}
      paymentDisplay={paymentDisplay}
      receiptNotice={receiptNotice}
      virtualAccount={virtualAccount}
    />
  );
}

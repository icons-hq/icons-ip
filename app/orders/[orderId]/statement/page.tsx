import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { OrderStatement } from '@/components/orders/OrderStatement';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { getBusinessInfo } from '@/lib/legal/business-info.server';
import { loadOrderDetail } from '@/lib/orders.server';
import { loadOrdererInfo } from '@/lib/orders/orderer.server';
import { loadMyOrderPartialCancellations } from '@/lib/orders/partial-cancellation.server';
import { orderPaymentMethodLabel } from '@/lib/orders/payment-display';
import { loadMyOrderPaymentDisplay } from '@/lib/orders/payment-display.server';
import { buildOrderStatement, statementUnavailableMessage } from '@/lib/orders/statement';

/* 거래명세서는 주문자 개인정보(이름·이메일)와 사업자 정보를 담은 개인 문서라 색인하지 않는다. */
export const metadata: Metadata = {
  title: '거래명세서 — 엑스스퀘어',
  description: '주문 한 건의 거래 내용을 확인하고 인쇄할 수 있어요.',
  robots: { index: false, follow: false },
};

export default async function Page({ params }: PageProps<'/orders/[orderId]/statement'>) {
  const { orderId: rawOrderId } = await params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) notFound();

  const auth = await getCurrentAuthState();
  const next = `/orders/${orderId}/statement`;
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const [order, partialCancellations, business, orderer, paymentDisplay] = await Promise.all([
    loadOrderDetail(auth.user.id, orderId),
    loadMyOrderPartialCancellations(orderId),
    getBusinessInfo(),
    loadOrdererInfo(auth),
    loadMyOrderPaymentDisplay(orderId),
  ]);
  /* 본인 주문이 아니거나 없는 주문은 존재를 알리지 않는다. */
  if (!order) notFound();

  const unavailableMessage = statementUnavailableMessage(order.status);
  if (unavailableMessage) return <OrderStatement orderId={order.id} model={null} unavailableMessage={unavailableMessage} />;

  const model = buildOrderStatement({
    order,
    partialCancellations,
    business,
    orderer,
    paymentLabel: orderPaymentMethodLabel(order.paymentMethod, paymentDisplay),
    issuedAt: new Date(),
  });
  return <OrderStatement orderId={order.id} model={model} />;
}

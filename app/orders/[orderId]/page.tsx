import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { OrderDetail } from '@/components/screens/OrderDetail';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { loadOrderDetail } from '@/lib/orders.server';
import { loadOrderReviewTargets } from '@/lib/reviews.server';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';

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
  const [order, cardRewardsEnabled, reviewTargets] = await Promise.all([
    loadOrderDetail(auth.user.id, orderId),
    readCardRewardsEnabled(),
    loadOrderReviewTargets(orderId),
  ]);
  if (!order) notFound();

  return (
    <OrderDetail
      cardRewardsEnabled={cardRewardsEnabled}
      order={order}
      reviewTargets={reviewTargets}
    />
  );
}

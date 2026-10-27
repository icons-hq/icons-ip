import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { OrderComplete, orderCompleteDestination } from '@/components/screens/OrderComplete';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { loadCheckoutOrder } from '@/lib/checkout.server';
import { getBankTransferAccount } from '@/lib/payments/bank-transfer.server';
import { orderCompleteHref } from '@/lib/routes';

export const metadata: Metadata = {
  title: '주문 완료 — ICONS',
  description: '주문번호와 주문한 굿즈, 최종 결제 금액을 확인하세요.',
};

/*
 * 주문 완료 화면(D12 · S18). 결제 승인 콜백과 무통장 접수가 여기로 보낸다. 본인 주문만 읽고,
 * 결제가 끝나지 않은 카드 주문·취소된 주문은 주문 상세로, 선물 주문은 선물함으로 보낸다
 * (판정은 orderCompleteDestination).
 */
export default async function Page({ params }: PageProps<'/orders/[orderId]/complete'>) {
  const { orderId: rawOrderId } = await params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) notFound();

  const auth = await getCurrentAuthState();
  const next = orderCompleteHref(orderId);
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const order = await loadCheckoutOrder(auth.user.id, orderId);
  if (!order) notFound();

  const destination = orderCompleteDestination(order);
  if (destination.kind === 'redirect') redirect(destination.href);

  return (
    <OrderComplete
      order={order}
      bankTransferAccount={destination.kind === 'deposit' ? await getBankTransferAccount() : null}
    />
  );
}

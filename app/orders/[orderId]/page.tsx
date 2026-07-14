import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { OrderDetail } from '@/components/screens/OrderDetail';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { loadOrderDetail } from '@/lib/orders.server';

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

  const order = await loadOrderDetail(auth.user.id, orderId);
  if (!order) notFound();

  return <OrderDetail order={order} />;
}

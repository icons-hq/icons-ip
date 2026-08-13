import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CheckoutOrder } from '@/components/screens/CheckoutOrder';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { loadCheckoutOrder } from '@/lib/checkout.server';

export const metadata: Metadata = {
  title: '주문 결제 — ICONS',
  description: 'ICONS 주문 결제 상태를 확인하세요.',
};

export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId: rawOrderId } = await params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) notFound();

  const auth = await getCurrentAuthState();
  const next = `/checkout/${orderId}`;
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  const order = await loadCheckoutOrder(auth.user.id, orderId);
  if (!order) notFound();

  return <CheckoutOrder order={order} />;
}

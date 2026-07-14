import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CheckoutOrder } from '@/components/screens/CheckoutOrder';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { loadCheckoutOrder } from '@/lib/checkout.server';
import { checkoutPaymentsEnabled } from '@/lib/payments/checkout-availability';

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

  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  const configured = checkoutPaymentsEnabled();

  return (
    <CheckoutOrder
      clientKey={configured ? clientKey ?? null : null}
      customer={{
        id: auth.user.id,
        email: auth.profile?.email ?? auth.user.email,
        name: auth.profile?.nickname ?? 'ICONS 팬',
      }}
      order={order}
    />
  );
}

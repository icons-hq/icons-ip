import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Checkout } from '@/components/screens/Checkout';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadLatestCheckoutAddress, loadLatestPendingCheckoutOrderId } from '@/lib/checkout.server';
import { checkoutPaymentsEnabled } from '@/lib/payments/checkout-availability';

export const metadata: Metadata = {
  title: '체크아웃 — ICONS',
  description: '배송지와 주문 내용을 확인하고 결제를 준비하세요.',
};

export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/checkout')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/checkout'));

  const [catalog, latestAddress, resumeOrderId] = await Promise.all([
    getCatalogSnapshot(),
    loadLatestCheckoutAddress(auth.user.id),
    loadLatestPendingCheckoutOrderId(auth.user.id),
  ]);

  return (
    <Checkout
      catalog={{ goods: catalog.goods, ips: catalog.ips }}
      latestAddress={latestAddress}
      resumeOrderId={resumeOrderId}
      paymentAvailable={checkoutPaymentsEnabled(auth.user.id)}
    />
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Checkout } from '@/components/screens/Checkout';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadLatestCheckoutAddress, loadLatestPendingCheckoutOrderId } from '@/lib/checkout.server';
import { loadCartCouponState } from '@/lib/coupons.server';
import { bankTransferCheckoutEnabled } from '@/lib/payments/bank-transfer.server';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';

export const metadata: Metadata = {
  title: '체크아웃 — ICONS',
  description: '배송지와 주문 내용을 확인하고 결제를 준비하세요.',
};

export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/checkout')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/checkout'));

  const [catalog, latestAddress, resumeOrderId, couponState] = await Promise.all([
    getCatalogSnapshot(),
    loadLatestCheckoutAddress(auth.user.id),
    loadLatestPendingCheckoutOrderId(auth.user.id),
    loadCartCouponState(),
  ]);

  /* 확정은 place_order 가 한다 — 주문서는 카트에 적용해 둔 선택을 미리 보여줄 뿐이다. */
  const appliedCoupon = couponState.coupons.find(
    (held) => held.id === couponState.selectedUserCouponId,
  ) ?? null;

  return (
    <Checkout
      catalog={{ goods: catalog.goods, ips: catalog.ips }}
      latestAddress={latestAddress}
      resumeOrderId={resumeOrderId}
      paymentAvailable={goodsCheckoutPaymentsEnabled(auth.user.id)}
      bankTransferAvailable={bankTransferCheckoutEnabled()}
      appliedCoupon={appliedCoupon}
    />
  );
}

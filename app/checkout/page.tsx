import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Checkout } from '@/components/screens/Checkout';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadCartGoodIds } from '@/lib/cart.server';
import { loadLatestCheckoutAddress, loadLatestPendingCheckoutOrderId } from '@/lib/checkout.server';
import { loadCartCouponState } from '@/lib/coupons.server';
import { bankTransferCheckoutEnabled } from '@/lib/payments/bank-transfer.server';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';
import { getStorefrontGoodsByIds, getStorefrontIpsByIds } from '@/lib/storefront.server';

export const metadata: Metadata = {
  title: '체크아웃 — ICONS',
  description: '배송지와 주문 내용을 확인하고 결제를 준비하세요.',
};

export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/checkout')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/checkout'));

  /* 주문서도 담긴 상품만 읽는다(규모 후속) — 카탈로그 전량은 1,000에서 조용히 잘린다. */
  const [goodIds, latestAddress, resumeOrderId, couponState] = await Promise.all([
    loadCartGoodIds(),
    loadLatestCheckoutAddress(auth.user.id),
    loadLatestPendingCheckoutOrderId(auth.user.id),
    loadCartCouponState(),
  ]);
  const goods = await getStorefrontGoodsByIds(goodIds);
  const ips = await getStorefrontIpsByIds(goods.map((good) => good.ip));

  /* 확정은 place_order 가 한다 — 주문서는 카트에 적용해 둔 선택을 미리 보여줄 뿐이다. */
  const appliedCoupon = couponState.coupons.find(
    (held) => held.id === couponState.selectedUserCouponId,
  ) ?? null;

  return (
    <Checkout
      catalog={{ goods, ips, answeredIds: goodIds }}
      latestAddress={latestAddress}
      resumeOrderId={resumeOrderId}
      paymentAvailable={goodsCheckoutPaymentsEnabled(auth.user.id)}
      bankTransferAvailable={bankTransferCheckoutEnabled()}
      appliedCoupon={appliedCoupon}
    />
  );
}

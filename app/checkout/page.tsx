import { loadCouponCombinationPolicy } from '@/lib/coupon-combinations.server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Checkout } from '@/components/screens/Checkout';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadLatestCheckoutAddress, loadLatestPendingCheckoutOrderId } from '@/lib/checkout.server';
import { loadCartCouponState } from '@/lib/coupons.server';
import { bankTransferCheckoutEnabled } from '@/lib/payments/bank-transfer.server';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';
import { deriveUserCartProvider } from '@/lib/payments/goods-sale-restriction.server';
import { loadGoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';
import { GoodsTransactionCheckout } from '@/components/screens/GoodsTransactionCheckout';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '체크아웃 — ICONS',
  description: '배송지와 주문 내용을 확인하고 결제하세요.',
};

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/checkout')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/checkout'));

  /* 토스 failUrl은 이 화면으로 돌아온다(?code=…&message=…). code는 외부
     문자열이라 형식만 통과시키고, message는 아예 읽지 않는다. */
  const params = (await searchParams) ?? {};
  const rawFailCode = typeof params.code === 'string' ? params.code : null;
  const paymentFailCode = rawFailCode && /^[A-Z_]{2,64}$/.test(rawFailCode)
    ? rawFailCode
    : null;

  const [catalog, latestAddress, resumeOrderId, couponState, transactionMode, couponPolicy] = await Promise.all([
    getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods })),
    loadLatestCheckoutAddress(auth.user.id),
    loadLatestPendingCheckoutOrderId(auth.user.id),
    loadCartCouponState(),
    loadGoodsTransactionRuntimeMode(),
    loadCouponCombinationPolicy(),
  ]);

  /* 카드 결제 가능 여부는 서버 카트 구성으로 파생한 provider의 gate다 — 19금 굿즈가
     섞이면 코페이다. 주문 액션이 실제 카트로 다시 판정하고, DB prepare가 최종 강제한다. */
  const cardProvider = await deriveUserCartProvider(auth.user.id).catch(() => 'toss' as const);
  const paymentAvailable = goodsCheckoutPaymentsEnabled(auth.user.id, cardProvider);

  /* 확정은 place_order 가 한다 — 주문서는 카트에 적용해 둔 선택을 미리 보여줄 뿐이다. */
  const appliedCoupon = couponState.coupons.find(
    (held) => held.id === couponState.selectedUserCouponId,
  ) ?? null;

  if (transactionMode === 'unavailable') return <main className="wc-root checkout-page"><div className="wrap card"><h1>주문 조건을 확인하지 못했어요</h1><p>잠시 후 다시 확인해주세요.</p><Link href="/cart">장바구니로 돌아가기</Link></div></main>;
  if (transactionMode === 'transaction') return <GoodsTransactionCheckout key={auth.user.id} accountId={auth.user.id} catalog={{ goods: catalog.goods, ips: catalog.ips }} latestAddress={latestAddress}
    resumeOrderId={resumeOrderId} paymentAvailable={paymentAvailable} bankTransferAvailable={await bankTransferCheckoutEnabled()}
    userCouponId={couponState.selectedUserCouponId} coupons={couponState.coupons} couponPolicy={couponPolicy} paymentFailCode={paymentFailCode} />;

  return (
    <Checkout
      catalog={{ goods: catalog.goods, ips: catalog.ips }}
      latestAddress={latestAddress}
      resumeOrderId={resumeOrderId}
      /* 카트 단계라 파생할 주문이 아직 없다 — 기본(toss) gate로 그린다. 제한
         상품은 현재 담기 자체가 차단되고, 19금 오픈 트랙에서 카트 파생과 함께
         korpay gate 분기가 이 자리에 온다(#392). 서버 prepare가 최종 gate다. */
      paymentAvailable={paymentAvailable}
      bankTransferAvailable={await bankTransferCheckoutEnabled()}
      appliedCoupon={appliedCoupon}
      paymentFailCode={paymentFailCode}
    />
  );
}

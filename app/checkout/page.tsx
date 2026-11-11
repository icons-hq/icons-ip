import { loadCouponCombinationPolicy } from '@/lib/coupon-combinations.server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Checkout } from '@/components/screens/Checkout';
import { addressBookOpenFor } from '@/lib/address-book';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadCheckoutAddressPrefill, loadLatestPendingCheckoutOrderId } from '@/lib/checkout.server';
import { loadCartCouponState } from '@/lib/coupons.server';
import { bankTransferCheckoutEnabled } from '@/lib/payments/bank-transfer.server';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';
import { deriveGoodsCartProvider, deriveUserCartProvider } from '@/lib/payments/goods-sale-restriction.server';
import { checkoutDraftHref, checkoutDraftReturnHref, normalizeCheckoutDraftId, type CheckoutDraft } from '@/lib/checkout-draft';
import { loadCheckoutDraft } from '@/lib/checkout-draft.server';
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

function DraftUnavailable({ draft, error }: { draft: Pick<CheckoutDraft, 'source' | 'baseGoodId'> | null; error: boolean }) {
  return (
    <main className="wc-root wc-receipt checkout-page">
      <div className="wrap checkout-empty card">
        <h1>{error ? '주문서를 불러오지 못했어요' : '주문서를 다시 열어주세요'}</h1>
        <p>{error ? '잠시 후 다시 시도해주세요.' : '주문서를 연 지 오래되었거나 이 계정의 주문서가 아니에요. 고른 화면에서 다시 주문해주세요.'}</p>
        <Link className="btn btn-holo" href={checkoutDraftReturnHref(draft)}>{draft?.source === 'direct' ? '굿즈로 돌아가기' : '장바구니로 돌아가기'}</Link>
      </div>
    </main>
  );
}

export default async function Page({ searchParams }: PageProps) {
  /* 토스 failUrl은 이 화면으로 돌아온다(?code=…&message=…). code는 외부
     문자열이라 형식만 통과시키고, message는 아예 읽지 않는다. */
  const params = (await searchParams) ?? {};
  /* 주문서 초안(ADR-0030 — 장바구니 선택 주문·바로구매). 없으면 지금처럼 장바구니 전체 주문서다. */
  const draftRequested = params.draft !== undefined;
  const draftId = typeof params.draft === 'string' ? normalizeCheckoutDraftId(params.draft) : null;
  const returnPath = draftId ? checkoutDraftHref(draftId) : '/checkout';
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(returnPath));

  const rawFailCode = typeof params.code === 'string' ? params.code : null;
  const paymentFailCode = rawFailCode && /^[A-Z_]{2,64}$/.test(rawFailCode)
    ? rawFailCode
    : null;

  const draft = draftId ? await loadCheckoutDraft(auth.user.id, draftId) : null;
  if (draft === 'error') return <DraftUnavailable draft={null} error />;
  if (draftRequested && !draft) return <DraftUnavailable draft={null} error={false} />;

  const [catalog, addressPrefill, resumeOrderId, couponState, transactionMode, couponPolicy] = await Promise.all([
    getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods })),
    loadCheckoutAddressPrefill(auth.user.id, addressBookOpenFor(auth)),
    loadLatestPendingCheckoutOrderId(auth.user.id),
    loadCartCouponState(),
    loadGoodsTransactionRuntimeMode(),
    loadCouponCombinationPolicy(),
  ]);

  /* 카드 결제 가능 여부는 이 주문서 품목으로 파생한 provider의 gate다 — 19금 굿즈가
     섞이면 나이스페이다. 초안이면 그 줄(장바구니에만 있는 19금 굿즈는 끼지 않는다), 아니면 서버 카트 전체로 판정한다.
     주문 액션이 같은 품목으로 다시 판정하고, DB prepare가 최종 강제한다. */
  const cardProvider = await (draft ? deriveGoodsCartProvider(draft.lines.map(line => line.goodId)) : deriveUserCartProvider(auth.user.id))
    .catch(() => 'toss' as const);
  const paymentAvailable = goodsCheckoutPaymentsEnabled(auth.user.id, cardProvider);

  /* 확정은 place_order 가 한다 — 주문서는 카트에 적용해 둔 선택을 미리 보여주고, 같은 선택(cart_coupon_selections)을 바꾸게 한다(R25). */
  const appliedCoupon = couponState.coupons.find(
    (held) => held.id === couponState.selectedUserCouponId,
  ) ?? null;

  if (transactionMode === 'unavailable') return <main className="wc-root checkout-page"><div className="wrap card"><h1>주문 조건을 확인하지 못했어요</h1><p>잠시 후 다시 확인해주세요.</p><Link href="/cart">장바구니로 돌아가기</Link></div></main>;
  if (transactionMode === 'transaction') return <GoodsTransactionCheckout key={auth.user.id} accountId={auth.user.id} catalog={{ goods: catalog.goods, ips: catalog.ips }} addressPrefill={addressPrefill}
    resumeOrderId={resumeOrderId} paymentAvailable={paymentAvailable} bankTransferAvailable={await bankTransferCheckoutEnabled()}
    userCouponId={couponState.selectedUserCouponId} coupons={couponState.coupons} couponPolicy={couponPolicy} paymentFailCode={paymentFailCode} draft={draft} />;

  return (
    <Checkout
      catalog={{ goods: catalog.goods, ips: catalog.ips }}
      addressPrefill={addressPrefill}
      resumeOrderId={resumeOrderId}
      /* 위에서 서버 카트 구성으로 파생한 provider의 gate다(19금 굿즈가 섞이면 나이스페이).
         주문 액션이 실제 카트로 다시 판정하고, 서버 prepare가 최종 gate다. */
      paymentAvailable={paymentAvailable}
      bankTransferAvailable={await bankTransferCheckoutEnabled()}
      appliedCoupon={appliedCoupon}
      couponState={couponState}
      paymentFailCode={paymentFailCode}
      draft={draft}
    />
  );
}

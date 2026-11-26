import { notFound, redirect } from 'next/navigation';
import { createDirectCheckoutDraftAction } from '@/app/checkout/draft-actions';
import { ADMIN_PAYMENT_TEST_PATH } from '@/lib/admin-payment-test';
import { loadAdminPaymentTestGood } from '@/lib/admin-payment-test.server';
import { onboardingPath } from '@/lib/auth/onboarding';
import { krwAmountWords } from '@/lib/format';

async function openCheckout() {
  'use server';
  const good = await loadAdminPaymentTestGood();
  if (!good) notFound();
  const option = good.options?.find(option => option.isDefault);
  if (option && option.stockQty > 0) {
    const result = await createDirectCheckoutDraftAction(good.id, [{ goodId: good.id, variantId: option.id, qty: 1 }]);
    if (result.ok) redirect(result.href);
    if (result.error === 'onboarding_required') redirect(onboardingPath(ADMIN_PAYMENT_TEST_PATH));
  }
  redirect(`${ADMIN_PAYMENT_TEST_PATH}?retry=1`);
}

export async function AdminPaymentTestGood({ retry }: { retry: boolean }) {
  const good = await loadAdminPaymentTestGood();
  if (!good) notFound();
  const option = good.options?.find(option => option.isDefault);
  return (
    <main className="wc-root wc-receipt checkout-page">
      <div className="wrap checkout-empty card">
        <h1>{good.name}</h1>
        <p>{krwAmountWords(option?.price ?? good.price)} · 1개{good.shippingFeeType === 'free' ? ' · 기본 배송비 무료' : ''}</p>
        <p>관리자 결제 확인용 상품입니다. 결제를 마치면 주문 내역에서 취소해 주세요. 실물 배송은 없습니다.</p>
        {retry && <p role="alert">주문서를 열지 못했습니다. 재고를 확인하고 다시 시도해 주세요.</p>}
        <form action={openCheckout}>
          <button type="submit" className="btn btn-holo" disabled={!option || option.stockQty < 1 || good.stock === 'soldout'}>
            {option && option.stockQty > 0 && good.stock !== 'soldout' ? '바로구매' : '품절'}
          </button>
        </form>
      </div>
    </main>
  );
}

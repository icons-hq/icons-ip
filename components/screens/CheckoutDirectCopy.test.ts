import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { directCheckoutCopy } from '@/lib/checkout-draft';
import { transactionIssueCopy } from '@/lib/checkout-transaction';
import { PLACE_ORDER_OPTION_LIMIT_MESSAGES, PLACE_ORDER_RANDOM_OPTION_LIMIT_MESSAGE, PLACE_ORDER_RANDOM_OPTION_MESSAGE } from '@/lib/goods-option-sale-mode';
import { checkoutActionErrorCopy } from './Checkout';
import { cartTransactionErrorCopy } from './GoodsTransactionCheckout';

/*
 * 바로구매 주문서(ADR-0030)의 오류 안내는 장바구니로 보내지 않는다 — 바로구매는 장바구니를 거치지 않으므로 굿즈 상세에서
 * 다시 고르게 하고(쿠폰은 이 주문서에서), 주문서는 '굿즈로 돌아가기'를 붙인다. 두 주문서·견적의 모든 공용 안내가 바뀌는지 본다.
 */
describe('바로구매 주문서 안내', () => {
  const sources: Record<string, string> = {
    ...Object.fromEntries(Object.entries(checkoutActionErrorCopy).map(([key, value]) => [`legacy.${key}`, value])),
    ...Object.fromEntries(Object.entries(cartTransactionErrorCopy).map(([key, value]) => [`transaction.${key}`, value])),
    ...Object.fromEntries(Object.entries(transactionIssueCopy).map(([key, value]) => [`issue.${key}`, value])),
    ...Object.fromEntries(Object.entries(PLACE_ORDER_OPTION_LIMIT_MESSAGES).map(([key, value]) => [`option.${key}`, value])),
    random: PLACE_ORDER_RANDOM_OPTION_MESSAGE,
    randomLimit: PLACE_ORDER_RANDOM_OPTION_LIMIT_MESSAGE,
    stock: '재고가 변경된 굿즈가 있어요. 장바구니에서 수량을 확인해주세요.',
  };

  it('장바구니를 가리키는 안내를 모두 굿즈 상세(쿠폰은 이 주문서)로 바꾼다', () => {
    const leftovers = Object.entries(sources).filter(([, value]) => directCheckoutCopy(value).includes('장바구니'));
    expect(leftovers).toEqual([]);
  });

  it('장바구니와 무관한 안내는 그대로 둔다', () => {
    expect(directCheckoutCopy(checkoutActionErrorCopy.payment_unavailable)).toBe(checkoutActionErrorCopy.payment_unavailable);
    expect(directCheckoutCopy(cartTransactionErrorCopy.draft_used)).toBe(cartTransactionErrorCopy.draft_used);
  });

  it('쿠폰 안내는 굿즈 상세가 아니라 이 주문서에서 다시 고르게 한다', () => {
    expect(directCheckoutCopy(transactionIssueCopy.coupon_unavailable)).toContain('이 주문서에서 쿠폰을 다시 골라주세요');
    expect(directCheckoutCopy(cartTransactionErrorCopy.coupon_changed)).toContain('이 주문서에서 쿠폰을 다시 골라주세요');
    expect(directCheckoutCopy(checkoutActionErrorCopy.out_of_stock)).toContain('굿즈 상세에서');
  });
});

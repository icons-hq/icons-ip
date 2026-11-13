'use server';

import { unstable_rethrow } from 'next/navigation';
import { normalizeStoreCreditAmount, type StoreCreditCheckoutQuote } from '@/lib/store-credits';
import { loadMyStoreCreditCheckout } from '@/lib/store-credits.server';
import { parseShippingDestination } from '@/lib/shipping-regions';
import { parseShippingQuoteItems } from '@/lib/fulfillment';
import { loadDraftStoreCreditCheckout } from '@/lib/checkout-draft.server';
import type { CheckoutDraftCoupon } from '@/lib/checkout-draft';
import { isUuid } from '@/lib/uuid';

function draftCoupon(value: unknown): CheckoutDraftCoupon | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, userCouponId } = value as { kind?: unknown; userCouponId?: unknown };
  if (kind === 'cart') return { kind };
  if (kind === 'direct' && (userCouponId === null || isUuid(userCouponId))) return { kind, userCouponId: userCouponId === null ? null : userCouponId.toLowerCase() };
  return null;
}

/**
 * 주문서 초안(선택 주문·바로구매, ADR-0030)의 적립금 사용 한도. 품목은 그 주문서의 줄이고, 쿠폰은 선택 주문이면
 * 장바구니 쿠폰 선택, 바로구매면 주문서에서 고른 쿠폰이다. 사용자는 로그인 세션이 정한다.
 */
export async function quoteDraftStoreCreditsAction(value: unknown, destinationInput: unknown, itemsInput: unknown, couponInput: unknown): Promise<
  { ok: true; quote: StoreCreditCheckoutQuote } | { ok: false; error: string }
> {
  const amount = normalizeStoreCreditAmount(value);
  if (amount === null) return { ok: false, error: '사용할 적립금은 0 이상의 원 단위 정수로 입력해주세요.' };
  const destination = destinationInput === null ? null : parseShippingDestination(destinationInput);
  if (destinationInput !== null && !destination) return { ok: false, error: '적립금 사용 조건을 확인할 배송지 주소를 다시 확인해주세요.' };
  const items = parseShippingQuoteItems(itemsInput);
  const coupon = draftCoupon(couponInput);
  if (!items?.length || !coupon) return { ok: false, error: '적립금 사용 조건을 확인할 굿즈를 다시 확인해주세요.' };
  try {
    const quote = await loadDraftStoreCreditCheckout(amount, destination, items, coupon);
    return quote ? { ok: true, quote } : { ok: false, error: '적립금을 확인하지 못했습니다. 다시 조회해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '적립금을 확인하지 못했습니다. 다시 조회해주세요.' };
  }
}

export async function quoteCheckoutStoreCreditsAction(value: unknown, destinationInput: unknown = null): Promise<
  { ok: true; quote: StoreCreditCheckoutQuote } | { ok: false; error: string }
> {
  const amount = normalizeStoreCreditAmount(value);
  if (amount === null) return { ok: false, error: '사용할 적립금은 0 이상의 원 단위 정수로 입력해주세요.' };
  const destination = destinationInput === null ? null : parseShippingDestination(destinationInput);
  if (destinationInput !== null && !destination) return { ok: false, error: '적립금 사용 조건을 확인할 배송지 주소를 다시 확인해주세요.' };
  try {
    const quote = await loadMyStoreCreditCheckout(amount, destination);
    return quote ? { ok: true, quote } : { ok: false, error: '적립금을 확인하지 못했습니다. 다시 조회해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '적립금을 확인하지 못했습니다. 다시 조회해주세요.' };
  }
}

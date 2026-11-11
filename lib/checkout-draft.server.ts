import 'server-only';
import { parseCheckoutDraft, type CheckoutDraft, type CheckoutDraftCoupon } from './checkout-draft';
import type { ShippingQuoteItem } from './fulfillment';
import type { ShippingDestination } from './shipping-regions';
import { parseStoreCreditCheckoutQuote, type StoreCreditCheckoutQuote } from './store-credits';
import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';

/**
 * 초안 주문서의 적립금 사용 한도. 장바구니 전체가 아니라 그 주문서의 품목과 쿠폰으로 계산한다(1014-032). 실패는
 * 사용 불가로 남긴다 — 0원 잔액을 지어내지 않는다.
 */
export async function loadDraftStoreCreditCheckout(
  requestedAmount: number,
  destination: ShippingDestination | null,
  items: ShippingQuoteItem[],
  coupon: CheckoutDraftCoupon,
): Promise<StoreCreditCheckoutQuote | null> {
  try {
    const supabase = await createClient();
    const { data, error } = coupon.kind === 'direct'
      ? await supabase.rpc('get_my_store_credit_checkout_for_direct', { p_requested_amount: requestedAmount, p_destination: destination,
        p_items: items, p_user_coupon_id: coupon.userCouponId })
      : await supabase.rpc('get_my_store_credit_checkout_for_items', { p_requested_amount: requestedAmount, p_destination: destination, p_items: items });
    const quote = error ? null : parseStoreCreditCheckoutQuote(data);
    return quote?.requestedAmount === requestedAmount ? quote : null;
  } catch {
    return null;
  }
}

/**
 * 로그인 사용자의 주문서 초안(ADR-0030). 다른 계정·만료 초안은 DB가 null로 답한다. 읽기 자체가 실패하면
 * 'error' — 주문서는 "다시 시도"를 안내하고, 장바구니 전체로 조용히 바꿔 주문하지 않는다.
 */
export async function loadCheckoutDraft(userId: string, draftId: string): Promise<CheckoutDraft | null | 'error'> {
  try {
    const { data, error } = await createServiceClient().rpc('service_get_checkout_draft', { p_user_id: userId, p_draft_id: draftId });
    if (error) return 'error';
    if (data === null) return null;
    return parseCheckoutDraft(data) ?? 'error';
  } catch {
    return 'error';
  }
}

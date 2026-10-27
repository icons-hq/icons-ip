'use server';

import { getCurrentAuthState } from '@/lib/auth/server';
import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { cartTransactionRequestTooLarge, cartTransactionSnapshot, parseCartTransactionInput, parseCartTransactionOrderInput, parseCartTransactionRecovery, type CartTransactionInput } from '@/lib/checkout-transaction';
import { normalizeOrderReference } from '@/lib/checkout';
import { parseGoodsTransactionQuote, type GoodsTransactionQuote } from '@/lib/goods-transaction';
import { bankTransferCheckoutEnabled } from '@/lib/payments/bank-transfer.server';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';
import { createServiceClient } from '@/lib/supabase/service';
import { bindStoreAnalyticsOrder } from '@/lib/store-analytics.server';
import { loadGoodsTransactionOffers } from '@/lib/goods-transaction-offers.server';
import type { GoodsTransactionOffer } from '@/lib/goods-transaction-offers';
import { loadGoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';

export type CartTransactionError = 'invalid_request' | 'order_too_large' | 'auth_changed' | 'account_unavailable' | 'checkout_unavailable' | 'payment_unavailable' | 'cart_changed' | 'coupon_changed' | 'quote_changed' | 'checkout_conflict' | 'payment_in_progress' | 'unavailable';
export type CartTransactionQuoteResult = { ok: true; quote: GoodsTransactionQuote; offers: GoodsTransactionOffer[] } | { ok: false; error: CartTransactionError };
export type CartTransactionPlaceResult = { ok: true; orderId: string } | { ok: false; error: CartTransactionError; uncertain: boolean };

async function authorize(expectedActorId: string, allowExisting = false): Promise<CartTransactionError | null> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || auth.user?.id !== expectedActorId) return 'auth_changed';
  if (!allowExisting && (isAccountSuspended(auth.profile) || !isOnboarded(auth.profile, auth.user.email))) return 'account_unavailable';
  return null;
}
function rpcError(message: string): CartTransactionError {
  // 이전 장바구니 주문의 결제를 승인 확인하는 중이면 새 주문을 받지 않는다(ADR-0026).
  if (message.includes('checkout_payment_in_progress')) return 'payment_in_progress';
  if (message.includes('transaction_quote_too_large')) return 'order_too_large';
  if (message.includes('transaction_runtime_disabled')) return 'checkout_unavailable';
  if (message.includes('cart_snapshot_changed')) return 'cart_changed';
  if (message.includes('coupon_snapshot_changed')) return 'coupon_changed';
  if (message.includes('transaction_quote_')) return 'quote_changed';
  if (message.includes('checkout_key_conflict')) return 'checkout_conflict';
  if (message.includes('transaction_actor_unavailable')) return 'account_unavailable';
  if (message.includes('transaction_payment_method_unavailable') || message.includes('transaction_new_payment_disabled')) return 'payment_unavailable';
  return 'unavailable';
}
function quoteFitsCart(quote: GoodsTransactionQuote, input: CartTransactionInput) {
  if (quote.state === 'blocked') return true;
  if (input.userCouponIds && JSON.stringify(quote.display.coupons?.map(c => c.userCouponId)) !== JSON.stringify(input.userCouponIds)) return false;
  if (quote.display.userCouponId !== input.userCouponId || quote.display.totals.storeCreditTotal !== input.storeCreditAmount) return false;
  const identities = (rows: readonly { goodId: string; variantId?: string | null; qty: number }[]) => rows.map(row => JSON.stringify([row.goodId, row.variantId, row.qty])).sort();
  return JSON.stringify(identities(quote.display.lines)) === JSON.stringify(identities(input.items));
}

export async function quoteCartTransactionAction(value: unknown): Promise<CartTransactionQuoteResult> {
  if (cartTransactionRequestTooLarge(value)) return { ok: false, error: 'order_too_large' };
  const input = parseCartTransactionInput(value); if (!input) return { ok: false, error: 'invalid_request' };
  const denied = await authorize(input.expectedActorId); if (denied) return { ok: false, error: denied };
  if (await loadGoodsTransactionRuntimeMode() !== 'transaction') return { ok: false, error: 'checkout_unavailable' };
  try {
    const [{ data, error }, offers] = await Promise.all([
      createServiceClient().rpc(input.userCouponIds ? 'quote_cart_goods_transaction_combined' : 'quote_cart_goods_transaction', {
        p_user_id: input.expectedActorId, p_expected_cart: cartTransactionSnapshot(input.items), p_address: input.address,
        p_delivery_choices: input.deliveryChoices, ...(input.userCouponIds ? { p_user_coupon_ids: input.userCouponIds } : { p_user_coupon_id: input.userCouponId }), p_store_credit_amount: input.storeCreditAmount,
      }),
      loadGoodsTransactionOffers([...new Set(input.items.map(item => item.goodId))]),
    ]);
    if (error) return { ok: false, error: rpcError(error.message) };
    const quote = parseGoodsTransactionQuote(data);
    return quote && offers && quoteFitsCart(quote, input) ? { ok: true, quote, offers } : { ok: false, error: 'unavailable' };
  } catch { return { ok: false, error: 'unavailable' }; }
}

export async function placeCartTransactionAction(value: unknown): Promise<CartTransactionPlaceResult> {
  if (cartTransactionRequestTooLarge(value)) return { ok: false, error: 'order_too_large', uncertain: false };
  const input = parseCartTransactionOrderInput(value); if (!input) return { ok: false, error: 'invalid_request', uncertain: false };
  const denied = await authorize(input.expectedActorId); if (denied) return { ok: false, error: denied, uncertain: false };
  if (await loadGoodsTransactionRuntimeMode() !== 'transaction') return { ok: false, error: 'checkout_unavailable', uncertain: false };
  const available = input.paymentMethod === 'bank_transfer' ? await bankTransferCheckoutEnabled() : goodsCheckoutPaymentsEnabled(input.expectedActorId);
  if (!available) return { ok: false, error: 'payment_unavailable', uncertain: false };
  try {
    const { data, error } = await createServiceClient().rpc('place_cart_goods_transaction', {
      p_user_id: input.expectedActorId, p_expected_cart: cartTransactionSnapshot(input.items), p_address: input.address,
      p_quote_id: input.quoteId, p_checkout_key: input.checkoutKey, p_payment_method: input.paymentMethod,
    });
    if (error) return { ok: false, error: rpcError(error.message), uncertain: !/^(?:PT409|22[0-9A-Z]{3}|23[0-9A-Z]{3}|42501|P0001)$/.test(error.code ?? '') };
    const orderId = normalizeOrderReference(data);
    if (!orderId) return { ok: false, error: 'unavailable', uncertain: true };
    // Analytics must never turn an already committed order into a failed request.
    try { await bindStoreAnalyticsOrder(orderId, input.expectedActorId); } catch { /* order remains committed */ }
    return { ok: true, orderId };
  } catch { return { ok: false, error: 'unavailable', uncertain: true }; }
}

/** Recovery sends identifiers only. The original address and selection stay in the private quote. */
export async function resumeCartTransactionAction(value: unknown): Promise<CartTransactionPlaceResult> {
  const input = parseCartTransactionRecovery(value); if (!input) return { ok: false, error: 'invalid_request', uncertain: false };
  const denied = await authorize(input.expectedActorId, true); if (denied) return { ok: false, error: denied, uncertain: false };
  try {
    const runtimeReady = await loadGoodsTransactionRuntimeMode() === 'transaction';
    const allowNew = runtimeReady && (input.paymentMethod === 'bank_transfer' ? await bankTransferCheckoutEnabled() : goodsCheckoutPaymentsEnabled(input.expectedActorId));
    const { data, error } = await createServiceClient().rpc('resume_cart_goods_transaction', {
      p_user_id: input.expectedActorId, p_quote_id: input.quoteId, p_checkout_key: input.checkoutKey,
      p_payment_method: input.paymentMethod, p_allow_new: allowNew,
    });
    if (error) return { ok: false, error: rpcError(error.message), uncertain: !/^(?:PT409|22[0-9A-Z]{3}|23[0-9A-Z]{3}|42501|P0001)$/.test(error.code ?? '') };
    const orderId = normalizeOrderReference(data);
    return orderId ? { ok: true, orderId } : { ok: false, error: 'unavailable', uncertain: true };
  } catch { return { ok: false, error: 'unavailable', uncertain: true }; }
}

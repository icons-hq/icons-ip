'use server';

import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import {
  mapPlaceOrderError,
  normalizeCheckoutAddress,
  normalizeCheckoutKey,
  normalizeCheckoutPaymentMethod,
  normalizeOrderReference,
  type PlaceOrderErrorCode,
} from '@/lib/checkout';
import { loadCheckoutOrder } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { bankTransferCheckoutEnabled } from '@/lib/payments/bank-transfer.server';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';
import { createServiceClient } from '@/lib/supabase/service';

type PlaceOrderActionError =
  | PlaceOrderErrorCode
  | 'invalid_request'
  | 'auth_required'
  | 'onboarding_required'
  | 'payment_unavailable';

export type PlaceOrderActionResult =
  | { ok: true; orderId: string }
  | { ok: false; error: PlaceOrderActionError };

export interface PrepareGoodsPaymentActionState {
  readonly prepared?: PreparedCheckout;
  readonly error?: 'auth_required' | 'not_found' | 'not_payable' | 'payment_unavailable';
}

export async function prepareGoodsPaymentAction(
  _state: PrepareGoodsPaymentActionState,
  formData: FormData,
): Promise<PrepareGoodsPaymentActionState> {
  const orderId = normalizeOrderReference(formData.get('orderId'));
  if (!orderId) return { error: 'not_found' };

  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { error: 'auth_required' };
  if (
    isAccountSuspended(auth.profile)
    || !isOnboarded(auth.profile, auth.user.email)
  ) return { error: 'auth_required' };
  if (!goodsCheckoutPaymentsEnabled(auth.user.id)) return { error: 'payment_unavailable' };

  const order = await loadCheckoutOrder(auth.user.id, orderId);
  if (!order) return { error: 'not_found' };
  if (
    order.status !== 'pending'
    || order.paymentStatus !== null
    || !order.expiresAt
    || Date.parse(order.expiresAt) <= Date.now()
  ) return { error: 'not_payable' };

  try {
    const prepared = await createRuntimeGoodsPaymentCheckout().prepare({
      userId: auth.user.id,
      orderId: order.id,
    });
    if (Date.parse(prepared.expiresAt) <= Date.now()) return { error: 'not_payable' };
    return { prepared };
  } catch {
    return { error: 'payment_unavailable' };
  }
}

export async function placeOrderAction(
  addressValue: unknown,
  checkoutKeyValue: unknown,
  paymentMethodValue: unknown = 'card',
): Promise<PlaceOrderActionResult> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { ok: false, error: 'auth_required' };
  if (isAccountSuspended(auth.profile)) return { ok: false, error: 'account_suspended' };
  if (!isOnboarded(auth.profile, auth.user.email)) {
    return { ok: false, error: 'onboarding_required' };
  }

  const address = normalizeCheckoutAddress(addressValue);
  if (!address) return { ok: false, error: 'invalid_address' };

  const checkoutKey = normalizeCheckoutKey(checkoutKeyValue);
  if (!checkoutKey) return { ok: false, error: 'invalid_request' };

  const paymentMethod = normalizeCheckoutPaymentMethod(paymentMethodValue);
  if (!paymentMethod) return { ok: false, error: 'invalid_request' };

  // 수단별로 게이트가 다르다. 무통장에는 결제사가 없으므로 PG rollout gate가
  // 닫혀 있어도 열릴 수 있고, 반대로 계좌가 없으면 카드가 열려 있어도 닫힌다.
  const available = paymentMethod === 'bank_transfer'
    ? bankTransferCheckoutEnabled()
    : goodsCheckoutPaymentsEnabled(auth.user.id);
  if (!available) {
    return { ok: false, error: 'payment_unavailable' };
  }

  let data: unknown;
  let error: { message: string } | null;
  try {
    const service = createServiceClient();
    const result = await service.rpc('place_order', {
      p_user_id: auth.user.id,
      p_address: address,
      p_checkout_key: checkoutKey,
      p_payment_method: paymentMethod,
    });
    data = result.data;
    error = result.error;
  } catch {
    return { ok: false, error: 'unavailable' };
  }

  if (error) return { ok: false, error: mapPlaceOrderError(error.message) };

  const orderId = normalizeOrderReference(data);
  return orderId
    ? { ok: true, orderId }
    : { ok: false, error: 'unavailable' };
}

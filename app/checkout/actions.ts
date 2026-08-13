'use server';

import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import {
  mapPlaceOrderError,
  normalizeCheckoutAddress,
  normalizeCheckoutKey,
  normalizeOrderReference,
  type PlaceOrderErrorCode,
} from '@/lib/checkout';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';
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

export async function placeOrderAction(
  addressValue: unknown,
  checkoutKeyValue: unknown,
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

  if (!goodsCheckoutPaymentsEnabled()) {
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

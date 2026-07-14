'use server';

import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import {
  mapPlaceOrderError,
  normalizeCheckoutAddress,
  normalizeCheckoutKey,
  normalizeOrderReference,
  type PlaceOrderErrorCode,
} from '@/lib/checkout';
import { paymentsEnabledForRuntime } from '@/lib/payments/config';
import { createClient } from '@/lib/supabase/server';

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
  if (!isOnboarded(auth.profile, auth.user.email)) {
    return { ok: false, error: 'onboarding_required' };
  }

  const address = normalizeCheckoutAddress(addressValue);
  if (!address) return { ok: false, error: 'invalid_address' };

  const checkoutKey = normalizeCheckoutKey(checkoutKeyValue);
  if (!checkoutKey) return { ok: false, error: 'invalid_request' };

  if (!paymentsEnabledForRuntime(
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    process.env.TOSS_SECRET_KEY,
  )) {
    return { ok: false, error: 'payment_unavailable' };
  }

  let data: unknown;
  let error: { message: string } | null;
  try {
    const supabase = await createClient();
    const result = await supabase.rpc('place_order', {
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

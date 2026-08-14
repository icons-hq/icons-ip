import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import {
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
} from './runtime-gateway';

/**
 * Goods reservations are created only when the provider-neutral server path is
 * ready. #207 owns the explicit Korpay rollout/canary gates while existing
 * provider callbacks remain drainable through the separate readiness check.
 */
export function goodsPaymentConfirmationAvailable() {
  return getServiceRoleConfig().isConfigured && paymentProviderConfigured();
}

export function goodsCheckoutPaymentsEnabled(userId?: string) {
  return goodsPaymentConfirmationAvailable()
    && newPaymentCheckoutEnabled('order', userId);
}

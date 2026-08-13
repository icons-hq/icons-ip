import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import {
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
} from './runtime-gateway';

/**
 * Goods reservations are created only when the provider-neutral server path is
 * ready. #207 owns the explicit Korpay rollout gate; #205 therefore remains
 * unavailable in every runtime while still being fully exercisable with Fake.
 */
export function goodsCheckoutPaymentsEnabled() {
  return getServiceRoleConfig().isConfigured
    && paymentProviderConfigured()
    && newPaymentCheckoutEnabled();
}

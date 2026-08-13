import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import {
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
} from './runtime-gateway';

/** Existing attempts can finish or be recovered while new checkout is paused. */
export function ticketPaymentProviderAvailable() {
  return getServiceRoleConfig().isConfigured && paymentProviderConfigured();
}

/** #207 owns the rotated Korpay adapter and independently reversible rollout gate. */
export function ticketCheckoutPaymentsEnabled() {
  return ticketPaymentProviderAvailable() && newPaymentCheckoutEnabled();
}

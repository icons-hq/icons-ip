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

/** #207 owns the Korpay adapter and independently reversible rollout/canary gate. */
export function ticketCheckoutPaymentsEnabled(userId?: string) {
  return ticketPaymentProviderAvailable() && newPaymentCheckoutEnabled('ticket', userId);
}

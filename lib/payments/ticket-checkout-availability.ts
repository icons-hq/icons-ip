import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import {
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
} from './runtime-gateway';

/** Existing attempts can be recovered while the new-checkout gate is paused. */
export function ticketPaymentReconciliationAvailable() {
  return getServiceRoleConfig().isConfigured && paymentProviderConfigured();
}

/** #207 owns the rotated Korpay adapter and independently reversible rollout gate. */
export function ticketCheckoutPaymentsEnabled() {
  return ticketPaymentReconciliationAvailable() && newPaymentCheckoutEnabled();
}

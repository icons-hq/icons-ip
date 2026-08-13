import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import { paymentProviderConfigured } from './runtime-gateway';

/** #207 owns the rotated Korpay adapter and rollout gate. */
export function ticketCheckoutPaymentsEnabled() {
  return getServiceRoleConfig().isConfigured && paymentProviderConfigured();
}

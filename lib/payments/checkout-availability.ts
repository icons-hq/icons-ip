import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import { paymentsEnabledForRuntime } from './config';

export function checkoutPaymentsEnabled() {
  return getServiceRoleConfig().isConfigured && paymentsEnabledForRuntime(
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    process.env.TOSS_SECRET_KEY,
  );
}

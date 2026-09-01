import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import {
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
  type PaymentCheckoutProvider,
} from './runtime-gateway';

/**
 * Existing attempts can finish or be recovered while new checkout is paused.
 * 티켓 seam은 아직 korpay에 물려 있다 — 토스 전환(#393)에서 기본값이 'toss'로
 * 바뀌고, gate(TOSS_TICKET_CHECKOUT_ENABLED)는 판매 일정 확정 시 env로 연다.
 */
export function ticketPaymentProviderAvailable(
  provider: PaymentCheckoutProvider = 'korpay',
) {
  return getServiceRoleConfig().isConfigured && paymentProviderConfigured(provider);
}

export function ticketCheckoutPaymentsEnabled(userId?: string) {
  return ticketPaymentProviderAvailable('korpay')
    && newPaymentCheckoutEnabled('ticket', userId, 'korpay');
}

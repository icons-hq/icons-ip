import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import {
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
  type PaymentCheckoutProvider,
} from './runtime-gateway';

/**
 * Existing attempts can finish or be recovered while new checkout is paused.
 * 티켓 seam의 기본 provider는 toss다(#393). korpay 콜백 drain 라우트만
 * 'korpay'를 명시하고, gate(TOSS_TICKET_CHECKOUT_ENABLED)는 공연/티켓 판매
 * 일정이 확정될 때 env로 연다.
 */
export function ticketPaymentProviderAvailable(
  provider: PaymentCheckoutProvider = 'toss',
) {
  return getServiceRoleConfig().isConfigured && paymentProviderConfigured(provider);
}

export function ticketCheckoutPaymentsEnabled(userId?: string) {
  return ticketPaymentProviderAvailable('toss')
    && newPaymentCheckoutEnabled('ticket', userId, 'toss');
}

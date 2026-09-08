import 'server-only';

import { createServiceClient } from '../supabase/service';
import type { PaymentGateway } from './gateway';
import { getPaymentGateway, type PaymentCheckoutProvider } from './runtime-gateway';
import { createTicketPaymentCheckout } from './ticket-checkout';
import { createTicketPaymentAttemptRepository } from './ticket-checkout.server';

function lazyRuntimeGateway(provider: PaymentCheckoutProvider): PaymentGateway {
  return {
    prepare: (attempt) => getPaymentGateway(provider).prepare(attempt),
    confirm: (input) => getPaymentGateway(provider).confirm(input),
    reconcile: (attempt) => getPaymentGateway(provider).reconcile(attempt),
    refund: (input) => getPaymentGateway(provider).refund(input),
  };
}

/**
 * Composition root kept outside the deep module so tests can inject Fake.
 * 티켓 seam의 기본 provider는 toss다(#393). 티켓에는 판매 제한 플래그가 없어
 * 파생 분기도 없다 — korpay는 진행 중 콜백 drain(korpay confirm 라우트)만
 * 명시 인자로 조립한다. gate(TOSS_TICKET_CHECKOUT_ENABLED)는 닫힌 채 두고
 * 공연/티켓 판매 일정이 확정되면 env로 연다.
 */
export function createRuntimeTicketPaymentCheckout(
  provider: PaymentCheckoutProvider = 'toss',
) {
  return createTicketPaymentCheckout({
    provider,
    // Resolve the adapter only at the network boundary so the repository's
    // `legacy` classification can answer before any gateway configuration runs.
    gateway: lazyRuntimeGateway(provider),
    repository: createTicketPaymentAttemptRepository(createServiceClient()),
  });
}

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
 * 티켓 seam의 기본 provider는 아직 korpay다 — 토스 전환(#393)에서 기본값이
 * 바뀌고, 그 전에는 웹훅 재정합(#390)만 'toss'를 명시해 조립한다.
 */
export function createRuntimeTicketPaymentCheckout(
  provider: PaymentCheckoutProvider = 'korpay',
) {
  return createTicketPaymentCheckout({
    provider,
    // Resolve the adapter only at the network boundary so the repository's
    // `legacy` classification can answer before any gateway configuration runs.
    gateway: lazyRuntimeGateway(provider),
    repository: createTicketPaymentAttemptRepository(createServiceClient()),
  });
}

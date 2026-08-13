import 'server-only';

import { createServiceClient } from '../supabase/service';
import type { PaymentGateway } from './gateway';
import { getPaymentGateway } from './runtime-gateway';
import { createTicketPaymentCheckout } from './ticket-checkout';
import { createTicketPaymentAttemptRepository } from './ticket-checkout.server';

const lazyRuntimeGateway: PaymentGateway = {
  prepare: (attempt) => getPaymentGateway().prepare(attempt),
  confirm: (input) => getPaymentGateway().confirm(input),
  reconcile: (attempt) => getPaymentGateway().reconcile(attempt),
  refund: (input) => getPaymentGateway().refund(input),
};

/** Composition root kept outside the deep module so tests can inject Fake. */
export function createRuntimeTicketPaymentCheckout() {
  return createTicketPaymentCheckout({
    provider: 'korpay',
    // Resolve the adapter only at the network boundary. A known legacy Toss
    // refund must reach the repository's `legacy` result while #207 is OFF.
    gateway: lazyRuntimeGateway,
    repository: createTicketPaymentAttemptRepository(createServiceClient()),
  });
}

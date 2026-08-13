import 'server-only';
import type { PaymentGateway } from './gateway';

export type NewPaymentCheckoutPurpose = 'order' | 'ticket';

export class PaymentGatewayUnavailableError extends Error {
  constructor() {
    super('payment_gateway_unavailable');
    this.name = 'PaymentGatewayUnavailableError';
  }
}

async function unavailable(): Promise<never> {
  throw new PaymentGatewayUnavailableError();
}

const unavailableGateway: PaymentGateway = {
  prepare: unavailable,
  confirm: unavailable,
  reconcile: unavailable,
  refund: unavailable,
};

/** #207 installs the rotated Korpay adapter and credential readiness check. */
export function paymentProviderConfigured() {
  return false;
}

/** #207 owns the explicit, independently reversible new-checkout rollout gate. */
export function newPaymentCheckoutEnabled(_purpose: NewPaymentCheckoutPurpose) {
  void _purpose;
  return false;
}

/**
 * New Toss checkout is intentionally absent. Until #207 lands a rotated Korpay
 * adapter, every runtime attempt fails closed behind the provider-neutral seam.
 */
export function getPaymentGateway(): PaymentGateway {
  return unavailableGateway;
}

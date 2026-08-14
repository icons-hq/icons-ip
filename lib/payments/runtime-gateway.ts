import 'server-only';
import type { PaymentGateway } from './gateway';
import { createKorpayPaymentGateway } from './korpay-gateway.server';

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

const KORPAY_MID = /^[A-Za-z0-9]{10}$/;
const KORPAY_KEY = /^[A-Za-z0-9+/]{30,254}={0,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function runtimeConfiguration() {
  const merchantId = process.env.KORPAY_MID?.trim() ?? '';
  const merchantKey = process.env.KORPAY_KEY?.trim() ?? '';
  const siteUrl = process.env.SITE_URL?.trim() ?? '';
  if (!KORPAY_MID.test(merchantId) || !KORPAY_KEY.test(merchantKey)) return null;

  try {
    const url = new URL(siteUrl);
    const localHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (
      (url.protocol !== 'https:' && !localHttp)
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return null;
    return { merchantId, merchantKey, siteUrl: url.origin };
  } catch {
    return null;
  }
}

/** Credentials make the adapter ready; rollout gates remain independent. */
export function paymentProviderConfigured() {
  return runtimeConfiguration() !== null;
}

/**
 * Public rollout is purpose-specific. While it is OFF, a single opaque user id
 * may be allowlisted for a controlled Production canary without opening sales.
 */
export function newPaymentCheckoutEnabled(
  purpose: NewPaymentCheckoutPurpose,
  userId?: string,
) {
  if (!paymentProviderConfigured()) return false;
  const publicGate = purpose === 'order'
    ? process.env.KORPAY_ORDER_CHECKOUT_ENABLED
    : process.env.KORPAY_TICKET_CHECKOUT_ENABLED;
  if (publicGate === 'true') return true;

  const canaryUserId = purpose === 'order'
    ? process.env.KORPAY_ORDER_CANARY_USER_ID
    : process.env.KORPAY_TICKET_CANARY_USER_ID;
  return typeof userId === 'string'
    && UUID.test(userId)
    && typeof canaryUserId === 'string'
    && UUID.test(canaryUserId)
    && userId === canaryUserId;
}

/**
 * Resolves the server-only Korpay adapter lazily so missing or partial runtime
 * configuration stays fail closed without breaking legacy Toss drains.
 */
export function getPaymentGateway(): PaymentGateway {
  const configuration = runtimeConfiguration();
  return configuration
    ? createKorpayPaymentGateway(configuration)
    : unavailableGateway;
}

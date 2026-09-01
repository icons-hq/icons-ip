import 'server-only';
import type { PaymentGateway } from './gateway';
import {
  isKorpayMerchantId,
  isKorpayMerchantKey,
  isKorpayUuid,
  normalizeKorpaySiteUrl,
} from './korpay-config.mjs';
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

function runtimeConfiguration() {
  if (process.env.VERCEL_ENV !== 'production') return null;
  const merchantId = process.env.KORPAY_MID?.trim() ?? '';
  const merchantKey = process.env.KORPAY_KEY?.trim() ?? '';
  const siteUrl = process.env.SITE_URL?.trim() ?? '';
  if (!isKorpayMerchantId(merchantId) || !isKorpayMerchantKey(merchantKey)) return null;
  const normalizedSiteUrl = normalizeKorpaySiteUrl(siteUrl, { production: true });
  return normalizedSiteUrl ? { merchantId, merchantKey, siteUrl: normalizedSiteUrl } : null;
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
    && isKorpayUuid(userId)
    && typeof canaryUserId === 'string'
    && isKorpayUuid(canaryUserId)
    && userId === canaryUserId;
}

/**
 * Resolves the server-only Korpay adapter lazily so missing or partial runtime
 * configuration stays fail closed.
 */
export function getPaymentGateway(): PaymentGateway {
  const configuration = runtimeConfiguration();
  return configuration
    ? createKorpayPaymentGateway(configuration)
    : unavailableGateway;
}

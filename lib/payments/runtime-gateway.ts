import 'server-only';
import type { PaymentGateway } from './gateway';
import {
  isKorpayMerchantId,
  isKorpayMerchantKey,
  isKorpayUuid,
  normalizeKorpaySiteUrl,
} from './korpay-config.mjs';
import { createKorpayPaymentGateway } from './korpay-gateway.server';
import { isTossClientKey, isTossKeyPairAligned, isTossSecretKey } from './toss-config.mjs';
import { createTossPaymentGateway } from './toss-gateway.server';

export type NewPaymentCheckoutPurpose = 'order' | 'ticket';

/**
 * 콜백형 결제 게이트웨이를 가진 provider. 기본은 toss다(에픽 #384 재전환) —
 * korpay는 제거하지 않고 판매 제한 상품 전용으로 19금 오픈 트랙에서 재개방한다.
 * bank_transfer는 게이트웨이 seam을 타지 않으므로 여기 없다.
 */
export type PaymentCheckoutProvider = 'toss' | 'korpay';

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

function korpayConfiguration() {
  if (process.env.VERCEL_ENV !== 'production') return null;
  const merchantId = process.env.KORPAY_MID?.trim() ?? '';
  const merchantKey = process.env.KORPAY_KEY?.trim() ?? '';
  const siteUrl = process.env.SITE_URL?.trim() ?? '';
  if (!isKorpayMerchantId(merchantId) || !isKorpayMerchantKey(merchantKey)) return null;
  const normalizedSiteUrl = normalizeKorpaySiteUrl(siteUrl, { production: true });
  return normalizedSiteUrl ? { merchantId, merchantKey, siteUrl: normalizedSiteUrl } : null;
}

function tossConfiguration() {
  // 심사 기간에는 production에 테스트 키(test_gck/gsk)가 물린다 — 환경 가드는
  // korpay와 같이 production 전용이고, 키 모드는 페어 일치만 요구한다(#394·#395).
  if (process.env.VERCEL_ENV !== 'production') return null;
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ?? '';
  const secretKey = process.env.TOSS_SECRET_KEY?.trim() ?? '';
  const siteUrl = process.env.SITE_URL?.trim() ?? '';
  if (
    !isTossClientKey(clientKey)
    || !isTossSecretKey(secretKey)
    || !isTossKeyPairAligned(clientKey, secretKey)
  ) {
    return null;
  }
  // canonical origin 규칙은 provider와 무관한 사이트 속성이라 korpay-config의
  // 정규화를 공용한다.
  const normalizedSiteUrl = normalizeKorpaySiteUrl(siteUrl, { production: true });
  return normalizedSiteUrl ? { clientKey, secretKey, siteUrl: normalizedSiteUrl } : null;
}

/** Credentials make the adapter ready; rollout gates remain independent. */
export function paymentProviderConfigured(provider: PaymentCheckoutProvider = 'toss') {
  return provider === 'korpay'
    ? korpayConfiguration() !== null
    : tossConfiguration() !== null;
}

const CHECKOUT_GATE_ENV = {
  toss: {
    order: { public: 'TOSS_ORDER_CHECKOUT_ENABLED', canary: 'TOSS_ORDER_CANARY_USER_ID' },
    ticket: { public: 'TOSS_TICKET_CHECKOUT_ENABLED', canary: 'TOSS_TICKET_CANARY_USER_ID' },
  },
  korpay: {
    order: { public: 'KORPAY_ORDER_CHECKOUT_ENABLED', canary: 'KORPAY_ORDER_CANARY_USER_ID' },
    ticket: { public: 'KORPAY_TICKET_CHECKOUT_ENABLED', canary: 'KORPAY_TICKET_CANARY_USER_ID' },
  },
} as const;

/**
 * Public rollout is provider- and purpose-specific. While it is OFF, a single
 * opaque user id may be allowlisted for a controlled Production canary without
 * opening sales.
 */
export function newPaymentCheckoutEnabled(
  purpose: NewPaymentCheckoutPurpose,
  userId?: string,
  provider: PaymentCheckoutProvider = 'toss',
) {
  if (!paymentProviderConfigured(provider)) return false;
  const gateEnv = CHECKOUT_GATE_ENV[provider][purpose];
  if (process.env[gateEnv.public] === 'true') return true;

  const canaryUserId = process.env[gateEnv.canary];
  return typeof userId === 'string'
    && isKorpayUuid(userId)
    && typeof canaryUserId === 'string'
    && isKorpayUuid(canaryUserId)
    && userId === canaryUserId;
}

/**
 * Resolves the server-only provider adapter lazily so missing or partial
 * runtime configuration stays fail closed.
 */
export function getPaymentGateway(provider: PaymentCheckoutProvider = 'toss'): PaymentGateway {
  if (provider === 'korpay') {
    const configuration = korpayConfiguration();
    return configuration
      ? createKorpayPaymentGateway(configuration)
      : unavailableGateway;
  }
  const configuration = tossConfiguration();
  return configuration
    ? createTossPaymentGateway(configuration)
    : unavailableGateway;
}

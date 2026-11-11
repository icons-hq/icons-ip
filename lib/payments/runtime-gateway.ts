import 'server-only';
import { createServiceClient } from '../supabase/service';
import type { PaymentGateway } from './gateway';
import {
  isKorpayMerchantId,
  isKorpayMerchantKey,
  isKorpayUuid,
  normalizeKorpaySiteUrl,
} from './korpay-config.mjs';
import { createKorpayPaymentGateway } from './korpay-gateway.server';
import { isNicepayMerchantId, isNicepayMerchantKey } from './nicepay-config.mjs';
import { createNicepayPaymentGateway, type NicepayPaymentReferenceStore } from './nicepay-gateway.server';
import { isTossClientKey, isTossKeyPairAligned, isTossSecretKey } from './toss-config.mjs';
import { createTossPaymentGateway } from './toss-gateway.server';

export type NewPaymentCheckoutPurpose = 'order' | 'ticket';

/**
 * 콜백형 결제 게이트웨이를 가진 provider. 기본은 toss다(에픽 #384 재전환). 판매 제한
 * 상품(19금) 주문의 카드 PG는 nicepay다(2026-11-06, 코페이 대체). korpay는 drain 전용으로
 * 은퇴했다 — 진행 중 콜백·수동 복구를 위해 어댑터와 자격 증명 경로는 남기지만 새 결제는
 * 열지 않는다. bank_transfer는 게이트웨이 seam을 타지 않으므로 여기 없다.
 */
export type PaymentCheckoutProvider = 'toss' | 'korpay' | 'nicepay';

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

function nicepayConfiguration() {
  // 나이스페이 MID·MerchantKey는 production 전용이다. 카드사 심사 기간에도 실 MID로
  // 심사용 canary가 결제한다 — 공개 gate는 닫힌 채다(docs/runbooks/nicepay-production-rollout.md).
  if (process.env.VERCEL_ENV !== 'production') return null;
  const merchantId = process.env.NICEPAY_MID?.trim() ?? '';
  const merchantKey = process.env.NICEPAY_MERCHANT_KEY?.trim() ?? '';
  const siteUrl = process.env.SITE_URL?.trim() ?? '';
  if (!isNicepayMerchantId(merchantId) || !isNicepayMerchantKey(merchantKey)) return null;
  const normalizedSiteUrl = normalizeKorpaySiteUrl(siteUrl, { production: true });
  return normalizedSiteUrl ? { merchantId, merchantKey, siteUrl: normalizedSiteUrl } : null;
}

/**
 * 나이스페이 TID 기록·조회. 웹표준 거래조회·취소가 TID 기준이라 승인 API 전에 DB에 남긴다.
 * service role RPC만 쓰며, 클라이언트는 첫 호출 때 만든다(구성 판정만 하는 호출자가
 * service role env 없이도 게이트웨이를 만들 수 있게).
 */
function nicepayReferenceStore(): NicepayPaymentReferenceStore {
  let client: ReturnType<typeof createServiceClient> | null = null;
  const service = () => {
    client ??= createServiceClient();
    return client;
  };
  return {
    async record(attemptId, transactionId) {
      const { error } = await service().rpc('service_record_nicepay_payment_reference', {
        p_attempt_id: attemptId,
        p_transaction_id: transactionId,
      });
      if (error) throw new Error('nicepay_reference_record_failed');
    },
    async list(attemptId) {
      const { data, error } = await service().rpc('service_get_nicepay_payment_references', {
        p_attempt_id: attemptId,
      });
      if (error) throw new Error('nicepay_reference_lookup_failed');
      if (data === null) return [];
      if (!Array.isArray(data) || data.some((value) => typeof value !== 'string')) {
        throw new Error('nicepay_reference_lookup_invalid');
      }
      return data as string[];
    },
  };
}

/** Credentials make the adapter ready; rollout gates remain independent. */
export function paymentProviderConfigured(provider: PaymentCheckoutProvider = 'toss') {
  if (provider === 'korpay') return korpayConfiguration() !== null;
  if (provider === 'nicepay') return nicepayConfiguration() !== null;
  return tossConfiguration() !== null;
}

/*
 * 신규 결제 rollout gate. null은 그 목적의 신규 결제를 열지 않는다는 뜻이다 — 나이스페이
 * 계약 품목은 판매 제한 굿즈라 티켓은 닫혀 있고, 코페이는 drain 전용으로 은퇴했다
 * (KORPAY_*_CHECKOUT_ENABLED·KORPAY_*_CANARY_USER_ID는 더는 읽지 않는다).
 */
const CHECKOUT_GATE_ENV: Record<
  PaymentCheckoutProvider,
  Record<NewPaymentCheckoutPurpose, { readonly public: string; readonly canary: string } | null>
> = {
  toss: {
    order: { public: 'TOSS_ORDER_CHECKOUT_ENABLED', canary: 'TOSS_ORDER_CANARY_USER_ID' },
    ticket: { public: 'TOSS_TICKET_CHECKOUT_ENABLED', canary: 'TOSS_TICKET_CANARY_USER_ID' },
  },
  nicepay: {
    order: { public: 'NICEPAY_ORDER_CHECKOUT_ENABLED', canary: 'NICEPAY_ORDER_CANARY_USER_ID' },
    ticket: null,
  },
  korpay: {
    order: null,
    ticket: null,
  },
};

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
  const gateEnv = CHECKOUT_GATE_ENV[provider][purpose];
  if (!gateEnv) return false;
  if (!paymentProviderConfigured(provider)) return false;
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
  if (provider === 'nicepay') {
    const configuration = nicepayConfiguration();
    return configuration
      ? createNicepayPaymentGateway({ ...configuration, references: nicepayReferenceStore() })
      : unavailableGateway;
  }
  const configuration = tossConfiguration();
  return configuration
    ? createTossPaymentGateway(configuration)
    : unavailableGateway;
}

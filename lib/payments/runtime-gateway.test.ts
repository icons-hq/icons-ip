import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaymentAttempt } from './gateway';
import {
  PaymentGatewayUnavailableError,
  getPaymentGateway,
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
} from './runtime-gateway';

const attempt: PaymentAttempt = {
  id: '30000000-0000-4000-8000-000000000205',
  provider: 'korpay',
  purpose: 'order',
  refId: '20000000-0000-4000-8000-000000000205',
  amount: 31_000,
  currency: 'KRW',
  idempotencyKey: 'goods:20000000-0000-4000-8000-000000000205',
  providerOrderId: 'O30000000000040008000000000000205',
  providerProductCode: 'P30000000000040008000000000000205',
  expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
};

const CANARY_USER_ID = '10000000-0000-4000-8000-000000000207';

function configureProvider() {
  vi.stubEnv('KORPAY_MID', 'test12345m');
  vi.stubEnv('KORPAY_KEY', 'c2VydmVyLW9ubHkta29ycGF5LWtleS0yMDc=');
  vi.stubEnv('SITE_URL', 'https://icons.example');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('payment runtime gateway', () => {
  it('자격 증명이 없거나 일부만 있으면 fail closed한다', async () => {
    vi.stubEnv('KORPAY_MID', 'test12345m');

    expect(paymentProviderConfigured()).toBe(false);
    expect(newPaymentCheckoutEnabled('order')).toBe(false);
    await expect(getPaymentGateway().prepare(attempt))
      .rejects.toBeInstanceOf(PaymentGatewayUnavailableError);
  });

  it('유효한 Production server config로 real adapter를 구성하되 목적 gate는 기본 OFF다', async () => {
    configureProvider();

    expect(paymentProviderConfigured()).toBe(true);
    expect(newPaymentCheckoutEnabled('order')).toBe(false);
    expect(newPaymentCheckoutEnabled('ticket')).toBe(false);
    await expect(getPaymentGateway().prepare(attempt)).resolves.toMatchObject({
      provider: 'korpay',
      action: { kind: 'client_sdk' },
    });
  });

  it('order와 ticket public rollout gate는 exact true에서만 독립적으로 열린다', () => {
    configureProvider();
    vi.stubEnv('KORPAY_ORDER_CHECKOUT_ENABLED', 'true');
    vi.stubEnv('KORPAY_TICKET_CHECKOUT_ENABLED', 'TRUE');

    expect(newPaymentCheckoutEnabled('order')).toBe(true);
    expect(newPaymentCheckoutEnabled('ticket')).toBe(false);
  });

  it('public gate OFF에서도 목적별 단일 canary user만 통과시킨다', () => {
    configureProvider();
    vi.stubEnv('KORPAY_ORDER_CANARY_USER_ID', CANARY_USER_ID);
    vi.stubEnv('KORPAY_TICKET_CANARY_USER_ID', 'not-a-uuid');

    expect(newPaymentCheckoutEnabled('order', CANARY_USER_ID)).toBe(true);
    expect(newPaymentCheckoutEnabled('order', '10000000-0000-4000-8000-000000000208')).toBe(false);
    expect(newPaymentCheckoutEnabled('order')).toBe(false);
    expect(newPaymentCheckoutEnabled('ticket', 'not-a-uuid')).toBe(false);
  });
});

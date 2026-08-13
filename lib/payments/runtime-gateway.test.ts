import { describe, expect, it, vi } from 'vitest';
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
  expiresAt: '2099-08-13T10:10:00.000Z',
};

describe('payment runtime gateway', () => {
  it('실 provider adapter가 배포되기 전에는 환경변수와 무관하게 fail closed한다', async () => {
    vi.stubEnv('KORPAY_MID', 'must-not-activate');
    vi.stubEnv('KORPAY_KEY', 'must-not-activate');

    expect(paymentProviderConfigured()).toBe(false);
    expect(newPaymentCheckoutEnabled('order')).toBe(false);
    expect(newPaymentCheckoutEnabled('ticket')).toBe(false);
    await expect(getPaymentGateway().prepare(attempt))
      .rejects.toBeInstanceOf(PaymentGatewayUnavailableError);
  });
});

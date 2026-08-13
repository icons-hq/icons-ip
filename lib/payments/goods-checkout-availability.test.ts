import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  goodsCheckoutPaymentsEnabled,
  goodsPaymentConfirmationAvailable,
} from './goods-checkout-availability';

const mocks = vi.hoisted(() => ({
  providerConfigured: false,
  enabledPurposes: new Set<string>(),
}));

vi.mock('./runtime-gateway', () => ({
  paymentProviderConfigured: () => mocks.providerConfigured,
  newPaymentCheckoutEnabled: (purpose: string) => mocks.enabledPurposes.has(purpose),
}));

describe('goodsCheckoutPaymentsEnabled', () => {
  beforeEach(() => {
    mocks.providerConfigured = false;
    mocks.enabledPurposes.clear();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  });

  it('provider rollout gate가 OFF면 service role이 있어도 주문 선점을 닫는다', () => {
    expect(goodsCheckoutPaymentsEnabled()).toBe(false);
  });

  it('provider·rollout gate와 server trust boundary가 모두 준비돼야 열린다', () => {
    mocks.providerConfigured = true;
    expect(goodsPaymentConfirmationAvailable()).toBe(true);
    expect(goodsCheckoutPaymentsEnabled()).toBe(false);

    mocks.enabledPurposes.add('ticket');
    expect(goodsCheckoutPaymentsEnabled()).toBe(false);

    mocks.enabledPurposes.add('order');
    expect(goodsCheckoutPaymentsEnabled()).toBe(true);

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(goodsPaymentConfirmationAvailable()).toBe(false);
    expect(goodsCheckoutPaymentsEnabled()).toBe(false);
  });
});

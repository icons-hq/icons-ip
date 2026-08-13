import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ticketCheckoutPaymentsEnabled,
  ticketPaymentProviderAvailable,
} from './ticket-checkout-availability';

const mocks = vi.hoisted(() => ({
  providerConfigured: false,
  checkoutEnabled: false,
}));

vi.mock('./runtime-gateway', () => ({
  paymentProviderConfigured: () => mocks.providerConfigured,
  newPaymentCheckoutEnabled: () => mocks.checkoutEnabled,
}));

describe('ticketCheckoutPaymentsEnabled', () => {
  beforeEach(() => {
    mocks.providerConfigured = false;
    mocks.checkoutEnabled = false;
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  });

  it('provider rollout gate가 OFF면 예매 선점을 닫는다', () => {
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);
  });

  it('provider가 준비돼도 rollout gate OFF면 신규 예매만 닫고 재조정은 유지한다', () => {
    mocks.providerConfigured = true;
    expect(ticketPaymentProviderAvailable()).toBe(true);
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);

    mocks.checkoutEnabled = true;
    expect(ticketCheckoutPaymentsEnabled()).toBe(true);

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(ticketPaymentProviderAvailable()).toBe(false);
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(ticketPaymentProviderAvailable()).toBe(false);
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);
  });
});

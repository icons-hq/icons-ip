import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ticketCheckoutPaymentsEnabled } from './ticket-checkout-availability';

const mocks = vi.hoisted(() => ({ providerConfigured: false }));

vi.mock('./runtime-gateway', () => ({
  paymentProviderConfigured: () => mocks.providerConfigured,
}));

describe('ticketCheckoutPaymentsEnabled', () => {
  beforeEach(() => {
    mocks.providerConfigured = false;
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  });

  it('provider rollout gate가 OFF면 예매 선점을 닫는다', () => {
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);
  });

  it('provider gate와 server trust boundary가 모두 준비돼야 열린다', () => {
    mocks.providerConfigured = true;
    expect(ticketCheckoutPaymentsEnabled()).toBe(true);

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ticketCheckoutPaymentsEnabled,
  ticketPaymentProviderAvailable,
} from './ticket-checkout-availability';

const mocks = vi.hoisted(() => ({
  providerConfigured: false,
  enabledPurposes: new Set<string>(),
  canaryUserId: null as string | null,
}));

vi.mock('./runtime-gateway', () => ({
  paymentProviderConfigured: () => mocks.providerConfigured,
  newPaymentCheckoutEnabled: (purpose: string, userId?: string) => (
    mocks.enabledPurposes.has(purpose) || userId === mocks.canaryUserId
  ),
}));

describe('ticketCheckoutPaymentsEnabled', () => {
  beforeEach(() => {
    mocks.providerConfigured = false;
    mocks.enabledPurposes.clear();
    mocks.canaryUserId = null;
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

    mocks.enabledPurposes.add('order');
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);

    mocks.enabledPurposes.add('ticket');
    expect(ticketCheckoutPaymentsEnabled()).toBe(true);

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(ticketPaymentProviderAvailable()).toBe(false);
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(ticketPaymentProviderAvailable()).toBe(false);
    expect(ticketCheckoutPaymentsEnabled()).toBe(false);
  });

  it('public gate OFF에서도 인증된 단일 canary user id를 runtime gate에 전달한다', () => {
    mocks.providerConfigured = true;
    mocks.canaryUserId = '10000000-0000-4000-8000-000000000207';

    expect(ticketCheckoutPaymentsEnabled()).toBe(false);
    expect(ticketCheckoutPaymentsEnabled(mocks.canaryUserId)).toBe(true);
  });
});

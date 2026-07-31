import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { placeOrderAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/checkout', async () => await import('../../lib/checkout'));
vi.mock('@/lib/payments/config', async () => await import('../../lib/payments/config'));
vi.mock('@/lib/payments/checkout-availability', async () => (
  await import('../../lib/payments/checkout-availability')
));
/* getServiceRoleConfig는 호출 시점에 env를 읽는다. 실제 구현을 남겨야
   SUPABASE_SERVICE_ROLE_KEY를 비우는 "결제 불가" 테스트가 의미를 갖는다. */
vi.mock('@/lib/supabase/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/service')>()),
  createServiceClient: () => ({ rpc: mocks.rpc }),
}));

const address = {
  recipientName: ' 팬 ',
  phone: '010-1234-5678',
  postalCode: '04799',
  address1: ' 서울 성동구 ',
  address2: '',
  deliveryNote: '',
};
const checkoutKey = '7ad4c967-3d48-44da-a665-64731ac33f62';
const orderId = '5cbcbbed-202d-4676-821a-7706398e57c0';
const userId = '00000000-0000-4000-8000-000000000001';

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: userId, email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
    },
    isStaff: false,
  };
}

describe('placeOrderAction', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.auth = onboardedAuth();
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: orderId, error: null });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'test_gck_example');
    vi.stubEnv('TOSS_SECRET_KEY', 'test_gsk_example');
  });

  it('normalizes fulfillment data and sends no client amount or item list', async () => {
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({ ok: true, orderId });
    expect(mocks.rpc).toHaveBeenCalledWith('place_order', {
      p_user_id: userId,
      p_address: {
        recipientName: '팬',
        phone: '01012345678',
        postalCode: '04799',
        address1: '서울 성동구',
        address2: '',
        deliveryNote: '',
      },
      p_checkout_key: checkoutKey,
    });
  });

  it('rejects malformed runtime inputs before writing', async () => {
    await expect(placeOrderAction({ ...address, postalCode: '499' }, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'invalid_address',
    });
    await expect(placeOrderAction(address, 'not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'invalid_request',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires an authenticated onboarded user and matching payment keys', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'auth_required',
    });

    mocks.auth = { ...onboardedAuth(), profile: null };
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'onboarding_required',
    });

    mocks.auth = onboardedAuth();
    vi.stubEnv('TOSS_SECRET_KEY', 'live_gsk_example');
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'payment_unavailable',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a suspended account before validating or reserving an order', async () => {
    mocks.auth = {
      ...onboardedAuth(),
      profile: {
        ...onboardedAuth().profile,
        suspended_at: '2026-07-17T00:00:00.000Z',
      },
    };

    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'account_suspended',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not reserve stock when the payment settlement service is unavailable', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'payment_unavailable',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('disables test payments in the production Vercel runtime', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');

    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'payment_unavailable',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('allows production test orders only for an active staff reviewer', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION', 'true');

    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'payment_unavailable',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.auth = { ...onboardedAuth(), isStaff: true };
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({ ok: true, orderId });
  });

  it.each([
    ['account_suspended', 'account_suspended'],
    ['cart empty', 'empty_cart'],
    ['out of stock: private-id', 'out_of_stock'],
    ['invalid checkout address', 'invalid_address'],
    ['sensitive db detail', 'unavailable'],
  ] as const)('maps database error %s to %s', async (message, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({ ok: false, error });
  });

  it('fails closed when the RPC returns a malformed order reference', async () => {
    mocks.rpc.mockResolvedValue({ data: 'not-a-uuid', error: null });
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
  });

  it('returns a safe retryable error when the database call throws', async () => {
    mocks.rpc.mockRejectedValue(new Error('private network detail'));
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
});

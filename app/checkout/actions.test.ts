import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { placeOrderAction, prepareGoodsPaymentAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  loadOrder: vi.fn(),
  paymentAvailable: true,
  prepare: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/checkout.server', () => ({ loadCheckoutOrder: mocks.loadOrder }));
vi.mock('@/lib/payments/goods-checkout-availability', () => ({
  goodsCheckoutPaymentsEnabled: () => mocks.paymentAvailable,
}));
vi.mock('@/lib/payments/goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: () => ({ prepare: mocks.prepare }),
}));
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
const paymentAttemptId = '30000000-0000-4000-8000-000000000205';

const checkoutOrder: CheckoutOrderSnapshot = {
  id: orderId,
  status: 'pending',
  total: 31_000,
  shippingFee: 3_000,
  address: null,
  expiresAt: '2099-08-13T10:10:00.000Z',
  createdAt: '2026-08-13T10:00:00.000Z',
  paymentStatus: null,
  items: [],
};

const prepared: PreparedCheckout = {
  attemptId: paymentAttemptId,
  provider: 'korpay',
  action: {
    kind: 'form_post',
    url: 'https://payments.example.test/authenticate',
    fields: { orderNumber: 'O30000000000040008000000000000205' },
  },
  callbackNonce: 'opaque-callback-nonce-205',
  expiresAt: '2099-08-13T10:10:00.000Z',
};

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
    mocks.paymentAvailable = true;
    mocks.loadOrder.mockReset();
    mocks.loadOrder.mockResolvedValue(checkoutOrder);
    mocks.prepare.mockReset();
    mocks.prepare.mockResolvedValue(prepared);
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: orderId, error: null });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
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

  it('requires an authenticated onboarded user and an available provider seam', async () => {
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
    mocks.paymentAvailable = false;
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
    mocks.paymentAvailable = false;

    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({
      ok: false,
      error: 'payment_unavailable',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
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

describe('prepareGoodsPaymentAction', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth();
    mocks.paymentAvailable = true;
    mocks.loadOrder.mockReset();
    mocks.loadOrder.mockResolvedValue(checkoutOrder);
    mocks.prepare.mockReset();
    mocks.prepare.mockResolvedValue(prepared);
  });

  function formData(value: unknown = orderId) {
    const data = new FormData();
    if (typeof value === 'string') data.set('orderId', value);
    return data;
  }

  it('사용자 POST action에서 auth와 owner-scoped 주문을 재검사한 뒤 prepare한다', async () => {
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ prepared });
    expect(mocks.loadOrder).toHaveBeenCalledWith(userId, orderId);
    expect(mocks.prepare).toHaveBeenCalledWith({ userId, orderId });
  });

  it('비로그인·foreign 주문·provider OFF는 attempt를 만들지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({
      error: 'auth_required',
    });

    mocks.auth = onboardedAuth();
    mocks.loadOrder.mockResolvedValue(null);
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ error: 'not_found' });

    mocks.loadOrder.mockResolvedValue(checkoutOrder);
    mocks.paymentAvailable = false;
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({
      error: 'payment_unavailable',
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('만료·결제된 주문은 provider 호출 전에 거부한다', async () => {
    mocks.loadOrder.mockResolvedValue({
      ...checkoutOrder,
      paymentStatus: 'pending',
    });
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({
      error: 'not_payable',
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

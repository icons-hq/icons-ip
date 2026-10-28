import { GoodsPaymentRepositoryError } from '@/lib/payments/goods-checkout.server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { placeOrderAction as placeOrderActionRaw, prepareGoodsPaymentAction } from './actions';

const seenCart=[{goodId:'g1',variantId:'00000000-0000-4000-8000-000000000001',qty:1}];
const placeOrderAction=(address:unknown,key:unknown,method:unknown='card',credits:unknown=0,coupon:unknown=undefined)=>placeOrderActionRaw(address,key,method,credits,coupon,seenCart);

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  loadOrder: vi.fn(),
  paymentAvailable: true,
  availabilityUserIds: [] as Array<string | undefined>,
  availabilityProviders: [] as Array<string | undefined>,
  derivedProvider: 'toss' as 'toss' | 'korpay',
  deriveProvider: vi.fn(),
  runtimeProviders: [] as Array<string | undefined>,
  prepare: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/checkout.server', () => ({ loadCheckoutOrder: mocks.loadOrder }));
vi.mock('@/lib/payments/goods-checkout-availability', () => ({
  goodsCheckoutPaymentsEnabled: (userId?: string, provider?: string) => {
    mocks.availabilityUserIds.push(userId);
    mocks.availabilityProviders.push(provider);
    return mocks.paymentAvailable;
  },
}));
vi.mock('@/lib/payments/goods-sale-restriction.server', () => ({
  deriveGoodsOrderProvider: (orderId: string) => {
    mocks.deriveProvider(orderId);
    return Promise.resolve(mocks.derivedProvider);
  },
}));
vi.mock('@/lib/payments/goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: (provider?: string) => {
    mocks.runtimeProviders.push(provider);
    return { prepare: mocks.prepare };
  },
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
  discountTotal: 0,
  storeCreditTotal: 0,
  address: null,
  expiresAt: '2099-08-13T10:10:00.000Z',
  createdAt: '2026-08-13T10:00:00.000Z',
  paymentStatus: null,
  shipments: [],
  paymentMethod: 'card' as const,
  paymentAttempt: null,
  hasActiveCancellationRequest: false,
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

it.each(['coupon_first_purchase_reserved', 'coupon_first_purchase_pending'])('첫구매 진행 중 주문 안내를 보존한다: %s', async (message) => {
  mocks.auth = onboardedAuth();
  mocks.rpc.mockResolvedValue({ data: null, error: { message } });
  expect(await placeOrderAction(address, checkoutKey)).toEqual({ ok: false, error: 'coupon_rejected', pendingOrder: true });
});

describe('placeOrderAction', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.auth = onboardedAuth();
    mocks.paymentAvailable = true;
    mocks.availabilityUserIds = [];
    mocks.loadOrder.mockReset();
    mocks.loadOrder.mockResolvedValue(checkoutOrder);
    mocks.prepare.mockReset();
    mocks.prepare.mockResolvedValue(prepared);
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: orderId, error: null });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  });

  it('normalizes fulfillment data and sends a cart expectation without client prices', async () => {
    await expect(placeOrderAction(address, checkoutKey)).resolves.toEqual({ ok: true, orderId });
    expect(mocks.rpc).toHaveBeenCalledWith('place_order_with_cart_snapshot', {
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
      /* 결제수단을 넘기지 않은 호출은 카드다. 무통장 24시간 선점을 기본값으로
         흘려보내면 재고가 하루씩 묶인다(#256). */
      p_payment_method: 'card',
      p_store_credit_amount: 0,
      p_expected_user_coupon_id:null,
      p_expected_cart:[{good_id:'g1',variant_id:'00000000-0000-4000-8000-000000000001',qty:1,input_revision:0,input_values:{}}],
    });
    expect(mocks.availabilityUserIds).toContain(userId);
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
  it('고객이 본 전체 장바구니가 빠지거나 중복된 기대값이면 주문 RPC에 닿지 않는다',async()=>{
    expect(await placeOrderActionRaw(address,checkoutKey)).toEqual({ok:false,error:'invalid_request'});
    expect(await placeOrderActionRaw(address,checkoutKey,'card',0,null,[seenCart[0],seenCart[0]])).toEqual({ok:false,error:'invalid_request'});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('원본 카트가 변경되면 재확인 오류를 반환한다',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:'cart_snapshot_changed'}});
    expect(await placeOrderAction(address,checkoutKey)).toEqual({ok:false,error:'cart_changed'});
  });
  it('passes explicit coupon intent including no coupon without any client discount amount', async () => {
    await expect(placeOrderAction(address, checkoutKey, 'card', 0, null)).resolves.toEqual({ ok: true, orderId });
    expect(mocks.rpc).toHaveBeenLastCalledWith('place_order_with_cart_snapshot', expect.objectContaining({ p_expected_user_coupon_id: null }));
    const selectedId = '11111111-1111-4111-8111-111111111111';
    await expect(placeOrderAction(address, checkoutKey, 'card', 0, selectedId)).resolves.toEqual({ ok: true, orderId });
    expect(mocks.rpc).toHaveBeenLastCalledWith('place_order_with_cart_snapshot', expect.objectContaining({ p_expected_user_coupon_id: selectedId }));
    mocks.rpc.mockClear();
    await expect(placeOrderAction(address, checkoutKey, 'card', 0, 'bad-id')).resolves.toEqual({ ok: false, error: 'invalid_request' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('passes only an explicit whole-won credit request and leaves all totals to the atomic order RPC', async () => {
    await expect(placeOrderAction(address, checkoutKey, 'card', '1500')).resolves.toEqual({ ok: true, orderId });
    expect(mocks.rpc).toHaveBeenLastCalledWith('place_order_with_cart_snapshot', expect.objectContaining({ p_store_credit_amount: 1500 }));
    mocks.rpc.mockClear();
    for (const invalid of [-1, 1.5, '1e3', { amount: 1000 }, Number.MAX_SAFE_INTEGER]) {
      await expect(placeOrderAction(address, checkoutKey, 'card', invalid)).resolves.toEqual({ ok: false, error: 'invalid_request' });
    }
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
    ['store_credit_insufficient', 'store_credit_rejected'],
    ['store_credit_disabled', 'store_credit_rejected'],
    ['checkout key conflict', 'checkout_changed'],
    ['coupon_selection_changed', 'coupon_selection_changed'],
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
    mocks.availabilityProviders = [];
    mocks.derivedProvider = 'toss';
    mocks.deriveProvider.mockReset();
    mocks.runtimeProviders = [];
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
    // 일반 주문은 toss로 파생되고 gate·runtime 모두 그 provider를 본다(#392).
    expect(mocks.deriveProvider).toHaveBeenCalledWith(orderId);
    expect(mocks.availabilityProviders).toEqual(['toss']);
    expect(mocks.runtimeProviders).toEqual(['toss']);
  });

  it('판매기간 종료는 결제 환경 오류와 구분해 안내한다', async () => {
    mocks.prepare.mockRejectedValueOnce(new GoodsPaymentRepositoryError('goods_sale_not_open'));
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ error: 'goods_sale_not_open' });
  });

  it('판매 제한 상품 포함 주문은 korpay로 파생돼 korpay gate·조립을 탄다', async () => {
    mocks.derivedProvider = 'korpay';

    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ prepared });

    expect(mocks.availabilityProviders).toEqual(['korpay']);
    expect(mocks.runtimeProviders).toEqual(['korpay']);
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

  /*
   * 승인 거절·시도 만료 뒤의 prepare는 DB가 goods_payment_attempt_not_preparable로 막는다.
   * 그 실패를 "결제 환경을 준비 중"으로 뭉개면 고객은 같은 실패를 반복한다.
   */
  it.each([
    ['승인 거절', { paymentAttempt: { state: 'declined', expiresAt: '2099-08-13T10:05:00.000Z', provider: 'toss' } }],
    ['시도 만료', { paymentAttempt: { state: 'prepared', expiresAt: '2000-01-01T00:00:00.000Z', provider: 'toss' } }],
    ['취소 요청 처리 중', { hasActiveCancellationRequest: true }],
  ])('%s 주문은 provider 호출 없이 payment_closed로 답한다', async (_label, patch) => {
    mocks.loadOrder.mockResolvedValue({ ...checkoutOrder, ...patch });

    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ error: 'payment_closed' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('아직 유효한 prepared 시도는 같은 주문으로 다시 준비한다', async () => {
    mocks.loadOrder.mockResolvedValue({
      ...checkoutOrder,
      paymentAttempt: { state: 'prepared', expiresAt: '2099-08-13T10:05:00.000Z', provider: 'toss' },
    });

    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ prepared });
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it('prepare 실패 뒤 원장을 다시 읽어 닫힌 결제와 일시 장애를 나눈다', async () => {
    mocks.prepare.mockRejectedValue(new Error('goods_payment_repository_failed'));
    mocks.loadOrder
      .mockResolvedValueOnce(checkoutOrder)
      .mockResolvedValueOnce({
        ...checkoutOrder,
        paymentAttempt: { state: 'declined', expiresAt: '2099-08-13T10:05:00.000Z', provider: 'toss' },
      });
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ error: 'payment_closed' });

    mocks.loadOrder.mockReset();
    mocks.loadOrder.mockResolvedValue(checkoutOrder);
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ error: 'payment_unavailable' });

    mocks.loadOrder.mockReset();
    mocks.loadOrder
      .mockResolvedValueOnce(checkoutOrder)
      .mockResolvedValueOnce({ ...checkoutOrder, status: 'canceled' });
    await expect(prepareGoodsPaymentAction({}, formData())).resolves.toEqual({ error: 'not_payable' });
  });
});

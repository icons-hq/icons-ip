import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome } from '@/lib/payments/gateway';
import {
  GoodsPaymentConfirmationInProgressError,
  GoodsPaymentContractError,
} from '@/lib/payments/goods-checkout';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  confirmationAvailable: true,
  confirm: vi.fn(),
  availabilityProvider: undefined as string | undefined,
  checkoutProvider: undefined as string | undefined,
}));

vi.mock('@/lib/payments/goods-checkout-availability', () => ({
  goodsPaymentConfirmationAvailable: (provider?: string) => {
    mocks.availabilityProvider = provider;
    return mocks.confirmationAvailable;
  },
}));
vi.mock('@/lib/payments/goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: (provider?: string) => {
    mocks.checkoutProvider = provider;
    return { confirm: mocks.confirm };
  },
}));

const NONCE = 'opaque-toss-callback-nonce-000000000388';
const PROVIDER_ORDER_ID = 'O30000000000040008000000000000388';
const PAYMENT_KEY = 'tviva20260901000000abcDEF123456789';

const query = {
  paymentType: 'NORMAL',
  orderId: PROVIDER_ORDER_ID,
  paymentKey: PAYMENT_KEY,
  amount: '31000',
};

function callGet(
  overrides: Record<string, string | undefined> = {},
  nonce: string = NONCE,
  rawQuery?: string,
) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...query, ...overrides })) {
    if (value !== undefined) params.set(name, value);
  }
  const url = `https://icons.example/api/payments/goods/confirm/toss/${nonce}?${rawQuery ?? params.toString()}`;
  return GET(new Request(url, { method: 'GET' }), {
    params: Promise.resolve({ nonce }),
  });
}

function outcome(value: ConfirmOutcome['outcome']): ConfirmOutcome {
  return {
    attemptId: '30000000-0000-4000-8000-000000000388',
    provider: 'toss',
    outcome: value,
  };
}

describe('GET /api/payments/goods/confirm/toss/[nonce]', () => {
  beforeEach(() => {
    mocks.confirmationAvailable = true;
    mocks.availabilityProvider = undefined;
    mocks.checkoutProvider = undefined;
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(outcome('approved'));
  });

  it('successUrl 쿼리를 allowlist payload로 줄이고 경로 nonce와 함께 confirm에 넘긴다', async () => {
    const result = await callGet({ extraProviderField: 'must-not-enter-domain' });

    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=approved');
    expect(result.headers.get('cache-control')).toBe('no-store');
    await expect(result.text()).resolves.toBe('');
    expect(mocks.confirm).toHaveBeenCalledWith({
      providerOrderId: PROVIDER_ORDER_ID,
      callbackNonce: NONCE,
      providerPayload: query,
    });
    expect(mocks.availabilityProvider).toBe('toss');
    expect(mocks.checkoutProvider).toBe('toss');
  });

  it.each([
    ['unknown', '/orders?payment=checking'],
    ['needs_review', '/orders?payment=checking'],
    ['declined', '/orders?payment=failed'],
    ['canceled', '/orders?payment=failed'],
  ] as const)('%s는 secret 없는 명시적 303 위치로 이동한다', async (paymentOutcome, location) => {
    mocks.confirm.mockResolvedValue(outcome(paymentOutcome));
    const result = await callGet();
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe(location);
    expect(result.headers.get('location')).not.toContain(PAYMENT_KEY);
  });

  it('중복 callback claim이 진행 중이면 provider 재시도 없이 checking으로 이동한다', async () => {
    mocks.confirm.mockRejectedValue(new GoodsPaymentConfirmationInProgressError());
    const result = await callGet();
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=checking');
  });

  it('known callback 계약 오류는 provider 값을 노출하지 않고 실패 위치로 이동한다', async () => {
    mocks.confirm.mockRejectedValue(new GoodsPaymentContractError('unknown_order'));
    const result = await callGet();
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=failed');
    expect(await result.text()).not.toContain('unknown_order');
  });

  it.each([
    ['orderId 형식 위반', { orderId: 'raw-order-uuid' }, NONCE],
    ['paymentKey 과대', { paymentKey: 'p'.repeat(201) }, NONCE],
    ['amount 0', { amount: '0' }, NONCE],
    ['amount 누락', { amount: undefined }, NONCE],
    ['nonce 형식 위반', {}, 'short'],
  ] as const)('형식 밖 콜백은 domain 호출 전에 실패 위치로 보낸다: %s', async (_label, overrides, nonce) => {
    const result = await callGet(overrides as Record<string, string | undefined>, nonce);
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=failed');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('같은 쿼리 키가 중복 전달되면 domain 호출 전에 거부한다', async () => {
    const result = await callGet({}, NONCE, `${new URLSearchParams(query)}&orderId=${PROVIDER_ORDER_ID}`);
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=failed');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('runtime readiness OFF는 checking으로 fail closed하고 domain을 부르지 않는다', async () => {
    mocks.confirmationAvailable = false;
    const result = await callGet();
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=checking');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('parsed callback의 내부 오류는 checking 303으로 fail closed한다', async () => {
    mocks.confirm.mockRejectedValue(new Error('private provider secret'));
    const result = await callGet();
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=checking');
    expect(await result.text()).not.toContain('private provider secret');
  });
});

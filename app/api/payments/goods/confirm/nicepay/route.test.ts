import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome } from '@/lib/payments/gateway';
import {
  GoodsPaymentConfirmationInProgressError,
  GoodsPaymentContractError,
} from '@/lib/payments/goods-checkout';
import { POST, maxDuration } from './route';

const mocks = vi.hoisted(() => ({
  confirmationAvailable: true,
  confirm: vi.fn(),
  availabilityProvider: undefined as string | undefined,
  checkoutProvider: undefined as string | undefined,
}));

vi.mock('@/lib/payments/goods-checkout-availability', () => ({
  goodsPaymentConfirmationAvailable: (provider: string) => {
    mocks.availabilityProvider = provider;
    return mocks.confirmationAvailable;
  },
}));
vi.mock('@/lib/payments/goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: (provider: string) => {
    mocks.checkoutProvider = provider;
    return { confirm: mocks.confirm };
  },
}));

// 형식만 맞춘 가짜 인증 응답이다.
const fields = {
  AuthResultCode: '0000',
  AuthToken: 'NICETOKN0123456789ABCDEF0123456789ABCD',
  PayMethod: 'CARD',
  MID: 'iconst000m',
  Moid: 'O30000000000040008000000000000611',
  Signature: 'a'.repeat(64),
  Amt: '31000',
  ReqReserved: 'opaque-callback-nonce-611',
  TxTid: 'iconst000m01162611061015001234',
  NextAppURL: 'https://dc1-api.nicepay.co.kr/webapi/pay_process.jsp',
  NetCancelURL: 'https://dc1-api.nicepay.co.kr/webapi/cancel_process.jsp',
};

function request(
  overrides: Record<string, string | undefined> = {},
  extra: Array<[string, string]> = [],
  headers: HeadersInit = {},
) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...fields, ...overrides })) {
    if (value !== undefined) body.set(name, value);
  }
  for (const [name, value] of extra) body.append(name, value);
  return new Request('https://icons.example/api/payments/goods/confirm/nicepay', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: body.toString(),
  });
}

function outcome(value: ConfirmOutcome['outcome'], orderId?: string) {
  return {
    attemptId: '30000000-0000-4000-8000-000000000611',
    provider: 'nicepay' as const,
    outcome: value,
    ...(orderId ? { orderId } : {}),
  };
}

describe('POST /api/payments/goods/confirm/nicepay', () => {
  beforeEach(() => {
    mocks.confirmationAvailable = true;
    mocks.availabilityProvider = undefined;
    mocks.checkoutProvider = undefined;
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(outcome('approved', '20000000-0000-4000-8000-000000000611'));
  });

  it('판정 필드만 남긴 payload로 nicepay checkout을 부르고 주문 완료 화면으로 303 이동한다', async () => {
    const result = await POST(request({}, [
      ['GoodsName', '%C7%D1%B1%DB'],
      ['AuthResultMsg', 'whatever'],
      ['MID', fields.MID],
    ]));

    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders/20000000-0000-4000-8000-000000000611/complete');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(mocks.availabilityProvider).toBe('nicepay');
    expect(mocks.checkoutProvider).toBe('nicepay');
    expect(mocks.confirm).toHaveBeenCalledWith({
      providerOrderId: fields.Moid,
      callbackNonce: fields.ReqReserved,
      providerPayload: fields,
    });
    expect(maxDuration).toBe(60);
  });

  it('EUC-KR로 인코딩된 한글 필드가 섞여도 판정 필드만 읽는다', async () => {
    const body = `${new URLSearchParams(fields).toString()}&GoodsName=ICONS+%B1%C2%C1%EE+%C1%D6%B9%AE&AuthResultMsg=%C1%A4%BB%F3`;
    const result = await POST(new Request('https://icons.example/api/payments/goods/confirm/nicepay', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }));

    expect(result.status).toBe(303);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ providerPayload: fields }));
  });

  it('같은 이름의 판정 필드 값이 서로 다르면 승인 경로로 보내지 않는다', async () => {
    const result = await POST(request({}, [['Amt', '1000']]));

    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=failed');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('형식 밖 주문번호·nonce·content-type·과대 본문은 실패 화면으로 보낸다', async () => {
    for (const candidate of [
      request({ Moid: 'T30000000000040008000000000000611' }),
      request({ ReqReserved: 'short' }),
      request({ MID: 'bad' }),
      request({}, [], { 'content-type': 'application/json' }),
      request({}, [], { 'content-length': String(64 * 1024 + 1) }),
    ]) {
      const result = await POST(candidate);
      expect(result.status).toBe(303);
      expect(result.headers.get('location')).toBe('/orders?payment=failed');
    }
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('자격 증명이 닫혀 있으면 확정하지 않고 확인 화면으로 보낸다', async () => {
    mocks.confirmationAvailable = false;
    const result = await POST(request());

    expect(result.headers.get('location')).toBe('/orders?payment=checking');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('결과마다 확인·실패 화면으로 나누고 처리 중·계약 오류·예외를 흡수한다', async () => {
    mocks.confirm.mockResolvedValueOnce(outcome('unknown'));
    expect((await POST(request())).headers.get('location')).toBe('/orders?payment=checking');
    mocks.confirm.mockResolvedValueOnce(outcome('declined'));
    expect((await POST(request())).headers.get('location')).toBe('/orders?payment=failed');
    mocks.confirm.mockRejectedValueOnce(new GoodsPaymentConfirmationInProgressError());
    expect((await POST(request())).headers.get('location')).toBe('/orders?payment=checking');
    mocks.confirm.mockRejectedValueOnce(new GoodsPaymentContractError('invalid_callback'));
    expect((await POST(request())).headers.get('location')).toBe('/orders?payment=failed');
    mocks.confirm.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await POST(request())).headers.get('location')).toBe('/orders?payment=checking');
  });
});

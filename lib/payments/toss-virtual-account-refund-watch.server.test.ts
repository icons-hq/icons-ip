import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { classifyVirtualAccountRefund, createTossVirtualAccountRefundInspector, escrowCanceledByBuyer } from './toss-virtual-account-refund-watch.server';

const watch = { attemptId: 'a', orderId: 'o', paymentKey: 'va-key-1', providerOrderId: 'O-1', amount: 31000 };
const canceled = (refundStatus: string, extra: Record<string, unknown> = {}) => ({
  paymentKey: 'va-key-1', orderId: 'O-1', totalAmount: 31000, balanceAmount: 0, status: 'CANCELED', method: '가상계좌',
  virtualAccount: { accountNumber: 'X1', bankCode: '20', refundStatus, refundReceiveAccount: null }, ...extra,
});

describe('classifyVirtualAccountRefund', () => {
  it('전액 취소된 이 결제의 은행 송금 상태로 나눈다', () => {
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED'))).toEqual({ outcome: 'completed', refundStatus: 'COMPLETED' });
    expect(classifyVirtualAccountRefund(watch, canceled('FAILED'))).toEqual({ outcome: 'failed', refundStatus: 'FAILED' });
    expect(classifyVirtualAccountRefund(watch, canceled('PARTIAL_FAILED'))).toEqual({ outcome: 'failed', refundStatus: 'PARTIAL_FAILED' });
    expect(classifyVirtualAccountRefund(watch, canceled('PENDING'))).toEqual({ outcome: 'pending', refundStatus: 'PENDING' });
    expect(classifyVirtualAccountRefund(watch, canceled('NONE'))).toEqual({ outcome: 'pending', refundStatus: 'NONE' });
  });

  it('원장의 결제가 아니거나 전액 취소 상태가 아니면 운영자 확인으로 올린다', () => {
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { paymentKey: 'other' })).outcome).toBe('mismatch');
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { orderId: 'O-2' })).outcome).toBe('mismatch');
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { totalAmount: 1000 })).outcome).toBe('mismatch');
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { status: 'DONE', balanceAmount: 31000 })).outcome).toBe('mismatch');
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { virtualAccount: null })).outcome).toBe('mismatch');
  });

  it('형식 밖 상태 표지는 남기지 않는다', () => {
    expect(classifyVirtualAccountRefund(watch, canceled('failed; drop'))).toEqual({ outcome: 'pending', refundStatus: null });
    expect(classifyVirtualAccountRefund(watch, null)).toEqual({ outcome: 'unavailable', refundStatus: null });
  });
});

describe('createTossVirtualAccountRefundInspector', () => {
  function inspector(response: () => Promise<Response>) {
    const fetch = vi.fn(response);
    return { fetch, inspect: createTossVirtualAccountRefundInspector({ secretKey: 'test_sk_synthetic', fetch }).inspect };
  }

  it('원장 결제 키로 결제를 조회하고 시크릿 키를 기본 인증으로 보낸다', async () => {
    const { fetch, inspect } = inspector(async () => new Response(JSON.stringify(canceled('COMPLETED')), { status: 200 }));
    expect(await inspect(watch)).toEqual({ outcome: 'completed', refundStatus: 'COMPLETED', escrowBuyerCanceled: null, escrowLookupFailed: false });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tosspayments.com/v1/payments/va-key-1');
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('test_sk_synthetic:').toString('base64')}`);
  });

  it('없는 결제는 운영자 확인, 5xx·키 오류·전송 실패·형식 오류는 다음 회차로 미룬다', async () => {
    expect((await inspector(async () => new Response('{"code":"NOT_FOUND_PAYMENT"}', { status: 404 })).inspect(watch)).outcome).toBe('mismatch');
    expect((await inspector(async () => new Response('{}', { status: 500 })).inspect(watch)).outcome).toBe('unavailable');
    expect((await inspector(async () => new Response('{}', { status: 401 })).inspect(watch)).outcome).toBe('unavailable');
    expect((await inspector(async () => new Response('not json', { status: 200 })).inspect(watch)).outcome).toBe('unavailable');
    expect((await inspector(async () => { throw new Error('network'); }).inspect(watch)).outcome).toBe('unavailable');
  });

  it('결제 키 형식이 다르면 조회하지 않는다', async () => {
    const { fetch, inspect } = inspector(async () => new Response('{}', { status: 200 }));
    expect((await inspect({ ...watch, paymentKey: 'bad key' })).outcome).toBe('mismatch');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('에스크로 구매자 취소 환불 확인(2026-11-24 보강)', () => {
  const escrowPayment = (refundStatus: string | null, extra: Record<string, unknown> = {}) =>
    canceled(refundStatus as string, { useEscrow: true, escrowKey: 'escrow-1', ...extra });
  const escrow = (body: Record<string, unknown>) => JSON.stringify({ version: '2022-11-16', traceId: 't', entityType: 'escrow', entityBody: {
    id: 'escrow-1', targetId: 'va-key-1', targetType: 'PAYMENT', status: 'CANCELED', cancelType: 'CUSTOMER', ...body } });
  function inspector(responses: Array<() => Promise<Response>>, escrowSecretKey: string | null = 'test_sk_escrow') {
    const fetch = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected request');
      return next();
    });
    return { fetch, inspect: createTossVirtualAccountRefundInspector({ secretKey: 'test_gsk_synthetic', escrowSecretKey, fetch }).inspect };
  }
  const ok = (body: string) => async () => new Response(body, { status: 200 });

  it('송금 상태가 NONE인 에스크로 결제는 거래를 에스크로 키로 조회해 구매자 취소 수락을 넘긴다', async () => {
    const { fetch, inspect } = inspector([ok(JSON.stringify(escrowPayment('NONE'))), ok(escrow({}))]);
    expect(await inspect(watch)).toEqual({ outcome: 'pending', refundStatus: 'NONE', escrowBuyerCanceled: true, escrowLookupFailed: false });
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tosspayments.com/v2/escrows/escrow-1');
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('test_sk_escrow:').toString('base64')}`);
    // 송금 상태 칸이 아예 없어도 같다.
    const missing = inspector([ok(JSON.stringify(escrowPayment(null, { virtualAccount: { accountNumber: 'X1', bankCode: '20' } }))), ok(escrow({}))]);
    expect((await missing.inspect(watch)).escrowBuyerCanceled).toBe(true);
  });

  it('결제 취소로 함께 끝났거나 진행 중이거나 다른 결제의 거래면 false다', async () => {
    for (const body of [{ cancelType: 'TARGET_CANCELED' }, { status: 'CANCEL_REQUESTED', cancelType: null }, { targetId: 'other' }, { targetId: undefined }]) {
      expect(await inspector([ok(JSON.stringify(escrowPayment('NONE'))), ok(escrow(body))]).inspect(watch), JSON.stringify(body))
        .toEqual({ outcome: 'pending', refundStatus: 'NONE', escrowBuyerCanceled: false, escrowLookupFailed: false });
    }
  });

  it('송금 상태가 있거나(형식 밖 값 포함) 에스크로가 아니거나 송금 중이 아니면 거래를 조회하지 않는다', async () => {
    for (const payment of [
      escrowPayment('PENDING'),
      escrowPayment('failed; drop'),
      canceled('NONE'),
      escrowPayment('COMPLETED'),
      escrowPayment('FAILED'),
      escrowPayment('NONE', { status: 'DONE', balanceAmount: 31000 }),
    ]) {
      const { fetch, inspect } = inspector([ok(JSON.stringify(payment))]);
      const result = await inspect(watch);
      expect(result.escrowBuyerCanceled, JSON.stringify(payment)).toBeNull();
      expect(result.escrowLookupFailed).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('확인해야 하는데 에스크로 키·거래 id가 없으면 조회하지 않고 확인 실패로 알린다', async () => {
    for (const [payment, key] of [[escrowPayment('NONE'), null], [escrowPayment('NONE', { escrowKey: null }), 'test_sk_escrow']] as const) {
      const { fetch, inspect } = inspector([ok(JSON.stringify(payment))], key);
      expect(await inspect(watch)).toEqual({ outcome: 'pending', refundStatus: 'NONE', escrowBuyerCanceled: null, escrowLookupFailed: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('거래 조회가 실패하면 결제 조회 결과는 그대로 두고 확인 없음·확인 실패로 넘긴다', async () => {
    for (const failure of [
      async () => new Response('{}', { status: 401 }),
      async () => new Response('{"code":"NOT_FOUND"}', { status: 404 }),
      async () => new Response('{}', { status: 500 }),
      async () => new Response('{}', { status: 429 }),
      async () => new Response('not json', { status: 200 }),
      async () => new Response('{"entityBody":{}}', { status: 200 }),
      async () => { throw new Error('network'); },
    ]) {
      expect(await inspector([ok(JSON.stringify(escrowPayment('NONE'))), failure]).inspect(watch))
        .toEqual({ outcome: 'pending', refundStatus: 'NONE', escrowBuyerCanceled: null, escrowLookupFailed: true });
    }
  });

  it('응답 모양 판정', () => {
    expect(escrowCanceledByBuyer(watch, JSON.parse(escrow({})))).toBe(true);
    expect(escrowCanceledByBuyer(watch, { status: 'CANCELED', cancelType: 'CUSTOMER', targetId: 'va-key-1' })).toBe(true);
    expect(escrowCanceledByBuyer(watch, JSON.parse(escrow({ targetType: 'ORDER' })))).toBe(false);
    expect(escrowCanceledByBuyer(watch, null)).toBeNull();
  });
});
